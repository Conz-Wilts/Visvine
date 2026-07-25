// GET  /api/notes/references?communityId=&scope=&path=
// Roam-style backlinks for a note: notes that link to it (with the surrounding
// passage) and notes that mention its title in plain text but haven't linked it.
// Computed over the visibility-filtered vault, so nothing in a private folder
// the caller can't read is surfaced as a reference.
//
// POST /api/notes/references
//   { communityId, scope, path, fromPath, offset? } → { ok, references }
// Turn ONE unlinked mention into a real link: rewrites the mention at `offset`
// in `fromPath` into a markdown link to `path`. Read → mutate → write happens
// server-side so the write is gated once (against the SOURCE note) and can't
// race a concurrent edit through a client round-trip. Returns the target note's
// refreshed references so the caller can swap state without a second request.

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail, failFromError } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/brain'
import { visibleVault, readVisible, writeDenialFull } from '@/lib/notes/brainService'
import { computeReferences, linkMentionAt, linkFirstMention } from '@/lib/notes/shared/references'
import { splitFrontmatter } from '@/lib/notes/shared/markdown'
import { writeNote } from '@/lib/notes/store'

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

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  const path = typeof body.path === 'string' ? body.path : null
  const fromPath = typeof body.fromPath === 'string' ? body.fromPath : null
  if (!path || !fromPath) return fail('path and fromPath are required')
  if (path === fromPath) return fail('A note cannot link a mention of itself')
  const offset = typeof body.offset === 'number' ? body.offset : null

  const p = await principalOf(brain)
  const { metas } = await visibleVault(p, brain)
  // Resolve the link text from the vault, never from the client: the title the
  // mention was found by is the target note's own title (falling back to the
  // filename, as computeReferences does).
  const target = metas.find((m) => m.path === path)
  const title = (target?.title ?? path.replace(/\.md$/i, '').split('/').pop() ?? '').trim()
  if (!title) return fail(`Note not found: ${path}`, 404)

  const content = await readVisible(p, brain, fromPath)
  if (content === null) return fail(`Note not found: ${fromPath}`, 404)
  // The write lands on the SOURCE note, so its folder gate and replica block apply.
  const denial = await writeDenialFull(p, brain, fromPath)
  if (denial) return fail(denial, 403)

  const { frontmatter, body: noteBody } = splitFrontmatter(content)
  // Prefer the exact mention the user clicked; fall back to the first eligible
  // one if the note shifted under us.
  const linked =
    (offset !== null ? linkMentionAt(noteBody, title, path, offset) : null) ??
    linkFirstMention(noteBody, title, path)
  if (linked === null) {
    return fail('That mention is no longer there — it may already be linked', 409)
  }

  try {
    await writeNote(
      brain,
      fromPath,
      frontmatter != null ? `---\n${frontmatter}\n---\n\n${linked}` : linked,
      brain.actor,
      'edit',
    )
  } catch (err) {
    return failFromError(err)
  }

  const fresh = await visibleVault(p, brain)
  return NextResponse.json({
    ok: true,
    references: computeReferences(fresh.raws, path, fresh.metas),
  })
}
