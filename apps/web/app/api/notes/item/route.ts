// The single-note CRUD endpoint.
//   GET    /api/notes/item?communityId=&scope=&path=        → { content }
//   POST   { communityId, scope, path, content? }            → { note, movedTo? }  (create)
//   PUT    { communityId, scope, path, content, origin? }    → { ok, movedTo? }    (write + revision)
//   PATCH  { communityId, scope, from, to }                  → { path }   (rename/move)
//   DELETE ?communityId=&scope=&path=                        → { ok }     (soft-delete → trash)
//
// Shared-brain reads go through the visibility lens (404 when hidden — absent and
// inaccessible are indistinguishable) and every write through the folder gate
// (403 with the denial reason). Rename + delete are ADDITIONALLY gated by
// brain.canRemove (personal: always; shared: admins or the note's author).
//
// `movedTo` appears when a write turned the note into a folder: an index note IS
// a folder, so writing `type: Index` at `a/b.md` lands it at `a/b/index.md`.

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail, failFromError } from '@/lib/notes/api'
import { canRemove, principalOf } from '@/lib/notes/brain'
import { readVisible, writeDenial, writeDenialFull, moveGated } from '@/lib/notes/brainService'
import {
  writeNote,
  createNote,
  deleteNote,
  getNoteCreatedBy,
  listRaw,
} from '@/lib/notes/store'
import { buildNoteIndex } from '@/lib/notes/shared/context'
import { aiModelName } from '@/lib/notes/ai'
import type { NoteRevisionOrigin } from '@/lib/notes/shared/types'

const DEFAULT_NOTE = (title: string, author?: string): string => {
  const authorLine = author ? `author: ${author}\n` : ''
  return `---\ntype: Note\ntitle: ${title}\n${authorLine}tags: []\n---\n\n# ${title}\n\n`
}

export async function GET(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  const path = new URL(req.url).searchParams.get('path')
  if (!path) return fail('path is required')
  const p = await principalOf(brain)
  const content = await readVisible(p, brain, path)
  if (content === null) return fail(`Note not found: ${path}`, 404)
  return NextResponse.json({ content })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  const path = typeof body.path === 'string' ? body.path : null
  if (!path) return fail('path is required')
  const p = await principalOf(brain)
  const denial = writeDenial(p, brain, path)
  if (denial) return fail(denial, 403)
  const title = path.replace(/\.md$/i, '').split('/').pop() || 'Untitled'
  const content =
    typeof body.content === 'string' && body.content.length > 0
      ? body.content
      : DEFAULT_NOTE(title, brain.actor.name)
  try {
    // A `type: Index` note IS a folder, so createNote may land it at
    // `<path-without-.md>/index.md` — take the path it actually wrote.
    const created = await createNote(brain, path, content, brain.actor)
    const meta = buildNoteIndex(await listRaw(brain)).find((m) => m.path === created.path) ?? null
    return NextResponse.json(
      { note: meta, ...(created.path === path ? {} : { movedTo: created.path }) },
      { status: 201 },
    )
  } catch (err) {
    return failFromError(err)
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  const path = typeof body.path === 'string' ? body.path : null
  const content = typeof body.content === 'string' ? body.content : null
  if (!path || content === null) return fail('path and content are required')
  const p = await principalOf(brain)
  // Full check: folder gate + the replica block (published copies are
  // read-only in their destination — unlink to edit).
  const denial = await writeDenialFull(p, brain, path)
  if (denial) return fail(denial, 403)
  const origin: NoteRevisionOrigin =
    body.origin === 'restore' ? 'restore' : body.origin === 'ai-refactor' ? 'ai-refactor' : 'edit'
  const model = origin === 'ai-refactor' ? aiModelName() : undefined
  try {
    // Retyping a note to `Index` turns it into a folder — writeNote returns the
    // path it ended up at so the editor can follow instead of 404ing on the old one.
    const finalPath = await writeNote(brain, path, content, brain.actor, origin, model)
    return NextResponse.json({ ok: true, ...(finalPath === path ? {} : { movedTo: finalPath }) })
  } catch (err) {
    return failFromError(err)
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  const from = typeof body.from === 'string' ? body.from : null
  const to = typeof body.to === 'string' ? body.to : null
  if (!from || !to) return fail('from and to are required')
  const p = await principalOf(brain)
  if (!canRemove(brain, await getNoteCreatedBy(brain, from), { principal: p, path: from })) {
    return fail('Only an admin, the author, or a full-access member can move this note', 403)
  }
  try {
    // moveGated checks the folder gate on BOTH ends and rewrites inbound links
    // to the new path (a no-op gate for personal brains).
    const result = await moveGated(p, brain, from, to)
    if (result.status === 'denied') return fail(result.reason, 403)
    return NextResponse.json({ path: result.path })
  } catch (err) {
    return failFromError(err)
  }
}

export async function DELETE(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  const path = new URL(req.url).searchParams.get('path')
  if (!path) return fail('path is required')
  const p = await principalOf(brain)
  if (!canRemove(brain, await getNoteCreatedBy(brain, path), { principal: p, path })) {
    return fail('Only an admin, the author, or a full-access member can delete this note', 403)
  }
  // Deleting a published REPLICA is allowed — it deactivates the link — so the
  // sync folder gate applies here, not the replica block.
  const denial = writeDenial(p, brain, path)
  if (denial) return fail(denial, 403)
  try {
    await deleteNote(brain, path)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return failFromError(err)
  }
}
