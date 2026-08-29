import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { verifyEdgeCaller } from '@/lib/vm/edgeAuth'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

/** One batch of records, from one agent's Durable Object. */
const bodySchema = z.object({
  spaceId: z.string().min(1),
  agentName: z.string().min(1),
  runId: z.string().min(1).nullish(),
  records: z
    .array(
      z.object({
        at: z.iso.datetime(),
        method: z.string().min(1).max(16),
        host: z.string().max(255),
        path: z.string().max(2048),
        verdict: z.enum(['allow', 'deny', 'approval']),
        reason: z.string().max(1024).optional(),
        status: z.number().int().optional(),
        bytes: z.number().int().optional(),
      }),
    )
    .max(500),
})

/**
 * Where the edge's egress records land. The edge owns no rows; this is the only
 * way one gets written, and it is the detection surface a compromised agent
 * shows up on.
 *
 * The route carries no user session — /api/internal/ is public in proxy.ts only
 * in the sense that it authenticates itself, the same arrangement the agent tick
 * has. It refuses on an unknown space rather than creating anything: a record
 * for a space that does not exist is a bug or a forgery, and either way it is
 * not evidence.
 */
export async function POST(req: NextRequest) {
  const denied = verifyEdgeCaller(req)
  if (denied) return NextResponse.json({ error: denied }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'malformed batch' }, { status: 400 })
  const { spaceId, agentName, runId, records } = parsed.data
  if (records.length === 0) return NextResponse.json({ ok: true, written: 0 })

  const space = await prisma.space.findUnique({ where: { id: spaceId }, select: { id: true } })
  if (!space) return NextResponse.json({ error: 'unknown space' }, { status: 404 })

  await prisma.agentEgressLog.createMany({
    data: records.map((r) => ({
      spaceId,
      agentName,
      runId: runId ?? null,
      method: r.method,
      host: r.host,
      path: r.path,
      verdict: r.verdict,
      reason: r.reason ?? null,
      status: r.status ?? null,
      bytes: r.bytes ?? null,
      at: new Date(r.at),
    })),
  })

  // A refusal is the policy working, so it is a warn. Routing these to error
  // reporting is how a real fault gets lost in a pile of working denials.
  const refused = records.filter((r) => r.verdict !== 'allow')
  if (refused.length > 0) {
    logger.warn('vm.egress.refused', {
      spaceId,
      agentName,
      count: refused.length,
      hosts: [...new Set(refused.map((r) => r.host))].slice(0, 10),
    })
  }

  return NextResponse.json({ ok: true, written: records.length })
}
