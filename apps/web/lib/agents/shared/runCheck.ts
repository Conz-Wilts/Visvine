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
const REACHING_TOOLS = new Set(['run_connector', 'run_command', 'open_page', 'sign_in', 'run_action', 'run_agent', 'fetch_url'])

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
