// GET /api/notes/tree?communityId=&scope=
// The folder/note tree for the sidebar (note-derived folders + explicit empty
// folders, sorted folders-first then alphabetically).

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain } from '@/lib/notes/api'
import { tree } from '@/lib/notes/store'

export async function GET(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  return NextResponse.json({ tree: await tree(brain) })
}
