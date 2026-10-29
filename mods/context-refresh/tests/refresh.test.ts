import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const SNAP = '/home/u/.claude/context_snapshot_-work.md'
const RESET = [{ role: 'user', text: '（context-refresh: 会話をリセットしました）', toolUses: [] }]

const TRANSCRIPT = '/home/u/.claude/projects/-work/sess-1-abcdef.jsonl'

type WorldOpts = {
  percent?: number; snapshotWritten?: boolean; written?: string[]; configPercent?: string; env?: Record<string, string>; cwd?: string; noSender?: boolean
  messages?: unknown[]; messagesFail?: boolean; transcriptAt?: string; projectDirs?: string[]
}

function world($: Engine, on: On, opts: WorldOpts = {}) {
  const clock = mock.clock(on, { now: 1000 })
  mock.env(on, opts.env ?? { HOME: '/home/u' })
  const prompts: string[] = []
  const compactions: unknown[] = []
  const compactedTo: unknown[] = []
  const notifications: string[][] = []
  const uiNotes: { text: string; title?: string }[] = []
  const runs: string[][] = []
  const listed: unknown[] = []
  const logs: { path: string; text: string }[] = []
  let mtime = opts.snapshotWritten === false ? 0 : 5000
  let percent = opts.percent ?? 10
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  // Stands for core's /compact: raises session.compact with the typed args as instructions.
  on('command.run', { command: 'compact' }, async (_$, e) => {
    const r = await $.session.compact({ trigger: 'manual', instructions: e.args, messages: [] } as never)
    compactedTo.push(r.messages)

    return { text: 'compacted' }
  })
  on('command.register', () => ({ value: {} }) as never)
  on('tool.register', () => ({ value: { tool: 'mcp__context-refresh__refresh' } }) as never)
  on('session.cwd', () => ({ value: opts.cwd ?? '/work' }) as never)
  on('session.id', () => ({ value: 'sess-1-abcdef' }) as never)
  on('session.root', () => ({ value: opts.cwd ?? '/work' }) as never)
  on('process.run', (_$, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    runs.push(argv)
    if (argv[1]?.endsWith('ctx-notify-send.sh')) notifications.push(argv.slice(2))

    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('fs.exists', (_$, e) => {
    const path = String((e as unknown as { path?: string }).path ?? JSON.stringify(e))
    if (path.endsWith('ctx-notify-send.sh')) return { value: !opts.noSender } as never
    if (path.endsWith('.jsonl')) return { value: path === (opts.transcriptAt ?? TRANSCRIPT) } as never

    return { value: path.endsWith('ctx-config.sh') && opts.configPercent !== undefined } as never
  })
  on('fs.read', (_$, e) =>
    e.path.endsWith('.md')
      ? ({ value: '# Claude Context Snapshot\n本文\n' }) as never
      : ({ value: `CTX_HIGH_THRESHOLD=80\nCTX_AUTO_REFRESH_THRESHOLD=${opts.configPercent}\n` }) as never)
  on('session.messages', () => {
    if (opts.messagesFail) throw new Error('messages unavailable')

    return { value: opts.messages ?? [] } as never
  })
  on('fs.write', (_$, e) => {
    logs.push(e as unknown as { path: string; text: string })

    return { value: undefined } as never
  })
  on('ui.notify', (_$, e) => {
    uiNotes.push(e as unknown as { text: string; title?: string })

    return { value: { isSent: true, channel: 'test' } } as never
  })
  // ~/.claude as the model left it: this run's snapshots (fresh), an old one, a sidecar.
  const written = opts.written ?? (opts.snapshotWritten === false ? [] : ['context_snapshot_-work.md'])
  on('fs.list', (_$, e) => (listed.push(e), e.path.endsWith('/projects') ? {
    value: (opts.projectDirs ?? ['-work']).map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 1, isLink: false })),
  } : { value: [
    ...written.map(name => ({ name, kind: 'file', size: 10, mtimeMs: mtime, isLink: false })),
    { name: 'context_snapshot_-old.md', kind: 'file', size: 10, mtimeMs: 1, isLink: false },
    { name: 'context_snapshot_-work.git.txt', kind: 'file', size: 10, mtimeMs: 5000, isLink: false },
  ] }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: percent * 10, window: 1000, percent }, rateLimits: [] } }) as never)
  on('prompt.submit', (_$, e) => {
    prompts.push(e.text)

    return { text: e.text } as never
  })
  on('session.compact', (_$, e) => {
    compactions.push(e)

    return { messages: [{ role: 'user', text: 'core summary', toolUses: [] }] }
  })

  return {
    clock, prompts, compactions, compactedTo, notifications, uiNotes, runs, listed, logs,
    setMtime: (m: number) => (mtime = m), setPercent: (p: number) => (percent = p),
  }
}

let turnSeq = 0
async function startTurn($: Engine, text = '作業の続き'): Promise<string> {
  const turnId = `t${++turnSeq}`
  await $.turn.start({ text, turnId } as never)

  return turnId
}
const endTurn = ($: Engine, turnId: string, reason: 'answer' | 'aborted' = 'answer') =>
  $.turn.complete({ reason, answer: 'ok', durationMs: 1, isAborted: reason === 'aborted', turnId } as never)
const callTool = ($: Engine) => $.tool.call({ tool: 'mcp__context-refresh__refresh', input: {} } as never)
// A turn in which the model answers the request by calling the tool (and, in the test world, the snapshot exists).
async function toolTurn($: Engine, text: string) {
  const turnId = await startTurn($, text)
  const result = await callTool($)
  await endTurn($, turnId)

  return JSON.stringify(result)
}
async function workTurn($: Engine, text = '作業の続き') {
  await endTurn($, await startTurn($, text))
}
async function restoreTurn($: Engine, prompt: string) {
  await endTurn($, await startTurn($, prompt))
}
const boot = ($: Engine, cwd = '/work') => $.session.start({ source: 'startup', cwd } as never)

test('/context-refresh: asks for a tool turn, then snapshot -> compact to one line -> restore', async ($, on) => {
  const w = world($, on)
  await boot($)
  const { text } = await $.command.run({ command: 'context-refresh' } as never)
  expect(text).toContain('context-refresh 開始')
  await w.clock.advance(1)
  expect(w.prompts[0]).toContain('mcp__context-refresh__refresh')

  const result = await toolTurn($, w.prompts[0]!)
  expect(result).toContain('context-snapshot-refresh')
  expect(result).toContain('Context at Save には 10% と書くこと')
  await w.clock.advance(400)
  expect(w.compactions).toHaveLength(0)
  expect(w.compactedTo).toEqual([RESET])
  expect(w.prompts[1]).toContain('context-restore')
  expect(w.prompts[1]).toContain(SNAP)

  await restoreTurn($, w.prompts[1]!)
  const again = await $.command.run({ command: 'context-refresh' } as never)
  expect(again.text).toContain('開始')
  expect(w.notifications).toEqual([])
})

test('compaction during refresh keeps one line; other compactions untouched', async ($, on) => {
  world($, on)
  await boot($)
  const normal = await $.session.compact({ trigger: 'manual', messages: [] } as never)
  expect(normal.messages).toHaveLength(1)

  await toolTurn($, 'コンテキストリフレッシュして')
  const plugin = await $.session.compact({ trigger: 'manual', instructions: 'context-refresh: reset', messages: [] } as never)
  expect(plugin.messages).toEqual(RESET)
})

test('no fresh snapshot when the snapshot turn ends: stops without compacting, and notifies even a manual run', async ($, on) => {
  const w = world($, on, { snapshotWritten: false })
  await boot($)
  await toolTurn($, 'コンテキストリフレッシュして')
  await w.clock.advance(400)
  expect(w.compactedTo).toEqual([])
  expect(w.prompts).toHaveLength(0)
  expect(w.notifications[0]?.[0]).toBe('Claude Code — ❌ refresh 中止')
})

test('auto at >= 90%: notifies the start, asks for a tool turn, runs, notifies completion', async ($, on) => {
  const w = world($, on, { percent: 92 })
  await boot($)
  await workTurn($)
  await w.clock.advance(1)
  expect(w.prompts[0]).toContain('自動 92%')
  expect(w.notifications).toEqual([['Claude Code — 🔄 自動 refresh 開始（92%）', '/work', 'snapshot → 会話リセット → 復元']])

  expect(await toolTurn($, w.prompts[0]!)).toContain('Context at Save には 92% と書くこと')
  await w.clock.advance(400)
  w.setPercent(1)
  await restoreTurn($, w.prompts[1]!)
  expect(w.notifications[1]).toEqual(['Claude Code — ✅ refresh 完了', '/work', '作業を再開しました（session_id 維持）'])
  expect(w.notifications).toHaveLength(2)
})

test('the 10/29 failure: a Monitor notification turn ending first does not stop an automatic refresh', async ($, on) => {
  const w = world($, on, { percent: 92 })
  await boot($)
  await workTurn($)
  await w.clock.advance(1)
  // The queued Monitor event runs before the mod's request.
  await workTurn($, '<task-notification> Monitor event: transcript updated')
  expect(w.notifications).toHaveLength(1)

  await toolTurn($, w.prompts[0]!)
  await w.clock.advance(400)
  expect(w.compactedTo).toEqual([RESET])
  expect(w.notifications.some(n => n[0]?.includes('❌'))).toBe(false)
})

test('a turn other than the snapshot turn ending is ignored', async ($, on) => {
  const w = world($, on)
  await boot($)
  const turnId = await startTurn($, 'コンテキストリフレッシュして')
  await callTool($)
  await endTurn($, 'some-other-turn')
  await w.clock.advance(400)
  expect(w.compactedTo).toEqual([])
  expect(w.notifications).toEqual([])

  await endTurn($, turnId)
  await w.clock.advance(400)
  expect(w.compactedTo).toEqual([RESET])
})

test('the person asks while an automatic request waits: their turn writes it, the late request does nothing', async ($, on) => {
  const w = world($, on, { percent: 92 })
  await boot($)
  await workTurn($)
  await w.clock.advance(1)
  expect(await toolTurn($, 'いったんコンテキストリフレッシュして')).toContain('context-snapshot-refresh')
  await w.clock.advance(400)
  w.setPercent(1)
  await restoreTurn($, w.prompts[1]!)

  expect(await toolTurn($, w.prompts[0]!)).toContain('もう済んでいます')
  expect(w.compactedTo).toHaveLength(1)
})

test('waits at most 10 minutes for the requested turn, then stops with a notification', async ($, on) => {
  const w = world($, on, { percent: 92 })
  await boot($)
  await workTurn($)
  await w.clock.advance(10 * 60 * 1000 + 1)
  expect(w.notifications.at(-1)?.[0]).toBe('Claude Code — ❌ refresh 中止')
  expect(w.notifications.at(-1)?.[2]).toContain('10 分')
})

test('after a failed automatic run, no automatic run for 30 minutes', async ($, on) => {
  const w = world($, on, { percent: 92, snapshotWritten: false })
  await boot($)
  await workTurn($)
  await w.clock.advance(1)
  await toolTurn($, w.prompts[0]!)
  expect(w.notifications.at(-1)?.[0]).toBe('Claude Code — ❌ refresh 中止')

  await workTurn($)
  await w.clock.advance(1)
  expect(w.prompts).toHaveLength(1)

  await w.clock.advance(31 * 60 * 1000)
  await workTurn($)
  await w.clock.advance(1)
  expect(w.prompts).toHaveLength(2)
})

test('threshold comes from ctx-config.sh: 95 keeps 92% quiet', async ($, on) => {
  const w = world($, on, { percent: 92, configPercent: '95' })
  await boot($)
  await workTurn($)
  await w.clock.advance(1)
  expect(w.prompts).toHaveLength(0)
})

test('threshold from ctx-config.sh can be lower than 90', async ($, on) => {
  const w = world($, on, { percent: 88, configPercent: '85' })
  await boot($)
  await workTurn($)
  await w.clock.advance(1)
  expect(w.prompts[0]).toContain('自動 88%')
})

test('auto: an aborted turn at 95% does not start a refresh', async ($, on) => {
  const w = world($, on, { percent: 95 })
  await boot($)
  await endTurn($, await startTurn($), 'aborted')
  await w.clock.advance(1)
  expect(w.prompts).toHaveLength(0)
})

test('calling the tool twice in the same turn repeats the instructions', async ($, on) => {
  world($, on)
  await boot($)
  await startTurn($, 'コンテキストリフレッシュして')
  await callTool($)
  expect(JSON.stringify(await callTool($))).toContain('context-snapshot-refresh')
})

test('a newer turn asking again while an older snapshot turn never finished starts over from scratch', async ($, on) => {
  const w = world($, on)
  await boot($)
  await startTurn($, 'コンテキストリフレッシュして')
  await callTool($)
  // That turn never ends (stopped, lost): the person asks again later.
  expect(await toolTurn($, 'もう一度コンテキストリフレッシュして')).toContain('context-snapshot-refresh')
  await w.clock.advance(400)
  expect(w.compactedTo).toEqual([RESET])
})

test('while the restore is still to come, a new request is told to restore instead of writing a new snapshot', async ($, on) => {
  const w = world($, on)
  await boot($)
  await toolTurn($, 'コンテキストリフレッシュして')
  await w.clock.advance(400)
  expect(await toolTurn($, 'コンテキストリフレッシュして')).toContain('context-restore スキルの手順でスナップショットから復元')
  expect(w.compactedTo).toHaveLength(1)
})

test('the model cd-s before writing: the snapshot it actually wrote is found and used', async ($, on) => {
  const w = world($, on, { written: ['context_snapshot_-work-sub.md'] })
  await boot($)
  await toolTurn($, 'コンテキストリフレッシュして')
  await w.clock.advance(400)
  expect(w.compactedTo).toHaveLength(1)
  expect(w.prompts[0]).toContain('/home/u/.claude/context_snapshot_-work-sub.md')
})

test('two fresh snapshots from other directories: refuses to guess', async ($, on) => {
  const w = world($, on, { written: ['context_snapshot_-a.md', 'context_snapshot_-b.md'] })
  await boot($)
  await toolTurn($, 'コンテキストリフレッシュして')
  await w.clock.advance(400)
  expect(w.compactedTo).toEqual([])
  expect(w.notifications[0]?.[2]).toContain('2 件')
})

const WINDOWS = { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\u' }

test('Windows: no bash, the home is USERPROFILE and paths take the C:/ form the hooks use', async ($, on) => {
  const w = world($, on, {
    env: WINDOWS, cwd: 'C:\\Users\\u\\work', noSender: true,
    written: ['context_snapshot_C--Users-u-work.md', 'context_snapshot_C--Users-u-other.md'],
  })
  await boot($, 'C:\\Users\\u\\work')
  await toolTurn($, 'コンテキストリフレッシュして')
  await w.clock.advance(400)
  expect(w.compactedTo).toHaveLength(1)
  expect(w.prompts[0]).toContain('C:/Users/u/.claude/context_snapshot_C--Users-u-work.md')
  expect(JSON.stringify(w.listed)).toContain('C:/Users/u/.claude')
  expect(w.runs).toEqual([])
})

test('Windows: a stop is notified through the engine, not a script', async ($, on) => {
  const w = world($, on, { env: WINDOWS, cwd: 'C:\\Users\\u\\work', snapshotWritten: false })
  await boot($, 'C:\\Users\\u\\work')
  await toolTurn($, 'コンテキストリフレッシュして')
  expect(w.uiNotes).toHaveLength(1)
  expect(JSON.stringify(w.uiNotes[0])).toContain('❌ refresh 中止')
  expect(w.runs).toEqual([])
})

test('a Japanese directory is named the way snapshot-path.sh names it (one dash per UTF-8 byte)', async ($, on) => {
  const w = world($, on, { cwd: '/tmp/日本語 dir/a.b', written: ['context_snapshot_-tmp-----------dir-a-b.md', 'context_snapshot_-other.md'] })
  await boot($, '/tmp/日本語 dir/a.b')
  await toolTurn($, 'コンテキストリフレッシュして')
  await w.clock.advance(400)
  expect(w.prompts[0]).toContain('/home/u/.claude/context_snapshot_-tmp-----------dir-a-b.md')
})

test('no notification script on a Mac: falls back to the engine notification', async ($, on) => {
  const w = world($, on, { snapshotWritten: false, noSender: true })
  await boot($)
  await toolTurn($, 'コンテキストリフレッシュして')
  expect(w.notifications).toEqual([])
  expect(w.uiNotes).toHaveLength(1)
})

// What the snapshot file holds after the mod appended to it.
const snapshotAsWritten = (w: ReturnType<typeof world>) => w.logs.filter(l => l.path === SNAP).at(-1)?.text ?? ''

test('the snapshot gets an appendix: the transcript, the person\'s words, edited files and URLs, without the noise', async ($, on) => {
  const long = `長い依頼${'あ'.repeat(600)}`
  const w = world($, on, { messages: [
    { role: 'user', text: '前回のリフレッシュより前の依頼', toolUses: [] },
    { role: 'user', text: '（context-refresh: 会話をリセットしました）', toolUses: [] },
    { role: 'user', text: 'スレッドに返信したい https://example.slack.com/archives/C0A/p1?thread_ts=1.2&cid=C0A', toolUses: [] },
    { role: 'assistant', text: '公開しました：https://claude.ai/artifact/Gf5nu。', toolUses: [
      { tool_use_id: '1', tool: 'Write', input: { file_path: '/work/a.md', content: 'x' } },
      { tool_use_id: '2', tool: 'Edit', input: { file_path: '/work/a.md', old_string: 'x', new_string: 'y' } },
      { tool_use_id: '3', tool: 'NotebookEdit', input: { notebook_path: '/work/n.ipynb' } },
      { tool_use_id: '4', tool: 'Write', input: { file_path: SNAP, content: 'snap' } },
    ] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: '1', text: 'ok' }] },
    { role: 'user', text: '<command-name>/auto-mode-setup</command-name>\n<command-message>auto-mode-setup</command-message>\n<command-args></command-args>', toolUses: [] },
    { role: 'user', text: '<command-name>/compact</command-name>\n<command-args>context-refresh: reset</command-args>', toolUses: [] },
    { role: 'user', text: 'Base directory for this skill: /x\n# Skill', toolUses: [] },
    { role: 'user', text: '(Re-invocation of /superpowers:systematic-debugging — the skill instructions were previously loaded)', toolUses: [] },
    { role: 'user', text: long, toolUses: [] },
    { role: 'user', text: 'context-refresh mod からの依頼（手動）です。', toolUses: [] },
    { role: 'user', text: '<system-reminder>注入</system-reminder>\nコンテキストリフレッシュして', toolUses: [] },
  ] })
  await boot($)
  await toolTurn($, 'コンテキストリフレッシュして')
  const snap = snapshotAsWritten(w)
  expect(snap.startsWith('# Claude Context Snapshot\n本文\n')).toBe(true)
  expect(snap).toContain('## 付録：会話記録からの自動抽出')
  expect(snap).toContain(TRANSCRIPT)
  expect(snap).toContain('1. スレッドに返信したい https://example.slack.com/archives/C0A/p1?thread_ts=1.2&cid=C0A')
  expect(snap).toContain('2. /auto-mode-setup')
  expect(snap).toContain(`3. 長い依頼${'あ'.repeat(496)}…（以下略）`)
  expect(snap).toContain('4. コンテキストリフレッシュして')
  expect(snap).toContain('- /work/a.md（2 回）')
  expect(snap).toContain('- /work/n.ipynb（1 回）')
  expect(snap).toContain('- https://claude.ai/artifact/Gf5nu\n')
  for (const noise of ['前回のリフレッシュより前', 'mod からの依頼', 'context-refresh: reset', 'Base directory', 'Re-invocation', 'system-reminder', `- ${SNAP}`]) {
    expect(snap).not.toContain(noise)
  }

  await w.clock.advance(400)
  expect(w.compactedTo).toEqual([RESET])
  expect(w.prompts[0]).toContain(TRANSCRIPT)
  expect(w.prompts[0]).toContain('ユーザーに聞く前に')
})

test('a transcript in a folder named some other way is found by looking through the projects folders', async ($, on) => {
  const elsewhere = '/home/u/.claude/projects/-work-hashed-1a2b/sess-1-abcdef.jsonl'
  const w = world($, on, { transcriptAt: elsewhere, projectDirs: ['-other', '-work-hashed-1a2b'] })
  await boot($)
  await toolTurn($, 'コンテキストリフレッシュして')
  await w.clock.advance(400)
  expect(snapshotAsWritten(w)).toContain(elsewhere)
  expect(w.prompts[0]).toContain(elsewhere)
})

test('no messages to read: the refresh goes on with the snapshot as the model wrote it', async ($, on) => {
  const w = world($, on, { messagesFail: true })
  await boot($)
  await toolTurn($, 'コンテキストリフレッシュして')
  await w.clock.advance(400)
  expect(snapshotAsWritten(w)).toBe('')
  expect(w.compactedTo).toEqual([RESET])
  expect(w.prompts[0]).toContain(SNAP)
  expect(JSON.stringify(w.logs.at(-1))).toContain('appendix-failed')
})

test('decisions go to a per-session log, with the context figures behind an automatic start', async ($, on) => {
  const w = world($, on, { percent: 92 })
  await boot($)
  await workTurn($)
  const last = w.logs.at(-1)!
  expect(JSON.stringify(last)).toContain('/home/u/.claude/context-refresh-sess-1-a.log')
  expect(JSON.stringify(last)).toContain('auto-check')
  expect(JSON.stringify(last)).toContain('\\"tokens\\":920')
})
