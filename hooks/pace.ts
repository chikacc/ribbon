// How fast a limit is being used against the clock. Pure: no engine, no drawing.
import { WORDS } from './lang'
import type { Lang } from './lang'

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

const DAY = 86_400_000

/** The 7-day limit running out before it resets, at this week's pace. */
export type RunOut = { at: number; left: number; gained: number; over: number; resetMs: number }

/**
 * When the 7-day limit runs out at the week's pace (share used over time elapsed, as Claude's own
 * usage page projects it), if that is before the reset. Not before a day of the week has passed
 * or 15% is used: there is too little to go on. Null for every other window.
 */
export const runOutOf = (kind: string, percentUsed: number, resetsAt: string | undefined, now: number): RunOut | null => {
  if (kind !== 'seven_day') return null
  const resetMs = Date.parse(resetsAt ?? '')
  if (!Number.isFinite(resetMs)) return null
  const over = now - (resetMs - 7 * DAY)
  if (over < DAY || percentUsed < 15 || percentUsed >= 100) return null
  const at = now + ((100 - percentUsed) * over) / percentUsed
  return at < resetMs ? { at, left: at - now, gained: percentUsed, over, resetMs } : null
}

/** Within a day of running out the warning turns red. */
export const OUT_ALERT = DAY

const two = (n: number) => String(n).padStart(2, '0')

/** "Sun night", "Fri evening"; short: "Sun pm". The hours after midnight belong to the night before. */
export const dayPart = (ms: number, short = false, lang: Lang = 'en'): string => {
  const w = WORDS[lang]
  const d = new Date(ms)
  const h = d.getHours()
  const part = h < 6 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'
  return w.dayPart(w.days[d.getDay()]!, w.days[(d.getDay() + 6) % 7]!, part, short)
}

export const clockOf = (ms: number): string => `${two(new Date(ms).getHours())}:${two(new Date(ms).getMinutes())}`

/** "Mon 19 Oct". */
export const dateOf = (ms: number, lang: Lang = 'en'): string => {
  const w = WORDS[lang]
  const d = new Date(ms)
  return w.date(w.days[d.getDay()]!, d.getDate(), d.getMonth() + 1)
}
