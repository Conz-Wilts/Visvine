// DB-backed note store. Every note is a `ContextNote` row keyed by a context
// `{ spaceId, ownerKey }` and a context-relative POSIX `path`, exposed as
// `{ path, content, mtime }` so the pure index/context/backlink pipeline in
// ./shared can treat a row exactly like a file on disk.
//
// Soft-delete (trash) is a `deletedAt` timestamp; the row's `path` is parked at a
// `:trash:<id>` sentinel so it frees the real path (kept in `deletedPath`) for a
// future note and never collides with the (space, ownerKey, path) unique key.
// Revision history: a baseline snapshot is seeded on the first edit, consecutive
// same-author edits coalesce, and history is capped.

import prisma from '@/lib/prisma'
import type {
  RawNote,
  NoteRevision,
  NoteRevisionOrigin,
  TrashEntry,
} from './shared/types'
import { TRASH_RETENTION_DAYS } from './shared/types'
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from './shared/markdown'
import { syncContextLinks, syncContextLinksBulk } from './entityLinks'
import { parseEntityHref } from './entities'
// Import cycles with vaultCache (it reads via listRaw) and publications (it
// writes replicas via writeNote; we call its hooks) are benign: both sides
// only call each other inside function bodies, never at module init.
import { invalidateVault } from './vaultCache'
import {
  syncPublicationsOnDelete,
  syncPublicationsOnRename,
  syncPublicationsOnWrite,
} from './publications'
import {
  INDEX_BASENAME,
  ancestorFolders,
  applyChildrenBlock,
  buildIndexStub,
  enforceIndexFrontmatter,
  folderOfIndexPath,
  hasChildrenBlock,
  indexFolderPathOf,
  indexPathOf,
  isIndexContent,
  isIndexPath,
  newIndexContent,
  nextIndexTitle,
  humanizeFolderName,
  type IndexChild,
} from './shared/indexNote'

// The `starred` column is a queryable index of the frontmatter `starred:` flag
// (the source of truth), re-derived on every write.
function isStarred(content: string): boolean {
  return Boolean(parseFrontmatter(content).starred)
}

export interface Context {
  spaceId: string
  ownerKey: string // 'shared' = space context; else a userId = personal context
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

// path safety

// Normalize an untrusted, client-supplied path to a safe context-relative POSIX
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

// The folder holding a path — '' for the context root.
function folderOf(p: string): string {
  return p.split('/').slice(0, -1).join('/')
}

function toRaw(row: { path: string; content: string; updatedAt: Date }): RawNote {
  return { path: row.path, content: row.content, mtime: row.updatedAt.getTime() }
}

// A live (non-trashed) note at this exact path, or null.
function findLive(context: Context, path: string) {
  return prisma.contextNote.findFirst({
    where: { spaceId: context.spaceId, ownerKey: context.ownerKey, path, deletedAt: null },
  })
}

// reads

export async function listRaw(context: Context): Promise<RawNote[]> {
  const rows = await prisma.contextNote.findMany({
    where: { spaceId: context.spaceId, ownerKey: context.ownerKey, deletedAt: null },
    select: { path: true, content: true, updatedAt: true },
  })
  return rows.map(toRaw)
}

export async function listFolders(context: Context): Promise<string[]> {
  const rows = await prisma.contextFolder.findMany({
    where: { spaceId: context.spaceId, ownerKey: context.ownerKey },
    select: { path: true },
  })
  // The table doubles as the access-boundary store, and a boundary can sit on a
  // NOTE (the Share panel's "make this note private"). Those rows are flags,
  // not folders — grafting one into the tree would render a phantom folder
  // duplicate next to the note itself.
  return rows.map((r) => r.path).filter((p) => !p.endsWith('.md'))
}

export async function noteCount(context: Context): Promise<number> {
  return prisma.contextNote.count({
    where: { spaceId: context.spaceId, ownerKey: context.ownerKey, deletedAt: null },
  })
}

export async function readNote(context: Context, path: string): Promise<string> {
  const row = await findLive(context, sanitizePath(path))
  if (!row) throw new Error(`Note not found: ${path}`)
  return row.content
}

/** Like readNote, but absent notes return null instead of throwing. */
export async function readNoteOrNull(context: Context, path: string): Promise<string | null> {
  const row = await findLive(context, sanitizePath(path))
  return row?.content ?? null
}

// The userId that created a live note, or null if it doesn't exist. Used for the
// shared-context delete/rename permission check (see context.ts:canRemove).
export async function getNoteCreatedBy(context: Context, path: string): Promise<string | null> {
  const row = await findLive(context, sanitizePath(path))
  return row?.createdBy ?? null
}

// writes

// Create a note, refusing to overwrite an existing one. Records no revision —
// the first revision (baseline + edit) is seeded on the first save, matching the
// source app where note:create is separate from note:write.
export async function createNote(
  context: Context,
  path: string,
  content: string,
  actor: Actor,
): Promise<RawNote> {
  const requested = sanitizePath(path)
  assertMarkdown(requested)
  // An index note IS a folder: creating `a/b.md` with `type: Index` creates the
  // folder `a/b` and writes its index, never a loose note that claims the type.
  let p = requested
  if (isIndexContent(content) && !isIndexPath(requested)) {
    const denial = await indexConversionDenial(context, requested)
    if (denial) throw new Error(denial)
    p = indexPathOf(indexFolderPathOf(requested))
  }
  // The reverse guard: a note AT an index path is a folder whatever its
  // frontmatter says, so the Index type is enforced rather than trusted.
  if (isIndexPath(p)) content = enforceIndexFrontmatter(content, folderOfIndexPath(p))
  if (await findLive(context, p)) throw new Error(`A note already exists at: ${p}`)
  const row = await prisma.contextNote.create({
    data: {
      spaceId: context.spaceId,
      ownerKey: context.ownerKey,
      path: p,
      content,
      starred: isStarred(content),
      createdBy: actor.id,
    },
    select: { path: true, content: true, updatedAt: true },
  })
  if (isIndexPath(p)) await upsertFolderRow(context, folderOf(p))
  await syncContextLinks(context, p, content)
  await ensureAncestorIndexes(context, p, actor)
  await refreshIndexesForNote(context, p)
  invalidateVault(context)
  return toRaw(row)
}

// folder indexes
//
// An index note IS a folder. Everything below keeps that true: every folder has
// exactly one index, and every index's managed child block lists what the folder
// currently holds — its direct notes AND its direct subfolders (which are their
// own index notes, so a folder listing a subfolder is one index linking another).

/**
 * What a folder's index should currently list: the folder's direct-child notes
 * (its own index excluded) plus its direct subfolders, each linked at its index.
 * Titles come from frontmatter, falling back to the filename / humanized segment.
 */
async function directChildrenOf(context: Context, folder: string): Promise<IndexChild[]> {
  const prefix = folder ? `${folder}/` : ''
  const rows = await prisma.contextNote.findMany({
    where: {
      spaceId: context.spaceId,
      ownerKey: context.ownerKey,
      deletedAt: null,
      ...(prefix ? { path: { startsWith: prefix } } : {}),
    },
    select: { path: true, content: true },
  })
  const own = indexPathOf(folder)
  const children: IndexChild[] = []
  for (const row of rows) {
    if (row.path === own || row.path.startsWith(':trash:')) continue
    const rel = row.path.slice(prefix.length)
    const declared = String(parseFrontmatter(row.content).title ?? '').trim()
    if (!rel.includes('/')) {
      // A direct note. The context root's own index.md is a note like any other
      // here only when `folder` is not the root — handled by the `own` skip.
      children.push({ path: row.path, title: declared || rel.replace(/\.md$/i, '') })
    } else if (rel.split('/').length === 2 && isIndexPath(rel)) {
      // A direct subfolder, addressed by its index — the folder IS that note.
      const segment = rel.split('/')[0]
      children.push({ path: row.path, title: declared || humanizeFolderName(segment) })
    }
  }
  return children
}

/**
 * Refresh a folder's index so its managed child block matches the folder. Curated
 * prose and frontmatter are untouched (see applyChildrenBlock); the write is a
 * direct row update rather than writeNote, because index upkeep is machinery and
 * should not spawn a revision every time a note is added next door.
 *
 * The context root is only refreshed if its index already opted in by carrying a
 * block — the root index is a hand-written home page, not a listing.
 */
export async function refreshFolderIndex(context: Context, folder: string): Promise<void> {
  const idx = indexPathOf(folder)
  const row = await findLive(context, idx)
  if (!row) return
  if (!folder && !hasChildrenBlock(row.content)) return
  const next = applyChildrenBlock(row.content, await directChildrenOf(context, folder))
  if (next === row.content) return
  await prisma.contextNote.update({ where: { id: row.id }, data: { content: next } })
  invalidateVault(context)
}

/**
 * Refresh the indexes that list `notePath`: the folder it lives in, and — when
 * the note IS a folder's index — the parent folder that lists that folder.
 */
async function refreshIndexesForNote(context: Context, notePath: string): Promise<void> {
  const own = folderOf(notePath)
  await refreshFolderIndex(context, own)
  if (isIndexPath(notePath) && own) await refreshFolderIndex(context, folderOf(own))
}

/** The `SpaceNoteFolder` row that makes a folder exist in its own right. */
async function upsertFolderRow(context: Context, folder: string): Promise<void> {
  if (!folder) return
  await prisma.contextFolder.upsert({
    where: {
      folder_identity: { spaceId: context.spaceId, ownerKey: context.ownerKey, path: folder },
    },
    create: { spaceId: context.spaceId, ownerKey: context.ownerKey, path: folder },
    update: {},
  })
}

// Every folder carries an index.md. Ensure each ancestor folder of `path` has
// one, creating missing indexes as a stub listing the folder's current children.
// NEVER rewrites an existing index (they're often curated documents) — keeping
// one current is refreshFolderIndex's job.
// Rows are inserted directly (not via createNote) — no recursion, no revision.
// Returns the index paths created.
export async function ensureAncestorIndexes(
  context: Context,
  path: string,
  actor: Actor,
): Promise<string[]> {
  const created: string[] = []
  for (const folder of ancestorFolders(sanitizePath(path))) {
    const idx = indexPathOf(folder)
    if (await findLive(context, idx)) continue
    const children = await directChildrenOf(context, folder)
    try {
      await prisma.contextNote.create({
        data: {
          spaceId: context.spaceId,
          ownerKey: context.ownerKey,
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
  if (created.length) invalidateVault(context)
  return created
}

// The context root's own index.md — the one index nothing else creates.
// ensureAncestorIndexes can't: ancestorFolders('index.md') is [] by design (the
// root isn't a folder anyone can nest under), and refreshFolderIndex leaves a
// blockless root alone. So a context gets a root index only if something seeds it.
//
// It matters beyond tidiness: the Directory's Context tab routes to the root
// index — the space's home page (see app/(auth)/directory/page.tsx, which
// also writes one on first open for contexts that predate this seeding).
//
// Seeded via newIndexContent, whose empty managed child block is what makes the
// root opt in to auto-listing its folders from here on. Returns true when it
// created the index, false when one already existed.
export async function ensureRootIndex(
  context: Context,
  title: string,
  actor: Actor,
): Promise<boolean> {
  // createNote throws on an existing path, and a curated home page must never be
  // clobbered — so check first.
  if (await readNoteOrNull(context, INDEX_BASENAME)) return false
  try {
    await createNote(context, INDEX_BASENAME, newIndexContent({ title }), actor)
    return true
  } catch (e) {
    // Same race as ensureAncestorIndexes: the loser of a concurrent seed finds
    // the index already there, which is the outcome it wanted anyway.
    if ((e as { code?: string }).code !== 'P2002') throw e
    return false
  }
}

// Upsert a note's content and record a revision. Mirrors rpc.ts 'note:write':
// skip no-op saves, seed a baseline from the pre-edit content on the first edit,
// then record the new snapshot tagged with how it arose.
//
// Returns the note's path after the save. It differs from `path` only when the
// save retyped the note to `Index` and so turned it into a folder — callers that
// hold a path (the editor, the API) redirect to the returned one.
export async function writeNote(
  context: Context,
  path: string,
  content: string,
  actor: Actor,
  origin: NoteRevisionOrigin = 'edit',
  model?: string,
): Promise<string> {
  const p = sanitizePath(path)
  assertMarkdown(p)
  // Retyping a note to `Index` makes it a folder (below). Refuse the whole save
  // when it can't be one, rather than storing a note whose type contradicts
  // where it lives. Replica writes never restructure their target context.
  const converting = origin !== 'publish' && isIndexContent(content) && !isIndexPath(p)
  if (converting) {
    const denial = await indexConversionDenial(context, p)
    if (denial) throw new Error(denial)
  }
  // The reverse guard: a save at an index path keeps `type: Index` (and a
  // title) whatever the incoming frontmatter says — dropping the type would
  // silently turn the folder into a loose note.
  if (isIndexPath(p)) content = enforceIndexFrontmatter(content, folderOfIndexPath(p))
  const existing = await findLive(context, p)
  const prev = existing?.content ?? null

  // An index that carried the managed child block keeps it: a raw write that
  // drops the markers would end the auto-listing (the root index opts in by
  // carrying one). Re-seed it empty; refreshIndexesForNote below refills it.
  if (isIndexPath(p) && prev !== null && hasChildrenBlock(prev) && !hasChildrenBlock(content)) {
    content = applyChildrenBlock(content, [])
  }

  const note = existing
    ? await prisma.contextNote.update({
        where: { id: existing.id },
        data: { content, starred: isStarred(content) },
      })
    : await prisma.contextNote.create({
        data: {
          spaceId: context.spaceId,
          ownerKey: context.ownerKey,
          path: p,
          content,
          starred: isStarred(content),
          createdBy: actor.id,
        },
      })

  // Entity notes drive directory links: re-derive this note's 'mentioned' edges
  // from its [[mentions]]. Best-effort (no-op for personal contexts / non-entity
  // paths); runs even on no-op saves so a missed sync self-heals on next save.
  await syncContextLinks(context, p, content)

  // Refresh this note's published replicas in other contexts. Origin 'publish'
  // IS a replica write — skipping it is what stops replication cascades and
  // publish cycles dead. Best-effort like the link sync; self-heals on no-op
  // saves the same way.
  if (origin !== 'publish') await syncPublicationsOnWrite(context, p, content, actor)

  // Upsert-created notes (e.g. an entity note's first save) get folder indexes too.
  if (existing === null) await ensureAncestorIndexes(context, p, actor)
  await refreshIndexesForNote(context, p)

  // Even a no-op save bumped updatedAt above, so the memo's stamp is stale.
  invalidateVault(context)

  // The type is what makes a note an index, so the path follows it.
  const finalPath = converting ? await convertNoteToIndex(context, p, actor) : p

  if (prev === content) return finalPath // nothing changed — don't spawn a revision

  // Seed a baseline of the pre-edit content the first time a note is edited, so
  // the oldest revision has a snapshot to diff/restore from.
  if (prev !== null) {
    const count = await prisma.contextNoteRevision.count({ where: { noteId: note.id } })
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
  return finalPath
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
  const last = await prisma.contextNoteRevision.findFirst({
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
    await prisma.contextNoteRevision.update({
      where: { id: last.id },
      data: {
        content: rev.content,
        at: new Date(at),
        editorEmail: rev.editorEmail ?? null,
        model: rev.model ?? null,
      },
    })
  } else {
    await prisma.contextNoteRevision.create({
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

  const count = await prisma.contextNoteRevision.count({ where: { noteId } })
  if (count > MAX_REVISIONS) {
    const stale = await prisma.contextNoteRevision.findMany({
      where: { noteId },
      orderBy: { at: 'asc' },
      take: count - MAX_REVISIONS,
      select: { id: true },
    })
    await prisma.contextNoteRevision.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } })
  }
}

export async function renameNote(context: Context, from: string, to: string): Promise<string> {
  const f = sanitizePath(from)
  const t = sanitizePath(to)
  assertMarkdown(t)
  const row = await findLive(context, f)
  if (!row) throw new Error(`Note not found: ${from}`)
  if (t !== f && (await findLive(context, t))) throw new Error(`A note already exists at: ${to}`)
  await prisma.contextNote.update({ where: { id: row.id }, data: { path: t } })
  // A rename changes which entity (if any) the note is canonical for: drop the
  // old path's context links, derive the new path's. Publications and any
  // note-level grants follow the note to its new path.
  if (t !== f) {
    await syncContextLinksBulk(context, [f], [[t, row.content]])
    await syncPublicationsOnRename(context, f, t)
    if (context.ownerKey === SHARED_OWNER_KEY) {
      await prisma.contextGrant.updateMany({
        where: { spaceId: context.spaceId, resourcePath: f },
        data: { resourcePath: t },
      })
    }
    // Both ends list the note: the folder it left and the folder it landed in.
    await refreshIndexesForNote(context, f)
    await refreshIndexesForNote(context, t)
  }
  invalidateVault(context)
  return t // revisions stay attached by noteId
}

// trash (soft-delete)

export async function deleteNote(context: Context, path: string): Promise<void> {
  const row = await findLive(context, sanitizePath(path))
  if (!row) return
  await prisma.contextNote.update({
    where: { id: row.id },
    data: { deletedAt: new Date(), deletedPath: row.path, path: `:trash:${row.id}` },
  })
  await syncContextLinks(context, row.path, null) // trashed note owns no context links
  // Trashing either end of a publication deactivates it (replica stays a copy).
  await syncPublicationsOnDelete(context, [row.path])
  await refreshIndexesForNote(context, row.path)
  invalidateVault(context)
}

// Trashed notes are kept for TRASH_RETENTION_DAYS and then purged for good.
// There is no cron behind this: the trash is only ever observed through
// listTrash, so expiring on read is enough to make the promise true everywhere
// it's visible.
async function purgeExpiredTrash(context: Context): Promise<void> {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const { count } = await prisma.contextNote.deleteMany({
    where: {
      spaceId: context.spaceId,
      ownerKey: context.ownerKey,
      deletedAt: { not: null, lt: cutoff },
    },
  })
  if (count > 0) invalidateVault(context)
}

export async function listTrash(context: Context): Promise<TrashEntry[]> {
  await purgeExpiredTrash(context)
  const rows = await prisma.contextNote.findMany({
    where: { spaceId: context.spaceId, ownerKey: context.ownerKey, deletedAt: { not: null } },
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
export async function restoreTrash(context: Context, id: string): Promise<string> {
  const row = await prisma.contextNote.findFirst({
    where: { id, spaceId: context.spaceId, ownerKey: context.ownerKey, deletedAt: { not: null } },
  })
  if (!row || !row.deletedPath) throw new Error('Trash entry not found')
  let dest = row.deletedPath
  let n = 1
  while (await findLive(context, dest)) {
    dest = row.deletedPath.replace(/\.md$/i, '') + `-${n++}.md`
  }
  await prisma.contextNote.update({
    where: { id: row.id },
    data: { deletedAt: null, deletedPath: null, path: dest },
  })
  await syncContextLinks(context, dest, row.content) // restored entity note re-owns its links
  await refreshIndexesForNote(context, dest)
  invalidateVault(context)
  return dest
}

// Force-delete a single trash entry ahead of its 7 days. Irreversible.
export async function purgeTrashEntry(context: Context, id: string): Promise<void> {
  const { count } = await prisma.contextNote.deleteMany({
    where: { id, spaceId: context.spaceId, ownerKey: context.ownerKey, deletedAt: { not: null } },
  })
  if (count === 0) throw new Error('Trash entry not found')
  invalidateVault(context)
}

export async function emptyTrash(context: Context): Promise<void> {
  await prisma.contextNote.deleteMany({
    where: { spaceId: context.spaceId, ownerKey: context.ownerKey, deletedAt: { not: null } },
  })
  invalidateVault(context)
}

// folders

export async function createFolder(context: Context, path: string, actor?: Actor): Promise<void> {
  const p = sanitizePath(path)
  await upsertFolderRow(context, p)
  // The synthetic index path makes ancestorFolders cover this folder AND its parents.
  if (actor) {
    await ensureAncestorIndexes(context, indexPathOf(p), actor)
    await refreshFolderIndex(context, folderOf(p))
  }
  invalidateVault(context)
}

/**
 * Create a folder from an index note somebody wrote — the "Index" create tile.
 * The note IS the folder: `content` (its title, tags and starting prose) becomes
 * `<path>/index.md`, and the parent folder's index picks it up. Returns the
 * index path so the caller can open it.
 */
export async function createIndexFolder(
  context: Context,
  path: string,
  content: string,
  actor: Actor,
): Promise<string> {
  const p = sanitizePath(path)
  if (p.toLowerCase().endsWith('.md')) throw new Error(`A folder path is not a file: ${path}`)
  const idx = indexPathOf(p)
  if (await findLive(context, idx)) throw new Error(`A folder already exists at: ${p}`)
  await upsertFolderRow(context, p)
  // createNote does the rest of the invariant: ancestor indexes, the folder rows
  // above it, and the parent index that now lists this folder.
  await createNote(context, idx, content, actor)
  return idx
}

/**
 * Why this note can't become a folder, or null if it can. Checked BEFORE a save
 * is applied so a note that can't convert is refused whole, rather than saved
 * and then stranded at a path that contradicts its own type.
 */
async function indexConversionDenial(context: Context, path: string): Promise<string | null> {
  const p = sanitizePath(path)
  if (isIndexPath(p)) return null
  // A canonical entity note is a directory record — a person, a company, a
  // connector. Those aren't containers, and moving one off its
  // `<namespace>/<slug>.md` path would orphan the node that points at it.
  if (parseEntityHref(p)) {
    return `"${p}" is a directory record, not a folder — it can't be an index`
  }
  const folder = indexFolderPathOf(p)
  if (await findLive(context, indexPathOf(folder))) {
    return `"${folder}" is already a folder — rename this note before making it an index`
  }
  return null
}

/**
 * Turn a plain note into the folder it declared itself to be: `a/b.md` retyped
 * to `Index` becomes `a/b/index.md`, and `a/b` becomes a real folder. The note
 * keeps its id (so its history survives) and its links, publications and grants
 * follow the path exactly as a rename moves them.
 *
 * Throws if `a/b` already exists as a folder — two folders can't share a path,
 * and silently merging one into the other would be a surprising way to lose a note.
 */
async function convertNoteToIndex(
  context: Context,
  path: string,
  actor: Actor,
): Promise<string> {
  const f = sanitizePath(path)
  if (isIndexPath(f)) return f
  const denial = await indexConversionDenial(context, f)
  if (denial) throw new Error(denial)
  const row = await findLive(context, f)
  if (!row) throw new Error(`Note not found: ${path}`)
  const folder = indexFolderPathOf(f)
  const dest = indexPathOf(folder)

  await prisma.contextNote.update({ where: { id: row.id }, data: { path: dest } })
  await syncContextLinksBulk(context, [f], [[dest, row.content]])
  await syncPublicationsOnRename(context, f, dest)
  if (context.ownerKey === SHARED_OWNER_KEY) {
    await prisma.contextGrant.updateMany({
      where: { spaceId: context.spaceId, resourcePath: f },
      data: { resourcePath: folder },
    })
  }
  await upsertFolderRow(context, folder)
  // Notes may already sit under `a/b/` (an index arriving late for a folder that
  // grew from note paths) — the new index lists them, and the parent lists it.
  await refreshFolderIndex(context, folder)
  await refreshFolderIndex(context, folderOf(folder))
  await ensureAncestorIndexes(context, dest, actor)
  invalidateVault(context)
  return dest
}

// Rename/move a folder and everything under it (notes + nested folder rows).
export async function renameFolder(
  context: Context,
  from: string,
  to: string,
  actor?: Actor,
): Promise<string> {
  const f = sanitizePath(from)
  const t = sanitizePath(to)
  const notes = await prisma.contextNote.findMany({
    where: {
      spaceId: context.spaceId,
      ownerKey: context.ownerKey,
      deletedAt: null,
      path: { startsWith: `${f}/` },
    },
    select: { id: true, path: true, content: true },
  })
  for (const note of notes) {
    await prisma.contextNote.update({
      where: { id: note.id },
      data: { path: t + note.path.slice(f.length) },
    })
  }
  // Moving into/out of the people|companies namespaces changes which notes are
  // canonical entity notes — resync both sides (no-op when neither is involved).
  await syncContextLinksBulk(
    context,
    notes.map((n) => n.path),
    notes.map((n) => [t + n.path.slice(f.length), n.content]),
  )
  // Publications follow every moved note (independent rows — overlap the round-trips).
  await Promise.all(
    notes.map((note) => syncPublicationsOnRename(context, note.path, t + note.path.slice(f.length))),
  )
  // Grants ride the rename too — a moved team subtree keeps its access rows.
  if (context.ownerKey === SHARED_OWNER_KEY) {
    await prisma.contextGrant.updateMany({
      where: { spaceId: context.spaceId, resourcePath: f },
      data: { resourcePath: t },
    })
    const nested = await prisma.contextGrant.findMany({
      where: { spaceId: context.spaceId, resourcePath: { startsWith: `${f}/` } },
      select: { id: true, resourcePath: true },
    })
    await Promise.all(
      nested.map((grant) =>
        prisma.contextGrant.update({
          where: { id: grant.id },
          data: { resourcePath: t + grant.resourcePath.slice(f.length) },
        }),
      ),
    )
  }
  const folders = await prisma.contextFolder.findMany({
    where: {
      spaceId: context.spaceId,
      ownerKey: context.ownerKey,
      OR: [{ path: f }, { path: { startsWith: `${f}/` } }],
    },
    select: { id: true, path: true },
  })
  for (const fol of folders) {
    await prisma.contextFolder.update({
      where: { id: fol.id },
      data: { path: fol.path === f ? t : t + fol.path.slice(f.length) },
    })
  }
  // The index note's title is the folder's display name, so a path rename has to
  // decide what happens to it: follow the new path while nobody has named the
  // folder themselves, and keep out of the way once somebody has (see
  // nextIndexTitle). Renaming the display name is editing that title.
  if (actor) await retitleIndexAfterRename(context, f, t, actor)
  // The folder is an entry in its old and new parents' indexes — both move.
  await refreshFolderIndex(context, folderOf(f))
  await refreshFolderIndex(context, folderOf(t))
  invalidateVault(context)
  return t
}

async function retitleIndexAfterRename(
  context: Context,
  from: string,
  to: string,
  actor: Actor,
): Promise<void> {
  const indexPath = indexPathOf(to)
  const row = await findLive(context, indexPath)
  if (!row) return
  const { body } = splitFrontmatter(row.content)
  const frontmatter = parseFrontmatter(row.content)
  const current = typeof frontmatter.title === 'string' ? frontmatter.title : null
  const title = nextIndexTitle(from.split('/').pop() ?? from, to.split('/').pop() ?? to, current)
  if (!title || title === current) return
  // Everything else in the frontmatter (type, tags, description) rides through.
  await writeNote(context, indexPath, joinFrontmatter({ ...frontmatter, title }, body), actor)
}

// Soft-delete a folder: trash every note under it and drop the folder rows.
export async function deleteFolder(context: Context, path: string): Promise<void> {
  const p = sanitizePath(path)
  const notes = await prisma.contextNote.findMany({
    where: {
      spaceId: context.spaceId,
      ownerKey: context.ownerKey,
      deletedAt: null,
      path: { startsWith: `${p}/` },
    },
    select: { id: true, path: true },
  })
  for (const note of notes) {
    await prisma.contextNote.update({
      where: { id: note.id },
      data: { deletedAt: new Date(), deletedPath: note.path, path: `:trash:${note.id}` },
    })
  }
  await syncContextLinksBulk(context, notes.map((n) => n.path)) // trashed entity notes drop their links
  await syncPublicationsOnDelete(context, notes.map((n) => n.path))
  await prisma.contextFolder.deleteMany({
    where: {
      spaceId: context.spaceId,
      ownerKey: context.ownerKey,
      OR: [{ path: p }, { path: { startsWith: `${p}/` } }],
    },
  })
  // Grants into a deleted subtree go with it — a future folder reusing the
  // name must not inherit a dead folder's access.
  if (context.ownerKey === SHARED_OWNER_KEY) {
    await prisma.contextGrant.deleteMany({
      where: {
        spaceId: context.spaceId,
        OR: [{ resourcePath: p }, { resourcePath: { startsWith: `${p}/` } }],
      },
    })
  }
  // The folder was an entry in its parent's index; it isn't any more.
  await refreshFolderIndex(context, folderOf(p))
  invalidateVault(context)
}

// revision history

export async function listRevisions(context: Context, path: string): Promise<NoteRevision[]> {
  const row = await findLive(context, sanitizePath(path))
  if (!row) return []
  const revs = await prisma.contextNoteRevision.findMany({
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
  context: Context,
  path: string,
  revisionId: string,
  actor: Actor,
): Promise<void> {
  const row = await findLive(context, sanitizePath(path))
  if (!row) throw new Error(`Note not found: ${path}`)
  const rev = await prisma.contextNoteRevision.findFirst({
    where: { id: revisionId, noteId: row.id },
  })
  if (!rev) throw new Error('Revision not found')
  await writeNote(context, row.path, rev.content, actor, 'restore')
}

// Star / unstar a note (sidebar Starred section + editor toolbar star). The
// frontmatter `starred:` flag is the source of truth; rewrite it through
// writeNote so the synced column, revisions and link sync all stay consistent
// with a toggle made from the editor.
//
// Index notes are folders, and folders aren't starrable — the Starred section is
// a shortcut list of notes, not a second folder tree. Rejected here so every
// caller (API, MCP, scripts) is covered, not just the UI that hides the control.
export async function setStarred(
  context: Context,
  path: string,
  starred: boolean,
  actor: Actor,
): Promise<void> {
  const clean = sanitizePath(path)
  if (isIndexPath(clean)) throw new Error('Index notes cannot be starred')
  const row = await findLive(context, clean)
  if (!row) throw new Error(`Note not found: ${path}`)
  const { frontmatter, body } = splitFrontmatter(row.content)
  const lines = (frontmatter ?? '')
    .split('\n')
    .filter((l) => l.trim() && !/^starred\s*:/i.test(l.trim()))
  if (starred) lines.push('starred: true')
  const content = lines.length ? `---\n${lines.join('\n')}\n---\n\n${body}` : body
  await writeNote(context, row.path, content, actor)
}

export async function listStarred(context: Context): Promise<string[]> {
  const rows = await prisma.contextNote.findMany({
    where: { spaceId: context.spaceId, ownerKey: context.ownerKey, deletedAt: null, starred: true },
    select: { path: true },
  })
  // Index notes can no longer be starred; filter any that were starred before
  // that rule existed so they don't linger in the Starred section.
  return rows.map((r) => r.path).filter((p) => !isIndexPath(p))
}
