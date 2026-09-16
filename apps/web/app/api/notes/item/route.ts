// The single-note CRUD endpoint.
//   GET    /api/notes/item?spaceId=&scope=&path=        → { content, path }
//   POST   { spaceId, scope, path, content? }            → { note, movedTo? }  (create)
//   PUT    { spaceId, scope, path, content, origin? }    → { ok, movedTo? }    (write + revision)
//   PATCH  { spaceId, scope, from, to }                  → { path }   (rename/move)
//   DELETE ?spaceId=&scope=&path=                        → { ok }     (soft-delete → trash)
//
// Shared-context reads go through the visibility lens (404 when hidden — absent and
// inaccessible are indistinguishable) and every write through the folder gate
// (403 with the denial reason). Rename + delete are ADDITIONALLY gated by
// context.canRemove (personal: always; shared: admins or the note's author).
//
// A path under subspaces/<id>/ is a sub-space's note read through this space
// (lib/notes/federation.ts). A write there is a write IN the sub-space, under
// the caller's own standing in it — `writeTarget` hops the context, principal
// and path across, and every gate below then runs against the sub-space.
// Paths in the response come back rebased onto this space's tree.
//
// `movedTo` appears when the path the write landed at isn't the one asked for —
// the note had become its own folder since, so the write was redirected to
// `a/b/index.md`.

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail, failFromError } from '@/lib/notes/api'
import { canRemove, principalOf } from '@/lib/notes/resolve'
import { writeDenial, writeDenialFull, moveGated, namespaceFeatureDenial, configKindDenial } from '@/lib/notes/contextService'
import { moveTargets, readFederated, writeTarget } from '@/lib/notes/federation'
import { isFederatedPath } from '@/lib/spaces/subspaces'
import {
  writeNote,
  canonicalEntityWritePath,
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
  const context = await requireContext(req)
  if (context instanceof Response) return context
  const path = new URL(req.url).searchParams.get('path')
  if (!path) return fail('path is required')
  const p = await principalOf(context)
  // An entity's flat path keeps answering after its note has become the folder
  // index (people/x.md → people/x/index.md): a client holding the old path (a
  // stale profile cache, an old link) reads the live note, and `path` says
  // where it really is. Writes redirect the same way (store.writeNote).
  // A path under subspaces/<id>/ or parent/ is another space's note read
  // through this one (lib/notes/federation.ts) — its own, already-canonical
  // path, never this context's entity map.
  const canonical = isFederatedPath(path) ? path : await canonicalEntityWritePath(context, path)
  const content = await readFederated(p, context, canonical)
  if (content === null) return fail(`Note not found: ${path}`, 404)
  return NextResponse.json({ content, path: canonical })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  const path = typeof body.path === 'string' ? body.path : null
  if (!path) return fail('path is required')
  const p = await principalOf(context)
  const target = await writeTarget(p, context, path)
  if ('denial' in target) return fail(target.denial, 403)
  const { context: ctx, principal, path: at } = target
  const denial = writeDenial(principal, ctx, at)
  if (denial) return fail(denial, 403)
  // A namespace whose tool the space has switched off is not created by hand
  // either (lib/notes/shared/namespaces.ts).
  const namespace = await namespaceFeatureDenial(ctx, at)
  if (namespace) return fail(namespace, 403)
  const title = at.replace(/\.md$/i, '').split('/').pop() || 'Untitled'
  const content =
    typeof body.content === 'string' && body.content.length > 0
      ? body.content
      : DEFAULT_NOTE(title, ctx.actor.name)
  // A note that declares itself a connector or model is the admin's wherever
  // it is filed (lib/notes/shared/configKinds.ts).
  const declared = await configKindDenial(principal, ctx, at, content, { current: null })
  if (declared) return fail(declared, 403)
  try {
    // createNote may redirect an entity write to the folder form the entity has
    // since taken (people/<slug>/index.md) — take the path it actually wrote.
    const created = await createNote(ctx, at, content, ctx.actor)
    const meta = buildNoteIndex(await listRaw(ctx)).find((m) => m.path === created.path) ?? null
    return NextResponse.json(
      {
        note: meta ? target.rebaseMeta(meta) : null,
        ...(created.path === at ? {} : { movedTo: target.rebase(created.path) }),
      },
      { status: 201 },
    )
  } catch (err) {
    return failFromError(err)
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  const path = typeof body.path === 'string' ? body.path : null
  const content = typeof body.content === 'string' ? body.content : null
  if (!path || content === null) return fail('path and content are required')
  const p = await principalOf(context)
  const target = await writeTarget(p, context, path)
  if ('denial' in target) return fail(target.denial, 403)
  const { context: ctx, principal, path: at } = target
  // Full check: folder gate + the replica block (published copies are
  // read-only in their destination — unlink to edit).
  const denial = (await writeDenialFull(principal, ctx, at)) ?? (await configKindDenial(principal, ctx, at, content))
  if (denial) return fail(denial, 403)
  const origin: NoteRevisionOrigin =
    body.origin === 'restore' ? 'restore' : body.origin === 'ai-refactor' ? 'ai-refactor' : 'edit'
  const model = origin === 'ai-refactor' ? aiModelName() : undefined
  try {
    // Retyping a note to `Index` turns it into a folder — writeNote returns the
    // path it ended up at so the editor can follow instead of 404ing on the old one.
    const finalPath = await writeNote(ctx, at, content, ctx.actor, origin, model)
    return NextResponse.json({ ok: true, ...(finalPath === at ? {} : { movedTo: target.rebase(finalPath) }) })
  } catch (err) {
    return failFromError(err)
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const context = await requireContext(req, body)
  if (context instanceof Response) return context
  const from = typeof body.from === 'string' ? body.from : null
  const to = typeof body.to === 'string' ? body.to : null
  if (!from || !to) return fail('from and to are required')
  const p = await principalOf(context)
  const ends = await moveTargets(p, context, from, to)
  if ('denial' in ends) return fail(ends.denial, 403)
  const { context: ctx, principal, path: src } = ends.from
  if (!canRemove(ctx, await getNoteCreatedBy(ctx, src), { principal, path: src })) {
    return fail('Only an admin, the author, or a full-access member can move this note', 403)
  }
  try {
    // moveGated checks the folder gate on BOTH ends and rewrites inbound links
    // to the new path (a no-op gate for personal contexts).
    const result = await moveGated(principal, ctx, src, ends.to.path)
    if (result.status === 'denied') return fail(result.reason, 403)
    return NextResponse.json({ path: ends.to.rebase(result.path) })
  } catch (err) {
    return failFromError(err)
  }
}

export async function DELETE(req: NextRequest) {
  const context = await requireContext(req)
  if (context instanceof Response) return context
  const path = new URL(req.url).searchParams.get('path')
  if (!path) return fail('path is required')
  const p = await principalOf(context)
  const target = await writeTarget(p, context, path)
  if ('denial' in target) return fail(target.denial, 403)
  const { context: ctx, principal, path: at } = target
  if (!canRemove(ctx, await getNoteCreatedBy(ctx, at), { principal, path: at })) {
    return fail('Only an admin, the author, or a full-access member can delete this note', 403)
  }
  // Deleting a published REPLICA is allowed — it deactivates the link — so the
  // sync folder gate applies here, not the replica block.
  const denial = writeDenial(principal, ctx, at) ?? (await configKindDenial(principal, ctx, at, null))
  if (denial) return fail(denial, 403)
  try {
    await deleteNote(ctx, at)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return failFromError(err)
  }
}
