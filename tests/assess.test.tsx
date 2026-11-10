import type { On, SessionMessage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// The context-meter behaviours, as ribbon carries them: the CTX gauge coloured by how close the
// context is to auto-compaction, the compact tool, the count.

const STARTED_AT = Date.parse('2098-12-31T22:00:00Z')
const THRESHOLD = 967_000
const WINDOWS = [
  { kind: 'five_hour', percentUsed: 18, resetsAt: '2099-01-01T01:29:00Z' },
  { kind: 'seven_day', percentUsed: 1 },
]
const SUMMARY: SessionMessage[] = [{ role: 'user', text: 'summary', toolUses: [] }]
const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 150,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
} as const
const BLUE = '#2f7de1'
const YELLOW = '#e0b000'
const RED = '#d64545'

// The engine beneath the plugin: a session on a 1M window whose context holds `tokens`, another
// mod's band drawn beneath ribbon, and what the plugin ran.
const answerSession = (on: On, tokens: number) => {
  const host = { tokens, commands: [] as { command: string; args?: string }[] }
  mock.store(on)
  on('tool.register', () => ({ value: { tool: 'mcp__ribbon__compact_after_turn' } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', async (_$, e) => ({
    value: {
      startedAt: STARTED_AT,
      context: {
        tokens: host.tokens,
        window: 1_000_000,
        percent: Math.round(host.tokens / 10_000),
        ...(e?.breakdown ? { breakdown: { isAutoCompactEnabled: true, autoCompactThreshold: THRESHOLD } } : {}),
      },
      rateLimits: WINDOWS,
    },
  }) as never)
  on('command.run', async (_$, e) => {
    host.commands.push({ command: e.command, args: e.args })
    return {}
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>next: from beneath</Text>
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  return host
}

type T$ = Parameters<TestBody>[0]

// A session resumed 18 minutes after its last reply: warm, with the context the host holds.
const resume = async ($: T$, tokens: number) => {
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 18 * 60, context_tokens: tokens, model: 'claude-opus-5-5' })
}

const completeTurn = ($: T$, turnId: string) =>
  $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId, reason: 'answer' })

test('below 150k the CTX gauge is blue, and the band beneath still draws', async ($, on) => {
  mock.clock(on, { now: STARTED_AT })
  answerSession(on, 122_000)
  await resume($, 122_000)

  const ui = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect((await ui.find({ type: 'Text', text: ' 87.8% left' }))?.props.color).toBe(BLUE)
  expect(await ui.find({ key: 'compacted' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'next: from beneath' })).toBeDefined()
  await ui.unmount()
})

test('at 90% of the threshold the CTX gauge turns red', async ($, on) => {
  mock.clock(on, { now: STARTED_AT })
  answerSession(on, 880_000)
  await resume($, 880_000)

  const ui = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect((await ui.find({ type: 'Text', text: ' 12% left' }))?.props.color).toBe(RED)
  await ui.unmount()
})

test('between 150k and 90% of the threshold the CTX gauge is yellow', async ($, on) => {
  mock.clock(on, { now: STARTED_AT })
  answerSession(on, 600_000)
  await resume($, 600_000)

  const ui = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect((await ui.find({ type: 'Text', text: ' 40% left' }))?.props.color).toBe(YELLOW)
  await ui.unmount()
})

test('compactions are counted on the band once there is one', { options: { language: 'zh-TW' } }, async ($, on) => {
  mock.clock(on, { now: STARTED_AT })
  answerSession(on, 300_000)
  on('session.compact', async () => ({ messages: SUMMARY }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })

  await $.session.compact({ trigger: 'manual', messages: SUMMARY })
  await $.session.compact({ trigger: 'precompute', messages: SUMMARY })
  await $.session.compact({ trigger: 'auto', messages: SUMMARY })
  const ui = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Text', text: '已壓縮 2 次' })).toBeDefined()
  await ui.unmount()
})

test('after a turn ends the band counts idle time, and past the hour shows it cold', async ($, on) => {
  const clock = mock.clock(on, { now: STARTED_AT })
  answerSession(on, 122_000)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await completeTurn($, 't1')
  const ui = await $.ui.mount({ plugin: 'ribbon', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ text: ' WARM ' })).toBeDefined()

  await clock.advance(65 * 60_000)
  expect(await ui.find({ text: ' COLD ' })).toBeDefined()
  expect(await ui.find({ text: ' 1h 5m' })).toBeDefined()

  // The next turn warms it again.
  await $.turn.start({ text: 'again', turnId: 't2' })
  await completeTurn($, 't2')
  expect(await ui.find({ text: ' WARM ' })).toBeDefined()
  expect(await ui.find({ text: ' 60m left' })).toBeDefined()
  await ui.unmount()
})

test('the band counts the one-hour cache down by the minute', async ($, on) => {
  const clock = mock.clock(on, { now: STARTED_AT })
  answerSession(on, 122_000)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })

  const ui = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ text: /m left$/ })).toBeUndefined()

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await completeTurn($, 't1')
  expect(await ui.find({ text: ' 60m left' })).toBeDefined()

  // Within a minute the text holds; past it the band shows the next minute down.
  await clock.advance(30_000)
  expect(await ui.find({ text: ' 60m left' })).toBeDefined()
  await clock.advance(30_000)
  expect(await ui.find({ text: ' 59m left' })).toBeDefined()
  await clock.advance(44 * 60_000)
  expect(await ui.find({ text: ' 15m left' })).toBeDefined()
  await ui.unmount()
})

test('the compact tool queues /compact with its instructions until the turn ends', async ($, on) => {
  const clock = mock.clock(on, { now: STARTED_AT })
  const host = answerSession(on, 700_000)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })

  await $.turn.start({ text: 'compact please', turnId: 't1' })
  const called = await $.tool.call({ tool: 'mcp__ribbon__compact_after_turn', instructions: 'keep the spec' })
  expect(called).toMatchObject({ result: 'queued' })
  expect(host.commands).toHaveLength(0)

  await completeTurn($, 't1')
  await clock.settle()
  expect(host.commands).toEqual([{ command: 'compact', args: 'keep the spec' }])

  await $.turn.start({ text: 'next', turnId: 't2' })
  await completeTurn($, 't2')
  await clock.settle()
  expect(host.commands).toHaveLength(1)
})

test('the context gauge shows at every width, with Show / Hide beside it', async ($, on) => {
  mock.clock(on, { now: STARTED_AT })
  answerSession(on, 600_000)
  await resume($, 600_000)

  for (const bodyColumns of [150, 80, 53, 33]) {
    const ui = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns } })
    expect(await ui.find({ type: 'Text', text: /^CTX ?$/ }), `CTX at ${bodyColumns} columns`).toBeDefined()
    expect(await ui.find({ key: 'cache-fold' }), `Show / Hide at ${bodyColumns} columns`).toBeDefined()
    await ui.unmount()
  }
})

test('the rows part by a small step, so the cache row does not touch the usage one', async ($, on) => {
  mock.clock(on, { now: STARTED_AT })
  answerSession(on, 400_000)
  await resume($, 400_000)

  const ui = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 33 } })
  expect(await ui.find({ key: 'cache-fold' })).toBeDefined()
  expect((await ui.find({ key: 'rows' }))?.props.rowGap).toBe('xs')
  await ui.unmount()
})

test('off the one-row layouts the blocks wrap with no label, a small step apart, so a wrapped block lines up under 7D', async ($, on) => {
  mock.clock(on, { now: STARTED_AT })
  answerSession(on, 400_000)
  await resume($, 400_000)

  for (const bodyColumns of [53, 33]) {
    const ui = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns } })
    const row = await ui.find({ key: 'row' })
    const blocks = await ui.find({ key: 'blocks' })
    expect(row?.props.flexWrap, `the outer row at ${bodyColumns} columns`).toBeUndefined()
    expect(blocks?.props.flexWrap).toBe('wrap')
    expect(blocks?.props.rowGap).toBe('xs')
    expect(blocks?.text, `CTX in the group at ${bodyColumns} columns`).toMatch(/CTX/)
    expect(await ui.find({ key: 'label' }), `no label at ${bodyColumns} columns`).toBeUndefined()
    await ui.unmount()
  }

  const wide = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect((await wide.find({ key: 'row' }))?.props.rowGap).toBe('xs')
  await wide.unmount()
})

test('empty cells are dim full dots where the font is proportional, and middle dots in the terminal', async ($, on) => {
  mock.clock(on, { now: STARTED_AT })
  answerSession(on, 400_000)
  await resume($, 400_000)

  const app = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const full = await app.findAll({ type: 'Text', text: /^●+$/ })
  expect(full.some(el => el.props.color === 'subtle')).toBe(true)
  expect(await app.find({ type: 'Text', text: /^·+$/ })).toBeUndefined()
  await app.unmount()

  const term = await $.ui.mount({ plugin: 'ribbon', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await term.find({ type: 'Text', text: /^·+$/ })).toBeDefined()
  await term.unmount()
})
