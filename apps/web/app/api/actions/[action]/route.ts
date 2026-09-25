/**
 * One action, as an endpoint.
 *
 *   GET  /api/actions/<name>   its manual — the same document the MCP tool
 *                              returns for `{ action }` with no `input`.
 *   POST /api/actions/<name>   run it. The JSON body IS the action's input.
 *
 * This is the other door on `runAction`; the `visvine` MCP tool is the first.
 * Neither re-implements anything the other does — same registry lookup, same
 * scope gate, same Zod validation, same body — so a behaviour proved through
 * one holds through the other.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireApiSession, handleApiError } from '@/lib/api/route'
import { callerFromSession } from '@/lib/actions/session'
import { getSessionInfo } from '@/lib/session'
import { toolClientOf } from '@/lib/tools/clientClass'
import { buildActionDoc } from '@/lib/actions/guide'
import { runAction } from '@/lib/actions/run'

type RouteContext = { params: Promise<{ action: string }> }

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireApiSession()
    if (session instanceof NextResponse) return session
    const { action } = await context.params
    const doc = await buildActionDoc(action)
    if (!doc) {
      return NextResponse.json(
        { error: `No action named '${action}' — GET /api/actions lists them` },
        { status: 404 },
      )
    }
    return new NextResponse(doc, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
  } catch (error) {
    return handleApiError(error, 'actions.doc.failed')
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireApiSession()
    if (session instanceof NextResponse) return session
    const { action } = await context.params

    // An empty body is a valid call: several actions take no arguments.
    let input: unknown = {}
    const raw = await request.text()
    if (raw.trim().length > 0) {
      try {
        input = JSON.parse(raw)
      } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
      }
    }

    const info = await getSessionInfo()
    const { result } = await runAction(callerFromSession(session, info ? toolClientOf(info) : 'app'), action, input)
    return NextResponse.json({ result })
  } catch (error) {
    // ActionError carries a status, so handleApiError surfaces it as one; a
    // genuine fault stays a logged 500 and reaches Error Reporting.
    return handleApiError(error, 'actions.run.failed')
  }
}
