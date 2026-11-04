import { expect, test } from 'claude-code/testing'

import { toneOf } from '../hooks/pace'

const NOW = Date.parse('2098-12-31T22:00:00Z')
const in5h = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString()

test('a window is calm, fast or in alert by its use against the clock', () => {
  // 5-hour window with 3 hours left: 40% of the time has gone.
  expect(toneOf('five_hour', 30, in5h(3), NOW)).toBe('calm')
  expect(toneOf('five_hour', 50, in5h(3), NOW)).toBe('fast')
  expect(toneOf('five_hour', 56, in5h(3), NOW)).toBe('alert') // 16 points ahead
  expect(toneOf('five_hour', 90, in5h(0.1), NOW)).toBe('alert') // 90% used, whatever the clock says
})

test('with no reset time or no known length only the 90% rule applies', () => {
  expect(toneOf('seven_day', 80, undefined, NOW)).toBe('calm')
  expect(toneOf('context', 89, undefined, NOW)).toBe('calm')
  expect(toneOf('context', 90, undefined, NOW)).toBe('alert')
  expect(toneOf('five_hour', 80, in5h(9), NOW)).toBe('calm') // reset further off than the window is long: bad data
})
