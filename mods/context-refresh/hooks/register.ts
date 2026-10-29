import type { EngineInterface, Register } from 'claude-code'

// snapshot -> compact to one marker message (session_id kept) -> context-restore; also auto at autoPercent.

const COMMAND = 'context-refresh'
const TOOL = 'refresh'
const TOOL_FULL = 'mcp__context-refresh__refresh'
const DEFAULT_AUTO_PERCENT = 90
const WAIT_LIMIT_MS = 10 * 60 * 1000
const AUTO_COOLDOWN_MS = 30 * 60 * 1000

// pending: asked for a turn that calls the tool; snapshotting: that turn writes the snapshot.
type Phase = 'idle' | 'pending' | 'snapshotting' | 'compacting' | 'restoring'
type Timer = ReturnType<EngineInterface['clock']['after']>

let phase: Phase = 'idle'
let startedAt = 0
let percentAtStart: number | undefined
let snapshotPath = ''
let armedPath = ''
let didReset = false
let isSessionKept = true
let autoPercent = DEFAULT_AUTO_PERCENT
// Set only for an automatic run: the person may be away, so it reports by macOS notification.
let autoAt: number | undefined
let autoCooldownUntil = 0
let currentTurnId: string | undefined
let currentTurnText = ''
// Other turns (a Monitor's notifications, the person's next message) may end first; only these count.
let snapshotTurnId: string | undefined
let restoreTurnId: string | undefined
let waitTimer: Timer | undefined
let logPath: string | undefined
const logLines: string[] = []

const COMPACT_ARGS = 'context-refresh: reset'
const RESET_MARK = '（context-refresh: 会話をリセットしました）'
const REQUEST_MARK = 'context-refresh mod からの依頼'
const RESTORE_MARK = 'context-refresh で会話を空にしました'

// The model cannot see its own context fill and guesses badly, so the snapshot gets the engine's figure.
const savedAt = () =>
  percentAtStart === undefined ? 'Context at Save は「不明」と書くこと。' : `Context at Save には ${percentAtStart}% と書くこと（推測しない）。`

const requestPrompt = (trigger: string) =>
  `${REQUEST_MARK}（${trigger}）です。${TOOL_FULL} を呼び、その結果の指示に従ってください。`

const TOOL_DESCRIPTION =
  'Context refresh: saves a snapshot, empties this conversation while keeping the same session id, then resumes from the snapshot automatically. ' +
  'Call this when the user asks to refresh the context (e.g. 「コンテキストリフレッシュして」「リフレッシュして」「context refresh」) or when the context-refresh mod asks you to. ' +
  'Call it first, then follow its result. Never run /clear or /compact for this.'

const toolResult = () =>
  '受け付けました。このターンのうちに context-snapshot-refresh スキルでスナップショットを書き、「スナップショット作成完了」とだけ返してターンを終えてください。' +
  'ターン終了後に context-refresh mod が会話を空にし（session_id 維持）、context-restore を自動で始めます。' +
  savedAt()

const restorePrompt = (path: string) =>
  `${RESTORE_MARK}（session_id は維持）。context-restore スキルの手順で作業を再開してください。` +
  `スナップショットが注入されていなければ ${path} を Read すること。`

const isWindows = async ($: EngineInterface) => (await $.env.get('OS')) === 'Windows_NT'

// Windows paths arrive as C:\x or Git Bash's /c/x; the hooks name snapshots off C:/x, drive upper-cased.
function toWindowsForm(path: string): string {
  let p = path.replace(/\\/g, '/')
  const msys = /^\/([a-zA-Z])(\/|$)/.exec(p)
  if (msys) p = `${msys[1]}:/${p.slice(3)}`

  return /^[a-z]:/.test(p) ? p[0]!.toUpperCase() + p.slice(1) : p
}

async function home($: EngineInterface): Promise<string> {
  if (!(await isWindows($))) return (await $.env.get('HOME')) ?? ''

  return toWindowsForm((await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '')
}

// One file per session, the last 300 decisions: what to read when a refresh stops for no clear reason.
async function log($: EngineInterface, event: string, data: Record<string, unknown> = {}) {
  try {
    logLines.push(JSON.stringify({ at: new Date(await $.clock.now()).toISOString(), event, phase, ...data }))
    if (logLines.length > 300) logLines.splice(0, logLines.length - 300)
    logPath ??= `${await home($)}/.claude/context-refresh-${(await $.session.id()).slice(0, 8)}.log`
    await $.fs.write(logPath, `${logLines.join('\n')}\n`)
  } catch {
    // Logging must never stop the refresh.
  }
}

// Same name as hooks/snapshot-path.sh and .ps1: every UTF-8 byte outside [0-9A-Za-z] becomes '-'.
function snapshotKey(dir: string): string {
  let key = ''
  for (const ch of dir) {
    const cp = ch.codePointAt(0)!
    key += /[0-9A-Za-z]/.test(ch) ? ch : '-'.repeat(cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4)
  }

  return key
}

async function readAutoPercent($: EngineInterface): Promise<number> {
  const config = `${await home($)}/.claude/hooks/ctx-config.sh`
  if (!(await $.fs.exists(config))) return DEFAULT_AUTO_PERCENT
  const found = /^\s*CTX_AUTO_REFRESH_THRESHOLD=["']?(\d+)/m.exec(await $.fs.read(config))
  const n = Number.parseInt(found?.[1] ?? '', 10)

  return Number.isFinite(n) && n > 0 && n <= 100 ? n : DEFAULT_AUTO_PERCENT
}

async function resolveSnapshotPath($: EngineInterface, dir?: string): Promise<string> {
  const raw = dir ?? (await $.session.cwd())

  return `${await home($)}/.claude/context_snapshot_${snapshotKey((await isWindows($)) ? toWindowsForm(raw) : raw)}.md`
}

// The model's shell may cd before it writes, so look for what this run wrote instead of predicting the name.
async function findSnapshot($: EngineInterface): Promise<{ path: string } | { failed: string }> {
  const dir = `${await home($)}/.claude`
  const fresh = (await $.fs.list(dir))
    .filter(f => f.kind === 'file' && /^context_snapshot_.+\.md$/.test(f.name) && f.mtimeMs >= startedAt)
    .map(f => `${dir}/${f.name}`)
  if (fresh.length === 0) return { failed: `今回のスナップショットが見つかりません（${dir}/context_snapshot_*.md）` }
  if (fresh.length === 1) return { path: fresh[0]! }
  const preferred = [await resolveSnapshotPath($), await resolveSnapshotPath($, await $.session.root()), armedPath]
  const path = preferred.find(p => fresh.includes(p))

  return path === undefined ? { failed: `今回書かれたスナップショットが ${fresh.length} 件あり、どれか決められません` } : { path }
}

// Same format and sound as ctx-notify.sh, through its shared sender.
// Start and finish are notified for automatic runs only; a stop always is, since a toast is invisible in the desktop app.
async function notify($: EngineInterface, title: string, body: string, isAlways = false) {
  if (autoAt === undefined && !isAlways) return
  const h = await home($)
  const isWin = await isWindows($)
  const cwd = isWin ? toWindowsForm(await $.session.cwd()) : await $.session.cwd()
  const dir = cwd === h ? '~' : cwd.startsWith(`${h}/`) ? `~${cwd.slice(h.length)}` : cwd
  const sender = `${h}/.claude/hooks/ctx-notify-send.sh`
  try {
    if (!isWin && (await $.fs.exists(sender))) {
      const { exitCode } = await $.process.run(['bash', sender, `Claude Code — ${title}`, dir, body])
      if (exitCode === 0) return
    }
    // No sender script (Windows, or a machine set up from the README alone): the engine's own notification.
    await $.ui.notify(`${dir}: ${body}`, { title: `Claude Code — ${title}` })
  } catch {
    // A notification that fails must not stop the refresh.
  }
}

function clearWait() {
  waitTimer?.cancel()
  waitTimer = undefined
}

function waitAtMost($: EngineInterface, onTimeout: () => Promise<void>) {
  clearWait()
  waitTimer = $.clock.after(WAIT_LIMIT_MS, () => void onTimeout())
}

async function finish($: EngineInterface, outcome: { failed: string } | 'restored') {
  await log($, 'finish', { outcome })
  clearWait()
  phase = 'idle'
  snapshotTurnId = undefined
  restoreTurnId = undefined
  $.ui.status(undefined)
  if (outcome === 'restored') {
    $.ui.toast('context-refresh: 復元完了')
    await notify($, '✅ refresh 完了', isSessionKept ? '作業を再開しました（session_id 維持）' : '作業を再開しました（session_id が変化）')
  } else {
    $.ui.toast(`context-refresh: ${outcome.failed}`)
    await notify($, '❌ refresh 中止', outcome.failed, true)
    // A failed automatic run must not restart on the very next turn and fail again.
    if (autoAt !== undefined) autoCooldownUntil = (await $.clock.now()) + AUTO_COOLDOWN_MS
  }
  autoAt = undefined
}

// The turn running this tool call writes the snapshot.
async function bindSnapshotTurn($: EngineInterface) {
  if (phase === 'idle') {
    autoAt = undefined
    percentAtStart = (await $.session.usage()).context.percent
  }
  clearWait()
  armedPath = await resolveSnapshotPath($)
  snapshotPath = ''
  startedAt = await $.clock.now()
  snapshotTurnId = currentTurnId
  phase = 'snapshotting'
  $.ui.status('refresh: snapshot…')
  await log($, 'bind', { snapshotTurnId })
}

// /context-refresh and the 90% trigger: ask for a turn that calls the tool, so the snapshot turn is one we can name.
async function start($: EngineInterface, percent?: number): Promise<string> {
  if (phase !== 'idle') return `context-refresh は実行中です（${phase}）`
  autoAt = percent
  percentAtStart = (await $.session.usage()).context.percent
  phase = 'pending'
  $.ui.status('refresh: 開始待ち…')
  const trigger = percent === undefined ? '手動' : `自動 ${percent}%`
  await log($, 'start', { trigger })
  // A command.run hook may not submit (it would wait on its own turn): defer to a timer.
  $.clock.after(0, () => {
    $.prompt.submit({ text: requestPrompt(trigger) }).catch(error => {
      void log($, 'submit-failed', { error: String(error) })
      if (phase === 'pending') void finish($, { failed: '開始のプロンプトを送れませんでした' })
    })
  })
  waitAtMost($, async () => {
    if (phase === 'pending') await finish($, { failed: '10 分待っても始められませんでした（バックグラウンドの作業が動き続けていると始まらないことがあります）' })
  })
  await notify($, `🔄 自動 refresh 開始（${percent}%）`, 'snapshot → 会話リセット → 復元')

  return `context-refresh 開始（${trigger}）: snapshot → 会話を0に → restore`
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
      restoreTurnId = undefined
      $.ui.status('refresh: restore…')
      $.ui.log(`context-refresh: 会話を空にしました（session_id ${after}${isSessionKept ? ' 維持' : ` ← ${before} から変化`}）`)
      await log($, 'emptied', { isSessionKept, snapshotPath })
      $.prompt.submit({ text: restorePrompt(snapshotPath) }).catch(error => void log($, 'submit-failed', { error: String(error) }))
      waitAtMost($, async () => {
        if (phase === 'restoring') await finish($, { failed: '会話は空にしましたが、再開のプロンプトが始まりませんでした。何か送れば、スナップショットから復元されます' })
      })
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

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      currentTurnId = e.turnId
      currentTurnText = e.text
      if (phase === 'restoring' && e.text.includes(RESTORE_MARK)) restoreTurnId = e.turnId
    }

    return next(e)
  })

  // The model's way in: 「コンテキストリフレッシュして」 or the mod's own request -> this tool -> snapshot in the same turn.
  on('tool.call', { tool: TOOL_FULL }, async $ => {
    // A request the mod sent earlier may arrive after that refresh ended: it must not start a new one.
    if (phase === 'idle' && currentTurnText.includes(REQUEST_MARK)) {
      await log($, 'stale-request', { turnId: currentTurnId })

      return { result: 'この依頼はもう済んでいます。この呼び出しは何もしません。リフレッシュは動いていないので、今の作業をそのまま続けてください。' }
    }
    // Worded so the model goes on with its work: "do nothing" was once read as "stop working" for every later turn.
    if (phase !== 'idle' && phase !== 'pending') return { result: `context-refresh は別のターンで実行中です（${phase}）。この呼び出しは何もしません。待たずに、今の作業をそのまま続けてください。` }
    await bindSnapshotTurn($)

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
      if (snapshotTurnId !== undefined && e.turnId !== snapshotTurnId) {
        await log($, 'other-turn', { turnId: e.turnId, snapshotTurnId })

        return result
      }
      if (e.reason !== 'answer') await finish($, { failed: 'スナップショット作成が中断されました' })
      else {
        const found = await findSnapshot($)
        await log($, 'snapshot-turn-done', { found })
        if ('failed' in found) await finish($, found)
        else {
          snapshotPath = found.path
          phase = 'compacting'
          $.ui.status('refresh: 会話を空に…')
          emptyConversation($)
        }
      }
    } else if (phase === 'restoring') {
      // Without a recognised restore turn, the first turn that ends is the best evidence there is.
      if (restoreTurnId !== undefined && e.turnId !== restoreTurnId) return result
      await finish($, 'restored')
    } else if (phase === 'idle' && e.reason === 'answer') {
      const { tokens, window, percent } = (await $.session.usage()).context
      if (percent !== undefined && percent >= autoPercent) {
        const now = await $.clock.now()
        await log($, 'auto-check', { tokens, window, percent, autoPercent, isCoolingDown: now < autoCooldownUntil })
        if (now >= autoCooldownUntil) {
          $.ui.toast(`context-refresh: コンテキスト ${percent}% のため自動 refresh します`)
          await start($, percent)
        }
      }
    }

    return result
  })
}
