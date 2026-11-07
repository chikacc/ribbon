import { expect, mock, test } from 'claude-code/testing'

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 6,
  bodyColumns: 110,
  scroll: { offset: 0, bodyRows: 6 },
  view: {},
} as const

test("another mod's band beneath ribbon draws above ribbon's own", async ($, on) => {
  mock.store(on)
  on('tool.register', () => ({ value: { tool: 'mcp__ribbon__compact_after_turn' } })) // the host takes the compact tool
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 58 }] },
  }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>SAVVY ROW</Text>
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'ribbon', surface, component: 'AbovePrompt', props: PROPS })
    expect(await band.find({ text: 'SAVVY ROW' })).toBeDefined()
    expect(await band.find({ text: '42% left' })).toBeDefined()
    const all = JSON.stringify(await band.find({ type: 'Box' }))
    expect(all.indexOf('SAVVY ROW')).toBeLessThan(all.indexOf('42% left'))
    await band.unmount()
  }
})

const stackOf = async ($: Parameters<import('claude-code/testing').TestBody>[0], on: import('claude-code').On) => {
  mock.store(on)
  on('tool.register', () => ({ value: { tool: 'mcp__ribbon__compact_after_turn' } })) // the host takes the compact tool
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 58 }] },
  }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>SAVVY ROW</Text>
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const outer = (await band.findAll({ type: 'Box' }))[0]
  await band.unmount()
  return outer?.props.rowGap
}

test('stackGap: a small step parts the band above from ribbon by default', async ($, on) => {
  expect(await stackOf($, on)).toBe('sm')
})

test('stackGap: md takes the larger step', { options: { stackGap: 'md' } }, async ($, on) => {
  expect(await stackOf($, on)).toBe('md')
})

test('stackGap: none stacks the bands with no space, as upstream', { options: { stackGap: 'none' } }, async ($, on) => {
  expect(await stackOf($, on)).toBeUndefined()
})
