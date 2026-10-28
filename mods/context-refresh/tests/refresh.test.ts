import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const SNAP = '/home/u/.claude/context_snapshot_-work.md'

function world($: Engine, on: On, opts: { percent?: number; snapshotWritten?: boolean; written?: string[]; configPercent?: string } = {}) {
  const clock = mock.clock(on, { now: 1000 })
  mock.env(on, { HOME: '/home/u' })
  const prompts: string[] = []
  const compactions: unknown[] = []
  const compactedTo: unknown[] = []
  const notifications: string[][] = []
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
  on('session.cwd', () => ({ value: '/work' }) as never)
  on('session.id', () => ({ value: 'sess-1' }) as never)
  on('session.root', () => ({ value: '/work' }) as never)
  on('process.run', (_$, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (argv[1] === '-c') return ok(opts.configPercent ?? '90')
    if (argv[1]?.endsWith('ctx-notify-send.sh')) {
      notifications.push(argv.slice(2))

      return ok('')
    }

    return ok(`${SNAP}\n`)
  })
  // ~/.claude as the model left it: this run's snapshots (fresh), an old one, a sidecar.
  const written = opts.written ?? (opts.snapshotWritten === false ? [] : ['context_snapshot_-work.md'])
  on('fs.list', () => ({ value: [
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

  return { clock, prompts, compactions, compactedTo, notifications, setMtime: (m: number) => (mtime = m) }
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
