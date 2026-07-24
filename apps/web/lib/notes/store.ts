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
import { parseFrontmatter, splitFrontmatter } from './shared/markdown'
import { syncContextLinks, syncContextLinksBulk } from './entityLinks'
// Import cycles with vaultCache (it reads via listRaw) and publications (it
// writes replicas via writeNote; we call its hooks) are benign: both sides
// only call each other inside function bodies, never at module init.
import { invalidateVault } from './vaultCache'
import {
  syncPublicationsOnDelete,
  syncPublicationsOnRename,
  syncPublicationsOnWrite,
} from './publications'
import { ancestorFolders, buildIndexStub, indexPathOf } from './shared/indexNote'

// The `starred` column is a queryable index of the frontmatter `starred:` flag
// (the source of truth), re-derived on every write.
function isStarred(content: string): boolean {
  return Boolean(parseFrontmatter(content).starred)
}

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
// Exported for the context-source store, which shares the note path namespace.
export function sanitizePath(p: string): string {
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
      starred: isStarred(content),
      createdBy: actor.id,
    },
    select: { path: true, content: true, updatedAt: true },
  })
  await syncContextLinks(brain, p, content)
  await ensureAncestorIndexes(brain, p, actor)
  invalidateVault(brain)
  return toRaw(row)
}

// Every folder carries an index.md (the blackbird-brain convention — see
// lib/notes/shared/indexNote.ts). Ensure each ancestor folder of `path` has one,
// creating missing indexes as a stub listing the folder's current direct-child
// notes. NEVER rewrites an existing index (they're often curated documents).
// Rows are inserted directly (not via createNote) — no recursion, no revision.
// Returns the index paths created.
export async function ensureAncestorIndexes(
  brain: Brain,
  path: string,
  actor: Actor,
): Promise<string[]> {
  const created: string[] = []
  for (const folder of ancestorFolders(sanitizePath(path))) {
    const idx = indexPathOf(folder)
    if (await findLive(brain, idx)) continue
    const rows = await prisma.communityNote.findMany({
      where: {
        communityId: brain.communityId,
        ownerKey: brain.ownerKey,
        deletedAt: null,
        path: { startsWith: `${folder}/` },
      },
      select: { path: true, content: true },
    })
    const children = rows
      .filter((r) => r.path !== idx && !r.path.slice(folder.length + 1).includes('/'))
      .map((r) => {
        const title = String(parseFrontmatter(r.content).title ?? '').trim()
        return { path: r.path, title: title || baseName(r.path).replace(/\.md$/i, '') }
      })
    try {
      await prisma.communityNote.create({
        data: {
          communityId: brain.communityId,
          ownerKey: brain.ownerKey,
          path: idx,
          content: buildIndexStub(folder, children),
          starred: false,
          createdBy: actor.id,
        },
      })
      created.push(idx)
    } catch (e) {
      // Concurrent creates in a fresh folder can race the index insert; the
      // note_identity unique key makes the loser throw — the index exists, done.
      if ((e as { code?: string }).code !== 'P2002') throw e
    }
  }
  if (created.length) invalidateVault(brain)
  return created
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
    ? await prisma.communityNote.update({
        where: { id: existing.id },
        data: { content, starred: isStarred(content) },
      })
    : await prisma.communityNote.create({
        data: {
          communityId: brain.communityId,
          ownerKey: brain.ownerKey,
          path: p,
          content,
          starred: isStarred(content),
          createdBy: actor.id,
        },
      })

  // Entity notes drive directory links: re-derive this note's 'mentioned' edges
  // from its [[mentions]]. Best-effort (no-op for personal brains / non-entity
  // paths); runs even on no-op saves so a missed sync self-heals on next save.
  await syncContextLinks(brain, p, content)

  // Refresh this note's published replicas in other brains. Origin 'publish'
  // IS a replica write — skipping it is what stops replication cascades and
  // publish cycles dead. Best-effort like the link sync; self-heals on no-op
  // saves the same way.
  if (origin !== 'publish') await syncPublicationsOnWrite(brain, p, content, actor)

  // Upsert-created notes (e.g. an entity note's first save) get folder indexes too.
  if (existing === null) await ensureAncestorIndexes(brain, p, actor)

  // Even a no-op save bumped updatedAt above, so the memo's stamp is stale.
  invalidateVault(brain)

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
  // old path's context links, derive the new path's. Publications and any
  // note-level grants follow the note to its new path.
  if (t !== f) {
    await syncContextLinksBulk(brain, [f], [[t, row.content]])
    await syncPublicationsOnRename(brain, f, t)
    if (brain.ownerKey === SHARED_OWNER_KEY) {
      await prisma.brainGrant.updateMany({
        where: { communityId: brain.communityId, resourcePath: f },
        data: { resourcePath: t },
      })
    }
  }
  invalidateVault(brain)
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
  // Trashing either end of a publication deactivates it (replica stays a copy).
  await syncPublicationsOnDelete(brain, [row.path])
  invalidateVault(brain)
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
  invalidateVault(brain)
  return dest
}

export async function emptyTrash(brain: Brain): Promise<void> {
  await prisma.communityNote.deleteMany({
    where: { communityId: brain.communityId, ownerKey: brain.ownerKey, deletedAt: { not: null } },
  })
  invalidateVault(brain)
}

// --- folders -----------------------------------------------------------------

export async function createFolder(brain: Brain, path: string, actor?: Actor): Promise<void> {
  const p = sanitizePath(path)
  await prisma.communityNoteFolder.upsert({
    where: { folder_identity: { communityId: brain.communityId, ownerKey: brain.ownerKey, path: p } },
    create: { communityId: brain.communityId, ownerKey: brain.ownerKey, path: p },
    update: {},
  })
  // The synthetic index path makes ancestorFolders cover this folder AND its parents.
  if (actor) await ensureAncestorIndexes(brain, indexPathOf(p), actor)
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
  // Publications follow every moved note (independent rows — overlap the round-trips).
  await Promise.all(
    notes.map((note) => syncPublicationsOnRename(brain, note.path, t + note.path.slice(f.length))),
  )
  // Grants ride the rename too — a moved team subtree keeps its access rows.
  if (brain.ownerKey === SHARED_OWNER_KEY) {
    await prisma.brainGrant.updateMany({
      where: { communityId: brain.communityId, resourcePath: f },
      data: { resourcePath: t },
    })
    const nested = await prisma.brainGrant.findMany({
      where: { communityId: brain.communityId, resourcePath: { startsWith: `${f}/` } },
      select: { id: true, resourcePath: true },
    })
    await Promise.all(
      nested.map((grant) =>
        prisma.brainGrant.update({
          where: { id: grant.id },
          data: { resourcePath: t + grant.resourcePath.slice(f.length) },
        }),
      ),
    )
  }
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
  invalidateVault(brain)
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
  await syncPublicationsOnDelete(brain, notes.map((n) => n.path))
  await prisma.communityNoteFolder.deleteMany({
    where: {
      communityId: brain.communityId,
      ownerKey: brain.ownerKey,
      OR: [{ path: p }, { path: { startsWith: `${p}/` } }],
    },
  })
  // Grants into a deleted subtree go with it — a future folder reusing the
  // name must not inherit a dead folder's access.
  if (brain.ownerKey === SHARED_OWNER_KEY) {
    await prisma.brainGrant.deleteMany({
      where: {
        communityId: brain.communityId,
        OR: [{ resourcePath: p }, { resourcePath: { startsWith: `${p}/` } }],
      },
    })
  }
  invalidateVault(brain)
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

// Star / unstar a note (sidebar Starred section + editor toolbar star). The
// frontmatter `starred:` flag is the source of truth; rewrite it through
// writeNote so the synced column, revisions and link sync all stay consistent
// with a toggle made from the editor.
export async function setStarred(
  brain: Brain,
  path: string,
  starred: boolean,
  actor: Actor,
): Promise<void> {
  const row = await findLive(brain, sanitizePath(path))
  if (!row) throw new Error(`Note not found: ${path}`)
  const { frontmatter, body } = splitFrontmatter(row.content)
  const lines = (frontmatter ?? '')
    .split('\n')
    .filter((l) => l.trim() && !/^starred\s*:/i.test(l.trim()))
  if (starred) lines.push('starred: true')
  const content = lines.length ? `---\n${lines.join('\n')}\n---\n\n${body}` : body
  await writeNote(brain, row.path, content, actor)
}

export async function listStarred(brain: Brain): Promise<string[]> {
  const rows = await prisma.communityNote.findMany({
    where: { communityId: brain.communityId, ownerKey: brain.ownerKey, deletedAt: null, starred: true },
    select: { path: true },
  })
  return rows.map((r) => r.path)
}
