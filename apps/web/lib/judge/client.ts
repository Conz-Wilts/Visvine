// The judge: fast typed decisions from TypeSafe's Jev through OpenRouter's
// Decisions endpoint, on the deployment's one key (OPENROUTER_API_KEY).
//
// Every call is BOUNDED and FAILS OPEN. A judge removes noise and saves work;
// nothing depends on it answering. Unconfigured, switched off (JUDGE=off),
// rate-limited, timed out or refused upstream, `decide` returns null and the
// caller behaves as if no judge existed. That is the app working as designed,
// so failures are `warn`, never `error`.
//
// A judge's answer never widens what happens: it may drop a result, skip a
// run, veto a fix or attach a suggestion. Authority stays in code.
//
// The allowance is a row (lib/rateLimit), because ten instances share the
// provider's one requests-per-minute limit. It is spent per BATCH, not per
// request — a search judges a dozen candidates at once and one bucket write is
// what that should cost — so a batch is capped at MAX_BATCH requests.

import { logger } from '@/lib/logger'
import { takeToken, type RateLimitConfig } from '@/lib/rateLimit'
import { coerceAnswers, type JudgeAnswers, type JudgeQuestions, type JudgeState } from './shared/types'

const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions'
const DEFAULT_MODEL = 'typesafe/jev-1.13'
/** State past this is cut: the model reads 32k tokens and degrades with noise well before. */
const MAX_STATE_CHARS = 24_000
/** Requests one batch may hold — with BATCH_LIMIT, under the provider's 1,200 a minute. */
export const MAX_BATCH = 12
const BATCH_LIMIT: RateLimitConfig = { capacity: 20, refillPerSec: 1.5 }
const DEFAULT_DEADLINE_MS = 1_500

export function judgeConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY) && process.env.JUDGE?.trim().toLowerCase() !== 'off'
}

export interface JudgeRequest {
  state: JudgeState
  questions: JudgeQuestions
}

export interface JudgeOptions {
  /** How long the caller will wait. The search path is short; a nightly pass can afford more. */
  deadlineMs?: number
  /** A nightly pass waits for allowance instead of going without. */
  patient?: boolean
}

function clipState(state: JudgeState): JudgeState {
  if (typeof state === 'string') return state.slice(0, MAX_STATE_CHARS)
  const text = JSON.stringify(state)
  return text.length > MAX_STATE_CHARS ? text.slice(0, MAX_STATE_CHARS) : state
}

async function one(req: JudgeRequest, signal: AbortSignal): Promise<JudgeAnswers | null> {
  const res = await fetch(DECISIONS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    body: JSON.stringify({
      model: process.env.JUDGE_MODEL ?? DEFAULT_MODEL,
      state: clipState(req.state),
      questions: req.questions,
    }),
    signal,
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`judge answered ${res.status}`)
  const data = (await res.json()) as { answers?: unknown }
  return coerceAnswers(data.answers, req.questions)
}

/**
 * Ask several independent requests at once. The result is index-aligned with
 * the input; an entry is null where that request got no verdict. More than
 * MAX_BATCH requests are asked in consecutive batches.
 */
export async function decideMany(requests: JudgeRequest[], opts: JudgeOptions = {}): Promise<(JudgeAnswers | null)[]> {
  const out: (JudgeAnswers | null)[] = requests.map(() => null)
  if (!requests.length || !judgeConfigured()) return out
  const deadline = Date.now() + (opts.deadlineMs ?? DEFAULT_DEADLINE_MS)
  for (let at = 0; at < requests.length; at += MAX_BATCH) {
    let allowance = await takeToken('judge:batch', BATCH_LIMIT)
    while (!allowance.ok && opts.patient && Date.now() + allowance.retryAfterMs < deadline) {
      await new Promise((r) => setTimeout(r, allowance.retryAfterMs))
      allowance = await takeToken('judge:batch', BATCH_LIMIT)
    }
    const left = deadline - Date.now()
    if (!allowance.ok || left <= 0) {
      logger.warn('judge.skipped', { reason: allowance.ok ? 'deadline' : 'rate', unanswered: requests.length - at })
      return out
    }
    const signal = AbortSignal.timeout(left)
    const batch = requests.slice(at, at + MAX_BATCH)
    const settled = await Promise.allSettled(batch.map((r) => one(r, signal)))
    let failed = 0
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled') out[at + i] = s.value
      else failed += 1
    })
    if (failed) {
      const first = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected')
      logger.warn('judge.failed', { failed, of: batch.length, err: first?.reason })
    }
  }
  return out
}

/** One request. Null means no verdict — behave as if there were no judge. */
export async function decide(state: JudgeState, questions: JudgeQuestions, opts: JudgeOptions = {}): Promise<JudgeAnswers | null> {
  return (await decideMany([{ state, questions }], opts))[0]
}
