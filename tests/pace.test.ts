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

import { dateOf, dayPart, runOutOf } from '../hooks/pace'

test('the 7-day limit runs out early only when the week\'s pace says so', () => {
  const day = 86_400_000
  const reset = NOW + 3 * day // 4 days into the week
  const iso = new Date(reset).toISOString()
  // 70% in 4 days: 100% at day 5.7, before the reset at day 7.
  const out = runOutOf('seven_day', 70, iso, NOW)
  expect(out).not.toBeNull()
  expect(Math.round(out!.left / day * 10) / 10).toBe(1.7)
  expect(runOutOf('seven_day', 40, iso, NOW)).toBeNull() // lasts past the reset
  expect(runOutOf('seven_day', 10, iso, NOW)).toBeNull() // under 15%: too little to go on
  expect(runOutOf('seven_day', 100, iso, NOW)).toBeNull()
  expect(runOutOf('seven_day', 70, new Date(NOW + 6.5 * day).toISOString(), NOW)).toBeNull() // under a day into the week
  expect(runOutOf('five_hour', 70, iso, NOW)).toBeNull()
})

test('a time of day is a day and a part of it; the small hours belong to the night before', () => {
  const at = (iso: string) => new Date(iso).getTime()
  expect(dayPart(at('2026-10-18T22:00:00'))).toBe('Sun evening')
  expect(dayPart(at('2026-10-19T00:42:00'))).toBe('Sun night')
  expect(dayPart(at('2026-10-19T00:42:00'), true)).toBe('Sun pm')
  expect(dayPart(at('2026-10-19T09:00:00'))).toBe('Mon morning')
})

test('days and dates in Chinese', () => {
  const at = (iso: string) => new Date(iso).getTime()
  expect(dayPart(at('2026-10-19T00:42:00'), false, 'zh')).toBe('周日夜里')
  expect(dayPart(at('2026-10-18T22:00:00'), false, 'zh')).toBe('周日晚上')
  expect(dayPart(at('2026-10-18T22:00:00'), true, 'zh')).toBe('周日下午')
  expect(dateOf(at('2026-10-19T09:00:00'), 'zh')).toBe('10月19日 周一')
  expect(dateOf(at('2026-10-19T09:00:00'))).toBe('Mon 19 Oct')
})
