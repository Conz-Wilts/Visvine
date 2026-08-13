// GET  /api/notes/references?spaceId=&scope=&path=
// Roam-style backlinks for a note: notes that link to it (with the surrounding
// passage) and notes that mention its title in plain text but haven't linked it.
// Computed over the FULL corpus, then run through the access lens
// (contextService.referencesFor): a reference whose source note the caller can't
// read comes back as an opaque locked stub — existence only, never the source's
// path, title, or text. The stub's token is what "Get access" trades in
// (POST /api/notes/access-requests with referenceToken).
//
// POST /api/notes/references
//   { spaceId, scope, path, fromPath, offset? } → { ok, references }
// Turn ONE unlinked mention into a real link: rewrites the mention at `offset`
// in `fromPath` into a markdown link to `path`. Read → mutate → write happens
// server-side so the write is gated once (against the SOURCE note) and can't
// race a concurrent edit through a client round-trip. Returns the target note's
// refreshed references so the caller can swap state without a second request.

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail, failFromError } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/resolve'
import { visibleVault, readVisible, writeDenialFull, referencesFor } from '@/lib/notes/contextService'
import { pendingRequestPaths } from '@/lib/notes/accessRequests'
import { linkMentionAt, linkFirstMention } from '@/lib/notes/shared/references'
import { splitFrontmatter } from '@/lib/notes/shared/markdown'
import { writeNote } from '@/lib/notes/store'

export async function GET(req: NextRequest) {
  const context = await requireContext(req)
  if (context instanceof Response) return context
  const path = new URL(req.url).searchParams.get('path')
  if (!path) return fail('path is required')
  const p = await principalOf(context)
  // Personal spaces have no gates and no requests — skip the pending lookup.
  const pending = context.isPersonalSpace ? new Set<string>() : await pendingRequestPaths(p)
  const references = await referencesFor(p, context, path, pending)
  return NextResponse.json({ references })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  const path = typeof body.path === 'string' ? body.path : null
  const fromPath = typeof body.fromPath === 'string' ? body.fromPath : null
  if (!path || !fromPath) return fail('path and fromPath are required')
  if (path === fromPath) return fail('A note cannot link a mention of itself')
  const offset = typeof body.offset === 'number' ? body.offset : null

  const p = await principalOf(context)
  const { metas } = await visibleVault(p, context)
  // Resolve the link text from the vault, never from the client: the title the
  // mention was found by is the target note's own title (falling back to the
  // filename, as computeReferences does).
  const target = metas.find((m) => m.path === path)
  const title = (target?.title ?? path.replace(/\.md$/i, '').split('/').pop() ?? '').trim()
  if (!title) return fail(`Note not found: ${path}`, 404)

  const content = await readVisible(p, context, fromPath)
  if (content === null) return fail(`Note not found: ${fromPath}`, 404)
  // The write lands on the SOURCE note, so its folder gate and replica block apply.
  const denial = await writeDenialFull(p, context, fromPath)
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
      context,
      fromPath,
      frontmatter != null ? `---\n${frontmatter}\n---\n\n${linked}` : linked,
      context.actor,
      'edit',
    )
  } catch (err) {
    return failFromError(err)
  }

  const pending = context.isPersonalSpace ? new Set<string>() : await pendingRequestPaths(p)
  return NextResponse.json({
    ok: true,
    references: await referencesFor(p, context, path, pending),
  })
}
