// GET /api/notes/references?communityId=&scope=&path=
// Roam-style backlinks for a note: notes that link to it (with the surrounding
// passage) and notes that mention its title in plain text but haven't linked it.

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail } from '@/lib/notes/api'
import { listRaw } from '@/lib/notes/store'
import { buildNoteIndex } from '@/lib/notes/shared/graph'
import { computeReferences } from '@/lib/notes/shared/references'

export async function GET(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  const path = new URL(req.url).searchParams.get('path')
  if (!path) return fail('path is required')
  const raw = await listRaw(brain)
  const references = computeReferences(raw, path, buildNoteIndex(raw))
  return NextResponse.json({ references })
}
