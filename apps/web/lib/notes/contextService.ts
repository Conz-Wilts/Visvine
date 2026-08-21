// The context-service core, over the Prisma note store. The single door for the REST routes,
// the MCP tools, and the internal maintenance passes: every function takes an
// explicit ContextPrincipal, reads apply the folder-visibility lens BEFORE
// search/index building, private-folder reads are audited, and writes go through
// an apply-or-deny gate on the target folder. Personal contexts bypass the folder
// layer entirely (owner-only by context scoping in lib/notes/resolve.ts).

import { createHmac, timingSafeEqual } from 'node:crypto'
import * as store from './store'
import { SHARED_OWNER_KEY, type Context, type Actor } from './store'
import * as sourceStore from './sourceStore'
import { ingestSource, reingestSource, type IngestInput } from './sources/ingest'
import { logAudit } from './audit'
import { configNoteKindOf, isSettingsPath, ownerAliasDenial, parseConfigNote } from '@/lib/spaces/configNote'
import { readSpaceConfig } from '@/lib/spaces/spaceConfig'
import { createVectorStage, type SemanticReport } from './vectorStage'
import { createSourceStage } from './sourceStage'
import { embedTexts, semanticConfigured, type SemanticStatus } from './embeddings'
import { getVault, vaultFor } from './vaultCache'
import { splitFrontmatter } from './shared/markdown'
import { rewriteLinks } from './shared/linkRewrite'
import { fusedSearch, type FusedResult, type SearchFilters } from './shared/retrieval'
import { computeReferences, redactReferences } from './shared/references'
import { pathVisibleTo } from './shared/visibility'
import { folderIdOfPath } from './shared/placement'
import {
  principalCanWrite,
  principalIsSuperAdmin,
  principalLevelName,
} from './shared/permissions'
import { isRestrictedPath, isLockedPath } from './shared/authz'
import { replicaDenial } from './publications'
import { appendNoteLogEntry, toDateString } from './shared/noteLog'
import type { ContextPrincipal, WriteResult } from './shared/contextTypes'
import type { NoteMeta, NoteRevisionOrigin, RawNote, References } from './shared/types'
import type { ContextSourceMeta } from './shared/sourceTypes'
import { logger } from '@/lib/logger'

function isShared(context: Context): boolean {
  return context.ownerKey === SHARED_OWNER_KEY
}

function actorOf(p: ContextPrincipal): Actor {
  return { id: p.userId, name: p.name, email: p.email || null }
}

/** Whether a shared-context read of this path must be recorded for compliance:
 *  reads inside a restricted boundary are the sensitive ones. */
function isAuditedRead(p: ContextPrincipal, context: Context, path: string): boolean {
  if (p.system || !isShared(context)) return false
  return isRestrictedPath(p.access.restricted, path)
}

// read surface

export interface VisibleVault {
  raws: RawNote[]
  metas: NoteMeta[]
}

/**
 * The visibility-filtered vault. The index is rebuilt over only the visible raws,
 * so a link into a folder the caller can't read degrades to an unresolved link —
 * no title leak. Personal contexts (and admins) see everything unfiltered.
 * Served from the per-context vault memo (lib/notes/vaultCache.ts), so the routes
 * that fan out on a Context-tab open share one corpus load and one index build.
 */
export async function visibleVault(p: ContextPrincipal, context: Context): Promise<VisibleVault> {
  return vaultFor(await getVault(context), p, context)
}

/** Whether the principal may read one note path in this context. */
export function canReadPath(p: ContextPrincipal, context: Context, path: string): boolean {
  return !isShared(context) || pathVisibleTo(path, p)
}

/**
 * Read one note through the lens; returns null when absent or inaccessible
 * (indistinguishable, so nothing leaks). Private-folder reads are audited.
 */
export async function readVisible(
  p: ContextPrincipal,
  context: Context,
  path: string,
): Promise<string | null> {
  if (!canReadPath(p, context, path)) return null
  let content: string
  try {
    content = await store.readNote(context, path)
  } catch {
    return null
  }
  if (isAuditedRead(p, context, path)) {
    void logAudit(p.spaceId, { userId: p.userId, name: p.name, action: 'read', path })
  }
  return content
}

// references (with the access lens)

/** HMAC token standing in for a hidden reference source's path. Keyed by the
 *  session secret and scoped to (space, target), so a client can't forge
 *  one, replay it against another note, or correlate the same hidden source
 *  across two targets. Deterministic, so the GET that mints it and the POST
 *  that resolves it agree without any stored state. */
function referenceToken(spaceId: string, targetPath: string, fromPath: string): string {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET environment variable is not set')
  return createHmac('sha256', secret)
    .update(`${spaceId}\0${targetPath}\0${fromPath}`)
    .digest('hex')
}

/**
 * The target note's references through the access lens: computed over the FULL
 * corpus, then references from sources the viewer can't read collapse to opaque
 * locked stubs (shared/references.ts#redactReferences) — the viewer learns that
 * a reference exists, never whose note it is or what it says. A target the
 * viewer can't read gets nothing at all (its title must not seed a mention
 * scan). `pendingPaths` marks stubs the viewer already has an open request for.
 */
export async function referencesFor(
  p: ContextPrincipal,
  context: Context,
  targetPath: string,
  pendingPaths: ReadonlySet<string> = new Set(),
): Promise<References> {
  if (!canReadPath(p, context, targetPath)) return { linked: [], unlinked: [], restricted: [] }
  const entry = await getVault(context)
  const full = computeReferences(entry.raws, targetPath, entry.metas)
  return redactReferences(
    full,
    (path) => canReadPath(p, context, path),
    (path) => referenceToken(context.spaceId, targetPath, path),
    pendingPaths,
  )
}

/**
 * Turn a RestrictedReference token back into the hidden source note's path, or
 * null when it matches none of the target's current hidden sources (the note
 * moved, or the token is stale/forged). Only paths that genuinely reference
 * `targetPath` AND are hidden from the viewer can resolve — so the answer never
 * widens what the token already stood for.
 */
export async function resolveReferenceToken(
  p: ContextPrincipal,
  context: Context,
  targetPath: string,
  token: string,
): Promise<string | null> {
  if (!canReadPath(p, context, targetPath)) return null
  const entry = await getVault(context)
  const full = computeReferences(entry.raws, targetPath, entry.metas)
  const hidden = new Set(
    [...full.linked, ...full.unlinked]
      .map((r) => r.fromPath)
      .filter((path) => !canReadPath(p, context, path)),
  )
  for (const path of hidden) {
    const expected = referenceToken(context.spaceId, targetPath, path)
    if (token.length === expected.length && timingSafeEqual(Buffer.from(expected), Buffer.from(token))) {
      return path
    }
  }
  return null
}

export interface BrainSearchResult {
  hits: FusedResult[]
  /**
   * What the semantic half did: 'on', 'no-key' (OPENAI_API_KEY unset — results
   * are keyword + link context only), or 'error'. Reported rather than hidden,
   * because a degraded search is indistinguishable from a thorough one that
   * found nothing.
   */
  semantic: SemanticStatus
}

/**
 * Fused search (frontmatter filter → BM25 → pgvector → source chunks → link
 * context, weighted RRF) over everything the principal can read in this context.
 * Private-folder hits are audited.
 */
export async function searchContext(
  p: ContextPrincipal,
  context: Context,
  query: string,
  filters: SearchFilters = {},
  k?: number,
): Promise<BrainSearchResult> {
  const { raws, metas } = await visibleVault(p, context)
  const bodyByPath = new Map(raws.map((r) => [r.path, splitFrontmatter(r.content).body]))
  const notes = metas.map((meta) => ({ meta, body: bodyByPath.get(meta.path) ?? '' }))
  // Context-source chunks rank alongside notes, over only the VISIBLE (and
  // folder-filtered) source paths — the lens applies before the stage exists.
  // Keyword ranking covers chunks whose embedding is missing, so 'ready' is the
  // only requirement.
  const sourcePaths = (await sourceStore.listSources(context))
    .filter((s) => s.status === 'ready' && canReadPath(p, context, s.path))
    .filter((s) => filters.folderId === undefined || folderIdOfPath(s.path) === filters.folderId)
    .map((s) => s.path)

  // One query embed shared by both vector stages.
  const report: SemanticReport = {}
  const configured = semanticConfigured()
  let queryVector: number[] | null = null
  if (configured) {
    try {
      ;[queryVector] = await embedTexts([query])
    } catch (err) {
      report.error = err instanceof Error ? err.message : String(err)
      logger.error('notes.search.embed_failed', { err })
    }
  }

  const hits = await fusedSearch(notes, query, filters, {
    k,
    vector: createVectorStage(context, queryVector, report),
    sources: createSourceStage(context, sourcePaths, queryVector, report),
  })
  for (const h of hits) {
    if (isAuditedRead(p, context, h.path)) {
      void logAudit(p.spaceId, { userId: p.userId, name: p.name, action: 'read', path: h.path })
    }
  }
  const semantic: SemanticStatus = !configured ? 'no-key' : report.error ? 'error' : 'on'
  return { hits, semantic }
}

// write gate

/**
 * The write gate. Personal contexts are always writable by their owner (scoping
 * guarantees the caller IS the owner). Shared-context writes require EDIT level
 * at the target path — a grant that reaches it (through any restricted cuts)
 * at edit or full. Returns null when allowed, else the denial reason.
 */
export function writeDenial(p: ContextPrincipal, context: Context, path: string): string | null {
  if (!isShared(context)) return null
  // connectors/ holds machine config that executes against external systems
  // (lib/connectors) — folder grants don't apply; only space admins write it.
  if (
    (path === 'connectors' || path.startsWith('connectors/')) &&
    !p.system &&
    !principalIsSuperAdmin(p)
  ) {
    return 'Only space admins can create or edit connectors.'
  }
  // agents/live/ holds each agent's ACTIVATION (active + schedule). The brief
  // beside it (agents/<name>.md) is member-writable on purpose; turning one on
  // means "run unattended on the space's model key with declared connector
  // reach", so that stays with admins. Sits inside agents/, so a folder grant
  // on agents/ does not reach it — this clause runs before the grant check.
  if (
    (path === 'agents/live' || path.startsWith('agents/live/')) &&
    !p.system &&
    !principalIsSuperAdmin(p)
  ) {
    return 'Only space admins can activate an agent.'
  }
  // settings/ IS the space's configuration (lib/spaces/configNote.ts) — the
  // feature switches, the type vocabulary, and the alias flags that decide who
  // administers the space. Editing one of those notes changes the space, so it
  // is an admin act for the same reason the console is, and a folder grant on
  // settings/ must not be a way around that. This clause runs before the grant
  // check for exactly that reason.
  if (isSettingsPath(path) && !p.system && !principalIsSuperAdmin(p)) {
    return "Only space admins can change a space's settings."
  }
  if (principalCanWrite(p, path)) return null
  const level = principalLevelName(p, path)
  const where = folderIdOfPath(path) || 'the context root'
  return level
    ? `You have ${level} access in "${where}" — edit access is required.`
    : `You don't have access to write in "${where}".`
}

/**
 * Origins that mean "an AI/agent wrote this without a human approving the
 * exact change": autonomous MCP writes, enrichment passes, maintenance/clean
 * passes. These are what a folder's "Freeze for AI" lock keeps out.
 * `ai-refactor` is deliberately absent — a refactor is applied by a human in
 * the editor, so the lock does not bind it. `edit`/`restore` are human acts.
 */
const AI_ORIGINS: ReadonlySet<NoteRevisionOrigin> = new Set(['agent', 'ai-enrich', 'maintenance'])

/**
 * The "Freeze for AI" gate: a locked shared-context folder refuses autonomous
 * AI writes while leaving humans (and human-approved refactors) alone.
 * Until now only the review pass honoured locks — the SharePanel copy promises
 * "maintenance passes leave this folder alone", so the write gate must too.
 */
export function lockedDenial(
  p: ContextPrincipal,
  context: Context,
  path: string,
  origin: NoteRevisionOrigin,
): string | null {
  if (!isShared(context)) return null
  if (!AI_ORIGINS.has(origin)) return null
  // agents/ is structurally frozen for AI, whether or not it is locked: a
  // member's edit to a live brief auto-deactivates the agent (lib/agents/hooks),
  // so an AI sweep that reformatted the briefs would silently switch off every
  // agent in the space — and an agent could otherwise rewrite itself or its
  // siblings. Agents are written by people.
  if (path === 'agents' || path.startsWith('agents/')) {
    return 'Agent briefs are frozen for AI — a human must make this change.'
  }
  // tools/ is frozen for the same reason, one step further: a Tool's sub-notes
  // are its executable source (lib/tools), so an autonomous pass that "tidied"
  // them would be rewriting code that runs against the space's own data — and a
  // Tool could otherwise rewrite itself or its neighbours. Members author tools
  // freely (there is deliberately no admin-only writeDenial on tools/ above);
  // only the AI origins are shut out.
  //
  // NOTE for the Tool authoring surface: the generic MCP context writes pass
  // origin 'agent' (lib/mcp/tools.ts), so they land here. The dedicated Tool
  // handlers must write with a human origin ('edit') — a person driving Claude
  // Code is authoring, not sweeping, the same distinction that keeps
  // 'ai-refactor' out of AI_ORIGINS.
  if (path === 'tools' || path.startsWith('tools/')) {
    return 'Tools are frozen for AI — a human must make this change.'
  }
  // settings/ is frozen for the same structural reason, and one more: these
  // notes carry the feature switches and the owner-alias flags, so an
  // autonomous pass that "tidied" them could turn a surface off for everyone or
  // rewrite who administers the space. An agent may READ the space's settings —
  // that is most of the value of having them as notes — but changing them is a
  // human act. A proposal from an agent belongs in an ordinary note a person
  // then applies, not in a direct write here.
  if (isSettingsPath(path)) {
    return 'Space settings are frozen for AI — a human must make this change.'
  }
  if (!isLockedPath(p.access.locked, path)) return null
  return 'This folder is frozen for AI ("Freeze for AI") — a human must make this change.'
}

/**
 * The full async write check: the folder gate plus the replica block — an
 * ACTIVE publication target is read-only in its destination (the next source
 * save would clobber any local edit). Every content write goes through this.
 */
export async function writeDenialFull(
  p: ContextPrincipal,
  context: Context,
  path: string,
): Promise<string | null> {
  const denial = writeDenial(p, context, path)
  if (denial) return denial
  if (isShared(context)) return replicaDenial(context.spaceId, path)
  return null
}

/** Gated whole-note write, recording revision history. */
export async function writeGated(
  p: ContextPrincipal,
  context: Context,
  path: string,
  content: string,
  origin: Parameters<typeof store.writeNote>[4] = 'edit',
  model?: string,
): Promise<WriteResult> {
  const denial = (await writeDenialFull(p, context, path)) ?? lockedDenial(p, context, path, origin)
  if (denial) return { status: 'denied', reason: denial }
  // A config note is refused BEFORE it is saved when it does not describe a
  // valid configuration. The store hook that projects it into the columns runs
  // after the write, so this is the only point at which a bad settings edit can
  // be stopped rather than merely ignored — and being stopped is what keeps the
  // note and the columns from silently disagreeing.
  const configDenial = await configNoteDenial(context, path, content)
  if (configDenial) return { status: 'denied', reason: configDenial }
  await store.writeNote(context, path, content, actorOf(p), origin, model)
  return { status: 'applied', path }
}

/** Why this settings note cannot be saved, or null when it is fine. */
async function configNoteDenial(
  context: Context,
  path: string,
  content: string,
): Promise<string | null> {
  if (!isShared(context)) return null
  const kind = configNoteKindOf(path)
  if (!kind) return null
  const { patch, errors } = parseConfigNote(kind, content)
  if (errors.length) {
    return `This settings note is not a valid configuration, so it was not saved: ${errors.join('; ')}`
  }
  // Structurally fine, but it may still be an edit the space cannot survive.
  // Only reachable for the types note, which is the only one carrying aliases.
  if (patch.aliases) {
    const stored = await readSpaceConfig(context.spaceId)
    const denial = stored ? ownerAliasDenial(patch, stored) : null
    if (denial) return denial
  }
  return null
}

/**
 * Gated dated `## Log` append (creating the section when absent). AI/agent
 * appends pass `origin`/`model` so the revision AND the log entry's role are
 * stamped with how the entry arose — human vs AI edits stay distinguishable.
 */
export async function appendLogGated(
  p: ContextPrincipal,
  context: Context,
  path: string,
  entry: string,
  origin: NoteRevisionOrigin = 'edit',
  model?: string,
): Promise<WriteResult> {
  const denial = (await writeDenialFull(p, context, path)) ?? lockedDenial(p, context, path, origin)
  if (denial) return { status: 'denied', reason: denial }
  const current = await store.readNote(context, path)
  const role =
    origin === 'edit' || origin === 'restore'
      ? roleLabel(p, context, path)
      : model
        ? `ai: ${model}`
        : origin
  const md = appendNoteLogEntry(current, {
    date: toDateString(Date.now()),
    actor: p.name,
    role,
    summary: entry,
  })
  await store.writeNote(context, path, md, actorOf(p), origin, model)
  return { status: 'applied', path }
}

/** The authority label stamped into `## Log` entries. */
function roleLabel(p: ContextPrincipal, context: Context, path: string): string {
  if (p.system) return 'maintenance'
  if (!isShared(context)) return 'owner'
  if (principalIsSuperAdmin(p)) return 'admin'
  return principalLevelName(p, path) ?? 'member'
}

// move (gated on BOTH ends, inbound links rewritten)

/**
 * Move/rename a note within a context: gated on write access to the source and the
 * destination folder, then every inbound link in the context is rewritten to the
 * new path so nothing breaks. Returns the new path or a denial.
 */
export async function moveGated(
  p: ContextPrincipal,
  context: Context,
  from: string,
  to: string,
  origin: NoteRevisionOrigin = 'edit',
  model?: string,
): Promise<WriteResult> {
  for (const end of [from, to]) {
    const denial = writeDenial(p, context, end) ?? lockedDenial(p, context, end, origin)
    if (denial) return { status: 'denied', reason: denial }
  }
  const moved = await store.renameNote(context, from, to, actorOf(p), { origin, model })
  await rewriteInboundLinks(context, from, moved)
  if (isShared(context)) {
    void logAudit(p.spaceId, {
      userId: p.userId,
      name: p.name,
      action: 'move',
      path: moved,
      detail: `from ${from}`,
    })
  }
  return { status: 'applied', path: moved }
}

// context sources (non-note files/tables; same gate + lens as notes)

/** The sources the principal may see, optionally restricted to one top-level folder. */
export async function listVisibleSources(
  p: ContextPrincipal,
  context: Context,
  folderId?: string,
): Promise<ContextSourceMeta[]> {
  const all = await sourceStore.listSources(context)
  return all
    .filter((s) => canReadPath(p, context, s.path))
    .filter((s) => folderId === undefined || folderIdOfPath(s.path) === folderId)
}

/** Gated upload + ingestion of a new source file. */
export async function createSourceGated(
  p: ContextPrincipal,
  context: Context,
  input: IngestInput,
): Promise<WriteResult & { source?: ContextSourceMeta }> {
  const denial = writeDenial(p, context, input.path)
  if (denial) return { status: 'denied', reason: denial }
  const source = await ingestSource(context, input)
  if (isShared(context)) {
    void logAudit(p.spaceId, {
      userId: p.userId,
      name: p.name,
      action: 'write',
      path: source.path,
      detail: `source upload (${source.kind}, ${source.sizeBytes} bytes)`,
    })
  }
  return { status: 'applied', path: source.path, source }
}

/**
 * A page of a source's extracted text (concatenated chunks) through the lens.
 * Private-folder reads are audited exactly like note reads.
 */
export async function readSourceVisible(
  p: ContextPrincipal,
  context: Context,
  path: string,
  opts: { offsetChars?: number; maxChars?: number } = {},
): Promise<{ meta: ContextSourceMeta; text: string; totalChars: number } | null> {
  if (!canReadPath(p, context, path)) return null
  const row = await sourceStore.findSource(context, path)
  if (!row) return null
  const full = (await sourceStore.listChunkTexts(row.id)).join('\n\n')
  if (isAuditedRead(p, context, path)) {
    void logAudit(p.spaceId, { userId: p.userId, name: p.name, action: 'read', path })
  }
  const offset = Math.max(0, opts.offsetChars ?? 0)
  const max = Math.max(1, opts.maxChars ?? 20_000)
  return { meta: sourceStore.toMeta(row), text: full.slice(offset, offset + max), totalChars: full.length }
}

/** Gated hard delete of a source (row, chunks, and the GCS object). */
export async function deleteSourceGated(
  p: ContextPrincipal,
  context: Context,
  path: string,
): Promise<WriteResult> {
  const denial = writeDenial(p, context, path)
  if (denial) return { status: 'denied', reason: denial }
  const existed = await sourceStore.deleteSource(context, path)
  if (!existed) return { status: 'denied', reason: `No source at: ${path}` }
  if (isShared(context)) {
    void logAudit(p.spaceId, {
      userId: p.userId,
      name: p.name,
      action: 'delete',
      path,
      detail: 'source delete',
    })
  }
  return { status: 'applied', path }
}

/** Gated re-ingestion (retry after failure / embedding-model change). */
export async function reingestSourceGated(
  p: ContextPrincipal,
  context: Context,
  path: string,
): Promise<WriteResult & { source?: ContextSourceMeta }> {
  const denial = writeDenial(p, context, path)
  if (denial) return { status: 'denied', reason: denial }
  const source = await reingestSource(context, path)
  if (!source) return { status: 'denied', reason: `No source at: ${path}` }
  return { status: 'applied', path, source }
}

/** Rewrite every note that links to `fromPath` so it points at `toPath`. */
async function rewriteInboundLinks(
  context: Context,
  fromPath: string,
  toPath: string,
): Promise<void> {
  const raws = await store.listRaw(context)
  const targets = new Set([fromPath, fromPath.replace(/\.md$/i, '')])
  for (const raw of raws) {
    if (raw.path === toPath || raw.path === fromPath) continue
    const { frontmatter, body } = splitFrontmatter(raw.content)
    const next = rewriteLinks(body, raw.path, (t) => (targets.has(t) ? toPath : null))
    if (next !== body) {
      const content = frontmatter !== null ? `---\n${frontmatter}\n---\n\n${next}` : next
      await store.writeNote(context, raw.path, content, { id: 'system', name: 'Link maintenance' })
    }
  }
}
