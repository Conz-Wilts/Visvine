/**
 * How a claimed run gets carried.
 *
 * `self` (production): the tick POSTs each run to its OWN service at
 * /api/internal/agents/run and awaits the response — one HTTP request per
 * run, so runs land on whichever Cloud Run instance the front end picks
 * (load spreads across all ten), nothing is fire-and-forget, and no
 * in-process state is assumed. Needs Cloud Run `--timeout` ≥ MAX_RUN_MS.
 * If runs must ever exceed 30 minutes, swap this file for Cloud Tasks and
 * nothing else changes.
 *
 * `inline` (dev / tests / AGENT_DISPATCH=inline): run in the tick request.
 */
import { mintRunToken } from './internalAuth'
import { MAX_RUN_MS, RUN_AWAIT_MS } from './limits'
import { executeRun, type ExecuteRunOutcome } from './runner'

export type DispatchMode = 'self' | 'inline'

export function dispatchMode(): DispatchMode {
  const v = process.env.AGENT_DISPATCH?.trim().toLowerCase()
  if (v === 'self' || v === 'inline') return v
  return process.env.NODE_ENV === 'production' ? 'self' : 'inline'
}

function internalBase(): string {
  return (process.env.AGENT_INTERNAL_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
}

export type DispatchResult =
  | { ok: true; outcome: ExecuteRunOutcome | null }
  | { ok: false; error: string }

/** Carry one run to completion, by whichever mode is configured. */
export async function dispatchRun(runId: string): Promise<DispatchResult> {
  if (dispatchMode() === 'inline') {
    try {
      return { ok: true, outcome: await executeRun(runId) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'run failed' }
    }
  }
  try {
    const token = await mintRunToken(runId)
    const res = await fetch(`${internalBase()}/api/internal/agents/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ runId }),
      cache: 'no-store',
      // A little past the run cap: the run route enforces the real deadline.
      signal: AbortSignal.timeout(MAX_RUN_MS + 60_000),
    })
    if (!res.ok) return { ok: false, error: `run endpoint answered ${res.status}` }
    const body = (await res.json().catch(() => null)) as { outcome?: ExecuteRunOutcome } | null
    return { ok: true, outcome: body?.outcome ?? null }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'dispatch failed' }
  }
}

/**
 * The outcome of a dispatch if it lands inside `ms`, else null — the run is
 * left running and the caller answers with the run id.
 *
 * A caller waiting on a run it triggered is a REQUEST: an MCP client, a
 * browser. Waiting out a run that may take MAX_RUN_MS holds that connection —
 * and, on a scale-to-zero runtime, the instance behind it — for the whole run,
 * which is a bill and a pinned instance in exchange for nothing the agent's
 * page does not already show. Giving up the wait costs nothing: `self`
 * dispatch is its own request to the run endpoint, so the run carries on
 * without this promise. The abandoned promise is caught, so letting go of it
 * is never an unhandled rejection.
 */
export async function dispatchWithin(work: Promise<DispatchResult>, ms: number = RUN_AWAIT_MS): Promise<DispatchResult | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
  try {
    return await Promise.race([work.catch((e): DispatchResult => ({ ok: false, error: e instanceof Error ? e.message : 'dispatch failed' })), expiry])
  } finally {
    clearTimeout(timer)
  }
}
