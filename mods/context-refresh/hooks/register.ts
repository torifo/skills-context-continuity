import type { EngineInterface, Register } from 'claude-code'

// snapshot -> compact to one marker message (session_id kept) -> context-restore; also auto at autoPercent.

const COMMAND = 'context-refresh'
const TOOL = 'refresh'
const TOOL_FULL = 'mcp__context-refresh__refresh'
const DEFAULT_AUTO_PERCENT = 90

type Phase = 'idle' | 'snapshotting' | 'compacting' | 'restoring'

let phase: Phase = 'idle'
let startedAt = 0
let percentAtStart: number | undefined
let snapshotPath = ''
let didReset = false
let isSessionKept = true
let autoPercent = DEFAULT_AUTO_PERCENT
// Set only for an automatic run: the person may be away, so it reports by macOS notification.
let autoAt: number | undefined

const COMPACT_ARGS = 'context-refresh: reset'
const RESET_MARK = '（context-refresh: 会話をリセットしました）'

// The model cannot see its own context fill and guesses badly, so the snapshot gets the engine's figure.
const savedAt = () =>
  percentAtStart === undefined ? 'Context at Save は「不明」と書くこと。' : `Context at Save には ${percentAtStart}% と書くこと（推測しない）。`

const snapshotPrompt = () =>
  'context-snapshot-refresh スキルを起動し、その手順でスナップショットを作成してください。' +
  savedAt() +
  '書き終えたら「スナップショット作成完了」とだけ返してターンを終えること（/clear・/compact は不要。続きは context-refresh mod が自動で行う）。'

const TOOL_DESCRIPTION =
  'Context refresh: saves a snapshot, empties this conversation while keeping the same session id, then resumes from the snapshot automatically. ' +
  'Call this when the user asks to refresh the context (e.g. 「コンテキストリフレッシュして」「リフレッシュして」「context refresh」). ' +
  'Call it first, then follow its result. Never run /clear or /compact for this.'

const toolResult = () =>
  '受け付けました。このターンのうちに context-snapshot-refresh スキルでスナップショットを書き、「スナップショット作成完了」とだけ返してターンを終えてください。' +
  'ターン終了後に context-refresh mod が会話を空にし（session_id 維持）、context-restore を自動で始めます。' +
  savedAt()

const restorePrompt = (path: string) =>
  'context-refresh で会話を空にしました（session_id は維持）。context-restore スキルの手順で作業を再開してください。' +
  `スナップショットが注入されていなければ ${path} を Read すること。`

const home = async ($: EngineInterface) => (await $.env.get('HOME')) ?? ''

async function readAutoPercent($: EngineInterface): Promise<number> {
  const script = '. "$1/.claude/hooks/ctx-config.sh" 2>/dev/null; printf %s "${CTX_AUTO_REFRESH_THRESHOLD:-}"'
  const { stdout } = await $.process.run(['bash', '-c', script, 'ctx-config', await home($)])
  const n = Number.parseInt(stdout.trim(), 10)

  return Number.isFinite(n) && n > 0 && n <= 100 ? n : DEFAULT_AUTO_PERCENT
}

async function resolveSnapshotPath($: EngineInterface): Promise<string> {
  const cwd = await $.session.cwd()
  const { exitCode, stdout } = await $.process.run(['bash', `${await home($)}/.claude/hooks/snapshot-path.sh`, cwd])
  if (exitCode !== 0 || stdout.trim() === '') throw new Error('snapshot-path.sh failed')

  return stdout.trim()
}

async function isFreshSnapshot($: EngineInterface): Promise<boolean> {
  if (!(await $.fs.exists(snapshotPath))) return false
  const { kind, mtimeMs } = await $.fs.stat(snapshotPath)

  return kind === 'file' && mtimeMs >= startedAt
}

// Same format and sound as ctx-notify.sh, through its shared sender.
async function notify($: EngineInterface, title: string, body: string) {
  if (autoAt === undefined) return
  const h = await home($)
  const cwd = await $.session.cwd()
  const dir = cwd === h ? '~' : cwd.startsWith(`${h}/`) ? `~${cwd.slice(h.length)}` : cwd
  await $.process.run(['bash', `${h}/.claude/hooks/ctx-notify-send.sh`, `Claude Code — ${title}`, dir, body])
}

async function finish($: EngineInterface, outcome: { failed: string } | 'restored') {
  phase = 'idle'
  $.ui.status(undefined)
  if (outcome === 'restored') {
    $.ui.toast('context-refresh: 復元完了')
    await notify($, '✅ refresh 完了', isSessionKept ? '作業を再開しました（session_id 維持）' : '作業を再開しました（session_id が変化）')
  } else {
    $.ui.toast(`context-refresh: ${outcome.failed}`)
    await notify($, '❌ refresh 中止', outcome.failed)
  }
  autoAt = undefined
}

// Snapshotting begins now; the turn that writes the snapshot is either this one (tool) or a submitted one.
async function arm($: EngineInterface, percent?: number) {
  snapshotPath = await resolveSnapshotPath($)
  startedAt = await $.clock.now()
  percentAtStart = (await $.session.usage()).context.percent
  autoAt = percent
  phase = 'snapshotting'
  $.ui.status('refresh: snapshot…')
}

async function start($: EngineInterface, percent?: number): Promise<string> {
  if (phase !== 'idle') return `context-refresh は実行中です（${phase}）`
  await arm($, percent)
  // A command.run hook may not submit (it would wait on its own turn): defer to a timer.
  $.clock.after(0, () => void $.prompt.submit({ text: snapshotPrompt() }))
  await notify($, `🔄 自動 refresh 開始（${percent}%）`, 'snapshot → 会話リセット → 復元')

  return `context-refresh 開始（${percent === undefined ? '手動' : `自動 ${percent}%`}）: snapshot → 会話を0に → restore`
}

// Runs between turns: compaction rejects while a turn runs, so retry briefly.
function emptyConversation($: EngineInterface, tries = 0) {
  $.clock.after(300, () => {
    void (async () => {
      const before = await $.session.id()
      try {
        // Via /compact, not $.session.compact: a plugin's own call skips its own session.compact hook.
        didReset = false
        await $.command.run({ command: 'compact', args: COMPACT_ARGS })
      } catch {
        if (tries < 20) return emptyConversation($, tries + 1)

        return finish($, { failed: '会話を空にできませんでした' })
      }
      if (!didReset) $.ui.toast('context-refresh: 空化フックが動かず通常の compact になりました（復元は続行）')
      const after = await $.session.id()
      isSessionKept = before === after
      phase = 'restoring'
      $.ui.status('refresh: restore…')
      $.ui.log(`context-refresh: 会話を空にしました（session_id ${after}${isSessionKept ? ' 維持' : ` ← ${before} から変化`}）`)
      void $.prompt.submit({ text: restorePrompt(snapshotPath) })
    })()
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'snapshot → 会話を完全に空に（session_id 維持）→ context-restore',
    })
    await $.tool.register({ name: TOOL, description: TOOL_DESCRIPTION, isDeferred: false })
    autoPercent = await readAutoPercent($).catch(() => DEFAULT_AUTO_PERCENT)

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => ({ text: await start($) })).catch(() => {
    phase = 'idle'
    autoAt = undefined

    return { text: `context-refresh を開始できませんでした（詳細は claude --debug）` }
  })

  // The model's way in: 「コンテキストリフレッシュして」 -> this tool -> snapshot in the same turn.
  on('tool.call', { tool: TOOL_FULL }, async $ => {
    if (phase !== 'idle') return { result: `context-refresh は実行中です（${phase}）。何もせずターンを終えてください。` }
    await arm($)

    return { result: toolResult() }
  }).catch(() => {
    phase = 'idle'

    return { deny: 'context-refresh を開始できませんでした。ユーザーに /context-refresh を打つよう伝えてください。' }
  })

  // Keep no summary, only the one message the engine requires; the snapshot file carries the state.
  on('session.compact', ($, e, next) => {
    if (phase !== 'compacting' || e.agentId !== undefined || e.instructions !== COMPACT_ARGS) return next(e)
    didReset = true

    return { messages: [{ role: 'user', text: RESET_MARK, toolUses: [] }] }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result

    if (phase === 'snapshotting') {
      if (e.reason !== 'answer') await finish($, { failed: 'スナップショット作成が中断されました' })
      else if (!(await isFreshSnapshot($))) await finish($, { failed: `スナップショットが書かれていません: ${snapshotPath}` })
      else {
        phase = 'compacting'
        $.ui.status('refresh: 会話を空に…')
        emptyConversation($)
      }
    } else if (phase === 'restoring') {
      await finish($, 'restored')
    } else if (phase === 'idle' && e.reason === 'answer') {
      const { percent } = (await $.session.usage()).context
      if (percent !== undefined && percent >= autoPercent) {
        $.ui.toast(`context-refresh: コンテキスト ${percent}% のため自動 refresh します`)
        await start($, percent)
      }
    }

    return result
  })
}
