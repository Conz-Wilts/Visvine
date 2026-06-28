// The single-note CRUD endpoint.
//   GET    /api/notes/item?communityId=&scope=&path=        → { content }
//   POST   { communityId, scope, path, content? }            → { note }   (create)
//   PUT    { communityId, scope, path, content, origin? }    → { ok }     (write + revision)
//   PATCH  { communityId, scope, from, to }                  → { path }   (rename/move)
//   DELETE ?communityId=&scope=&path=                        → { ok }     (soft-delete → trash)
//
// Any member may create/edit. Rename + delete are gated by brain.canRemove
// (personal: always; shared: admins or the note's author).

import { NextRequest, NextResponse } from 'next/server'
import { requireBrain, fail, failFromError } from '@/lib/notes/api'
import { canRemove } from '@/lib/notes/brain'
import {
  readNote,
  writeNote,
  createNote,
  renameNote,
  deleteNote,
  getNoteCreatedBy,
  listRaw,
} from '@/lib/notes/store'
import { buildNoteIndex } from '@/lib/notes/shared/graph'
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
  try {
    return NextResponse.json({ content: await readNote(brain, path) })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 })
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const brain = await requireBrain(req, body)
  if (brain instanceof Response) return brain
  const path = typeof body.path === 'string' ? body.path : null
  if (!path) return fail('path is required')
  const title = path.replace(/\.md$/i, '').split('/').pop() || 'Untitled'
  const content =
    typeof body.content === 'string' && body.content.length > 0
      ? body.content
      : DEFAULT_NOTE(title, brain.actor.name)
  try {
    await createNote(brain, path, content, brain.actor)
    const meta = buildNoteIndex(await listRaw(brain)).find((m) => m.path === path) ?? null
    return NextResponse.json({ note: meta }, { status: 201 })
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
  const origin: NoteRevisionOrigin =
    body.origin === 'restore' ? 'restore' : body.origin === 'ai-refactor' ? 'ai-refactor' : 'edit'
  const model = origin === 'ai-refactor' ? aiModelName() : undefined
  try {
    await writeNote(brain, path, content, brain.actor, origin, model)
    return NextResponse.json({ ok: true })
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
  if (!canRemove(brain, await getNoteCreatedBy(brain, from))) {
    return fail('Only an admin or the author can move this note', 403)
  }
  try {
    return NextResponse.json({ path: await renameNote(brain, from, to) })
  } catch (err) {
    return failFromError(err)
  }
}

export async function DELETE(req: NextRequest) {
  const brain = await requireBrain(req)
  if (brain instanceof Response) return brain
  const path = new URL(req.url).searchParams.get('path')
  if (!path) return fail('path is required')
  if (!canRemove(brain, await getNoteCreatedBy(brain, path))) {
    return fail('Only an admin or the author can delete this note', 403)
  }
  try {
    await deleteNote(brain, path)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return failFromError(err)
  }
}
