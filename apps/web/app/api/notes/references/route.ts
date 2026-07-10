// GET /api/notes/references?communityId=&scope=&path=
// Roam-style backlinks for a note: notes that link to it (with the surrounding
// passage) and notes that mention its title in plain text but haven't linked it.
// Computed over the visibility-filtered vault, so nothing in a private folder
// the caller can't read is surfaced as a reference.

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/brain'
import { visibleVault } from '@/lib/notes/brainService'
import { computeReferences } from '@/lib/notes/shared/references'

export async function GET(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  const path = new URL(req.url).searchParams.get('path')
  if (!path) return fail('path is required')
  const p = await principalOf(brain)
  const { raws, metas } = await visibleVault(p, brain)
  const references = computeReferences(raws, path, metas)
  return NextResponse.json({ references })
}
