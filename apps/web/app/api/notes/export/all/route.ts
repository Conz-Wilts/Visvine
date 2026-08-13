// GET /api/notes/export/all?spaceId=&scope=
// Download the whole context as a .zip of .md files, preserving the folder layout.

import { NextRequest, NextResponse } from 'next/server'
import { requireContext } from '@/lib/notes/api'
import { listRaw } from '@/lib/notes/store'
import { makeZip } from '@/lib/notes/zip'

export async function GET(req: NextRequest) {
  const context = await requireContext(req)
  if (context instanceof Response) return context
  const raw = await listRaw(context)
  const zip = makeZip(raw.map((n) => ({ name: n.path, content: n.content })))
  const label = context.scope === 'shared' ? 'space-context' : 'my-notes'
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${label}.zip"`,
    },
  })
}
