/**
 * Reading a machine's record back: what it did during one run.
 *
 * The rows are written by the edge's batches (`/api/internal/vm/events`,
 * `/api/internal/vm/egress`) with the run id riding the payload; this is the
 * read side the window joins onto the run's own trace
 * (lib/agents/shared/trace.ts#attachMachine). Admin-only at every caller — a
 * terminal shows what the agent is doing with the space's reach.
 */
import prisma from '@/lib/prisma'

/** Enough of a run's terminal to read; a run that needs more is a run that should write a file. */
const RUN_EVENTS_CAP = 400

export interface MachineTrace {
  events: { seq: number; kind: string; at: string; payload: Record<string, unknown> }[]
  refusals: { id: string; method: string; host: string; path: string; verdict: string; reason: string | null; at: string }[]
}

/** The machine's timeline and the boundary's refusals for one run, oldest first. */
export async function machineTraceForRun(spaceId: string, agentName: string, runId: string): Promise<MachineTrace> {
  const [events, refusals] = await Promise.all([
    prisma.agentVmEvent.findMany({
      where: { spaceId, agentName, runId },
      orderBy: { seq: 'asc' },
      take: RUN_EVENTS_CAP,
      select: { seq: true, kind: true, payload: true, at: true },
    }),
    prisma.agentEgressLog.findMany({
      where: { spaceId, agentName, runId, verdict: { not: 'allow' } },
      orderBy: { at: 'asc' },
      take: 50,
      select: { id: true, method: true, host: true, path: true, verdict: true, reason: true, at: true },
    }),
  ])
  return {
    events: events.map((e) => ({ seq: e.seq, kind: e.kind, at: e.at.toISOString(), payload: (e.payload ?? {}) as Record<string, unknown> })),
    refusals: refusals.map((r) => ({ ...r, at: r.at.toISOString() })),
  }
}
