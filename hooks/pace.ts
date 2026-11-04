// How fast a limit is being used against the clock. Pure: no engine, no drawing.
export type Tone = 'calm' | 'fast' | 'alert'

/** The window lengths, which a reset time turns into "how much of the time has gone". */
const SPAN: Record<string, number> = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 }

/** Beyond this many points ahead of the clock, or at this share used, the window is in alert. */
export const PACE_ALERT = 15
export const USED_ALERT = 90

/**
 * calm: using no faster than time passes. fast: ahead of the clock. alert: more than 15 points
 * ahead, or 90% used. A window with no known length or reset has no pace: only the 90% rule.
 */
export const toneOf = (kind: string, percentUsed: number, resetsAt: string | undefined, now: number): Tone => {
  const used = Math.max(0, percentUsed)
  const span = SPAN[kind]
  const reset = resetsAt ? Date.parse(resetsAt) : NaN
  let pace = 0
  if (span && Number.isFinite(reset) && reset - now <= span) {
    pace = used - ((span - Math.max(0, reset - now)) / span) * 100
  }
  return used >= USED_ALERT || pace > PACE_ALERT ? 'alert' : pace > 0 ? 'fast' : 'calm'
}
