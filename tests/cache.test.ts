import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2098-12-31T22:00:00Z')
const WINDOWS = [
  { kind: 'five_hour', percentUsed: 18, resetsAt: '2099-01-01T01:29:00Z' },
  { kind: 'seven_day', percentUsed: 1 },
]
const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 150,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
} as const
const WARM_IDLE = 18 * 60 // 18 minutes: warm, cold in 42m
const COLD_IDLE = (3 * 24 + 9) * 3600 // 3d 9h: cold

test('a warm cache shows Robo, the WARM chip and the minutes left, folded', async ($, on) => {
  mock.store(on)
  on('tool.register', () => ({ value: { tool: 'mcp__ribbon__compact_after_turn' } })) // the host takes the compact tool
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: WARM_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  // Drawings keep no key in the kit, so they are found by what they say.
  const alts = (await band.findAll({ type: 'Svg' })).map(s => s.props.alt)
  expect(alts).toEqual(['Robo, bobbing', 'WARM'])
  expect(await band.find({ text: ' 42m left' })).toBeDefined()
  expect(await band.find({ key: 'card' })).toBeUndefined()
  expect((await band.find({ key: 'cache-fold' }))?.props.label).toBe('Show')

  await band.press({ key: 'cache-fold' })
  expect(await band.find({ key: 'card' })).toBeDefined()
  expect((await band.find({ key: 'cache-fold' }))?.props.label).toBe('Hide')
  await band.unmount()
})

test('a cold cache opens the card with the re-cache price, and Hide folds it to one row', async ($, on) => {
  mock.store(on)
  on('tool.register', () => ({ value: { tool: 'mcp__ribbon__compact_after_turn' } })) // the host takes the compact tool
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: COLD_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const card = await band.find({ key: 'card' })
  expect(card).toBeDefined()
  expect(JSON.stringify(card)).toContain('Cache cold. Idle 3d 9h. Next message re-caches 770k tokens.')
  // Three tiles of their own width in a Box that wraps, whatever the band's columns.
  expect((await band.find({ key: 'tiles' }))?.props.flexWrap).toBe('wrap')
  for (const w of [316, 286, 392]) expect(JSON.stringify(card)).toContain(`width=\\"${w}\\"`)

  await band.press({ key: 'cache-fold' })
  expect(await band.find({ key: 'card' })).toBeUndefined()
  expect(await band.find({ text: ' 3d 9h' })).toBeDefined()
  // Opus 5.5: 770k tokens at the 1-hour write price, 2 x $4 per million.
  expect(await band.find({ text: '$6.16' })).toBeDefined()
  await band.unmount()
})

test('squeezed, the folded cache stacks as a third block, then takes its own row', async ($, on) => {
  mock.store(on)
  on('tool.register', () => ({ value: { tool: 'mcp__ribbon__compact_after_turn' } })) // the host takes the compact tool
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: WARM_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const half = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 53 } })
  expect(await half.find({ key: 'block' })).toBeDefined()
  expect(await half.find({ text: '42m left' })).toBeDefined()
  expect(await half.find({ text: '$0.15' })).toBeDefined()
  await half.unmount()

  const narrow = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 33 } })
  expect(await narrow.find({ key: 'cache' })).toBeDefined()
  await narrow.press({ key: 'cache-fold' })
  // The narrow row shows Robo and the chip beside the card, so the idle tile leaves them out.
  const idle = JSON.stringify(await narrow.find({ key: 'tile-idle' }))
  expect(idle).toContain('IDLE')
  expect(idle).not.toContain('>WARM<')
  await narrow.unmount()

  // A wide row hides them while the card is open, so there the idle tile draws them.
  const wide = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(JSON.stringify(await wide.find({ key: 'tile-idle' }))).toContain('>WARM<')
  await wide.unmount()
})

test('the terminal draws the cache as text, with no drawings and no fold button', async ($, on) => {
  mock.store(on)
  on('tool.register', () => ({ value: { tool: 'mcp__ribbon__compact_after_turn' } })) // the host takes the compact tool
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: COLD_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: ' COLD ' })).toBeDefined()
  expect(await band.find({ text: '$6.16' })).toBeDefined()
  expect(await band.findAll({ type: 'Svg' })).toEqual([])
  expect(await band.find({ key: 'cache-fold' })).toBeUndefined()
  expect(await band.find({ key: 'card' })).toBeUndefined()
  await band.unmount()
})

test('a cleared session drops the cache until the next reply', async ($, on) => {
  mock.store(on)
  on('tool.register', () => ({ value: { tool: 'mcp__ribbon__compact_after_turn' } })) // the host takes the compact tool
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: COLD_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })
  await $.classic.SessionStart({ source: 'clear' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.findAll({ type: 'Svg' })).toEqual([])
  expect(await band.find({ text: ' 99% left' })).toBeDefined()
  await band.unmount()
})

const FIVE_MIN_TAIL = [
  'cut mid-line',
  JSON.stringify({ type: 'assistant', isSidechain: false, message: { usage: { cache_creation: { ephemeral_5m_input_tokens: 2000, ephemeral_1h_input_tokens: 0 } } } }),
].join('\n')

test('after a resume the cold price is Claude Code\'s own estimate, not the table\'s', async ($, on) => {
  mock.store(on)
  on('tool.register', () => ({ value: { tool: 'mcp__ribbon__compact_after_turn' } })) // the host takes the compact tool
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: COLD_IDLE, context_tokens: 770000, model: 'claude-opus-5-5', estimated_cache_write_usd: 5.5 })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: '$5.50' }), 'the estimate').toBeDefined()
  expect(await band.find({ text: '$6.16' }), 'not the table').toBeUndefined()
  await band.unmount()
})

test('a session on the 5-minute cache goes cold after 5 minutes and prices the 1.25x write', async ($, on) => {
  mock.store(on)
  on('tool.register', () => ({ value: { tool: 'mcp__ribbon__compact_after_turn' } })) // the host takes the compact tool
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  on('process.run', () => ({ value: { exitCode: 0, stdout: FIVE_MIN_TAIL, stderr: '' } }) as never)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 6 * 60, context_tokens: 770000, model: 'claude-opus-5-5', transcript_path: '/work/t.jsonl' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: ' COLD ' })).toBeDefined()
  // Opus 5.5: 770k tokens at the 5-minute write price, 1.25 x $4 per million.
  expect(await band.find({ text: '$3.85' })).toBeDefined()
  await band.unmount()
})

test('with no transcript to read, the cache keeps its 1-hour length', async ($, on) => {
  mock.store(on)
  on('tool.register', () => ({ value: { tool: 'mcp__ribbon__compact_after_turn' } })) // the host takes the compact tool
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 6 * 60, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: ' 54m left' })).toBeDefined()
  await band.unmount()
})

test('between the compact and full widths the band stays one row, in short words', async ($, on) => {
  mock.store(on)
  on('tool.register', () => ({ value: { tool: 'mcp__ribbon__compact_after_turn' } })) // the host takes the compact tool
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: WARM_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  for (const bodyColumns of [70, 90]) {
    const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns } })
    expect(await band.find({ key: 'cache' })).toBeUndefined()
    expect(await band.find({ text: 'USAGE' })).toBeUndefined()
    expect(await band.find({ text: '82%' })).toBeDefined()
    expect(await band.find({ text: '3h29m' })).toBeDefined()
    expect(await band.find({ text: '42m' })).toBeDefined()
    expect((await band.find({ key: 'cache-fold' }))?.props.label).toBe('Show')
    // The context gauge (770k of 1M used) needs room for its extra bar: it joins at 90 columns, not 70.
    expect(await band.find({ text: ' 23%' }) !== undefined).toBe(bodyColumns === 90)
    await band.unmount()
  }
})

test('a folded cold cache on the short row shows the price, or the idle time for an unpriced model', async ($, on) => {
  mock.store(on)
  on('tool.register', () => ({ value: { tool: 'mcp__ribbon__compact_after_turn' } })) // the host takes the compact tool
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: COLD_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 90 } })
  await band.press({ key: 'cache-fold' })
  expect(await band.find({ key: 'card' })).toBeUndefined()
  expect(await band.find({ text: '$6.16' })).toBeDefined()
  expect(await band.find({ text: '3d 9h' })).toBeUndefined()
  await band.unmount()

  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: COLD_IDLE, context_tokens: 770000, model: 'some-unpriced-model' })
  const unpriced = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 90 } })
  expect(await unpriced.find({ text: '3d9h' })).toBeDefined()
  await unpriced.unmount()
})

test('the terminal draws the short row as text too', async ($, on) => {
  mock.store(on)
  on('tool.register', () => ({ value: { tool: 'mcp__ribbon__compact_after_turn' } })) // the host takes the compact tool
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: WARM_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'terminal', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 80 } })
  expect(await band.findAll({ type: 'Svg' })).toEqual([])
  expect(await band.find({ text: 'WARM' })).toBeDefined()
  expect(await band.find({ text: '42m' })).toBeDefined()
  expect(await band.find({ text: 'USAGE' })).toBeUndefined()
  await band.unmount()
})

test('the full row adds a CTX gauge with the share of the context window left', async ($, on) => {
  mock.store(on)
  on('tool.register', () => ({ value: { tool: 'mcp__ribbon__compact_after_turn' } })) // the host takes the compact tool
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: WARM_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: 'CTX ' })).toBeDefined()
  expect(await band.find({ text: ' 23% left' })).toBeDefined()
  expect(await band.find({ text: ' · 770k/1M' })).toBeDefined()
  await band.unmount()
})

test('usage: used shows the spent share, the filled dots and the context as used', { options: { usage: 'used' } }, async ($, on) => {
  mock.store(on)
  on('tool.register', () => ({ value: { tool: 'mcp__ribbon__compact_after_turn' } })) // the host takes the compact tool
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: WARM_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: ' 18% used' })).toBeDefined()
  expect(await band.find({ text: ' 1% used' })).toBeDefined()
  expect(await band.find({ text: ' 77% used' })).toBeDefined()
  expect(await band.find({ text: ' 82% left' })).toBeUndefined()
  await band.unmount()
})

test('a session on an older model is priced at that model\'s rate, not the 5.5 row\'s', async ($, on) => {
  mock.store(on)
  on('tool.register', () => ({ value: { tool: 'mcp__ribbon__compact_after_turn' } })) // the host takes the compact tool
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: COLD_IDLE, context_tokens: 770000, model: 'claude-sonnet-4-5' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  // 770k tokens, the 1-hour write at 2 x $3 per million (Sonnet 5.5 would be $3.08).
  expect(await band.find({ text: '$4.62' })).toBeDefined()
  await band.unmount()
})

test('with no plan limits (an API key) the cache lives 5 minutes and prices the 1.25x write', async ($, on) => {
  mock.store(on)
  on('tool.register', () => ({ value: { tool: 'mcp__ribbon__compact_after_turn' } })) // the host takes the compact tool
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: [] } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 6 * 60, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: ' COLD ' })).toBeDefined()
  expect(await band.find({ text: '$3.85' })).toBeDefined()
  await band.unmount()
})


test('the windows are coloured by their pace, not by which window they are', async ($, on) => {
  mock.store(on)
  on('tool.register', () => ({ value: { tool: 'mcp__ribbon__compact_after_turn' } })) // the host takes the compact tool
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  // 5H: 60% used with 4 of 5 hours left (20% of the time gone), far ahead. 7D: 10% used, half the week gone.
  const rateLimits = [
    { kind: 'five_hour', percentUsed: 60, resetsAt: new Date(NOW + 4 * 3_600_000).toISOString() },
    { kind: 'seven_day', percentUsed: 10, resetsAt: new Date(NOW + 3.5 * 86_400_000).toISOString() },
  ]
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits } }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect((await band.find({ type: 'Text', text: ' 40% left' }))?.props.color).toBe('#d64545')
  expect((await band.find({ type: 'Text', text: ' 90% left' }))?.props.color).toBe('#3a9a62')
  await band.unmount()
})

test('a 7-day limit set to run out early shows the warning in the row and the details in the Show card', async ($, on) => {
  mock.store(on)
  on('tool.register', () => ({ value: { tool: 'mcp__ribbon__compact_after_turn' } })) // the host takes the compact tool
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  // 4 days into the week with 70% used.
  const rateLimits = [{ kind: 'seven_day', percentUsed: 70, resetsAt: new Date(NOW + 3 * 86_400_000).toISOString() }]
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits } }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  // Before the first reply there is no card to hold the details: the row keeps the reset.
  const early = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await early.find({ type: 'Text', text: '⚠' })).toBeDefined()
  expect(await early.find({ type: 'Text', text: ' · 3d 0h' })).toBeDefined()
  await early.unmount()

  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: WARM_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })
  const app = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await app.find({ type: 'Text', text: '⚠' })).toBeDefined()
  expect(await app.find({ type: 'Text', text: ' · 3d 0h' })).toBeUndefined() // the reset left the row
  expect(await app.find({ key: 'card' })).toBeUndefined() // a warm cache starts folded
  await app.press({ key: 'cache-fold' })
  const card = await app.find({ key: 'card' })
  expect(JSON.stringify(card)).toContain('7-day limit runs out')
  expect(JSON.stringify(card)).toContain('70% in 4d 0h')
  await app.unmount()

  const term = await $.ui.mount({ plugin: 'ribbon', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await term.find({ type: 'Text', text: '⚠' })).toBeDefined()
  expect(await term.find({ type: 'Text', text: ' · 3d 0h' })).toBeDefined() // no card: the reset stays
  await term.unmount()
})

test('language: zh writes the band, the button and the card in Chinese', { options: { language: 'zh' } }, async ($, on) => {
  mock.store(on)
  on('tool.register', () => ({ value: { tool: 'mcp__ribbon__compact_after_turn' } })) // the host takes the compact tool
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: WARM_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: '用量' })).toBeDefined()
  expect(await band.find({ text: ' 剩余 82%' })).toBeDefined()
  expect(await band.find({ text: '上下文 ' })).toBeDefined()
  expect(await band.find({ text: ' 剩 42m' })).toBeDefined()
  expect((await band.find({ key: 'cache-fold' }))?.props.label).toBe('展开')
  expect(await band.find({ text: 'USAGE' })).toBeUndefined()
  expect(await band.find({ text: ' left' })).toBeUndefined()
  await band.press({ key: 'cache-fold' })
  expect((await band.find({ key: 'cache-fold' }))?.props.label).toBe('收起')
  expect(JSON.stringify(await band.find({ key: 'card' }))).toContain('缓存是热的')
  await band.unmount()

  const term = await $.ui.mount({ plugin: 'ribbon', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await term.find({ text: ' 热 ' })).toBeDefined()
  await term.unmount()
})

test('language: zh says the run-out in Chinese', { options: { language: 'zh' } }, async ($, on) => {
  mock.store(on)
  on('tool.register', () => ({ value: { tool: 'mcp__ribbon__compact_after_turn' } })) // the host takes the compact tool
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  const rateLimits = [{ kind: 'seven_day', percentUsed: 70, resetsAt: new Date(NOW + 3 * 86_400_000).toISOString() }]
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits } }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: WARM_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ type: 'Text', text: '⚠' })).toBeDefined()
  await band.press({ key: 'cache-fold' })
  const card = JSON.stringify(await band.find({ key: 'card' }))
  expect(card).toContain('7天额度将在')
  expect(card).toContain('重置')
  await band.unmount()
})

const cardOf = async ($: Parameters<import('claude-code/testing').TestBody>[0], on: import('claude-code').On) => {
  mock.store(on)
  on('tool.register', () => ({ value: { tool: 'mcp__ribbon__compact_after_turn' } })) // the host takes the compact tool
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: COLD_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })
  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const card = JSON.stringify(await band.find({ key: 'card' }))
  await band.unmount()
  return card
}

test('cardText: small draws the card\'s labels as upstream does', async ($, on) => {
  const card = await cardOf($, on)
  expect(card).toContain('font-size=\\"11\\"')
  expect(card).toContain('font-size=\\"38\\"')
})

test('cardText: medium draws the labels 2 px larger and leaves the big figures alone', { options: { cardText: 'medium' } }, async ($, on) => {
  const card = await cardOf($, on)
  // The chips keep their measured 11 px; the 12 px captions move to 14.
  expect(card).not.toContain('font-size=\\"12\\"')
  expect(card).toContain('font-size=\\"13\\"')
  expect(card).toContain('font-size=\\"14\\"')
  expect(card).toContain('font-size=\\"38\\"')
})

test('cardText: large draws the labels 3 px larger', { options: { cardText: 'large' } }, async ($, on) => {
  const card = await cardOf($, on)
  expect(card).toContain('font-size=\\"14\\"')
  expect(card).toContain('font-size=\\"15\\"')
  expect(card).not.toContain('font-size=\\"12\\"')
})

test('cardText: xlarge draws the labels 5 px larger', { options: { cardText: 'xlarge' } }, async ($, on) => {
  const card = await cardOf($, on)
  expect(card).toContain('font-size=\\"16\\"')
  expect(card).toContain('font-size=\\"17\\"')
  // The model names keep 11 px, so SONNET stays inside its column.
  expect(card).toMatch(/font-size=\\"11\\"[^>]*>SONNET</)
  expect(card).not.toContain('font-size=\\"12\\"')
})

test('each tile leaves its box to the markup, so it draws at its own size and shrinks only in a narrower slot', async ($, on) => {
  mock.store(on)
  on('tool.register', () => ({ value: { tool: 'mcp__ribbon__compact_after_turn' } })) // the host takes the compact tool
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: COLD_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const tiles = (await band.findAll({ type: 'Svg' })).filter(s => String(s.props.source).includes('viewBox="0 0 ') && String(s.props.source).includes(' 138"'))
  expect(tiles).toHaveLength(3)
  for (const svg of tiles) {
    expect(svg.props.width).toBeUndefined()
    expect(svg.props.height).toBeUndefined()
  }
  // Only the idle tile animates (Robo), so only it is a frame.
  expect(tiles.map(s => s.props.isInteractive)).toEqual([true, false, false])
  expect(String(tiles[0]?.props.alt)).toContain('Cache cold')
  await band.unmount()
})
