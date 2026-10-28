import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const SNAP = '/home/u/.claude/context_snapshot_-work.md'

type WorldOpts = { percent?: number; snapshotWritten?: boolean; written?: string[]; configPercent?: string; env?: Record<string, string>; cwd?: string; noSender?: boolean }

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
  let mtime = opts.snapshotWritten === false ? 0 : 5000
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
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
  on('session.id', () => ({ value: 'sess-1' }) as never)
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

    return { value: path.endsWith('ctx-config.sh') && opts.configPercent !== undefined } as never
  })
  on('fs.read', () => ({ value: `CTX_HIGH_THRESHOLD=80\nCTX_AUTO_REFRESH_THRESHOLD=${opts.configPercent}\n` }) as never)
  on('ui.notify', (_$, e) => {
    uiNotes.push(e as unknown as { text: string; title?: string })

    return { value: { isSent: true, channel: 'test' } } as never
  })
  // ~/.claude as the model left it: this run's snapshots (fresh), an old one, a sidecar.
  const written = opts.written ?? (opts.snapshotWritten === false ? [] : ['context_snapshot_-work.md'])
  on('fs.list', (_$, e) => (listed.push(e), { value: [
    ...written.map(name => ({ name, kind: 'file', size: 10, mtimeMs: mtime, isLink: false })),
    { name: 'context_snapshot_-old.md', kind: 'file', size: 10, mtimeMs: 1, isLink: false },
    { name: 'context_snapshot_-work.git.txt', kind: 'file', size: 10, mtimeMs: 5000, isLink: false },
  ] }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000, percent: opts.percent ?? 10 }, rateLimits: [] } }) as never)
  on('prompt.submit', (_$, e) => {
    prompts.push(e.text)

    return { text: e.text } as never
  })
  on('session.compact', (_$, e) => {
    compactions.push(e)

    return { messages: [{ role: 'user', text: 'core summary', toolUses: [] }] }
  })

  return { clock, prompts, compactions, compactedTo, notifications, uiNotes, runs, listed, setMtime: (m: number) => (mtime = m) }
}

const endTurn = ($: Engine, reason: 'answer' | 'aborted' = 'answer') =>
  $.turn.complete({ reason, answer: 'ok', durationMs: 1, isAborted: reason === 'aborted', turnId: 't' } as never)

test('/context-refresh: snapshot -> compact to nothing -> restore prompt', async ($, on) => {
  const w = world($, on)
  await $.session.start({ source: 'startup', cwd: '/work' } as never)
  const { text } = await $.command.run({ command: 'context-refresh' } as never)
  expect(text).toContain('context-refresh 開始')
  await w.clock.advance(1)
  expect(w.prompts[0]).toContain('context-snapshot-refresh')
  expect(w.prompts[0]).toContain('Context at Save には 10% と書くこと')

  await endTurn($)
  await w.clock.advance(400)
  expect(w.prompts).toHaveLength(2)
  expect(w.prompts[1]).toContain('context-restore')
  expect(w.prompts[1]).toContain(SNAP)
  expect(w.compactions).toHaveLength(0)
  expect(w.compactedTo).toEqual([[{ role: 'user', text: '（context-refresh: 会話をリセットしました）', toolUses: [] }]])

  await endTurn($)
  const again = await $.command.run({ command: 'context-refresh' } as never)
  expect(again.text).toContain('開始')
  expect(w.notifications).toEqual([])
})

test('compaction during refresh keeps no messages; other compactions untouched', async ($, on) => {
  const w = world($, on)
  await $.session.start({ source: 'startup', cwd: '/work' } as never)
  const normal = await $.session.compact({ trigger: 'manual', messages: [] } as never)
  expect(normal.messages).toHaveLength(1)

  await $.command.run({ command: 'context-refresh' } as never)
  await endTurn($)
  const plugin = await $.session.compact({ trigger: 'manual', instructions: 'context-refresh: reset', messages: [] } as never)
  expect(plugin.messages).toEqual([{ role: 'user', text: '（context-refresh: 会話をリセットしました）', toolUses: [] }])
  void w
})

test('no fresh snapshot: aborts without compacting', async ($, on) => {
  const w = world($, on, { snapshotWritten: false })
  await $.session.start({ source: 'startup', cwd: '/work' } as never)
  await $.command.run({ command: 'context-refresh' } as never)
  await w.clock.advance(1)
  await endTurn($)
  await w.clock.advance(400)
  expect(w.prompts).toHaveLength(1)
  expect(w.compactions).toHaveLength(0)
  expect(w.compactedTo).toEqual([])
})

test('auto at >= 90%: runs the whole refresh and notifies start and completion', async ($, on) => {
  const w = world($, on, { percent: 92 })
  await $.session.start({ source: 'startup', cwd: '/work' } as never)
  await endTurn($)
  await w.clock.advance(1)
  expect(w.prompts[0]).toContain('context-snapshot-refresh')
  expect(w.prompts[0]).toContain('Context at Save には 92% と書くこと')
  expect(w.notifications).toEqual([['Claude Code — 🔄 自動 refresh 開始（92%）', '/work', 'snapshot → 会話リセット → 復元']])

  await endTurn($)
  await w.clock.advance(400)
  await endTurn($)
  expect(w.notifications[1]).toEqual(['Claude Code — ✅ refresh 完了', '/work', '作業を再開しました（session_id 維持）'])
  expect(w.notifications).toHaveLength(2)
})

test('auto: a missing snapshot notifies the failure', async ($, on) => {
  const w = world($, on, { percent: 92, snapshotWritten: false })
  await $.session.start({ source: 'startup', cwd: '/work' } as never)
  await endTurn($)
  await w.clock.advance(1)
  await endTurn($)
  expect(w.notifications[1]?.[0]).toBe('Claude Code — ❌ refresh 中止')
  expect(w.notifications[1]?.[2]).toContain('スナップショットが見つかりません')
})

test('threshold comes from ctx-config.sh: 95 keeps 92% quiet', async ($, on) => {
  const w = world($, on, { percent: 92, configPercent: '95' })
  await $.session.start({ source: 'startup', cwd: '/work' } as never)
  await endTurn($)
  await w.clock.advance(1)
  expect(w.prompts).toHaveLength(0)
})

test('threshold from ctx-config.sh can be lower than 90', async ($, on) => {
  const w = world($, on, { percent: 88, configPercent: '85' })
  await $.session.start({ source: 'startup', cwd: '/work' } as never)
  await endTurn($)
  await w.clock.advance(1)
  expect(w.prompts[0]).toContain('context-snapshot-refresh')
})

test('auto: an aborted turn at 95% does not start a refresh', async ($, on) => {
  const w = world($, on, { percent: 95 })
  await $.session.start({ source: 'startup', cwd: '/work' } as never)
  await endTurn($, 'aborted')
  await w.clock.advance(1)
  expect(w.prompts).toHaveLength(0)
})

test('natural language: the model calls the tool, writes the snapshot in that turn, then the mod empties and restores', async ($, on) => {
  const w = world($, on)
  await $.session.start({ source: 'startup', cwd: '/work' } as never)
  const called = await $.tool.call({ tool: 'mcp__context-refresh__refresh', input: {} } as never)
  expect(JSON.stringify(called)).toContain('context-snapshot-refresh')
  expect(JSON.stringify(called)).toContain('Context at Save には 10% と書くこと')
  await w.clock.advance(1)
  expect(w.prompts).toHaveLength(0)

  await endTurn($)
  await w.clock.advance(400)
  expect(w.compactedTo).toEqual([[{ role: 'user', text: '（context-refresh: 会話をリセットしました）', toolUses: [] }]])
  expect(w.prompts).toHaveLength(1)
  expect(w.prompts[0]).toContain('context-restore')
  expect(w.notifications).toEqual([])
})

test('the tool refuses a second run while one is in progress', async ($, on) => {
  world($, on)
  await $.session.start({ source: 'startup', cwd: '/work' } as never)
  await $.tool.call({ tool: 'mcp__context-refresh__refresh', input: {} } as never)
  const again = await $.tool.call({ tool: 'mcp__context-refresh__refresh', input: {} } as never)
  expect(JSON.stringify(again)).toContain('実行中')
})

test('the model cd-s before writing: the snapshot it actually wrote is found and used', async ($, on) => {
  const w = world($, on, { written: ['context_snapshot_-work-sub.md'] })
  await $.session.start({ source: 'startup', cwd: '/work' } as never)
  await $.tool.call({ tool: 'mcp__context-refresh__refresh', input: {} } as never)
  await endTurn($)
  await w.clock.advance(400)
  expect(w.compactedTo).toHaveLength(1)
  expect(w.prompts[0]).toContain('/home/u/.claude/context_snapshot_-work-sub.md')
})

test('a manual run that stops is reported by notification, not only a toast', async ($, on) => {
  const w = world($, on, { snapshotWritten: false })
  await $.session.start({ source: 'startup', cwd: '/work' } as never)
  await $.tool.call({ tool: 'mcp__context-refresh__refresh', input: {} } as never)
  await endTurn($)
  expect(w.notifications).toHaveLength(1)
  expect(w.notifications[0]?.[0]).toBe('Claude Code — ❌ refresh 中止')
})

test('two fresh snapshots from other directories: refuses to guess', async ($, on) => {
  const w = world($, on, { written: ['context_snapshot_-a.md', 'context_snapshot_-b.md'] })
  await $.session.start({ source: 'startup', cwd: '/work' } as never)
  await $.tool.call({ tool: 'mcp__context-refresh__refresh', input: {} } as never)
  await endTurn($)
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
  await $.session.start({ source: 'startup', cwd: 'C:\\Users\\u\\work' } as never)
  await $.tool.call({ tool: 'mcp__context-refresh__refresh', input: {} } as never)
  await endTurn($)
  await w.clock.advance(400)
  expect(w.compactedTo).toHaveLength(1)
  expect(w.prompts[0]).toContain('C:/Users/u/.claude/context_snapshot_C--Users-u-work.md')
  expect(JSON.stringify(w.listed)).toContain('C:/Users/u/.claude')
  expect(w.runs).toEqual([])
})

test('Windows: a stop is notified through the engine, not a script', async ($, on) => {
  const w = world($, on, { env: WINDOWS, cwd: 'C:\\Users\\u\\work', snapshotWritten: false })
  await $.session.start({ source: 'startup', cwd: 'C:\\Users\\u\\work' } as never)
  await $.tool.call({ tool: 'mcp__context-refresh__refresh', input: {} } as never)
  await endTurn($)
  expect(w.uiNotes).toHaveLength(1)
  expect(JSON.stringify(w.uiNotes[0])).toContain('❌ refresh 中止')
  expect(w.runs).toEqual([])
})

test('a Japanese directory is named the way snapshot-path.sh names it (one dash per UTF-8 byte)', async ($, on) => {
  const w = world($, on, { cwd: '/tmp/日本語 dir/a.b', written: ['context_snapshot_-tmp-----------dir-a-b.md', 'context_snapshot_-other.md'] })
  await $.session.start({ source: 'startup', cwd: '/tmp/日本語 dir/a.b' } as never)
  await $.tool.call({ tool: 'mcp__context-refresh__refresh', input: {} } as never)
  await endTurn($)
  await w.clock.advance(400)
  expect(w.prompts[0]).toContain('/home/u/.claude/context_snapshot_-tmp-----------dir-a-b.md')
})

test('no notification script on a Mac: falls back to the engine notification', async ($, on) => {
  const w = world($, on, { snapshotWritten: false, noSender: true })
  await $.session.start({ source: 'startup', cwd: '/work' } as never)
  await $.tool.call({ tool: 'mcp__context-refresh__refresh', input: {} } as never)
  await endTurn($)
  expect(w.notifications).toEqual([])
  expect(w.uiNotes).toHaveLength(1)
})
