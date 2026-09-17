import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody, requireSpaceAdmin } from '@/lib/api/route'
import { getCleanSchedule, saveCleanSchedule } from '@/lib/notes/cleanSchedule'

/**
 * The space's nightly pass, as the Console's General section reads and writes
 * it: clean on/off, embed on/off, and the time. Admins only: a clean writes
 * notes under an admin's own identity, so scheduling one is admin work by
 * definition.
 *
 *   GET — the schedule
 *   PUT — save it (the caller becomes the person it runs as)
 *
 * The pass itself is lib/notes/cleanSchedule.ts; nothing here decides what may
 * be cleaned.
 */

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  hour: z.number().int().min(0).max(23).optional(),
  minute: z.number().int().min(0).max(59).optional(),
  embedEnabled: z.boolean().optional(),
})

export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const session = await requireSpaceAdmin(spaceId)
  if (session instanceof NextResponse) return session

  return NextResponse.json({ schedule: await getCleanSchedule(spaceId) })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const session = await requireSpaceAdmin(spaceId)
  if (session instanceof NextResponse) return session
  const body = await parseBody(request, settingsSchema)
  if (body instanceof NextResponse) return body

  try {
    const schedule = await saveCleanSchedule(spaceId, { id: session.userId }, body)
    return NextResponse.json({ schedule })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not save the clean schedule' },
      { status: 400 },
    )
  }
}
