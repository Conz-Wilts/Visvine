// DB-backed note store: the web replacement for blackbird-brain's filesystem
// src/server/notes.ts + src/server/history.ts. Every note is a `CommunityNote`
// row keyed by a brain `{ communityId, ownerKey }` and a brain-relative POSIX
// `path` — the same `{ path, content, mtime }` shape the Electron app read off
// disk, so the pure index/graph/backlink pipeline in ./shared works unchanged.
//
// Soft-delete (trash) is a `deletedAt` timestamp; the row's `path` is parked at a
// `:trash:<id>` sentinel so it frees the real path (kept in `deletedPath`) for a
// future note and never collides with the (community, ownerKey, path) unique key.
// Revision history mirrors the .history sidecar: a baseline snapshot is seeded on
// the first edit, consecutive same-author edits coalesce, and history is capped.

import prisma from '@/lib/prisma'
import type {
  RawNote,
  NoteRevision,
  NoteRevisionOrigin,
  TrashEntry,
} from './shared/types'
import { syncContextLinks, syncContextLinksBulk } from './entityLinks'

export interface Brain {
  communityId: string
  ownerKey: string // 'shared' = community brain; else a userId = personal brain
}

export const SHARED_OWNER_KEY = 'shared'

/** Who is making the change — for revision attribution and note ownership. */
export interface Actor {
  id: string
  name: string
  email?: string | null
}

const MAX_REVISIONS = 50
// Consecutive manual edits by the same person within this window collapse into a
// single revision (latest snapshot wins), so autosave doesn't spam an entry per save.
const COALESCE_WINDOW_MS = 5 * 60 * 1000

// --- path safety -------------------------------------------------------------

// Normalize an untrusted, client-supplied path to a safe brain-relative POSIX
// path. Rejects traversal and NUL (Postgres text can't store NUL anyway).
function sanitizePath(p: string): string {
  const norm = p
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .trim()
  if (!norm || norm.split('/').some((seg) => seg === '..' || seg === '.') || norm.includes('\u0000')) {
    throw new Error(`Invalid note path: ${p}`)
  }
  return norm
}

function assertMarkdown(p: string): void {
  if (!p.toLowerCase().endsWith('.md')) {
    throw new Error(`Notes must be .md files: ${p}`)
  }
}

function baseName(p: string): string {
  return p.split('/').pop() ?? p
}

function toRaw(row: { path: string; content: string; updatedAt: Date }): RawNote {
  return { path: row.path, content: row.content, mtime: row.updatedAt.getTime() }
}

// A live (non-trashed) note at this exact path, or null.
function findLive(brain: Brain, path: string) {
  return prisma.communityNote.findFirst({
    where: { communityId: brain.communityId, ownerKey: brain.ownerKey, path, deletedAt: null },
  })
}

// --- reads -------------------------------------------------------------------

export async function listRaw(brain: Brain): Promise<RawNote[]> {
  const rows = await prisma.communityNote.findMany({
    where: { communityId: brain.communityId, ownerKey: brain.ownerKey, deletedAt: null },
    select: { path: true, content: true, updatedAt: true },
  })
  return rows.map(toRaw)
}

export async function listFolders(brain: Brain): Promise<string[]> {
  const rows = await prisma.communityNoteFolder.findMany({
    where: { communityId: brain.communityId, ownerKey: brain.ownerKey },
    select: { path: true },
  })
  return rows.map((r) => r.path)
}

export async function noteCount(brain: Brain): Promise<number> {
  return prisma.communityNote.count({
    where: { communityId: brain.communityId, ownerKey: brain.ownerKey, deletedAt: null },
  })
}

export async function readNote(brain: Brain, path: string): Promise<string> {
  const row = await findLive(brain, sanitizePath(path))
  if (!row) throw new Error(`Note not found: ${path}`)
  return row.content
}

/** Like readNote, but absent notes return null instead of throwing. */
export async function readNoteOrNull(brain: Brain, path: string): Promise<string | null> {
  const row = await findLive(brain, sanitizePath(path))
  return row?.content ?? null
}

// The userId that created a live note, or null if it doesn't exist. Used for the
// shared-brain delete/rename permission check (see brain.ts:canRemove).
export async function getNoteCreatedBy(brain: Brain, path: string): Promise<string | null> {
  const row = await findLive(brain, sanitizePath(path))
  return row?.createdBy ?? null
}

// --- writes ------------------------------------------------------------------

// Create a note, refusing to overwrite an existing one. Records no revision —
// the first revision (baseline + edit) is seeded on the first save, matching the
// source app where note:create is separate from note:write.
export async function createNote(
  brain: Brain,
  path: string,
  content: string,
  actor: Actor,
): Promise<RawNote> {
  const p = sanitizePath(path)
  assertMarkdown(p)
  if (await findLive(brain, p)) throw new Error(`A note already exists at: ${path}`)
  const row = await prisma.communityNote.create({
    data: {
      communityId: brain.communityId,
      ownerKey: brain.ownerKey,
      path: p,
      content,
      createdBy: actor.id,
    },
    select: { path: true, content: true, updatedAt: true },
  })
  await syncContextLinks(brain, p, content)
  return toRaw(row)
}

// Upsert a note's content and record a revision. Mirrors rpc.ts 'note:write':
// skip no-op saves, seed a baseline from the pre-edit content on the first edit,
// then record the new snapshot tagged with how it arose.
export async function writeNote(
  brain: Brain,
  path: string,
  content: string,
  actor: Actor,
  origin: NoteRevisionOrigin = 'edit',
  model?: string,
): Promise<void> {
  const p = sanitizePath(path)
  assertMarkdown(p)
  const existing = await findLive(brain, p)
  const prev = existing?.content ?? null

  const note = existing
    ? await prisma.communityNote.update({ where: { id: existing.id }, data: { content } })
    : await prisma.communityNote.create({
        data: {
          communityId: brain.communityId,
          ownerKey: brain.ownerKey,
          path: p,
          content,
          createdBy: actor.id,
        },
      })

  // Entity notes drive directory links: re-derive this note's 'mentioned' edges
  // from its [[mentions]]. Best-effort (no-op for personal brains / non-entity
  // paths); runs even on no-op saves so a missed sync self-heals on next save.
  await syncContextLinks(brain, p, content)

  if (prev === content) return // nothing changed — don't spawn a revision

  // Seed a baseline of the pre-edit content the first time a note is edited, so
  // the oldest revision has a snapshot to diff/restore from.
  if (prev !== null) {
    const count = await prisma.communityNoteRevision.count({ where: { noteId: note.id } })
    if (count === 0) {
      await recordRevision(
        note.id,
        { content: prev, editor: 'Unknown', origin: 'baseline' },
        Date.now() - 1,
      )
    }
  }

  await recordRevision(note.id, {
    content,
    editor: actor.name,
    editorEmail: actor.email ?? undefined,
    origin,
    model,
  })
}

interface RevisionInput {
  content: string
  editor: string
  editorEmail?: string
  origin: NoteRevisionOrigin
  model?: string
}

// Append a revision, coalescing consecutive same-author manual edits within the
// window (latest wins), then prune to MAX_REVISIONS (oldest first).
async function recordRevision(noteId: string, rev: RevisionInput, at = Date.now()): Promise<void> {
  const last = await prisma.communityNoteRevision.findFirst({
    where: { noteId },
    orderBy: { at: 'desc' },
  })
  const coalesce =
    last !== null &&
    last.origin === 'edit' &&
    rev.origin === 'edit' &&
    last.editor === rev.editor &&
    at - last.at.getTime() < COALESCE_WINDOW_MS

  if (coalesce && last) {
    await prisma.communityNoteRevision.update({
      where: { id: last.id },
      data: {
        content: rev.content,
        at: new Date(at),
        editorEmail: rev.editorEmail ?? null,
        model: rev.model ?? null,
      },
    })
  } else {
    await prisma.communityNoteRevision.create({
      data: {
        noteId,
        content: rev.content,
        editor: rev.editor,
        editorEmail: rev.editorEmail ?? null,
        origin: rev.origin,
        model: rev.model ?? null,
        at: new Date(at),
      },
    })
  }

  const count = await prisma.communityNoteRevision.count({ where: { noteId } })
  if (count > MAX_REVISIONS) {
    const stale = await prisma.communityNoteRevision.findMany({
      where: { noteId },
      orderBy: { at: 'asc' },
      take: count - MAX_REVISIONS,
      select: { id: true },
    })
    await prisma.communityNoteRevision.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } })
  }
}

export async function renameNote(brain: Brain, from: string, to: string): Promise<string> {
  const f = sanitizePath(from)
  const t = sanitizePath(to)
  assertMarkdown(t)
  const row = await findLive(brain, f)
  if (!row) throw new Error(`Note not found: ${from}`)
  if (t !== f && (await findLive(brain, t))) throw new Error(`A note already exists at: ${to}`)
  await prisma.communityNote.update({ where: { id: row.id }, data: { path: t } })
  // A rename changes which entity (if any) the note is canonical for: drop the
  // old path's context links, derive the new path's.
  if (t !== f) await syncContextLinksBulk(brain, [f], [[t, row.content]])
  return t // revisions stay attached by noteId
}

// --- trash (soft-delete) -----------------------------------------------------

export async function deleteNote(brain: Brain, path: string): Promise<void> {
  const row = await findLive(brain, sanitizePath(path))
  if (!row) return
  await prisma.communityNote.update({
    where: { id: row.id },
    data: { deletedAt: new Date(), deletedPath: row.path, path: `:trash:${row.id}` },
  })
  await syncContextLinks(brain, row.path, null) // trashed note owns no context links
}

export async function listTrash(brain: Brain): Promise<TrashEntry[]> {
  const rows = await prisma.communityNote.findMany({
    where: { communityId: brain.communityId, ownerKey: brain.ownerKey, deletedAt: { not: null } },
    orderBy: { deletedAt: 'desc' },
    select: { id: true, deletedPath: true, deletedAt: true },
  })
  return rows.map((r) => ({
    id: r.id,
    name: baseName(r.deletedPath ?? r.id),
    path: r.deletedPath ?? '',
    deletedAt: r.deletedAt ? r.deletedAt.getTime() : 0,
  }))
}

// Restore a trashed note to its original path, suffixing on collision.
export async function restoreTrash(brain: Brain, id: string): Promise<string> {
  const row = await prisma.communityNote.findFirst({
    where: { id, communityId: brain.communityId, ownerKey: brain.ownerKey, deletedAt: { not: null } },
  })
  if (!row || !row.deletedPath) throw new Error('Trash entry not found')
  let dest = row.deletedPath
  let n = 1
  while (await findLive(brain, dest)) {
    dest = row.deletedPath.replace(/\.md$/i, '') + `-${n++}.md`
  }
  await prisma.communityNote.update({
    where: { id: row.id },
    data: { deletedAt: null, deletedPath: null, path: dest },
  })
  await syncContextLinks(brain, dest, row.content) // restored entity note re-owns its links
  return dest
}

export async function emptyTrash(brain: Brain): Promise<void> {
  await prisma.communityNote.deleteMany({
    where: { communityId: brain.communityId, ownerKey: brain.ownerKey, deletedAt: { not: null } },
  })
}

// --- folders -----------------------------------------------------------------

export async function createFolder(brain: Brain, path: string): Promise<void> {
  const p = sanitizePath(path)
  await prisma.communityNoteFolder.upsert({
    where: { folder_identity: { communityId: brain.communityId, ownerKey: brain.ownerKey, path: p } },
    create: { communityId: brain.communityId, ownerKey: brain.ownerKey, path: p },
    update: {},
  })
}

// Rename/move a folder and everything under it (notes + nested folder rows).
export async function renameFolder(brain: Brain, from: string, to: string): Promise<string> {
  const f = sanitizePath(from)
  const t = sanitizePath(to)
  const notes = await prisma.communityNote.findMany({
    where: {
      communityId: brain.communityId,
      ownerKey: brain.ownerKey,
      deletedAt: null,
      path: { startsWith: `${f}/` },
    },
    select: { id: true, path: true, content: true },
  })
  for (const note of notes) {
    await prisma.communityNote.update({
      where: { id: note.id },
      data: { path: t + note.path.slice(f.length) },
    })
  }
  // Moving into/out of the people|companies namespaces changes which notes are
  // canonical entity notes — resync both sides (no-op when neither is involved).
  await syncContextLinksBulk(
    brain,
    notes.map((n) => n.path),
    notes.map((n) => [t + n.path.slice(f.length), n.content]),
  )
  const folders = await prisma.communityNoteFolder.findMany({
    where: {
      communityId: brain.communityId,
      ownerKey: brain.ownerKey,
      OR: [{ path: f }, { path: { startsWith: `${f}/` } }],
    },
    select: { id: true, path: true },
  })
  for (const fol of folders) {
    await prisma.communityNoteFolder.update({
      where: { id: fol.id },
      data: { path: fol.path === f ? t : t + fol.path.slice(f.length) },
    })
  }
  return t
}

// Soft-delete a folder: trash every note under it and drop the folder rows.
export async function deleteFolder(brain: Brain, path: string): Promise<void> {
  const p = sanitizePath(path)
  const notes = await prisma.communityNote.findMany({
    where: {
      communityId: brain.communityId,
      ownerKey: brain.ownerKey,
      deletedAt: null,
      path: { startsWith: `${p}/` },
    },
    select: { id: true, path: true },
  })
  for (const note of notes) {
    await prisma.communityNote.update({
      where: { id: note.id },
      data: { deletedAt: new Date(), deletedPath: note.path, path: `:trash:${note.id}` },
    })
  }
  await syncContextLinksBulk(brain, notes.map((n) => n.path)) // trashed entity notes drop their links
  await prisma.communityNoteFolder.deleteMany({
    where: {
      communityId: brain.communityId,
      ownerKey: brain.ownerKey,
      OR: [{ path: p }, { path: { startsWith: `${p}/` } }],
    },
  })
}

// --- revision history --------------------------------------------------------

export async function listRevisions(brain: Brain, path: string): Promise<NoteRevision[]> {
  const row = await findLive(brain, sanitizePath(path))
  if (!row) return []
  const revs = await prisma.communityNoteRevision.findMany({
    where: { noteId: row.id },
    orderBy: { at: 'desc' },
  })
  return revs.map((r) => ({
    id: r.id,
    at: r.at.getTime(),
    editor: r.editor,
    editorEmail: r.editorEmail ?? undefined,
    origin: r.origin as NoteRevisionOrigin,
    model: r.model ?? undefined,
    content: r.content,
  }))
}

// Restore a past revision's content as the current note (records a 'restore').
export async function applyRevision(
  brain: Brain,
  path: string,
  revisionId: string,
  actor: Actor,
): Promise<void> {
  const row = await findLive(brain, sanitizePath(path))
  if (!row) throw new Error(`Note not found: ${path}`)
  const rev = await prisma.communityNoteRevision.findFirst({
    where: { id: revisionId, noteId: row.id },
  })
  if (!rev) throw new Error('Revision not found')
  await writeNote(brain, row.path, rev.content, actor, 'restore')
}

// Pin / unpin a note (sidebar pins section).
export async function setPinned(brain: Brain, path: string, pinned: boolean): Promise<void> {
  const row = await findLive(brain, sanitizePath(path))
  if (!row) throw new Error(`Note not found: ${path}`)
  await prisma.communityNote.update({ where: { id: row.id }, data: { pinned } })
}

export async function listPinned(brain: Brain): Promise<string[]> {
  const rows = await prisma.communityNote.findMany({
    where: { communityId: brain.communityId, ownerKey: brain.ownerKey, deletedAt: null, pinned: true },
    select: { path: true },
  })
  return rows.map((r) => r.path)
}
