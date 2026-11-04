import { expect, test } from 'claude-code/testing'

import { modelId, olderRate } from '../hooks/cache-art'
import { learnTtl, ruleTtl } from '../hooks/ttl'

const ENV = { force5m: false, ttl: '', enable1h: false }
const PLAN = [{ kind: 'five_hour', percentUsed: 30 }, { kind: 'seven_day', percentUsed: 10 }]

test('the cache length by Claude Code\'s rules: env settings first, then the plan', () => {
  expect(ruleTtl(ENV, PLAN)).toBe(60)
  expect(ruleTtl(ENV, [])).toBe(5)
  expect(ruleTtl(ENV, [{ kind: 'five_hour', percentUsed: 100 }])).toBe(5)
  expect(ruleTtl({ ...ENV, force5m: true }, PLAN)).toBe(5)
  expect(ruleTtl({ ...ENV, ttl: '5m' }, PLAN)).toBe(5)
  expect(ruleTtl({ ...ENV, ttl: '1h' }, [])).toBe(60)
  expect(ruleTtl({ ...ENV, enable1h: true }, [])).toBe(60)
})

test('the traffic shows the length: a late hit proves the hour, a miss inside it says 5 minutes', () => {
  const hit = { read: 90_000, write: 500, fresh: 100 }
  const miss = { read: 0, write: 90_000, fresh: 100 }
  const min = 60_000
  expect(learnTtl(20 * min, hit, true, 90_000)).toBe(60)
  expect(learnTtl(3 * min, hit, true, 90_000)).toBeNull()
  expect(learnTtl(20 * min, miss, true, 90_000)).toBe(5)
  expect(learnTtl(20 * min, miss, false, 90_000)).toBeNull() // another model: not the clock's fault
  expect(learnTtl(20 * min, miss, true, 200_000)).toBeNull() // the prompt shrank: not the clock's fault
  expect(learnTtl(90 * min, miss, true, 90_000)).toBeNull() // past the hour either length lapses
})

test('a model id loses its provider prefix, date and version suffix; older models have their own rate', () => {
  expect(modelId('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe('claude-sonnet-4-5')
  expect(modelId('claude-opus-4-1@20250805')).toBe('claude-opus-4-1')
  expect(modelId('claude-opus-5-5[1m]')).toBe('claude-opus-5-5')
  expect(olderRate('claude-sonnet-4-6')).toEqual({ input: 3, read: 0.3 })
  expect(olderRate('claude-opus-4-1-20250805')).toEqual({ input: 15, read: 1.5 })
  expect(olderRate('claude-opus-5-5')).toBeUndefined() // the 5.5 rows price it
  expect(olderRate('constructor')).toBeUndefined()
})
