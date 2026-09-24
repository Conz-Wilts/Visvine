/**
 * What to change about an agent, in words for its page — pure.
 *
 * Two kinds of advice, both read from evidence the space already has:
 *
 *   - a failed run's likely CAUSE (the judge's reading, lib/agents/diagnose.ts)
 *     as one line saying what to do about it;
 *   - which of the space's models suits a brief: first from how each model has
 *     actually done on this space's runs (models/shared/trackRecords.ts
 *     #trackRecords), and with no record yet from how much the brief asks of a
 *     model (the judge's JOB_SHAPE reading) against the model's weight class.
 *
 * Advice only: nothing is switched, retried or refused on it. The person (or
 * the AI configuring the agent) acts on it through the ordinary record write.
 */
import type { ModelTrackRecord } from '@/lib/models/shared/trackRecords'

export type RunCause = 'model' | 'access' | 'source' | 'brief' | 'other'
export type JobShape = 'simple' | 'multi_step' | 'heavy'

export function causeAdvice(cause: RunCause): string | null {
  switch (cause) {
    case 'model':
      return 'Likely cause: the model lost track of a job with several steps. Try a stronger model, or set one as its fallback.'
    case 'access':
      return "Likely cause: something it needed was out of reach — check its connectors and who it runs as."
    case 'source':
      return 'Likely cause: a page or service it reads from failed or came back empty. It may pass on the next run.'
    case 'brief':
      return 'Likely cause: the instructions are unclear. Say exactly what to read, what to produce and where to write it.'
    default:
      return null
  }
}

export interface ModelAdvice {
  /** `<provider>/<model id>` to use. */
  model: string
  /** As the agent's model, or as its fallback — tried only when a run falls short, so it costs only then. */
  as: 'model' | 'fallback'
  /** One line of evidence, for the page. */
  why: string
}

/** Runs a model needs on record before its rate means anything. */
const MIN_RUNS = 3
const GOOD_RATE = 0.9
/** A model that usually finishes is kept, and the better one becomes its fallback instead of its replacement. */
const KEEP_RATE = 0.7
const LIGHT_MODEL = /(^|[-/])(lite|mini|nano|haiku|small|flash-lite)([-.]|$)/i

/** Whether a model is a light one — the only case the brief's shape can change the advice. */
export const isLightModel = (ref: string) => LIGHT_MODEL.test(ref.slice(ref.indexOf('/') + 1))

const rate = (t: ModelTrackRecord) => t.finished / (t.finished + t.short)
const runs = (t: ModelTrackRecord) => t.finished + t.short
const idOf = (ref: string) => ref.slice(ref.indexOf('/') + 1)

export function recommendModel(input: {
  /** What the agent runs on now, `<provider>/<id>`; null when it has no model. */
  current: string | null
  fallback: string | null
  /** The space's runnable models, `<provider>/<id>`. */
  runnable: readonly string[]
  /** How each model has done on this space's recent runs. */
  tracks: readonly ModelTrackRecord[]
  shape: JobShape | null
}): ModelAdvice | null {
  const { current } = input
  if (!current) return null
  const byModel = new Map(input.tracks.map((t) => [t.model, t]))
  const mine = byModel.get(current)
  const others = input.runnable.filter((m) => m !== current)

  // Evidence first: a model that has finished this space's jobs where this one has not.
  if (mine && runs(mine) >= MIN_RUNS && rate(mine) < GOOD_RATE) {
    const better = others
      .map((m) => byModel.get(m))
      .filter((t): t is ModelTrackRecord => !!t && runs(t) >= MIN_RUNS && rate(t) >= GOOD_RATE && rate(t) - rate(mine) >= 0.2)
      .sort((a, b) => rate(b) - rate(a) || runs(b) - runs(a))[0]
    if (better) {
      const as = rate(mine) >= KEEP_RATE ? 'fallback' : 'model'
      if (as === 'fallback' && input.fallback === better.model) return null
      return {
        model: better.model,
        as,
        why: `${idOf(better.model)} finished ${better.finished} of ${runs(better)} runs here; ${idOf(current)} ${mine.finished} of ${runs(mine)}.`,
      }
    }
  }

  // No record yet: a light model on a brief that asks a lot of one.
  if ((!mine || runs(mine) < MIN_RUNS) && input.shape === 'heavy' && LIGHT_MODEL.test(idOf(current))) {
    const heavier = others.find((m) => !LIGHT_MODEL.test(idOf(m)))
    if (heavier && input.fallback !== heavier) {
      return { model: heavier, as: 'fallback', why: `This brief asks a lot of a model, and ${idOf(current)} is a light one.` }
    }
  }
  return null
}
