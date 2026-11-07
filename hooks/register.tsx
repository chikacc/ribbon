import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CacheFacts, Compactions, Fold, PendingCompact, Window } from '../types'
import { COMPACT_TOOL, assessPrompt, zoneOf } from './assess'
import {
  HUE, INK, ROBO_SIZE, TONES, TTL_MIN, ZONE_TONES,
  cardTextOf, cardTiles, chipSvg, familyOf, fmtIdle, kindOf, mineModel, olderRate, priceOf, roboSvg, tok, usd,
} from './cache-art'
import type { CacheView } from './cache-art'
import type { Lang } from './lang'
import { TAIL_BYTES, lastReply, learnTtl, ruleTtl, ttlFromTail } from './ttl'
import type { CacheEnv } from './ttl'
import { WORDS, langOf } from './lang'
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
//
// The CTX gauge is coloured by how close the context is to auto-compaction (assess.ts).
// From 150k tokens on, an "Ask agent" button submits a prompt, only when the person
// presses it, asking the agent whether to compact, hand over or carry on; the agent
// compacts through the compact_after_turn tool once the person picks it.

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
const threshold = atom({ plugin: 'ribbon', key: 'threshold' } as const, null as number | null)
const compactions = atom({ plugin: 'ribbon', key: 'compactions' } as const, null as Compactions | null)
const isAssessQueued = atom({ plugin: 'ribbon', key: 'isAssessQueued' } as const, false)
const pendingCompact = atom({ plugin: 'ribbon', key: 'pendingCompact' } as const, null as PendingCompact | null)

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

const fmtReset = (iso: string | undefined, now: number, resetting = 'resetting'): string => {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (Number.isNaN(ms)) return ''
  if (ms <= 0) return resetting
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** What the cache drawings read, or null until a request and its context size are known. */
export const viewOf = (c: CacheFacts | null, now: number, fallbackMin = TTL_MIN, lang: Lang = 'en'): CacheView | null => {
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
    lang,
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

/**
 * The usage figures with the summary breakdown, which carries the auto-compaction threshold, and
 * that threshold kept: null while auto-compaction is off, the last one when no breakdown came back.
 * A summary breakdown estimates locally and sends nothing, so it is cheap enough per turn end.
 */
const usageWithThreshold = async ($: EngineInterface) => {
  const u = await $.session.usage({ breakdown: 'summary' })
  const b = u.context.breakdown
  if (b) await update($, threshold, () => (b.isAutoCompactEnabled ? (b.autoCompactThreshold ?? null) : null))
  return u
}

const pull = async ($: EngineInterface): Promise<void> => {
  const u = await usageWithThreshold($)
  await update($, windows, () => clean(u.rateLimits))
}

/** Fresh context figures from the engine onto the cache facts, when it has them. */
const measure = async ($: EngineInterface, lastAt: number | null, model: string | null): Promise<void> => {
  const u = await usageWithThreshold($)
  const m = model ?? (await $.session.model())
  await update($, cache, c => ({
    ...c,
    lastAt: lastAt ?? c?.lastAt ?? 0,
    tokens: u.context.tokens && u.context.tokens > 0 ? u.context.tokens : (c?.tokens ?? 0),
    window: u.context.window || c?.window || 0,
    model: m || c?.model || null,
  }))
}

/** Asks the agent whether to compact, hand over or carry on; only ever from the person's press. */
const assess = async ($: EngineInterface, tokens: number, window: number): Promise<void> => {
  await update($, isAssessQueued, () => true)
  const limit = await read($, threshold)
  try {
    await $.prompt.submit({ text: assessPrompt(tok(tokens), tok(window), limit === null ? null : tok(limit)) })
  } catch (error) {
    await update($, isAssessQueued, () => false)
    $.ui.toast(String(error), { timeoutMs: 10_000 })
  }
}

// `$.session.compact` is refused on the desktop host; the /compact command runs once the session is idle.
const runCompact = async ($: EngineInterface, instructions: string, toast: (reason: string) => string): Promise<void> => {
  try {
    await $.command.run({ command: 'compact', args: instructions })
  } catch (error) {
    $.ui.toast(toast(String(error)), { timeoutMs: 10_000 })
  }
}

export const register: Register = (on, options) => {
  // userConfig `usage`: whether the bars show what is left (default) or what is used.
  const used = options.usage === 'used'
  // userConfig `language`: en (default), zh or zh-TW.
  const lang = langOf(options.language)
  // userConfig `cardText`: how large the cache card's small text is, small (default), medium, large or xlarge.
  const cardText = cardTextOf(options.cardText)
  // userConfig `stackGap`: the space between another mod's band above (next-steps, say) and this
  // one, as a step each surface sizes its own way; none (upstream), sm (default) or md.
  const stackGap = options.stackGap === 'none' ? undefined : options.stackGap === 'md' ? 'md' : 'sm'
  const T = WORDS[lang]

  on('session.start', async ($, e, next) => {
    await pull($)
    await loadEnv($)
    await seedFromTranscript($).catch(() => undefined)
    $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'))
    // Last, so a host that refuses the tool has the band set up already.
    await $.tool.register({
      name: COMPACT_TOOL,
      description:
        'Queues a compaction of this conversation that runs as soon as the current turn ends. ' +
        'Call it only after the person chose to compact. `instructions` is what the summary should keep.',
      inputSchema: { type: 'object', properties: { instructions: { type: 'string' } } },
      isDeferred: false,
    })
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

    // The compaction the agent asked for during this turn, now that the turn is over. First, so a
    // failed measure below never drops it.
    const request = await read($, pendingCompact)
    if (request !== null) {
      await update($, pendingCompact, () => null)
      $.clock.after(0, () => void runCompact($, request.instructions, T.compactFailed))
    }

    const now = await $.clock.now()
    const c = await read($, cache)
    // turn.step stamps the exact request time; when no step of this turn did, the turn's end is the floor.
    const lastAt = !c || now - c.lastAt > e.durationMs ? now : c.lastAt
    await measure($, lastAt, e.usage?.model ?? null)
    await detectTtl($).catch(() => undefined)
    return r
  })

  // A new turn is the assess prompt's answer, or the person moving on: the button comes back.
  on('turn.start', async ($, e, next) => {
    await update($, isAssessQueued, () => false)
    return next(e)
  })

  // The matcher is spelled out so validate can read it: it is COMPACT_TOOL_ID.
  on('tool.call', { tool: 'mcp__ribbon__compact_after_turn' }, async ($, e) => {
    const instructions = typeof e.instructions === 'string' ? e.instructions : ''
    await update($, pendingCompact, () => ({ instructions }))
    return { result: 'queued', text: 'Compaction queued. It runs when this turn ends.' }
  })

  // Counts the main conversation's compactions, for the session that started at `startedAt`.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.trigger === 'precompute' || e.agentId || result.messages === undefined) return result
    const { startedAt } = await $.session.usage()
    await update($, compactions, c => ({ since: startedAt, count: (c?.since === startedAt ? c.count : 0) + 1 }))
    return result
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
      const view = viewOf(await read($, cache), now, ruleTtl(cacheEnv, saved), lang)

      // How close the context is to auto-compaction: the CTX gauge's colour, and from 150k on a
      // button that asks the agent whether to compact, hand over or carry on.
      const zone = view && view.window > 0 ? zoneOf(view.tokens, await read($, threshold), view.window) : 'roomy'
      const assessButton = !view || zone === 'roomy'
        ? null
        : (
            <Box key="assess-box" flexShrink={0} alignItems="flex-start" marginRight={1}>
              {(await read($, isAssessQueued))
                ? <Button key="assess" hotkey="a" plain dimColor label={T.assessQueued} onPress={() => {}} />
                : <Button key="assess" hotkey="a" label={T.assess} onPress={() => assess($, view.tokens, view.window)} />}
            </Box>
          )
      const { startedAt } = await $.session.usage()
      const counted = await read($, compactions)
      const compacted = counted !== null && counted.since === startedAt && counted.count > 0
        ? <Box key="compacted" flexShrink={0} marginRight={2}><Text color={MUTED}>{T.compacted(counted.count)}</Text></Box>
        : null

      if (saved.length === 0 && !view && !compacted) {
        return (
          <Box paddingX={1}>
            <Text color={MUTED}>{`${T.usage} · ${T.waiting}`}</Text>
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
          text: T.figure(fig, used),
          col: w.kind === 'context' ? ZONE_TONES[zone] : TONES[tone],
          name: w.kind === 'context' ? T.ctx : (NAMES[w.kind] ?? w.kind.toUpperCase()),
          d: dots(fig, cells),
          reset: w.note ?? fmtReset(w.resetsAt, now, T.resetting),
          out,
          outCol: out && out.left <= OUT_ALERT ? TONES.alert : TONES.fast,
        }
      }

      // The 7-day limit running out early. Where the Show card can hold the details (the app, once
      // there is a cache to show) the warning takes the reset countdown's place and the card says
      // the rest; otherwise it adds to the row.
      const detail = Svg !== null && !!view
      const warning = (p: ReturnType<typeof parts>, form: 'long' | 'short') =>
        p.out ? <Text color={p.outCol} bold>{form === 'long' ? ' · ' : ' '}⚠ {dayPart(p.out.at, form === 'short', lang)}</Text> : null

      // Wide: every window on one row. Narrow: each window is a block of three
      // lines (name and dots, percent left, reset time) so nothing wraps or clips.
      const wide = (w: Window, i: number) => {
        const p = parts(w)
        return (
          <Box key={`w-${i}`} flexDirection="row" flexShrink={0} marginRight={3}>
            <Text color={MUTED} bold>{p.name} </Text>
            <Text color={p.col}>{p.d.on}</Text>
            <Text color={EMPTY}>{p.d.off}</Text>
            <Text color={p.col} bold>{` ${p.text}`}</Text>
            {p.left < LOW_AT ? <Text color={TEXT} bold>{` ${T.low}`}</Text> : null}
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
            {p.left < LOW_AT ? <Text color={TEXT} bold>{` ${T.low}`}</Text> : null}
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
              <Text color={p.col} bold>{p.text}</Text>
              {p.left < LOW_AT ? <Text color={TEXT} bold>{` ${T.low}`}</Text> : null}
            </Box>
            {p.out && detail ? <Text color={p.outCol} bold>⚠ {dayPart(p.out.at, true, lang)}</Text> : p.reset ? <Text color={MUTED}>{T.resetsLine(p.reset)}</Text> : null}
          </Box>
        )
      }

      const label = compact ? null : (
        <Box key="label" flexShrink={0} marginRight={isWide ? 2 : 3}>
          <Text color={TEXT} bold>{T.usage}</Text>
        </Box>
      )
      const usage = list.length > 0
        ? list.map(compact ? short : isWide ? wide : stacked)
        : [<Box key="wait" flexShrink={0} marginRight={3}><Text color={MUTED}>{T.waiting}</Text></Box>]

      // Before the first reply there is no cache to show: today's band, as it was.
      if (!view) {
        return (
          <Box flexDirection="row" paddingX={1}>
            {label}
            {usage}
            {compacted}
          </Box>
        )
      }

      const mode = view.mode
      const cold = mode === 'cold'
      const hue = HUE[mode]
      const mine = mineModel(view)
      const stored = await read($, fold)
      // Folding needs the card, and the card is a drawing: the terminal stays folded. Cold opens by
      // itself, unless another mod's band sits above: the two together outgrow the band's rows and
      // it scrolls, while the folded row still shows the price.
      const opensItself = cold && !above
      const open = Svg !== null && (stored && stored.mode === mode ? stored.open : opensItself)
      const toggle = () =>
        update($, fold, f => ({ mode, open: !(f && f.mode === mode ? f.open : opensItself) }))

      const badge = Svg
        ? [
            <Svg key="robo" source={roboSvg(mode)} alt={cold ? T.roboCold : T.roboWarm} width={ROBO_SIZE} height={ROBO_SIZE} isInteractive />,
            <Text key="gap"> </Text>,
            (() => {
              const c = chipSvg(mode, lang)
              return <Svg key="chip" source={c.source} alt={T[mode]} width={c.w} height={c.h} />
            })(),
          ]
        : [<Text key="chip" backgroundColor={hue} color={INK} bold>{` ${T[mode]} `}</Text>]

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
        : [<Text key="left" color={hue} bold>{` ${T.leftMin(Math.max(0, view.ttlMin - view.idleMin))}`}</Text>]

      const button = Svg ? (
        <Box key="fold" flexShrink={0} alignItems="flex-start">
          <Button key="cache-fold" label={open ? T.hide : T.show} onPress={toggle} />
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
            {compacted}
            {grow}
            {assessButton}
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
                <Text color={hue} bold>{cold ? T.idleFor(view.idle) : T.leftMin(Math.max(0, view.ttlMin - view.idleMin))}</Text>
                {mine ? (
                  <Box flexDirection="row">
                    <Text color={TEXT} bold>{usd(priceOf(view, mine))}</Text>
                    <Text color={MUTED}>{` ${T.next}`}</Text>
                  </Box>
                ) : null}
              </Box>
            )}
            {compacted}
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
            {compacted}
            {grow}
            {button}
          </Box>,
        ]
      }
      // Off the one-row layouts the row has no room for the assess button beside Show / Hide:
      // it takes a row of its own under them.
      if (!isWide && assessButton) {
        rows = [
          ...(Array.isArray(rows) ? rows : [rows]),
          <Box key="assess-row" flexDirection="row" paddingX={1}>{assessButton}</Box>,
        ]
      }

      let card = null
      if (open && Svg) {
        const o = list.map(w => ({ w, out: runOutOf(w.kind, w.percentUsed, w.resetsAt, now) })).find(x => x.out)
      const note = o?.out
        ? {
            color: o.out.left <= OUT_ALERT ? TONES.alert : TONES.fast,
            lines: [
              T.runsOut(dayPart(o.out.at, false, lang), clockOf(o.out.at)),
              T.pace(Math.round(o.out.gained), fmtIdle(o.out.over), dateOf(o.out.resetMs, lang), fmtIdle(o.out.resetMs - now)),
            ],
          }
        : undefined
        // Three tiles in a Box that wraps: the surface lays them out by its own pixels. The idle tile
        // is a frame, which left without a size takes a frame's default 300 by 150 px, so it names its
        // own and never shrinks. The other two are images: unsized, they keep their own size and
        // shrink in a slot narrower than they are. Their tops align, so the line each draws across its
        // top meets the next one's. A narrow row shows Robo and the chip beside the card already, so
        // the idle tile leaves them out.
        const tiles = cardTiles(view, cardText, isWide || kind === 'stacked', !isWide && kind === 'tight')
        card = (
          <Box key="card" flexDirection="column">
            <Box key="tiles" flexDirection="row" flexWrap="wrap" alignItems="flex-start">
              {tiles.map(tile => (
                <Box key={`tile-${tile.key}`} {...(tile.isInteractive ? { flexShrink: 0 } : {})}>
                  <Svg source={tile.source} alt={tile.alt} isInteractive={tile.isInteractive} {...(tile.isInteractive ? { width: tile.w, height: tile.h } : {})} />
                </Box>
              ))}
            </Box>
            {note ? (
              <Box key="note" flexDirection="column" paddingX={1}>
                {note.lines.map((line, i) => (
                  <Text key={`note-${i}`} color={i === 0 ? note.color : MUTED} bold={i === 0}>{line}</Text>
                ))}
              </Box>
            ) : null}
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
      <Box flexDirection="column" {...(stackGap ? { rowGap: stackGap } : {})}>
        {above}
        {own}
      </Box>
    )
  })
}
