import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { verifyEdgeCaller } from '@/lib/vm/edgeAuth'

export const dynamic = 'force-dynamic'

/** One batch of timeline events, from one machine. */
const bodySchema = z.object({
  spaceId: z.string().min(1),
  agentName: z.string().min(1),
  events: z
    .array(
      z.object({
        seq: z.number().int().min(0),
        kind: z.enum(['boot', 'wake', 'exec', 'output', 'exit', 'sleep', 'error', 'egress_denied']),
        at: z.iso.datetime(),
        payload: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .max(500),
})

/**
 * The window's durable half. The screen is ephemeral and the socket only exists
 * while someone is watching; this is what makes a run nobody watched reviewable
 * afterwards, so it is written whether or not anyone was attached.
 *
 * `runId` is not taken from the batch: the edge knows what a command was, not
 * which run asked for it, and a caller-supplied run id is a caller-supplied
 * join. It rides the payload instead, where it is data rather than a key.
 */
export async function POST(req: NextRequest) {
  const denied = verifyEdgeCaller(req)
  if (denied) return NextResponse.json({ error: denied }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'malformed batch' }, { status: 400 })
  const { spaceId, agentName, events } = parsed.data
  if (events.length === 0) return NextResponse.json({ ok: true, written: 0 })

  const space = await prisma.space.findUnique({ where: { id: spaceId }, select: { id: true } })
  if (!space) return NextResponse.json({ error: 'unknown space' }, { status: 404 })

  await prisma.agentVmEvent.createMany({
    data: events.map((e) => ({
      spaceId,
      agentName,
      runId: typeof e.payload.runId === 'string' ? e.payload.runId : null,
      seq: e.seq,
      kind: e.kind,
      payload: e.payload as object,
      at: new Date(e.at),
    })),
  })

  return NextResponse.json({ ok: true, written: events.length })
}
