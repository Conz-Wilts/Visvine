// GET /api/notes/export/all?spaceId=&scope=
// Download the whole brain as a .zip of .md files, preserving the folder layout.

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain } from '@/lib/notes/api'
import { listRaw } from '@/lib/notes/store'
import { makeZip } from '@/lib/notes/zip'

export async function GET(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  const raw = await listRaw(brain)
  const zip = makeZip(raw.map((n) => ({ name: n.path, content: n.content })))
  const label = brain.scope === 'shared' ? 'space-brain' : 'my-notes'
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${label}.zip"`,
    },
  })
}
