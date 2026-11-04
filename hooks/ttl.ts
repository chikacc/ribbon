// Which prompt-cache length this chat's main thread writes with, read from the end of its
// transcript. Claude Code does not hand that to mods, so the transcript is the source:
// every assistant row's usage says how many tokens went to the 1 hour and 5 min caches.

export type Ttl = 'unknown' | '5m' | '1h'

/** How many bytes from the end of the transcript are read; the last replies sit there. */
export const TAIL_BYTES = 3_000_000

type Row = {
  type?: unknown
  isSidechain?: unknown
  message?: { usage?: { cache_creation?: { ephemeral_1h_input_tokens?: unknown; ephemeral_5m_input_tokens?: unknown } } }
}

/**
 * The cache length of the last main-thread reply that wrote to the cache, given the
 * transcript's tail. The first line is dropped: a tail can start inside one.
 */
export function ttlFromTail(tail: string): Ttl {
  const lines = tail.split('\n').slice(1)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    if (!line.includes('"assistant"')) continue
    let row: Row
    try {
      row = JSON.parse(line) as Row
    } catch {
      continue
    }
    if (row.type !== 'assistant' || row.isSidechain) continue
    const cc = row.message?.usage?.cache_creation
    if (Number(cc?.ephemeral_1h_input_tokens ?? 0) > 0) return '1h'
    if (Number(cc?.ephemeral_5m_input_tokens ?? 0) > 0) return '5m'
  }
  return 'unknown'
}

export type Reply = { at: number; tokens: number; model: string | null; ttl: Ttl }

/**
 * The last main-thread reply in a transcript's tail: when it was written, how much context
 * it sent and on which model. For a session whose resume hook Claude Code skipped.
 */
export function lastReply(tail: string): Reply | null {
  const lines = tail.split('\n').slice(1)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    if (!line.includes('"assistant"')) continue
    let row: Row & { timestamp?: unknown; message?: { model?: unknown; usage?: Record<string, unknown> } }
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    const u = row.message?.usage
    const at = Date.parse(String(row.timestamp))
    if (row.type !== 'assistant' || row.isSidechain || !u || Number.isNaN(at)) continue
    const tokens = Number(u.input_tokens ?? 0) + Number(u.cache_read_input_tokens ?? 0) + Number(u.cache_creation_input_tokens ?? 0)
    if (tokens <= 0) continue
    const model = typeof row.message?.model === 'string' ? row.message.model : null
    return { at, tokens, model, ttl: ttlFromTail(`\n${line}`) }
  }
  return null
}

const FIVE_MIN = 5 * 60_000
const HOUR = 60 * 60_000

/** Claude Code's cache settings that fix the length. */
export type CacheEnv = { force5m: boolean; ttl: string; enable1h: boolean }

/**
 * The cache length before any request shows it, by Claude Code's rules: the env settings, then
 * 1 hour for a subscription still within its plan usage and 5 minutes for an API key or
 * usage credits.
 * shortcut: the plan check is a guess from the rate limits, upgrade once the engine names the plan.
 */
export function ruleTtl(env: CacheEnv, windows: readonly { kind: string; percentUsed: number }[]): 5 | 60 {
  if (env.force5m) return 5
  if (env.ttl === '5m') return 5
  if (env.ttl === '1h' || env.enable1h) return 60
  const plan = windows.filter(w => w.kind === 'five_hour' || w.kind === 'seven_day')
  return plan.length > 0 && plan.every(w => w.percentUsed < 100) ? 60 : 5
}

export type Seen = { read: number; write: number; fresh: number }

/**
 * What a request shows about the cache's length, or null when it shows nothing. A hit more than
 * 5 minutes after the last request proves the hour; a miss inside the hour, on the same model and
 * with a prompt that did not shrink, says 5 minutes.
 */
export function learnTtl(gapMs: number, cur: Seen, sameModel: boolean, prevPrompt: number): 5 | 60 | null {
  const prompt = cur.read + cur.write + cur.fresh
  const missed = prompt > 0 && cur.read / prompt < 0.5 && cur.write > 1000
  if (!missed && cur.read > 0 && gapMs > FIVE_MIN) return 60
  if (missed && gapMs > FIVE_MIN && gapMs < HOUR && sameModel && prompt >= prevPrompt) return 5
  return null
}
