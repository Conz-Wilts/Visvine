// What a finished run SAID it did, held against what it DID. Pure.
//
// A model can end a run with "I've updated the note and emailed the summary"
// having called neither tool. `narratedToolCall` catches a call written out as
// text; it cannot catch a plain sentence. The judge reads only the prose —
// does the message claim a write, claim to have acted outside — and the claims
// are checked HERE, in code, against the run's own trace. The trace is the
// truth. A claim with nothing behind it makes the run `unverified`: its summary
// is kept out of the agent's memory, where it would be read tomorrow as fact.

export interface RunClaims {
  /** 0..1 that the final message claims a note or record was written. Undefined = no verdict. */
  wrote?: number
  /** 0..1 that it claims to have sent something or acted in an outside service. */
  reached?: number
}

export interface RunTrace {
  /** Note paths the run wrote (or would have, under a dry run). */
  writes: number
  /** Names of the tools the run actually called. */
  tools: readonly string[]
}

/** Tools through which a run can write a note or record. */
const WRITING_TOOLS = new Set(['write_context', 'append_context', 'remember', 'create_node', 'link_nodes', 'run_action', 'run_agent'])
/** Tools through which a run can act outside the space. */
const REACHING_TOOLS = new Set(['run_connector', 'run_command', 'open_page', 'page_act', 'browse_task', 'sign_in', 'run_action', 'run_agent', 'fetch_url'])

export type RunOutcome = 'done' | 'partial' | 'blocked' | 'nothing'

/** The claims the trace does not back, in words for the run's page. Empty when the run did what it said. */
export function unbackedClaims(claims: RunClaims, trace: RunTrace, at: number): string[] {
  const out: string[] = []
  const called = (set: Set<string>) => trace.tools.some((t) => set.has(t))
  if ((claims.wrote ?? 0) >= at && trace.writes === 0 && !called(WRITING_TOOLS)) {
    out.push('It says it wrote or updated something, but the run made no write.')
  }
  if ((claims.reached ?? 0) >= at && !called(REACHING_TOOLS)) {
    out.push('It says it sent something or acted in an outside service, but the run called nothing that could.')
  }
  return out
}

export interface RunVerdict {
  unbacked: string[]
  /** How the run ended, when the judge is confident of it — what can fail a run. */
  outcome: RunOutcome | null
  /** The likeliest ending, confident or not — enough to hand the turn back. */
  lean?: RunOutcome | null
}

/**
 * Whether a run that ended on `verdict` finished the job. A claim the trace
 * does not back, a run that says it is only partly done or could not do what
 * it was asked — none of those is a success, however the loop ended. No
 * verdict (no judge) is not evidence of anything, so it passes.
 */
export function incompleteBecause(
  verdict: RunVerdict | null,
  run: { writes: number; promisesMore?: boolean } = { writes: 1 },
): string | null {
  // A run that wrote nothing is held to its likeliest ending, and to its own
  // last words: "now I will write it" with nothing written is not done.
  if (run.writes === 0 && run.promisesMore) return 'It ended announcing work it never did, having written nothing.'
  if (!verdict) return null
  if (verdict.unbacked.length) return verdict.unbacked.join(' ')
  const ending = verdict.outcome ?? (run.writes === 0 ? (verdict.lean ?? null) : null)
  if (ending === 'partial') return 'It ended saying only part of the job was done.'
  if (ending === 'blocked') return 'It ended saying it could not do what it was asked.'
  // Nothing written is a finished run only when its last message plainly says
  // so — the job done, or nothing to do. A judge that cannot tell is no pass.
  if (run.writes === 0 && verdict.outcome !== 'done' && verdict.outcome !== 'nothing') {
    return 'It wrote nothing, and its last message does not say the job is done.'
  }
  return null
}

/**
 * What a run that is about to end short is told, so it can finish instead:
 * the missing step in words, then the instruction to do it with the tools.
 * Null when the verdict is a finished run. Pure; lib/agents/runner.ts hands
 * it to the loop's `review`.
 */
export function nudgeFor(verdict: RunVerdict | null, trace: RunTrace): string | null {
  if (!verdict) return null
  const lines: string[] = []
  const wroteNothing = trace.writes === 0
  for (const line of verdict.unbacked) {
    if (line.startsWith('It says it wrote')) {
      lines.push('You said you wrote or updated a note, but no note was written — nothing was saved. Call write_context (or append_context) now with the content.')
    } else {
      lines.push('You said you sent something or acted in an outside service, but no tool that could was called. Make that call now, or say plainly that you did not.')
    }
  }
  const ending = verdict.outcome ?? verdict.lean ?? null
  if (!lines.length && ending === 'partial') {
    lines.push('Your reply says the job is only partly done. Carry on with the remaining steps now, calling the tools yourself.')
  }
  if (!lines.length && wroteNothing && ending !== 'done' && ending !== 'nothing' && ending !== 'blocked') {
    lines.push('You have written nothing yet, and your reply does not say the job is done. Finish it now with the tools, or say plainly that there was nothing to do.')
  }
  if (!lines.length && ending === 'blocked' && wroteNothing) {
    lines.push('Your reply says you are blocked. If a tool you have can get past it, use it now; if not, reply with exactly what is missing and who can fix it.')
  }
  if (!lines.length) return null
  return `${lines.join(' ')} Do not describe the steps — make the calls, then reply with a one-line summary of what you did.`
}

/**
 * Why a run whose loop ended `finished` or `max_turns` did not do the job, or
 * null when it did. The trace and the run's own last words first — a run that
 * used every turn, or went silent, having written nothing — then the judge's
 * verdict (incompleteBecause). Pure; the runner fails the run on a reason.
 */
export function shortOf(run: {
  reason: 'finished' | 'max_turns'
  finalText: string | null
  writes: number
  maxTurns: number
  verdict: RunVerdict | null
  promisesMore: boolean
}): string | null {
  if (run.reason === 'max_turns' && run.writes === 0) return `It used all ${run.maxTurns} turns without writing anything.`
  if (!run.finalText && run.writes === 0) return 'It stopped without a word, having written nothing.'
  return incompleteBecause(run.verdict, { writes: run.writes, promisesMore: run.promisesMore })
}
