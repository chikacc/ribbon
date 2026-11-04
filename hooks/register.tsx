import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CacheFacts, Fold, Window } from '../types'
import {
  HUE, INK, ROBO_SIZE, TONES, TTL_MIN, VIOLET, WORD,
  bandPx, cardSvg, chipSvg, familyOf, fmtIdle, kindOf, mineModel, olderRate, priceOf, roboSvg, tok, usd,
} from './cache-art'
import type { CacheView } from './cache-art'
import { TAIL_BYTES, lastReply, learnTtl, ruleTtl, ttlFromTail } from './ttl'
import type { CacheEnv } from './ttl'
import { OUT_ALERT, clockOf, dateOf, dayPart, runOutOf, toneOf } from './pace'

// A band above the prompt in a warm dark look: card surface, cream text,
// dot-matrix bars. Shows how much of each usage window is LEFT, 7-day first, then
// 5-hour; 7D is orange, 5H is yellow; a window under 15% adds a bold LOW.
//
// After the first reply it also shows the prompt cache: WARM (red, Robo bobbing)
// for an hour after the last request, then COLD (blue, Robo frozen) with what the
// next message costs to re-cache. Hide / Show folds the card; warm starts folded,
// cold starts open, and a choice holds until the cache flips. Zero token cost:
// it reads the engine's own figures and draws.

// Theme keys, so the band's text follows the person's light or dark theme.
const TEXT = 'text'
const MUTED = 'inactive'
const EMPTY = 'subtle'

const CELLS = 10
const LOW_AT = 15
const TIGHT_CELLS = 6
/** The full one row (label, "% left", the cache's minutes) needs about this many columns. */
const FULL_AT = 106
/** From here up to FULL_AT the band stays one row, in short words: no label, "94% 2d5h". */
const COMPACT_AT = 66
const COMPACT_CELLS = 5
/** Extra columns the CTX gauge costs on the full row, and on the compact one. */
const CTX_FULL = 36
const CTX_COMPACT = 20
/** How often the band redraws, so the countdown and the warm-to-cold flip stay current. */
const TICK_MS = 30_000

const windows = atom({ plugin: 'ribbon', key: 'windows' } as const, [] as Window[])
const cache = atom({ plugin: 'ribbon', key: 'cache' } as const, null as CacheFacts | null)
const fold = atom({ plugin: 'ribbon', key: 'fold' } as const, null as Fold | null)

const NAMES: Record<string, string> = { seven_day: '7D', five_hour: '5H', spend_limit: 'SPEND', context: 'CTX' }
const ORDER: Record<string, number> = { seven_day: 0, five_hour: 1 }

const clean = (list: readonly Window[]): Window[] =>
  list
    .map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt }))
    .sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9))

const dots = (left: number, cells: number): { on: string; off: string } => {
  const n = Math.max(0, Math.min(cells, Math.round((left / 100) * cells)))
  return { on: '●'.repeat(n), off: '·'.repeat(cells - n) }
}

const fmtReset = (iso: string | undefined, now: number): string => {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (Number.isNaN(ms)) return ''
  if (ms <= 0) return 'resetting'
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** What the cache drawings read, or null until a request and its context size are known. */
export const viewOf = (c: CacheFacts | null, now: number, fallbackMin = TTL_MIN): CacheView | null => {
  if (!c || c.lastAt <= 0 || c.tokens <= 0) return null
  const idleMs = Math.max(0, now - c.lastAt)
  const ttlMin = c.ttlMin ?? fallbackMin
  const rate = olderRate(c.model)
  return {
    mode: idleMs >= ttlMin * 60_000 ? 'cold' : 'warm',
    idle: fmtIdle(idleMs),
    idleMin: Math.floor(idleMs / 60000),
    ttlMin,
    tokens: c.tokens,
    window: c.window,
    mine: familyOf(c.model),
    ...(c.usd !== undefined ? { usd: c.usd } : {}),
    ...(rate ? { rate } : {}),
  }
}

// Claude Code's cache settings, read once when the session starts.
let cacheEnv: CacheEnv = { force5m: false, ttl: '', enable1h: false }

const loadEnv = async ($: EngineInterface): Promise<void> => {
  // $.env.get wants a literal name, so each variable is spelled out.
  const get = (read: () => Promise<string | undefined>) => read().then(v => (v ?? '').trim(), () => '')
  const on = (v: string) => /^(1|true|yes|on)$/i.test(v)
  cacheEnv = {
    force5m: on(await get(() => $.env.get('FORCE_PROMPT_CACHING_5M'))),
    ttl: await get(() => $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL')),
    enable1h: on(await get(() => $.env.get('ENABLE_PROMPT_CACHING_1H'))),
  }
}

// Where the session's transcript is: classic.SessionStart hands it over, else findTranscript looks.
let transcript = ''

const home = async ($: EngineInterface) => (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))

// Some machines (Team, Enterprise: cc-plugin-sec-default) skip every classic.* hook, so no
// hook hands over the transcript path. Find it from the session id: the folder Claude Code
// names after the project first, then every project folder.
const findTranscript = async ($: EngineInterface): Promise<string> => {
  const session = await $.session.id()
  const projects = `${(await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await home($)}/.claude`}/projects`
  const exists = (file: string) => $.fs.exists(file).catch(() => false)
  const root = await $.session.root().catch(() => '')
  const named = `${projects}/${root.replace(/[^a-zA-Z0-9]/g, '-')}/${session}.jsonl`
  if (root !== '' && (await exists(named))) return named
  for (const dir of (await $.fs.list(projects).catch(() => [])).filter(d => d.kind === 'dir')) {
    const file = `${projects}/${dir.name}/${session}.jsonl`
    if (await exists(file)) return file
  }
  return ''
}

// The end of the transcript. tail where there is one; without it (Windows) fs.read, which stops at 4 MiB.
const readTail = async ($: EngineInterface, file: string): Promise<string> => {
  const r = await $.process.run(['tail', '-c', String(TAIL_BYTES), file]).catch(() => undefined)
  if (r && r.exitCode === 0) return r.stdout
  return (await $.fs.read(file).catch(() => '')).slice(-TAIL_BYTES)
}

/** Which cache length the session's last reply wrote, read from the transcript's tail, onto the cache facts. */
const detectTtl = async ($: EngineInterface): Promise<void> => {
  if (!transcript) transcript = await findTranscript($)
  if (!transcript) return
  const found = ttlFromTail(await readTail($, transcript))
  if (found === 'unknown') return
  const ttlMin = found === '1h' ? 60 : 5
  await update($, cache, c => (c ? { ...c, ttlMin } : c))
}

/** A resumed session whose classic.SessionStart was skipped: seed the cache from its transcript. */
const seedFromTranscript = async ($: EngineInterface): Promise<void> => {
  if (await read($, cache)) return
  transcript = await findTranscript($)
  if (!transcript) return
  const r = lastReply(await readTail($, transcript))
  if (!r) return
  const window = (await $.session.usage()).context.window
  const ttlMin = r.ttl === '5m' ? 5 : 60
  await update($, cache, c => c ?? { lastAt: r.at, tokens: r.tokens, window, model: r.model, ttlMin })
}

const pull = async ($: EngineInterface): Promise<void> => {
  const u = await $.session.usage()
  await update($, windows, () => clean(u.rateLimits))
}

/** Fresh context figures from the engine onto the cache facts, when it has them. */
const measure = async ($: EngineInterface, lastAt: number | null, model: string | null): Promise<void> => {
  const u = await $.session.usage()
  const m = model ?? (await $.session.model())
  await update($, cache, c => ({
    ...c,
    lastAt: lastAt ?? c?.lastAt ?? 0,
    tokens: u.context.tokens && u.context.tokens > 0 ? u.context.tokens : (c?.tokens ?? 0),
    window: u.context.window || c?.window || 0,
    model: m || c?.model || null,
  }))
}

export const register: Register = (on, options) => {
  // userConfig `usage`: whether the bars show what is left (default) or what is used.
  const used = options.usage === 'used'

  on('session.start', async ($, e, next) => {
    await pull($)
    await loadEnv($)
    await seedFromTranscript($).catch(() => undefined)
    $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, windows, () => clean(e.rateLimits))
    }
    if (e.changed.includes('context') && e.context.tokens && e.context.tokens > 0) {
      const tokens = e.context.tokens
      await update($, cache, c => (c ? { ...c, tokens, window: e.context.window || c.window } : c))
    }
    return next(e)
  })

  // A resumed or forked session knows how long it was away and how big it is.
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    if (typeof e.transcript_path === 'string' && e.transcript_path) transcript = e.transcript_path
    if (e.source === 'clear' || e.source === 'compact') {
      await update($, cache, () => null)
      await update($, fold, () => null)
    } else if ((e.source === 'resume' || e.source === 'fork') && typeof e.seconds_since_last_response === 'number') {
      const now = await $.clock.now()
      const lastAt = now - e.seconds_since_last_response * 1000
      const window = (await $.session.usage()).context.window
      const model = typeof e.model === 'string' ? e.model : await $.session.model()
      const tokens = typeof e.context_tokens === 'number' ? e.context_tokens : 0
      // Claude Code prices the re-cache itself, at the managed or list rate: better than the table.
      const usd = typeof e.estimated_cache_write_usd === 'number' && e.estimated_cache_write_usd > 0 ? e.estimated_cache_write_usd : undefined
      await update($, cache, () => ({ lastAt, tokens, window, model, ...(usd !== undefined ? { usd } : {}) }))
      await detectTtl($).catch(() => undefined)
    }
    return r
  }).catch(($, e, next) => next(e)) // a band that fails to seed never holds up the session

  // Each main-thread request reads or writes the cache, so its start resets the hour.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e)
    const now = await $.clock.now()
    const prev = await read($, cache)
    await update($, cache, c => ({ lastAt: now, tokens: c?.tokens ?? 0, window: c?.window ?? 0, model: c?.model ?? null, ...(c?.ttlMin ? { ttlMin: c.ttlMin } : {}) }))
    const result = yield* next(e)
    // The reply's token counts show how long the cache lives: learn it from the traffic.
    const u = (result as { usage?: Record<string, unknown> } | undefined)?.usage
    if (u && prev && prev.lastAt > 0) {
      const model = String(u.model ?? (e as { model?: unknown }).model ?? '')
      const learned = learnTtl(
        now - prev.lastAt,
        { read: Number(u.cache_read_input_tokens ?? 0), write: Number(u.cache_creation_input_tokens ?? 0), fresh: Number(u.input_tokens ?? 0) },
        model !== '' && model === prev.model,
        prev.tokens,
      )
      if (learned) await update($, cache, c => (c ? { ...c, ttlMin: learned } : c))
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    const now = await $.clock.now()
    const c = await read($, cache)
    // turn.step stamps the exact request time; when no step of this turn did, the turn's end is the floor.
    const lastAt = !c || now - c.lastAt > e.durationMs ? now : c.lastAt
    await measure($, lastAt, e.usage?.model ?? null)
    await detectTtl($).catch(() => undefined)
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    // Keep other mods' bands (savvy-progress, say) stacked above this one. Claude Code's own
    // placeholder ({ type: 'engine' }) is never nested: the desktop drops a band that nests it.
    const drawn = await Promise.resolve(next(e)).catch(() => null)
    const above = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null
    const own = await (async () => {
      const ui = $.ui.resolve(e)
      const { Box, Button, Text } = ui
      // Svg draws on desktop, mobile and VS Code; the terminal gets the text form.
      // Ask the surface, not the table: the terminal's table still lists Svg.
      const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : null
      const saved = await read($, windows)
      const now = await $.clock.now()
      const view = viewOf(await read($, cache), now, ruleTtl(cacheEnv, saved))

      if (saved.length === 0 && !view) {
        return (
          <Box paddingX={1}>
            <Text color={MUTED}>USAGE · waiting for the first reply</Text>
          </Box>
        )
      }

      const columns = e.props.bodyColumns ?? e.viewport?.columns ?? 100
      const kind = kindOf(columns)
      // The context gauge needs the cache's token count, so it comes after the first reply.
      const hasCtx = !!view && view.window > 0
      const fullAt = FULL_AT + (hasCtx ? CTX_FULL : 0)
      // Between COMPACT_AT and fullAt the band stays one row, in short words.
      const compact = columns >= COMPACT_AT && columns < fullAt
      const isWide = kind === 'wide' || compact
      const cells = compact ? COMPACT_CELLS : kind === 'tight' ? TIGHT_CELLS : CELLS
      const ctx: Window[] =
        view && hasCtx && (columns >= fullAt || columns >= COMPACT_AT + CTX_COMPACT)
          ? [{ kind: 'context', percentUsed: Math.min(100, (view.tokens / view.window) * 100), note: compact ? tok(view.tokens) : `${tok(view.tokens)}/${tok(view.window)}` }]
          : []
      const list = [...saved, ...ctx]

      const parts = (w: Window) => {
        const left = Math.max(0, Math.round((100 - w.percentUsed) * 10) / 10)
        const tone = toneOf(w.kind, w.percentUsed, w.resetsAt, now)
        const out = runOutOf(w.kind, w.percentUsed, w.resetsAt, now)
        // The figure and the filled dots follow the setting; LOW always looks at what is left.
        const fig = used ? Math.min(100, Math.round(w.percentUsed * 10) / 10) : left
        return {
          left,
          fig,
          word: used ? 'used' : 'left',
          col: tone === 'calm' && w.kind === 'context' ? VIOLET : TONES[tone],
          name: NAMES[w.kind] ?? w.kind.toUpperCase(),
          d: dots(fig, cells),
          reset: w.note ?? fmtReset(w.resetsAt, now),
          out,
          outCol: out && out.left <= OUT_ALERT ? TONES.alert : TONES.fast,
        }
      }

      // The 7-day limit running out early. Where the Show card can hold the details (the app, once
      // there is a cache to show) the warning takes the reset countdown's place and the card says
      // the rest; otherwise it adds to the row.
      const detail = Svg !== null && !!view
      const warning = (p: ReturnType<typeof parts>, form: 'long' | 'short') =>
        p.out ? <Text color={p.outCol} bold>{form === 'long' ? ' · ' : ' '}⚠ {dayPart(p.out.at, form === 'short')}</Text> : null

      // Wide: every window on one row. Narrow: each window is a block of three
      // lines (name and dots, percent left, reset time) so nothing wraps or clips.
      const wide = (w: Window, i: number) => {
        const p = parts(w)
        return (
          <Box key={`w-${i}`} flexDirection="row" flexShrink={0} marginRight={3}>
            <Text color={MUTED} bold>{p.name} </Text>
            <Text color={p.col}>{p.d.on}</Text>
            <Text color={EMPTY}>{p.d.off}</Text>
            <Text color={p.col} bold> {p.fig}% {p.word}</Text>
            {p.left < LOW_AT ? <Text color={TEXT} bold> LOW</Text> : null}
            {p.reset && !(p.out && detail) ? <Text color={MUTED}> · {p.reset}</Text> : null}
            {warning(p, 'long')}
          </Box>
        )
      }

      // Compact: the same row in short words, so it fits where the full row clips.
      const short = (w: Window, i: number) => {
        const p = parts(w)
        return (
          <Box key={`w-${i}`} flexDirection="row" flexShrink={0} marginRight={2}>
            <Text color={MUTED} bold>{p.name} </Text>
            <Text color={p.col}>{p.d.on}</Text>
            <Text color={EMPTY}>{p.d.off}</Text>
            <Text color={p.col} bold> {Math.round(p.fig)}%</Text>
            {p.left < LOW_AT ? <Text color={TEXT} bold> LOW</Text> : null}
            {p.reset && !(p.out && detail) ? <Text color={MUTED}> {p.reset.replace(' ', '')}</Text> : null}
            {Svg ? warning(p, 'short') : null}
          </Box>
        )
      }

      const stacked = (w: Window, i: number) => {
        const p = parts(w)
        return (
          <Box key={`w-${i}`} flexDirection="column" flexShrink={0} marginRight={3}>
            <Box flexDirection="row">
              <Text color={MUTED} bold>{p.name} </Text>
              <Text color={p.col}>{p.d.on}</Text>
              <Text color={EMPTY}>{p.d.off}</Text>
            </Box>
            <Box flexDirection="row">
              <Text color={p.col} bold>{p.fig}% {p.word}</Text>
              {p.left < LOW_AT ? <Text color={TEXT} bold> LOW</Text> : null}
            </Box>
            {p.out && detail ? <Text color={p.outCol} bold>⚠ {dayPart(p.out.at, true)}</Text> : p.reset ? <Text color={MUTED}>resets {p.reset}</Text> : null}
          </Box>
        )
      }

      const label = compact ? null : (
        <Box key="label" flexShrink={0} marginRight={isWide ? 2 : 3}>
          <Text color={TEXT} bold>USAGE</Text>
        </Box>
      )
      const usage = list.length > 0
        ? list.map(compact ? short : isWide ? wide : stacked)
        : [<Box key="wait" flexShrink={0} marginRight={3}><Text color={MUTED}>waiting for the first reply</Text></Box>]

      // Before the first reply there is no cache to show: today's band, as it was.
      if (!view) {
        return (
          <Box flexDirection="row" paddingX={1}>
            {label}
            {usage}
          </Box>
        )
      }

      const mode = view.mode
      const cold = mode === 'cold'
      const hue = HUE[mode]
      const mine = mineModel(view)
      const stored = await read($, fold)
      // Folding needs the card, and the card is a drawing: the terminal stays folded.
      const open = Svg !== null && (stored && stored.mode === mode ? stored.open : cold)
      const toggle = () =>
        update($, fold, f => ({ mode, open: !(f && f.mode === mode ? f.open : mode === 'cold') }))

      const badge = Svg
        ? [
            <Svg key="robo" source={roboSvg(mode)} alt={cold ? 'Robo, frozen' : 'Robo, bobbing'} width={ROBO_SIZE} height={ROBO_SIZE} isInteractive />,
            <Text key="gap"> </Text>,
            (() => {
              const c = chipSvg(mode)
              return <Svg key="chip" source={c.source} alt={WORD[mode]} width={c.w} height={c.h} />
            })(),
          ]
        : [<Text key="chip" backgroundColor={hue} color={INK} bold>{` ${WORD[mode]} `}</Text>]

      const summary = compact
        ? cold
          ? [mine
              ? <Text key="cost" color={TEXT} bold>{` ${usd(priceOf(view, mine))}`}</Text>
              : <Text key="idle" color={hue} bold>{` ${view.idle.replace(' ', '')}`}</Text>]
          : [<Text key="left" color={hue} bold>{` ${Math.max(0, view.ttlMin - view.idleMin)}m`}</Text>]
        : cold
        ? [
            <Text key="idle" color={hue} bold>{` ${view.idle}`}</Text>,
            mine ? <Text key="dot" color={MUTED}> · </Text> : null,
            mine ? <Text key="cost" color={TEXT} bold>{usd(priceOf(view, mine))}</Text> : null,
          ]
        : [<Text key="left" color={hue} bold>{` ${Math.max(0, view.ttlMin - view.idleMin)}m left`}</Text>]

      const button = Svg ? (
        <Box key="fold" flexShrink={0} alignItems="flex-start">
          <Button key="cache-fold" label={open ? 'Hide' : 'Show'} onPress={toggle} />
        </Box>
      ) : null
      const grow = <Box key="grow" flexGrow={1} />

      let rows
      if (isWide) {
        rows = (
          <Box key="row" flexDirection="row" paddingX={1} alignItems="center">
            {label}
            {usage}
            {open ? null : (
              <Box key="inline" flexDirection="row" flexShrink={0} marginRight={2} alignItems="center">
                {badge}
                {summary}
              </Box>
            )}
            {grow}
            {button}
          </Box>
        )
      } else if (kind === 'stacked') {
        // The cache becomes a third stacked block, the same shape as 7D and 5H.
        rows = (
          <Box key="row" flexDirection="row" paddingX={1}>
            {label}
            {usage}
            {open ? null : (
              <Box key="block" flexDirection="column" flexShrink={0} marginRight={2}>
                <Box flexDirection="row" alignItems="center">{badge}</Box>
                <Text color={hue} bold>{cold ? `${view.idle} idle` : `${Math.max(0, view.ttlMin - view.idleMin)}m left`}</Text>
                {mine ? (
                  <Box flexDirection="row">
                    <Text color={TEXT} bold>{usd(priceOf(view, mine))}</Text>
                    <Text color={MUTED}> next</Text>
                  </Box>
                ) : null}
              </Box>
            )}
            {grow}
            {button}
          </Box>
        )
      } else {
        // Narrow: the cache gets its own row under the usage blocks.
        rows = [
          <Box key="row" flexDirection="row" paddingX={1}>
            {label}
            {usage}
          </Box>,
          <Box key="cache" flexDirection="row" paddingX={1} alignItems="center">
            {badge}
            {summary}
            {grow}
            {button}
          </Box>,
        ]
      }

      let card = null
      if (open && Svg) {
        const o = list.map(w => ({ w, out: runOutOf(w.kind, w.percentUsed, w.resetsAt, now) })).find(x => x.out)
      const note = o?.out
        ? {
            color: o.out.left <= OUT_ALERT ? TONES.alert : TONES.fast,
            lines: [
              `7-day limit runs out ${dayPart(o.out.at)}, around ${clockOf(o.out.at)}`,
              `At this week's pace: ${Math.round(o.out.gained)}% used in ${fmtIdle(o.out.over)}`,
              `It resets ${dateOf(o.out.resetMs)}, in ${fmtIdle(o.out.resetMs - now)}`,
            ],
          }
        : undefined
      const c = cardSvg(view, kind, bandPx(columns), note)
        card = (
          <Box key="card" flexDirection="row">
            <Svg source={c.source} alt={c.alt} width={c.w} height={c.h} isInteractive={kind !== 'tight'} />
          </Box>
        )
      }

      return (
        <Box flexDirection="column">
          {rows}
          {card}
        </Box>
      )
    })()
    if (!above) return own
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {above}
        {own}
      </Box>
    )
  })
}
