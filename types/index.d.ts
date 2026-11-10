/**
 * One usage window: which one, how much is used (0 to 100), when it resets.
 * `note` replaces the reset time, for a gauge that has none (the context's token count).
 */
export type Window = { kind: string; percentUsed: number; resetsAt?: string; note?: string }

/**
 * The prompt cache as the band last saw it: when the main thread last sent a
 * request (clock milliseconds), how much context the next request re-sends,
 * the model's context window, the model, and the cache's length in minutes
 * (60 or 5) once the transcript has shown it. After a resume, `usd` is Claude
 * Code's own estimate of re-caching that context; the next request drops it.
 */
export type CacheFacts = { lastAt: number; tokens: number; window: number; model: string | null; ttlMin?: number; usd?: number }

/** Whether the cache card is open, remembered only for the state it was set in. */
export type Fold = { mode: 'warm' | 'cold'; open: boolean }

/** How many times the main conversation compacted, counted for the session that started at `since`. */
export type Compactions = { since: number; count: number }

/** A compaction the agent asked for, waiting for its turn to end; `instructions` is what the summary keeps. */
export type PendingCompact = { instructions: string }

declare module 'claude-code' {
  interface PluginState {
    'ribbon': {
      windows: Window[]
      cache: CacheFacts | null
      fold: Fold | null
      /** The auto-compaction threshold in tokens, read at each turn end; null while auto-compaction is off. */
      threshold: number | null
      compactions: Compactions | null
      pendingCompact: PendingCompact | null
    }
  }
}
