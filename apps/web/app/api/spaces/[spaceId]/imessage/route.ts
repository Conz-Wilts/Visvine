import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { handleApiError, parseBody, requireSpaceAdmin } from '@/lib/api/route'
import { describeImessage, setImessageEnabled, setLineName } from '@/lib/imessage/console'

type Params = { params: Promise<{ spaceId: string }> }

/** GET — the space's iMessage state, for Console → iMessage. Admins only. */
export async function GET(_req: NextRequest, { params }: Params) {
  const { spaceId } = await params
  const session = await requireSpaceAdmin(spaceId)
  if (session instanceof NextResponse) return session
  try {
    return NextResponse.json(await describeImessage(spaceId, session.email))
  } catch (error) {
    return handleApiError(error, 'api.imessage.describe.failed')
  }
}

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  /** The shown name; empty or null = the space's name. */
  name: z.string().max(60).nullable().optional(),
})

/** PATCH — the switch and the name. Each field is saved on its own. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { spaceId } = await params
  const session = await requireSpaceAdmin(spaceId)
  if (session instanceof NextResponse) return session
  const body = await parseBody(req, patchSchema)
  if (body instanceof NextResponse) return body
  try {
    if (body.enabled !== undefined) await setImessageEnabled(spaceId, body.enabled)
    if (body.name !== undefined) await setLineName(spaceId, body.name)
    return NextResponse.json(await describeImessage(spaceId, session.email))
  } catch (error) {
    return handleApiError(error, 'api.imessage.patch.failed')
  }
}
