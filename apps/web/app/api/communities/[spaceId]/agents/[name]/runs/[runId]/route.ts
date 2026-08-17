import { NextRequest, NextResponse } from 'next/server'
import { requireAgentsAccess } from '@/lib/agents/route'
import { getRun } from '@/lib/agents/runs'
import { serializeRun } from '@/lib/agents/service'
import { AGENT_NAME_RE } from '@/lib/agents/config'

/**
 * One run with its transcript. The UI polls this every few seconds while
 * `status === 'running'` — polling rather than a stream because it is
 * correct across many instances, and the executor flushes the trace often.
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
  return NextResponse.json({ run: { ...serializeRun(rest), events } })
}
