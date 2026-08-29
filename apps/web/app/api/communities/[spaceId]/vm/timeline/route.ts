import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession as requireAdmin } from '@/lib/auth';
import prisma from '@/lib/prisma';

/** One page of a machine's timeline. Enough to read a session, not a month of them. */
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

/**
 * What a machine did, in order.
 *
 * This is the half of the window that outlives the socket: a run nobody watched
 * is still reviewable from here, which is the whole reason events are written
 * whether or not anyone was attached. Newest first, because the question is
 * almost always "what just happened".
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  const { spaceId } = await params;
  const session = await requireAdmin(spaceId);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const agent = searchParams.get('agent')?.trim();
  if (!agent) return NextResponse.json({ error: 'agent is required' }, { status: 400 });
  const limit = Math.min(Number(searchParams.get('limit')) || DEFAULT_LIMIT, MAX_LIMIT);

  const [events, egress, vm] = await Promise.all([
    prisma.agentVmEvent.findMany({
      where: { spaceId, agentName: agent },
      orderBy: { at: 'desc' },
      take: limit,
      select: { id: true, seq: true, kind: true, payload: true, at: true, runId: true },
    }),
    // Refusals belong on the timeline: they are what the boundary did, and a
    // machine that keeps hitting one is the shape a compromised agent has.
    prisma.agentEgressLog.findMany({
      where: { spaceId, agentName: agent, verdict: { not: 'allow' } },
      orderBy: { at: 'desc' },
      take: 50,
      select: { id: true, method: true, host: true, path: true, verdict: true, reason: true, at: true },
    }),
    prisma.agentVm.findUnique({
      where: { vm_identity: { spaceId, agentName: agent } },
      select: { state: true, instanceType: true, policyHash: true, lastActiveAt: true, workspaceKey: true },
    }),
  ]);

  return NextResponse.json({ machine: vm, events, refusals: egress });
}
