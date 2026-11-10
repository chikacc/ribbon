// Every word the band and the card say, in the languages ribbon speaks. Pure: no engine.
// Durations (3d 9h, 42m) and model names stay as they are in all of them.
// zh is Simplified Chinese; zh-TW is Traditional Chinese with Taiwan's terms.
export type Lang = 'en' | 'zh' | 'zh-TW'

export type Words = {
  usage: string
  waiting: string
  figure: (n: number, used: boolean) => string
  low: string
  resetsLine: (r: string) => string
  resetting: string
  show: string
  hide: string
  warm: string
  cold: string
  you: string
  leftMin: (m: number) => string
  idleFor: (idle: string) => string
  next: string
  roboWarm: string
  roboCold: string
  ctx: string
  // The card.
  idle: string
  reCache: string
  inCache: string
  nextCosts: (cold: boolean) => string
  warmFor: (ttl: string) => string
  coldNow: string
  lastReply: string
  coldIn: (m: number) => string
  ofContext: (pct: number, tokens: string) => string
  altCold: (idle: string, tokens: string) => string
  altWarm: (m: number, tokens: string) => string
  // Days and dates.
  days: string[]
  dayPart: (day: string, prevDay: string, part: 'night' | 'morning' | 'afternoon' | 'evening', short: boolean) => string
  date: (weekday: string, day: number, month: number) => string
  // The run-out note under the card.
  runsOut: (when: string, clock: string) => string
  pace: (gained: number, over: string, date: string, inn: string) => string
  // The context: the compactions so far.
  compacted: (n: number) => string
  compactFailed: (reason: string) => string
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const en: Words = {
  usage: 'USAGE',
  waiting: 'waiting for the first reply',
  figure: (n, used) => `${n}% ${used ? 'used' : 'left'}`,
  low: 'LOW',
  resetsLine: r => `resets ${r}`,
  resetting: 'resetting',
  show: 'Show',
  hide: 'Hide',
  warm: 'WARM',
  cold: 'COLD',
  you: 'YOU',
  leftMin: m => `${m}m left`,
  idleFor: idle => `${idle} idle`,
  next: 'next',
  roboWarm: 'Robo, bobbing',
  roboCold: 'Robo, frozen',
  ctx: 'CTX',
  idle: 'IDLE',
  reCache: 'RE-CACHE',
  inCache: 'IN CACHE',
  nextCosts: cold => (cold ? 'NEXT MESSAGE COSTS' : 'NEXT MESSAGE COSTS, CACHED'),
  warmFor: ttl => `warm ${ttl}`,
  coldNow: 'cold now',
  lastReply: 'last reply',
  coldIn: m => `cold in ${m}m`,
  ofContext: (pct, tokens) => `${pct}% of the ${tokens} context`,
  altCold: (idle, tokens) => `Cache cold. Idle ${idle}. Next message re-caches ${tokens} tokens.`,
  altWarm: (m, tokens) => `Cache warm. Goes cold in ${m} minutes. ${tokens} tokens cached.`,
  days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  dayPart: (day, prev, part, short) =>
    part === 'night' ? `${prev} ${short ? 'pm' : 'night'}` : `${day} ${short ? (part === 'morning' ? 'am' : 'pm') : part}`,
  date: (weekday, day, month) => `${weekday} ${day} ${MONTHS[month - 1]}`,
  runsOut: (when, clock) => `7-day limit runs out ${when}, around ${clock}`,
  pace: (gained, over, date, inn) => `At this week's pace: ${gained}% in ${over} · resets ${date}, in ${inn}`,
  compacted: n => `compacted ${n}x`,
  compactFailed: reason => `ribbon: compaction did not run, ${reason}`,
}

const zh: Words = {
  usage: '用量',
  waiting: '等待第一次回复',
  figure: (n, used) => `${used ? '已用' : '剩余'} ${n}%`,
  low: '偏低',
  resetsLine: r => `${r} 后重置`,
  resetting: '重置中',
  show: '展开',
  hide: '收起',
  warm: '热',
  cold: '冷',
  you: '当前',
  leftMin: m => `剩 ${m}m`,
  idleFor: idle => `空闲 ${idle}`,
  next: '下条',
  roboWarm: '机器人,在晃动',
  roboCold: '机器人,被冻住了',
  ctx: '上下文',
  idle: '空闲',
  reCache: '需重写缓存',
  inCache: '缓存中',
  nextCosts: cold => (cold ? '下条消息花费' : '下条消息花费(命中缓存)'),
  warmFor: ttl => `热 ${ttl}`,
  coldNow: '已变冷',
  lastReply: '上次回复',
  coldIn: m => `${m}m 后变冷`,
  ofContext: (pct, tokens) => `占 ${tokens} 上下文的 ${pct}%`,
  altCold: (idle, tokens) => `缓存已冷。已空闲 ${idle}。下条消息要重新缓存 ${tokens} 个 token。`,
  altWarm: (m, tokens) => `缓存是热的。${m} 分钟后变冷。已缓存 ${tokens} 个 token。`,
  days: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
  dayPart: (day, prev, part, short) =>
    part === 'night' ? `${prev}夜里` : `${day}${part === 'morning' ? '上午' : part === 'afternoon' ? '下午' : short ? '下午' : '晚上'}`,
  date: (weekday, day, month) => `${month}月${day}日 ${weekday}`,
  runsOut: (when, clock) => `7天额度将在 ${when} ${clock} 左右用完`,
  pace: (gained, over, date, inn) => `按本周速度:${over} 内用了 ${gained}% · ${date}重置,还有 ${inn}`,
  compacted: n => `已压缩 ${n} 次`,
  compactFailed: reason => `ribbon:压缩没有执行,${reason}`,
}

const zhTW: Words = {
  usage: '用量',
  waiting: '等待第一次回應',
  figure: (n, used) => `${used ? '已用' : '剩餘'} ${n}%`,
  low: '偏低',
  resetsLine: r => `${r} 後重設`,
  resetting: '重設中',
  show: '展開',
  hide: '收合',
  warm: '熱',
  cold: '冷',
  you: '目前',
  leftMin: m => `剩 ${m}m`,
  idleFor: idle => `閒置 ${idle}`,
  next: '下則',
  roboWarm: '機器人,在晃動',
  roboCold: '機器人,被凍住了',
  ctx: '上下文',
  idle: '閒置',
  reCache: '需重寫快取',
  inCache: '快取中',
  nextCosts: cold => (cold ? '下則訊息花費' : '下則訊息花費,命中快取'),
  warmFor: ttl => `熱 ${ttl}`,
  coldNow: '已變冷',
  lastReply: '上次回應',
  coldIn: m => `${m}m 後變冷`,
  ofContext: (pct, tokens) => `占 ${tokens} 上下文的 ${pct}%`,
  altCold: (idle, tokens) => `快取已冷。已閒置 ${idle}。下則訊息要重新快取 ${tokens} 個 token。`,
  altWarm: (m, tokens) => `快取是熱的。${m} 分鐘後變冷。已快取 ${tokens} 個 token。`,
  days: ['週日', '週一', '週二', '週三', '週四', '週五', '週六'],
  dayPart: (day, prev, part, short) =>
    part === 'night' ? `${prev}夜裡` : `${day}${part === 'morning' ? '上午' : part === 'afternoon' ? '下午' : short ? '下午' : '晚上'}`,
  date: (weekday, day, month) => `${month}月${day}日 ${weekday}`,
  runsOut: (when, clock) => `7 天額度將在 ${when} ${clock} 左右用完`,
  pace: (gained, over, date, inn) => `照本週速度:${over} 內用了 ${gained}% · ${date}重設,還有 ${inn}`,
  compacted: n => `已壓縮 ${n} 次`,
  compactFailed: reason => `ribbon:壓縮沒有執行,${reason}`,
}

export const WORDS: Record<Lang, Words> = { en, zh, 'zh-TW': zhTW }

/** The setting as a language: anything but "zh" or "zh-TW" is English. */
export const langOf = (setting: unknown): Lang => (setting === 'zh' || setting === 'zh-TW' ? setting : 'en')
