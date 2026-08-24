/**
 * GET /api/actions — the catalogue, and the plan for a request.
 *
 * The same document the `visvine` MCP tool returns when it is called with no
 * action, served over plain HTTP so that the surface is inspectable without an
 * MCP client: `curl` it with a session cookie and you get exactly what an agent
 * gets. Markdown by default because that is what the notes hold; `?format=json`
 * for the machine-readable catalogue.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireApiSession, handleApiError } from '@/lib/api/route'
import { callerFromSession } from '@/lib/actions/session'
import { buildGuide } from '@/lib/actions/guide'
import { allActions } from '@/lib/actions/registry'
import { paramsOf } from '@/lib/actions/shared/contract'

export async function GET(request: NextRequest) {
  try {
    const session = await requireApiSession()
    if (session instanceof NextResponse) return session
    const caller = callerFromSession(session)
    const { searchParams } = new URL(request.url)

    if (searchParams.get('format') === 'json') {
      return NextResponse.json({
        actions: allActions().map((a) => ({
          name: a.name,
          summary: a.summary,
          scope: a.scope,
          endpoint: `POST /api/actions/${a.name}`,
          params: paramsOf(a.input),
        })),
      })
    }

    const guide = await buildGuide({
      caller,
      request: searchParams.get('request') ?? undefined,
      spaceId: searchParams.get('space_id') ?? undefined,
    })
    return new NextResponse(guide, {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    })
  } catch (error) {
    return handleApiError(error, 'actions.catalogue.failed')
  }
}
