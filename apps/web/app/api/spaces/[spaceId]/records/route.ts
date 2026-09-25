import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireApiSession, parseBody } from '@/lib/api/route'
import { principalOf, resolveContext } from '@/lib/notes/resolve'
import { SHARED_OWNER_KEY } from '@/lib/notes/store'
import { queryRecords, recordTypes, setFields } from '@/lib/records/service'
import type { RecordsResponse, RecordTypesResponse } from '@/lib/records/api'

async function target(spaceId: string) {
  const session = await requireApiSession()
  if (session instanceof NextResponse) return session
  const resolved = await resolveContext(session, spaceId)
  if (resolved instanceof Response) return resolved
  return { principal: await principalOf(resolved), context: { spaceId: resolved.spaceId, ownerKey: SHARED_OWNER_KEY } }
}

/**
 * GET — the records of one of the space's own types (`?type=Deal`), those the
 * caller can read, for the Directory's table; without `type`, the space's own
 * types and how many records of each the caller can read.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const t = await target(spaceId)
  if (t instanceof Response) return t
  const type = req.nextUrl.searchParams.get('type')
  if (!type) {
    const body: RecordTypesResponse = { types: await recordTypes(t.principal, t.context) }
    return NextResponse.json(body)
  }
  const page = await queryRecords(t.principal, t.context, { type, limit: 200, cursor: req.nextUrl.searchParams.get('cursor') })
  if (!page.ok) return NextResponse.json({ error: page.error }, { status: page.status })
  const body: RecordsResponse = { type: page.type, rows: page.rows, nextCursor: page.nextCursor, total: page.total }
  return NextResponse.json(body)
}

const patchSchema = z.object({
  path: z.string().min(1),
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])),
})

/** PATCH — set a note record's fields: the one field door, as the caller (lib/records/service.ts#setFields). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const t = await target(spaceId)
  if (t instanceof Response) return t
  const body = await parseBody(req, patchSchema)
  if (body instanceof NextResponse) return body
  const result = await setFields(t.principal, t.context, { path: body.path }, body.fields)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ record: result.record, fields: result.fields })
}
