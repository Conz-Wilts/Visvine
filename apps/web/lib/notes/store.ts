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
import type { Prisma } from '@prisma/client'
import type {
  RawNote,
  NoteRevision,
  NoteRevisionOrigin,
  TrashEntry,
} from './shared/types'
import { TRASH_RETENTION_DAYS } from './shared/types'
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from './shared/markdown'
import { ensureToolNode, syncContextLinksBulk } from './entityLinks'
import { agentNoteDeleted, agentNoteRenamed } from '@/lib/agents/hooks'
import { toolNoteDeleted, toolNoteRenamed } from '@/lib/tools/hooks'
// The write path's outbox. Every mutator below enqueues the rebuild its write
// owes IN THE SAME TRANSACTION as the write, then settles it inline — see
// lib/notes/projections.ts for why the fan-out moved there and what it buys.
import {
  enqueueProjection,
  settleBatch,
  settleProjection,
  type ProjectionInput,
} from './projections'
import {
  entityFlatPath,
  entityIndexPathOf,
  entityOwnerPathOf,
  entityStub,
  entityTypeLabelOf,
  isEntityFolderIndex,
  namespaceFolderDenial,
  parseEntityHref,
  type EntityNodeLike,
} from './entities'
import { revalidateTag } from 'next/cache'
// Import cycles with vaultCache (it reads via listRaw) and publications (it
// writes replicas via writeNote; we call its hooks) are benign: both sides
// only call each other inside function bodies, never at module init.
import { invalidateVault } from './vaultCache'
import { syncPublicationsOnDelete, syncPublicationsOnRename } from './publications'
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

/**
 * A Prisma client or an interactive-transaction client. The revision ledger is
 * written through this so it can ride the note's own transaction.
 */
type Db = Prisma.TransactionClient | typeof prisma

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
function findLive(context: Context, path: string, db: Db = prisma) {
  return db.contextNote.findFirst({
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

/** The revision-style origin/model stamps a create or rename carries into the agent hook. */
export interface WriteStamp {
  origin?: NoteRevisionOrigin
  model?: string
}

// Create a note, refusing to overwrite an existing one. Records no revision —
// the first revision (baseline + edit) is seeded on the first save, matching the
// source app where note:create is separate from note:write.
export async function createNote(
  context: Context,
  path: string,
  content: string,
  actor: Actor,
  /**
   * How the create arose, for the agent hook only (a create records no
   * revision): an agent run's own creates are stamped `agent` / `agent:<name>`
   * so they never wake that agent (lib/agents/hooks).
   */
  stamp?: WriteStamp,
): Promise<RawNote> {
  const p = await canonicalEntityWritePath(context, path)
  assertMarkdown(p)
  // A create addressed straight at an entity's folder index (people/<slug>/index.md)
  // is that entity becoming a folder, not a loose note at an index path — it needs
  // the node pointer and the entity contract, which only ensureEntityFolder sets.
  if (isEntityFolderIndex(p) && !(await findLive(context, p))) {
    const node = await nodeForEntityPath(context.spaceId, p)
    if (node) {
      const flat = entityFlatPath(node)
      // The flat note is the SAME note — converting it would discard `content`.
      // Say so, rather than silently choosing one of the two bodies.
      if (flat && (await findLive(context, flat))) {
        throw new Error(`A note already exists at: ${flat} — write a note under ${folderOfIndexPath(p)}/ to make it a folder`)
      }
      // The folder is built by helpers that own their own writes, so there is
      // no note transaction here for the job to ride. The job is therefore
      // enqueued BEFORE the build rather than after it, which is the safe half
      // of the choice: a crash mid-build leaves a job for a path that holds no
      // note, and applyProjections treats exactly that as a no-op ("convergent
      // staleness" — the mutation that owns the path is authoritative for it).
      // Enqueueing afterwards left the opposite and worse case, a built folder
      // with no record that its projections were ever owed.
      const projection: ProjectionInput = {
        context,
        path: p,
        kind: 'write',
        origin: stamp?.origin ?? 'edit',
        actor,
        model: stamp?.model,
        changed: true,
      }
      const jobId = await enqueueProjection(prisma, projection)
      await ensureEntityFolder(context, node, actor, content)
      const row = await findLive(context, p)
      if (!row) throw new Error(`Note not found: ${p}`)
      await settleProjection(jobId, projection)
      return toRaw(row)
    }
  }
  // A note landing under `a/b/` makes `a/b` a folder: if `a/b.md` is a live
  // note it becomes `a/b/index.md`, so the note you were reading is now the
  // folder's home page. Under an entity namespace that conversion is the
  // entity's (people/<slug>.md → people/<slug>/index.md), and the create is
  // refused when no such entity exists — sub-notes need a node to belong to.
  await ensureParentFolderNote(context, p, actor)
  // A note AT an index path IS a folder whatever its frontmatter says, so the
  // contract (a title, and the entity's type and node: when the folder is an
  // entity's) is enforced rather than trusted.
  if (isIndexPath(p)) content = await enforceIndexContract(context, p, content)
  if (await findLive(context, p)) throw new Error(`A note already exists at: ${p}`)
  const projection: ProjectionInput = {
    context,
    path: p,
    kind: 'write',
    origin: stamp?.origin ?? 'edit',
    actor,
    model: stamp?.model,
    changed: true,
  }
  const { row, jobId } = await prisma.$transaction(async (tx) => {
    const row = await tx.contextNote.create({
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
    // An index note IS a folder, so its ContextFolder row is STRUCTURAL and
    // commits with the note. Outside the transaction, a crash here left an
    // index note whose folder did not exist — and no projection would ever
    // notice, because a folder row is not derived from anything.
    if (isIndexPath(p)) await upsertFolderRow(tx, context, folderOf(p))
    return { row, jobId: await enqueueProjection(tx, projection) }
  })
  await settleProjection(jobId, projection)
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
export async function refreshIndexesForNote(context: Context, notePath: string): Promise<void> {
  const own = folderOf(notePath)
  await refreshFolderIndex(context, own)
  if (isIndexPath(notePath) && own) await refreshFolderIndex(context, folderOf(own))
}

/**
 * A note-level restriction/lock is a `context_folders` row keyed by the NOTE's
 * path (SharePanel's "make this note private"). When the note moves — a rename,
 * or the flat entity note folding into `people/<slug>/index.md` — the flags must
 * ride along or the note silently reopens at its new path. Grants are moved by
 * the callers; this moves the boundary flags, OR-ing them onto any row already
 * at the destination (a folder row may pre-exist) and dropping the stale row.
 */
async function moveFolderFlags(
  db: Db,
  context: Context,
  from: string,
  to: string,
): Promise<void> {
  if (!from || !to || from === to) return
  const where = { spaceId: context.spaceId, ownerKey: context.ownerKey }
  const row = await db.contextFolder.findUnique({
    where: { folder_identity: { ...where, path: from } },
    select: { restricted: true, locked: true },
  })
  if (!row) return
  if (row.restricted || row.locked) {
    const flags = {
      ...(row.restricted ? { restricted: true } : {}),
      ...(row.locked ? { locked: true } : {}),
    }
    await db.contextFolder.upsert({
      where: { folder_identity: { ...where, path: to } },
      create: { ...where, path: to, ...flags },
      update: flags,
    })
  }
  await db.contextFolder.deleteMany({ where: { ...where, path: from } })
}

/**
 * The `SpaceNoteFolder` row that makes a folder exist in its own right.
 *
 * Takes the client because this is STRUCTURAL, not derived: an index note IS a
 * folder, so the row has to land with the note or the folder exists in one tier
 * and not the other, and nothing on the outbox would ever notice. §6 puts
 * structural work inline with the write; being inline is only half of it — it
 * also has to be in the same transaction.
 */
async function upsertFolderRow(db: Db, context: Context, folder: string): Promise<void> {
  if (!folder) return
  await db.contextFolder.upsert({
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
// note has since become its own folder and the save was redirected to the
// folder's index — callers that hold a path (the editor, the API) follow the
// returned one.
export async function writeNote(
  context: Context,
  path: string,
  content: string,
  actor: Actor,
  origin: NoteRevisionOrigin = 'edit',
  model?: string,
): Promise<string> {
  const p = await canonicalEntityWritePath(context, path)
  assertMarkdown(p)
  const existing = await findLive(context, p)
  // An upsert-create under `a/b/` makes `a/b` a folder first, exactly as
  // createNote does. Replica writes never restructure their target context.
  if (!existing && origin !== 'publish') await ensureParentFolderNote(context, p, actor)
  // A save at an index path is a save to a FOLDER's home page: the contract
  // (a title — the folder's display name — plus the entity's type and `node:`
  // when the folder is an entity's) is enforced whatever the incoming
  // frontmatter says.
  if (isIndexPath(p)) content = await enforceIndexContract(context, p, content)
  const prev = existing?.content ?? null

  // An index that carried the managed child block keeps it: a raw write that
  // drops the markers would end the auto-listing (the root index opts in by
  // carrying one). Re-seed it empty; refreshIndexesForNote below refills it.
  if (isIndexPath(p) && prev !== null && hasChildrenBlock(prev) && !hasChildrenBlock(content)) {
    content = applyChildrenBlock(content, [])
  }

  // The note row and the record that its projections are owed commit together.
  // Before the outbox these were the same statement plus six bare awaits, so a
  // crash between them left a stored declaration with stale derived state and
  // nothing anywhere saying so. See lib/notes/projections.ts.
  const jobId = await prisma.$transaction(async (tx) => {
    const note = existing
      ? await tx.contextNote.update({
          where: { id: existing.id },
          data: { content, starred: isStarred(content) },
        })
      : await tx.contextNote.create({
          data: {
            spaceId: context.spaceId,
            ownerKey: context.ownerKey,
            path: p,
            content,
            starred: isStarred(content),
            createdBy: actor.id,
          },
        })
    const jobId = await enqueueProjection(tx, {
      context,
      path: p,
      kind: 'write',
      origin,
      actor,
      model,
      changed: prev !== content,
    })
    // The revision ledger rides the same transaction. It is the ONLY thing on
    // this path that a replay cannot rebuild (§1: a ledger, not a projection),
    // so it is the last thing that should have been left outside — the content
    // committing without its history is an unrecoverable loss, where a missed
    // projection is merely owed. A no-op save records nothing, as before.
    if (prev !== content) {
      // Seed a baseline of the pre-edit content the first time a note is
      // edited, so the oldest revision has a snapshot to diff/restore from.
      if (prev !== null) {
        const count = await tx.contextNoteRevision.count({ where: { noteId: note.id } })
        if (count === 0) {
          await recordRevision(
            tx,
            note.id,
            { content: prev, editor: 'Unknown', origin: 'baseline' },
            Date.now() - 1,
          )
        }
      }
      await recordRevision(tx, note.id, {
        content,
        editor: actor.name,
        editorEmail: actor.email ?? undefined,
        origin,
        model,
      })
    }
    return jobId
  })

  // Rebuild what this write derives — directory links, agent state, the Tool
  // build, space-config columns, published replicas, folder indexes. Runs inline
  // so the author still sees a compile error on save; the difference the outbox
  // makes is that a failure is now recorded and retried rather than swallowed.
  await settleProjection(jobId, {
    context,
    path: p,
    kind: 'write',
    origin,
    actor,
    model,
    changed: prev !== content,
  })

  // Even a no-op save bumped updatedAt above, so the memo's stamp is stale.
  invalidateVault(context)

  return p
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
//
// Takes the client rather than reaching for `prisma`, because this runs INSIDE
// the note's own transaction. `ContextNoteRevision` is a LEDGER by
// docs/data-architecture.md §1 — "dropping a ledger loses history permanently" —
// so it is the one table on this path that a retry cannot reconstruct. It used
// to be appended after the commit, which meant a crash in between stored the new
// content and lost the record of who changed it, forever. The outbox protected
// the six replayable projections and left the unreplayable ledger bare; this
// closes that inversion by making the note and its history commit together.
async function recordRevision(
  db: Db,
  noteId: string,
  rev: RevisionInput,
  at = Date.now(),
): Promise<void> {
  const last = await db.contextNoteRevision.findFirst({
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
    await db.contextNoteRevision.update({
      where: { id: last.id },
      data: {
        content: rev.content,
        at: new Date(at),
        editorEmail: rev.editorEmail ?? null,
        model: rev.model ?? null,
      },
    })
  } else {
    await db.contextNoteRevision.create({
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

  // Prune in ONE statement rather than count → findMany → deleteMany. This runs
  // inside the note's transaction now, on the autosave hot path, so three round
  // trips per save is three too many — and doing the trim in a single statement
  // also means it cannot see a different set than it deletes.
  await db.$executeRaw`
    DELETE FROM context_note_revisions
    WHERE id IN (
      SELECT id FROM context_note_revisions
      WHERE note_id = ${noteId}
      ORDER BY at DESC, id DESC
      OFFSET ${MAX_REVISIONS}
    )`
}

export async function renameNote(
  context: Context,
  from: string,
  to: string,
  actor?: Actor,
  /** How the rename arose (agent hook only): an agent's own moves never wake it. */
  stamp?: WriteStamp,
): Promise<string> {
  const f = sanitizePath(from)
  const t = sanitizePath(to)
  assertMarkdown(t)
  const row = await findLive(context, f)
  if (!row) throw new Error(`Note not found: ${from}`)
  if (t !== f && (await findLive(context, t))) throw new Error(`A note already exists at: ${to}`)
  // Landing inside an entity's folder converts the entity note first (or is
  // refused when no such entity exists). Callers without an actor (system
  // moves) can't convert, so a sub-note destination needs the folder to exist.
  if (t !== f) {
    if (actor) await ensureParentFolderNote(context, t, actor, f)
    else if (entityOwnerPathOf(t) && !(await findLive(context, indexPathOf(entityOwnerPathOf(t)!)))) {
      throw new Error(`"${entityOwnerPathOf(t)}" is not a folder yet — open the entity and add a note first`)
    }
  }
  const mover: Actor = actor ?? { id: 'system', name: 'System', email: null }
  const projection: ProjectionInput =
    { context, path: t, kind: 'rename', fromPath: f, origin: stamp?.origin ?? 'edit', actor: mover, model: stamp?.model }
  const jobId = await prisma.$transaction(async (tx) => {
    await tx.contextNote.update({ where: { id: row.id }, data: { path: t } })
    return t === f ? null : await enqueueProjection(tx, projection)
  })

  // A rename changes which entity (if any) the note is canonical for: the old
  // path's context links are dropped and the new path's derived. That, the
  // publication follow and both folder indexes are projections and live on the
  // job. Grants and boundary flags do NOT: they are the structural half of the
  // move, must apply exactly once, and so stay here with the path update.
  if (t !== f) {
    if (context.ownerKey === SHARED_OWNER_KEY) {
      await prisma.contextGrant.updateMany({
        where: { spaceId: context.spaceId, resourcePath: f },
        data: { resourcePath: t },
      })
    }
    await moveFolderFlags(prisma, context, f, t)
    if (jobId) await settleProjection(jobId, projection)
  }
  invalidateVault(context)
  return t // revisions stay attached by noteId
}

// trash (soft-delete)

export async function deleteNote(context: Context, path: string): Promise<void> {
  const row = await findLive(context, sanitizePath(path))
  if (!row) return
  const projection: ProjectionInput = {
    context,
    path: row.path,
    kind: 'delete',
    origin: 'edit',
    actor: { id: 'system', name: 'System', email: null },
  }
  const jobId = await prisma.$transaction(async (tx) => {
    await tx.contextNote.update({
      where: { id: row.id },
      data: { deletedAt: new Date(), deletedPath: row.path, path: `:trash:${row.id}` },
    })
    return enqueueProjection(tx, projection)
  })
  // Drops the note's context links, deactivates its publications, relists the
  // folder that held it, and tells the agent/Tool hooks it is gone.
  await settleProjection(jobId, projection)
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
    // `content` rides along for the TITLE. A note's display name lives in its
    // frontmatter, not in any column, so the live tree gets it by parsing the
    // note (buildNoteIndex). Trash used to skip that and show the FILENAME,
    // which is why a note called "Q3 board pack" appeared in the trash as
    // "q3-board-pack.md" — the same note under a different name, exactly when
    // you are trying to identify it well enough to restore or purge it.
    select: { id: true, deletedPath: true, deletedAt: true, content: true },
  })
  return rows.map((r) => {
    const path = r.deletedPath ?? ''
    return {
      id: r.id,
      name: baseName(r.deletedPath ?? r.id),
      title: trashTitleOf(r.content, path) || baseName(r.deletedPath ?? r.id),
      path,
      deletedAt: r.deletedAt ? r.deletedAt.getTime() : 0,
    }
  })
}

/** A trashed note's display name: its frontmatter title, else its filename
 *  without the extension — the same precedence buildNoteIndex uses for a live
 *  note, so a note keeps its name across the delete. */
function trashTitleOf(content: string, path: string): string {
  const fm = parseFrontmatter(content).title
  if (typeof fm === 'string' && fm.trim()) return fm.trim()
  return baseName(path).replace(/\.md$/i, '')
}

/**
 * One trashed note, for the read-only preview behind a trash row. Soft-delete
 * keeps the content, so this is a plain read of a row the live lookups skip
 * (findLive filters `deletedAt: null`).
 *
 * No authorization of its own — the route resolves the entry through listTrash
 * and applies the same `canReadPath` lens the listing does, so an entry the
 * caller cannot see 404s exactly like an unknown id.
 */
export async function readTrashedNote(
  context: Context,
  id: string,
): Promise<{ path: string; title: string; content: string; deletedAt: number } | null> {
  const row = await prisma.contextNote.findFirst({
    where: { id, spaceId: context.spaceId, ownerKey: context.ownerKey, deletedAt: { not: null } },
    select: { deletedPath: true, deletedAt: true, content: true },
  })
  if (!row) return null
  const path = row.deletedPath ?? ''
  return {
    path,
    title: trashTitleOf(row.content, path) || baseName(path),
    content: row.content,
    deletedAt: row.deletedAt ? row.deletedAt.getTime() : 0,
  }
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
  // A restore is a write as far as everything downstream is concerned: the note
  // re-owns its context links, relists in its folder, and — this is what the old
  // two-hook version missed — a restored agent brief or Tool source rebuilds its
  // state instead of coming back as a note nothing is watching.
  const projection: ProjectionInput = {
    context,
    path: dest,
    kind: 'write',
    origin: 'restore',
    actor: { id: row.createdBy, name: 'System', email: null },
    changed: true,
  }
  const jobId = await prisma.$transaction(async (tx) => {
    await tx.contextNote.update({
      where: { id: row.id },
      data: { deletedAt: null, deletedPath: null, path: dest },
    })
    return enqueueProjection(tx, projection)
  })
  await settleProjection(jobId, projection)
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
  await upsertFolderRow(prisma, context, p)
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
  await upsertFolderRow(prisma, context, p)
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
  // A canonical entity note becomes its OWN folder through ensureEntityFolder
  // instead (the node keeps pointing at it), so it never reaches here.
  if (parseEntityHref(p)) return null
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
  await moveFolderFlags(prisma, context, f, folder)
  await upsertFolderRow(prisma, context, folder)
  // Notes may already sit under `a/b/` (an index arriving late for a folder that
  // grew from note paths) — the new index lists them, and the parent lists it.
  await refreshFolderIndex(context, folder)
  await refreshFolderIndex(context, folderOf(folder))
  await ensureAncestorIndexes(context, dest, actor)
  invalidateVault(context)
  return dest
}

// entity folders
//
// A directory node's context is one note (people/<slug>.md) until it needs more
// than one; then that note becomes the folder people/<slug>/ — it moves to
// people/<slug>/index.md, keeps its entity type and `node:` (the path is what
// makes it an index), and the node records the new location as
// `metadata.notePath` so entityNotePath finds it. Every other note under the
// folder is a sub-note of that node. See lib/notes/entities.ts.

/**
 * The directory node whose entity note lives at `flatOrIndex` (either form),
 * or null. Ids aren't string-invertible from paths (legacy prefixes), so this
 * narrows by slug and confirms with entityFlatPath over the real rows.
 */
async function nodeForEntityPath(
  spaceId: string,
  flatOrIndex: string,
): Promise<(EntityNodeLike & { id: string; name: string | null }) | null> {
  const flat = isIndexPath(flatOrIndex)
    ? `${folderOfIndexPath(flatOrIndex)}.md`
    : flatOrIndex
  const slug = flat.replace(/\.md$/i, '').split('/').pop() ?? ''
  if (!slug) return null
  const rows = await prisma.node.findMany({
    where: { spaceId, OR: [{ id: { endsWith: `:${slug}` } }, { id: slug }] },
    select: { id: true, type: true, name: true, subtitle: true, metadata: true },
  })
  for (const row of rows) {
    const node = { ...row, metadata: (row.metadata as Record<string, unknown> | null) ?? null }
    if (entityFlatPath(node) === flat) return node
  }
  return null
}

/**
 * Make `node`'s context a folder — idempotent. Moves people/<slug>.md to
 * people/<slug>/index.md (row id, history, links, publications and grants all
 * follow, as convertNoteToIndex does for any note), seeds the index from the
 * entity stub when the node had no note yet, holds it to the entity-index
 * contract, and records the location on the node. Returns the index path.
 *
 * The node pointer is shared-context state (there is one node); a personal
 * context converting its own copy just moves the note.
 */
async function ensureEntityFolder(
  context: Context,
  node: EntityNodeLike,
  actor: Actor,
  /** Content for the index when the node has no note yet (default: the entity stub). */
  seed?: string,
): Promise<string> {
  const flat = entityFlatPath(node)
  const dest = entityIndexPathOf(node)
  if (!flat || !dest) throw new Error(`"${node.id}" is not a directory entity`)
  const folder = folderOfIndexPath(dest)
  const shared = context.ownerKey === SHARED_OWNER_KEY

  // THE STRUCTURAL HALF — all of it, or none of it.
  //
  // Turning an entity note into an entity FOLDER is six writes that only mean
  // something together: the note moves to the index path, its grants follow to
  // the folder, its restricted/locked flags follow, the folder row appears, the
  // index is held to the entity contract, and the node records where its note
  // now lives. None of that is derived from anything, so no projection would
  // ever rebuild it and the outbox cannot help — §6's line about structural work
  // staying inline was only half the requirement. It has to be ATOMIC.
  //
  // Outside a transaction, a crash after the path update left an entity whose
  // note had moved but whose grants still pointed at the old path (so a
  // restricted person's note silently became readable), or whose node pointer
  // still named a path with nothing at it. Both are states nothing detects and
  // nothing repairs.
  const moved = await prisma.$transaction(async (tx) => {
    let renamedFrom: string | null = null
    const live = await findLive(context, dest, tx)
    if (!live) {
      const row = await findLive(context, flat, tx)
      if (row) {
        await tx.contextNote.update({ where: { id: row.id }, data: { path: dest } })
        if (shared) {
          await tx.contextGrant.updateMany({
            where: { spaceId: context.spaceId, resourcePath: flat },
            data: { resourcePath: folder },
          })
        }
        await moveFolderFlags(tx, context, flat, folder)
        renamedFrom = flat
      } else {
        // No note yet (the profile renders a lazy stub until the first save) —
        // the folder still needs its index, and it IS the entity note.
        await tx.contextNote.create({
          data: {
            spaceId: context.spaceId,
            ownerKey: context.ownerKey,
            path: dest,
            content: seed ?? entityStub(node),
            starred: false,
            createdBy: actor.id,
          },
        })
      }
      await upsertFolderRow(tx, context, folder)
    }

    // Hold the (moved or pre-existing) index to the entity contract — a retype
    // to `Index` that triggered this conversion is put back to the entity type.
    const idx = await findLive(context, dest, tx)
    let content = idx?.content ?? ''
    if (idx) {
      const next = enforceIndexFrontmatter(idx.content, folder, entityContractOf(node))
      if (next !== idx.content) {
        await tx.contextNote.update({ where: { id: idx.id }, data: { content: next } })
        content = next
      }
    }

    // The node pointer is shared-context state (there is one node); a personal
    // context converting its own copy just moves the note.
    let pointerMoved = false
    if (shared && node.metadata?.notePath !== dest) {
      const current = await tx.node.findUnique({
        where: { id: node.id },
        select: { metadata: true },
      })
      const metadata = (current?.metadata as Record<string, unknown> | null) ?? {}
      await tx.node.update({
        where: { id: node.id },
        data: { metadata: { ...metadata, notePath: dest } as Prisma.InputJsonObject },
      })
      pointerMoved = true
    }

    return { renamedFrom, content, pointerMoved }
  })

  // THE DERIVED HALF — replayable, so it belongs outside. Link edges, published
  // replicas and folder indexes are all rebuildable from the notes as they now
  // stand; a failure here is a stale projection, which is what the outbox and
  // `pnpm db:projections:rebuild` exist to repair. Keeping them inside would
  // hold a transaction open across an esbuild and several cross-context writes.
  if (moved.renamedFrom) {
    await syncContextLinksBulk(context, [moved.renamedFrom], [[dest, moved.content]])
    await syncPublicationsOnRename(context, moved.renamedFrom, dest)
  }
  if (moved.pointerMoved) bustContextData()
  await refreshFolderIndex(context, folder)
  await refreshFolderIndex(context, folderOf(folder))
  await ensureAncestorIndexes(context, dest, actor)
  invalidateVault(context)
  return dest
}

function entityContractOf(node: EntityNodeLike): { typeLabel: string; nodeId: string; name: string } {
  return {
    typeLabel: entityTypeLabelOf(node.type) ?? 'Note',
    nodeId: node.id,
    name: (node.name ?? node.id.split(':').pop() ?? node.id).trim(),
  }
}

function bustContextData(): void {
  try {
    revalidateTag('context-data-v2', { expire: 0 })
  } catch {
    /* outside request scope */
  }
}

/**
 * A note is about to land at `path`. Make its parent folder real first.
 *
 * This is the ONE gesture that turns a note into a folder, and it is the one
 * people actually perform: a second note about Connor is written at
 * `people/connor/comms.md`, so `people/connor.md` becomes
 * `people/connor/index.md` — still Connor's note, now also the folder's home
 * page. No retype, no separate "convert" step, nothing to know in advance.
 *
 * Two cases, one rule:
 *
 * - Inside an entity namespace (`people/<slug>/…`) the conversion is the
 *   ENTITY's, so ensureEntityFolder owns it: the note keeps its type and
 *   `node:`, and the node records where it moved. A path under a namespace
 *   with no entity behind it is refused — sub-notes need a node to belong to.
 * - Anywhere else, `a/b.md` is an ordinary note and convertNoteToIndex moves it.
 *   If nothing lives at `a/b.md` there is nothing to convert: the folder and
 *   its stub index are created by the ancestor pass on the write itself.
 *
 * Only the note's IMMEDIATE parent is considered — deeper ancestors are folders
 * that already have (or will get) generated indexes, and a note two levels up is
 * not what the writer was extending.
 */
async function ensureParentFolderNote(
  context: Context,
  path: string,
  actor: Actor,
  /** A note being MOVED here: it can't also be the parent it converts into. */
  exclude?: string,
): Promise<void> {
  const owner = entityOwnerPathOf(path)
  if (owner) {
    if (await findLive(context, indexPathOf(owner))) return
    const node = await nodeForEntityPath(context.spaceId, `${owner}.md`)
    if (!node) {
      throw new Error(
        `"${owner}" is not a directory entity — notes filed under an entity namespace must belong to one`,
      )
    }
    await ensureEntityFolder(context, node, actor)
    return
  }
  const parent = folderOf(sanitizePath(path))
  if (!parent) return
  const parentNote = `${parent}.md`
  if (exclude && sanitizePath(exclude) === parentNote) return
  if (await findLive(context, indexPathOf(parent))) return
  if (!(await findLive(context, parentNote))) return
  await convertNoteToIndex(context, parentNote, actor)
}

/**
 * The index contract for a write at index path `p`.
 *
 * A folder's index owes a title. When the folder is a directory entity's own
 * (`people/<slug>/`), the index IS the entity's note, so it also owes the
 * entity's type and `node:` — that is the whole difference, and it is passed
 * to the one contract function rather than being a second contract.
 *
 * An entity-shaped index path with no node behind it (a folder somebody
 * hand-made under people/) is just a folder — EXCEPT a Tool: it is folder-only
 * (lib/notes/entities.ts FOLDER_ONLY_ENTITY_KINDS), so a write straight at
 * `tools/<name>/index.md` declaring `type: tool` is its only chance to gain the
 * node that makes it a real Tool, and ensureToolNode makes it right here —
 * before the frontmatter below is decided, since this runs ahead of
 * syncContextLinks (see ensureToolNode's own comment for why that matters).
 */
async function enforceIndexContract(context: Context, p: string, content: string): Promise<string> {
  const folder = folderOfIndexPath(p)
  if (isEntityFolderIndex(p)) {
    let node = await nodeForEntityPath(context.spaceId, p)
    if (!node && context.ownerKey === SHARED_OWNER_KEY && (await ensureToolNode(context.spaceId, p, content))) {
      node = await nodeForEntityPath(context.spaceId, p)
    }
    if (node) return enforceIndexFrontmatter(content, folder, entityContractOf(node))
  }
  return enforceIndexFrontmatter(content, folder)
}

/**
 * Where a write addressed to an entity note actually goes: the flat form is
 * redirected to the folder form once the entity has converted, so a writer
 * holding the old path (a stale link, an agent) enriches the note instead of
 * creating a second one beside the folder.
 */
export async function canonicalEntityWritePath(context: Context, path: string): Promise<string> {
  const p = sanitizePath(path)
  if (!parseEntityHref(p) || isIndexPath(p)) return p
  const index = indexPathOf(indexFolderPathOf(p))
  return (await findLive(context, index)) ? index : p
}

/** True when `folder` is some entity's context folder (people/<slug>). */
function isEntityFolder(folder: string): boolean {
  return entityOwnerPathOf(`${folder}/x.md`) !== null && parseEntityHref(`${folder}/index.md`) !== null
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
  // An entity folder IS the entity's note path (people/<slug>): its name is the
  // node's identity, so it can't be renamed or moved — and nothing else can
  // become one by being renamed into that shape.
  if (isEntityFolder(f)) {
    throw new Error(`"${f}" is a directory entity's folder — its path is the entity's identity and can't change`)
  }
  if (isEntityFolder(t)) {
    throw new Error(`"${t}" is where a directory entity's notes live — a folder can't be renamed into it`)
  }
  // A namespace folder is fixed in both directions: `agents/` can't be moved or
  // renamed away, and nothing else can be renamed into its name — a second
  // folder claiming to be `agents/` is exactly the collision the runtime can't
  // see (namespaceFolderDenial).
  const fromNamespace = namespaceFolderDenial(f)
  if (fromNamespace) throw new Error(fromNamespace)
  if (namespaceFolderDenial(t)) {
    throw new Error(`"${t}" is one of the space's built-in folders — a folder can't be renamed into it`)
  }
  // Moving a folder INTO an entity's folder converts the entity note first.
  if (actor) await ensureParentFolderNote(context, `${t}/x.md`, actor)
  const notes = await prisma.contextNote.findMany({
    where: {
      spaceId: context.spaceId,
      ownerKey: context.ownerKey,
      deletedAt: null,
      path: { startsWith: `${f}/` },
    },
    select: { id: true, path: true, content: true },
  })
  // Every moved note's path update and its rebuild-owed row commit together, so
  // a crash part-way through a large folder move leaves the drain a complete
  // list of what still needs projecting rather than a silent half-migration.
  const mover: Actor = actor ?? { id: 'system', name: 'System', email: null }
  const jobIds = await prisma.$transaction(async (tx) => {
    const ids: string[] = []
    for (const note of notes) {
      const to = t + note.path.slice(f.length)
      await tx.contextNote.update({ where: { id: note.id }, data: { path: to } })
      ids.push(
        await enqueueProjection(tx, {
          context,
          path: to,
          kind: 'rename',
          fromPath: note.path,
          origin: 'edit',
          actor: mover,
        }),
      )
    }
    return ids
  })

  await settleBatch(jobIds, async () => {
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
    // Agent briefs moved by a folder rename deactivate like a single rename does;
    // a Tool folder moved this way rebuilds under its new name and drops the old.
    for (const note of notes) {
      const to = t + note.path.slice(f.length)
      await agentNoteRenamed(context, note.path, to, actor)
      await toolNoteRenamed(context, note.path, to)
    }
  })
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
  await Promise.all(
    folders.map((fol) =>
      prisma.contextFolder.update({
        where: { id: fol.id },
        data: { path: fol.path === f ? t : t + fol.path.slice(f.length) },
      }),
    ),
  )
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
  // The last word on it: every door into a folder delete — the route, the MCP
  // tool, a script — comes through here, so the namespaces are safe without
  // each caller having to remember them. Deleting what's INSIDE one is
  // untouched: `tools/<name>` and `agents/live/<name>` are ordinary paths and
  // the teardown hooks that remove them still work.
  const denial = namespaceFolderDenial(p)
  if (denial) throw new Error(denial)
  const notes = await prisma.contextNote.findMany({
    where: {
      spaceId: context.spaceId,
      ownerKey: context.ownerKey,
      deletedAt: null,
      path: { startsWith: `${p}/` },
    },
    select: { id: true, path: true },
  })
  const jobIds = await prisma.$transaction(async (tx) => {
    const ids: string[] = []
    for (const note of notes) {
      await tx.contextNote.update({
        where: { id: note.id },
        data: { deletedAt: new Date(), deletedPath: note.path, path: `:trash:${note.id}` },
      })
      ids.push(
        await enqueueProjection(tx, {
          context,
          path: note.path,
          kind: 'delete',
          origin: 'edit',
          actor: { id: 'system', name: 'System', email: null },
        }),
      )
    }
    return ids
  })

  await settleBatch(jobIds, async () => {
    await syncContextLinksBulk(context, notes.map((n) => n.path)) // trashed entity notes drop their links
    await syncPublicationsOnDelete(context, notes.map((n) => n.path))
    for (const note of notes) {
      await agentNoteDeleted(context, note.path)
      await toolNoteDeleted(context, note.path)
    }
  })
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
  // A deleted entity folder took the entity's note with it; the node falls back
  // to the flat form (a lazy stub) until somebody writes context again.
  if (isEntityFolder(p) && context.ownerKey === SHARED_OWNER_KEY) {
    const node = await nodeForEntityPath(context.spaceId, `${p}.md`)
    if (node && node.metadata?.notePath) {
      const { notePath: _dropped, ...rest } = node.metadata
      void _dropped
      await prisma.node.update({ where: { id: node.id }, data: { metadata: rest as Prisma.InputJsonObject } })
      bustContextData()
    }
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
