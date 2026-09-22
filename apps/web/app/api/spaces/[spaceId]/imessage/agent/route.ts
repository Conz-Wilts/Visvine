import { NextRequest, NextResponse } from 'next/server'
import { handleApiError, requireSpaceAdmin } from '@/lib/api/route'
import { principalOf, resolveContext } from '@/lib/notes/resolve'
import { createPhoneAgent } from '@/lib/imessage/console'
import { agentPageHref } from '@/lib/agents/config'
import { PHONE_AGENT } from '@/lib/imessage/shared/brief'

/**
 * POST — write the starter `phone` brief (agents/phone/index.md), as the
 * admin pressing the button. An ordinary agent from here on: edited on its
 * note, watched on its page.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const session = await requireSpaceAdmin(spaceId)
  if (session instanceof NextResponse) return session
  try {
    const resolved = await resolveContext(session, spaceId)
    if (resolved instanceof Response) return resolved
    const result = await createPhoneAgent(await principalOf(resolved), spaceId)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ path: result.path, page: agentPageHref(PHONE_AGENT, null, spaceId) })
  } catch (error) {
    return handleApiError(error, 'api.imessage.agent.failed')
  }
}
