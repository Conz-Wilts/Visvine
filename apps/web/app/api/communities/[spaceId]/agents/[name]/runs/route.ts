import { NextRequest, NextResponse } from 'next/server'
import { requireAgentsAccess } from '@/lib/agents/route'
import { listRuns } from '@/lib/agents/runs'
import { serializeRun } from '@/lib/agents/service'
import { AGENT_NAME_RE } from '@/lib/agents/config'

/** Run history for one agent, newest first (transcripts are on the per-run route). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ spaceId: string; name: string }> }) {
  const { spaceId, name: raw } = await params
  const name = decodeURIComponent(raw)
  if (!AGENT_NAME_RE.test(name)) return NextResponse.json({ error: 'Bad agent name' }, { status: 400 })
  const ctx = await requireAgentsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 25))
  const runs = await listRuns(spaceId, name, limit)
  return NextResponse.json({ runs: runs.map(serializeRun) })
}
