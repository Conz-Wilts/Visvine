// POST /api/notes/folders/order  { spaceId, folder, order }  → { ok }
//
// Store the order a folder's rows were dragged into (`folder: ''` = the top).
// Nothing moves: the list is recorded as `order:` on the folder's own index
// note and the tree sorts by it (lib/notes/shared/folderOrder.ts,
// context.ts#sortTree).
//
// The write is an ordinary gated note write (`writeGated`), so edit access on
// the folder's index note is the whole permission and the change lands as a
// revision like any other edit. A folder inside a room is ordered IN the room:
// the write hops across under the caller's standing there
// (lib/notes/federation.ts#writeTarget).

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail, failFromError } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/resolve'
import { writeGated } from '@/lib/notes/contextService'
import { writeTarget } from '@/lib/notes/federation'
import { readNoteOrNull } from '@/lib/notes/store'
import { buildIndexStub, folderOfIndexPath, indexPathOf } from '@/lib/notes/shared/indexNote'
import { withOrder } from '@/lib/notes/shared/folderOrder'

const MAX_ENTRIES = 2000
const MAX_KEY = 400

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  const folder = typeof body.folder === 'string' ? body.folder.replace(/^\/+|\/+$/g, '') : null
  if (folder === null || !Array.isArray(body.order)) return fail('folder and order are required')
  if (body.order.length > MAX_ENTRIES) return fail('That is more rows than a folder orders.')
  const order: string[] = []
  for (const key of body.order) {
    if (typeof key !== 'string' || !key.trim() || key.length > MAX_KEY || key.includes('..')) {
      return fail('order is a list of row names')
    }
    order.push(key.trim())
  }

  const p = await principalOf(context)
  const hop = await writeTarget(p, context, indexPathOf(folder))
  if ('denial' in hop) return fail(hop.denial, 403)
  try {
    // A folder nobody has opened yet has no home note; ordering it writes one,
    // the same stub the store would have made.
    const content = (await readNoteOrNull(hop.context, hop.path)) ?? buildIndexStub(folderOfIndexPath(hop.path), [])
    const result = await writeGated(hop.principal, hop.context, hop.path, withOrder(content, order))
    if (result.status === 'denied') return fail(result.reason, 403)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return failFromError(err)
  }
}
