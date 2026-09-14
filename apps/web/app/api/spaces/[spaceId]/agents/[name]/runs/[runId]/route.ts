import { NextRequest, NextResponse } from 'next/server'
import { requireAgentsAccess } from '@/lib/agents/route'
import { getRun } from '@/lib/agents/runs'
import { canTriggerRun, serializeRun } from '@/lib/agents/service'
import { AGENT_NAME_RE } from '@/lib/agents/config'
import { machineTraceForRun } from '@/lib/vm/timeline'

/**
 * One run with its transcript. The UI polls this every few seconds while
 * `status === 'running'` — polling rather than a stream because it is
 * correct across many instances, and the executor flushes the trace often.
 *
 * The transcript is author-or-admin only. A run executes as the brief's AUTHOR
 * (an admin's runs bypass grants), so its `events` carry whatever the agent
 * read — notes the viewing member may hold no grant on. Other members still
 * see the run's metadata (status, cost, summary, error) — the same fields the
 * agent's page and history list already show — but not the
 * trace; `transcriptHidden` tells the UI why the events are empty.
 *
 * `machine` is what the agent's machine did during this run — its commands,
 * output and the boundary's refusals — for the window to nest under the steps
 * that asked (lib/agents/shared/trace.ts#attachMachine). Admin-only, like
 * every other view of a machine: null for everyone else.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string; name: string; runId: string }> }) {
  const { spaceId, name: raw, runId } = await params
  const name = decodeURIComponent(raw)
  if (!AGENT_NAME_RE.test(name)) return NextResponse.json({ error: 'Bad agent name' }, { status: 400 })
  const ctx = await requireAgentsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  const run = await getRun(spaceId, name, runId)
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  const { events, ...rest } = run
  const canSeeTranscript = await canTriggerRun(ctx.principal, spaceId, name)
  const machine = ctx.resolved.isAdmin ? await machineTraceForRun(spaceId, name, runId) : null
  return NextResponse.json({
    run: canSeeTranscript
      ? { ...serializeRun(rest), events, transcriptHidden: false, machine }
      : { ...serializeRun(rest), events: [], transcriptHidden: true, machine: null },
  })
}
