// How close the conversation is to auto-compaction: the zones that colour the CTX gauge, and the
// tool the agent compacts through. Pure: no engine, no drawing.

/** Below this many tokens the context is roomy. */
export const ROOMY_TOKENS = 150_000
/** From this share of the auto-compaction threshold on, compaction is close. */
export const CLOSE_SHARE = 0.9

export type Zone = 'roomy' | 'weighing' | 'close'

/**
 * roomy: under 150k tokens. weighing: from 150k up to 90% of the auto-compaction threshold.
 * close: past that. With auto-compaction off (no threshold) the context window stands in.
 */
export const zoneOf = (tokens: number, threshold: number | null, window: number): Zone =>
  tokens >= CLOSE_SHARE * (threshold ?? window) ? 'close' : tokens >= ROOMY_TOKENS ? 'weighing' : 'roomy'

/** The tool the agent calls once the person picks compaction; the engine names it mcp__ribbon__<name>. */
export const COMPACT_TOOL = 'compact_after_turn'
export const COMPACT_TOOL_ID = `mcp__ribbon__${COMPACT_TOOL}`
