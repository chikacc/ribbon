// How close the conversation is to auto-compaction, and what the band asks the agent when it is
// close. Pure: no engine, no drawing.

/** Below this many tokens there is nothing to weigh yet. */
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

/**
 * The prompt the assess button submits: the figures, then the handover criteria, then how to ask.
 * It speaks to the agent, so it is the same whatever language the band is drawn in.
 */
export const assessPrompt = (used: string, window: string, threshold: string | null): string =>
  [
    `上下文已用 ${used} / ${window}，` + (threshold === null ? '自動壓縮已關閉。' : `自動壓縮門檻 ${threshold}。`),
    '請評估接下來要壓縮、移交新 session，還是先繼續。',
    '判準照 parallel-sessions.md 的交接節：上下文低於視窗的 60% 建議先繼續；超過 60% 預設建議移交。' +
      '下列情境改建議壓縮：剩餘工作短而有界，例如收尾這一片、等線回報再收線；' +
      '線的回報正在走 parentSessionId，移交會讓舊 session 多活幾小時只為了接訊息；' +
      '現在不在檢查點，例如一片做到一半，壓縮撐到下一個檢查點再移交。',
    '用 AskUserQuestion 列這三個選項，把你建議的排第一，每個選項寫一句原因。',
    `使用者選壓縮時，呼叫 ${COMPACT_TOOL_ID}，instructions 寫要保住的事：現況、等使用者的事、沒寫在別處的待辦、下一步；這一輪結束後就會壓縮。`,
    '使用者選移交時，照交接慣例用 start_session 開新 session。使用者選先繼續時，照常工作。',
  ].join('\n')
