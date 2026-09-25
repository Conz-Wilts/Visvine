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
import { createVectorStage, type SemanticReport } from './vectorStage'
import { createSourceStage } from './sourceStage'
import { createMemoryStage } from './memoryStage'
import { createChunkStage } from './chunkStage'
import { embeddingEnabledFor } from './embedSweep'
import { embedTexts, semanticConfigured, type SemanticStatus } from './embeddings'
import { getVault, vaultFor } from './vaultCache'
import { parseFrontmatter, splitFrontmatter } from './shared/markdown'
import { runKeysOf } from '@/lib/agents/shared/agentConfig'
import { rewriteLinks } from './shared/linkRewrite'
import { fusedSearch, type FusedResult, type SearchFilters } from './shared/retrieval'
import { createReranker, type RerankReport } from './rerank'
import { planQuery, type QueryPlan } from './shared/queryPlan'
import { computeReferences, redactReferences } from './shared/references'
import { pathVisibleTo } from './shared/visibility'
import { folderIdOfPath } from './shared/placement'
import {
  principalCanWrite,
  principalIsSuperAdmin,
  principalLevelName,
} from './shared/permissions'
import { agentOfRevisionStamp, entityKindOf, isAgentActivationPath, isAgentBriefPath, isAgentOwnNotePath } from './entities'
import { isUnderResources } from '@/lib/resources/shared/resourceTree'
import { isRestrictedPath, isLockedPath } from './shared/authz'
import { replicaDenial } from './publications'
import { isGlobalSpace } from '@/lib/spaces/globalSpace'
import { isLandingDir, namespaceFeatureRefusal, reservedWriteDenial, togglableNamespaceFeature } from './shared/namespaces'
import { landingFolderOf } from './landing'
import { getFeatureConfig } from '@/lib/auth'
import { federatedWriteDenial } from '@/lib/spaces/subspaces'
import { globalSelfRecordDenial } from '@/lib/global/gate'
import { configHomeDenial, configKindOfContent, configKindWriteDenial, configNameOfPath, type ConfigKind } from './shared/configKinds'
import { connectorNotePathIn } from '@/lib/connectors/locate'
import { modelNotePathIn } from '@/lib/models/locate'
import { agentContaining, agentFolderIn } from '@/lib/agents/location'
import { agentNameOfFolder, briefFolderOf } from '@/lib/agents/shared/folder'
import { declaresTool, toolFolderOfIndex, toolNameOfFolder } from '@/lib/tools/config'
import { toolContaining, toolFolderIn } from '@/lib/tools/location'
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
   * What the semantic half did: 'on', 'off' (the space switched embedding
   * off), 'no-key' (OPENROUTER_API_KEY unset — results
   * are keyword + link context only), or 'error'. Reported rather than hidden,
   * because a degraded search is indistinguishable from a thorough one that
   * found nothing.
   */
  semantic: SemanticStatus
  /**
   * False when a judge read the candidates and found none of them about the
   * query: nothing the caller can read answers it. Absent when no judge ran —
   * an empty `hits` then only means nothing matched.
   */
  answerable?: boolean
  /**
   * What the search decided the query was asking — the phrasings it ran, the
   * date range it read out of the words, whether it answered by recency alone,
   * and whether it treated the ask as a history question. Reported so a caller
   * can see why "last week" returned what it did.
   */
  plan: QueryPlan
}

export interface SearchOptions {
  /**
   * Judge the head of the ranking and drop what is not about the query
   * (lib/notes/rerank.ts). Default true; a person scanning a result list as
   * they type passes false — they want it now, and can skip a weak row.
   */
  judge?: boolean
}

/**
 * Fused search (query plan → frontmatter/date filter → BM25 → pgvector → derived
 * memories → source chunks → link context, weighted RRF → optional rerank) over everything the
 * principal can read in this context. Private-folder hits are audited.
 */
export async function searchContext(
  p: ContextPrincipal,
  context: Context,
  query: string,
  filters: SearchFilters = {},
  k?: number,
  opts: SearchOptions = {},
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

  const now = Date.now()
  // A space that switched embedding off (the Console's General → Nightly) gets
  // no semantic half — not the query embed, not the lazy catch-up — and says
  // so the way a missing key does. The judge reads the keyword hits either way.
  const report: SemanticReport = {}
  const keyed = semanticConfigured()
  const enabled = keyed && (await embeddingEnabledFor(context.spaceId))
  const mtimes = new Map(metas.map((m) => [m.path, m.mtime]))

  const plan = planQuery(query, now)
  const rerankReport: RerankReport = {}
  // The text stages rank on the topic (time words stripped), so that is what
  // is embedded, once, for both vector stages.
  const queryVectors = new Map<string, number[]>()
  const topic = plan.topic || query
  if (enabled && !plan.temporalOnly) {
    try {
      const [vector] = await embedTexts([topic])
      queryVectors.set(topic, vector)
    } catch (err) {
      report.error = err instanceof Error ? err.message : String(err)
      logger.error('notes.search.embed_failed', { err })
    }
  }
  const hits = await fusedSearch(notes, query, filters, {
    k,
    plan,
    now,
    vector: createVectorStage(context, queryVectors, report),
    sources: createSourceStage(context, sourcePaths, queryVectors, report),
    // Claims and chunks rank only for the visible notes at their CURRENT mtime.
    memories: createMemoryStage(context, mtimes, queryVectors, report),
    chunks: createChunkStage(context, mtimes, queryVectors, report),
    rerank: opts.judge === false ? undefined : createReranker(rerankReport),
  })
  for (const h of hits) {
    if (isAuditedRead(p, context, h.path)) {
      void logAudit(p.spaceId, { userId: p.userId, name: p.name, action: 'read', path: h.path })
    }
  }
  const semantic: SemanticStatus = !keyed ? 'no-key' : !enabled ? 'off' : report.error ? 'error' : 'on'
  return { hits, semantic, ...(rerankReport.judged ? { answerable: hits.length > 0 } : {}), plan }
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
  // The global space is the platform's: a person edits their OWN record there
  // (checked with the database in writeDenialFull, which every content write
  // goes through); creating anything else in it is a super-admin act.
  if (isGlobalSpace(context.spaceId) && !p.system && !principalIsSuperAdmin(p)) {
    return 'The Visvine record is maintained by the platform. Edit your own profile to change yours.'
  }
  // subspaces/ is where a sub-space's context is READ into this one, and
  // parent/ where the parent's shared notes are (lib/notes/federation.ts) —
  // nothing of THIS space's is ever stored under either: a note there would
  // look like another space's and be governed by neither. A write meant for
  // the sub-space is hopped across before it gets here (federation.ts#
  // writeTarget) and judged under the caller's standing there; a caller that
  // did not hop is told where it is written.
  const federated = federatedWriteDenial(path)
  if (federated) return federated
  // connectors/ holds machine config that executes against external systems
  // (lib/connectors) — folder grants don't apply; only space admins write it.
  if (
    (path === 'connectors' || path.startsWith('connectors/')) &&
    !p.system &&
    !principalIsSuperAdmin(p)
  ) {
    return 'Only space admins can create or edit connectors.'
  }
  // models/ names the provider agents run on and, for a custom endpoint, the
  // URL the space's context is sent to (lib/models) — the same bargain as a
  // connector's hosts, so the same gate.
  if ((path === 'models' || path.startsWith('models/')) && !p.system && !principalIsSuperAdmin(p)) {
    return 'Only space admins can create or edit models.'
  }
  // A namespace nothing may write: `subspaces/` is another space's context,
  // read into this one. Refused for everyone, ahead of the grant check — a
  // folder grant must not be a way in.
  const reserved = reservedWriteDenial(path)
  if (reserved) return reserved
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
  /** The revision's model stamp — `agent:<name>` when an agent's own run is writing. */
  model?: string,
): string | null {
  if (!isShared(context)) return null
  if (!AI_ORIGINS.has(origin)) return null
  // agents/ is structurally frozen for AI, whether or not it is locked: a
  // member's edit to a live brief auto-deactivates the agent (lib/agents/hooks),
  // so an AI sweep that reformatted the briefs would silently switch off every
  // agent in the space — and an agent could otherwise rewrite itself or its
  // siblings. Agents are written by people.
  //
  // The one opening is an agent's OWN folder: a run stamped `agent:<name>`
  // may write `agents/<name>/<anything>.md` — its digests, its reports, the
  // state it keeps between runs — but never its brief or its activation, and
  // never another agent's folder. Nothing under agents/ ever fires a trigger
  // (lib/agents/config.ts#matchesAnyGlob), so this cannot wake anything.
  if (path === 'agents' || path.startsWith('agents/')) {
    const own = agentOfRevisionStamp(origin, model)
    if (own && isAgentOwnNotePath(path, own)) return null
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
  // origin 'agent' (lib/actions/defs/context.ts), so they land here. The dedicated Tool
  // handlers must write with a human origin ('edit') — a person driving Claude
  // Code is authoring, not sweeping, the same distinction that keeps
  // 'ai-refactor' out of AI_ORIGINS.
  if (path === 'tools' || path.startsWith('tools/')) {
    return 'Tools are frozen for AI — a human must make this change.'
  }
  if (!isLockedPath(p.access.locked, path)) return null
  return 'This folder is frozen for AI ("Freeze for AI") — a human must make this change.'
}

/**
 * The agent and Tool rules `lockedDenial` keeps for `agents/` and `tools/`,
 * kept for one filed in a folder of the space's own (lib/agents/location.ts,
 * lib/tools/location.ts). An AI origin may write only an agent's OWN notes,
 * as that agent — never a brief, another agent's folder or anything in a
 * Tool's, and never mint either by writing an index. And the name is the
 * identity, so an index may not take a name another agent or Tool holds.
 * `next` is the content being written (null for a delete or a move's source).
 */
async function namedFolderDenial(
  p: ContextPrincipal,
  context: Context,
  path: string,
  next: string | null,
  origin: NoteRevisionOrigin,
  model?: string,
  opts: { movingFrom?: string } = {},
): Promise<string | null> {
  if (!isShared(context)) return null
  const clean = path.replace(/^\/+/, '')
  const tool = await toolPlaceDenial(context, clean, next, origin, opts)
  if (tool) return tool
  if (clean === 'agents' || clean.startsWith('agents/')) {
    // Under agents/ the path rules already answer; only the name clash with an
    // agent filed elsewhere is left to ask.
    const folder = briefFolderOf(clean, next ?? '')
    return folder ? agentNameClash(context, folder, opts.movingFrom) : null
  }
  const mints = briefFolderOf(clean, next) ?? (opts.movingFrom && next === null ? briefFolderOf(clean, await store.readNoteOrNull(context, opts.movingFrom)) : null)
  const at = AI_ORIGINS.has(origin) ? await agentContaining(context.spaceId, clean) : null
  if (AI_ORIGINS.has(origin) && (at || mints)) {
    const own = agentOfRevisionStamp(origin, model)
    if (!mints && at && own === at.name && at.file === 'own') return null
    return 'Agent briefs are frozen for AI — a human must make this change.'
  }
  return mints ? agentNameClash(context, mints, opts.movingFrom) : null
}

/**
 * The same for a Tool filed in a folder of the space's own: `tools/` is frozen
 * for AI, so a Tool anywhere is, and a Tool's name is its identity.
 */
async function toolPlaceDenial(
  context: Context,
  path: string,
  next: string | null,
  origin: NoteRevisionOrigin,
  opts: { movingFrom?: string },
): Promise<string | null> {
  if (path === 'tools' || path.startsWith('tools/')) {
    const folder = toolFolderOfIndex(path, true)
    return folder ? toolNameClash(context, folder, opts.movingFrom) : null
  }
  const incoming = opts.movingFrom && next === null ? await store.readNoteOrNull(context, opts.movingFrom) : next
  const mints = toolFolderOfIndex(path, declaresTool(incoming))
  if (AI_ORIGINS.has(origin) && (mints || (await toolContaining(context.spaceId, path)))) {
    return 'Tools are frozen for AI — a human must make this change.'
  }
  return mints ? toolNameClash(context, mints, opts.movingFrom) : null
}

/** Why a Tool index at `folder` would clash with a Tool of the same name elsewhere, or null. */
async function toolNameClash(context: Context, folder: string, movingFrom?: string): Promise<string | null> {
  const name = toolNameOfFolder(folder)
  const held = await toolFolderIn(context.spaceId, name)
  if (held === folder || !(await store.readNoteOrNull(context, `${held}/index.md`))) return null
  if (movingFrom && movingFrom.startsWith(`${held}/`)) return null
  return `A tool named "${name}" already exists at ${held}/ — a tool's name is its folder's name, and one space holds one of each.`
}

/** Why a brief at `folder` would clash with an agent of the same name elsewhere, or null. */
async function agentNameClash(context: Context, folder: string, movingFrom?: string): Promise<string | null> {
  const name = agentNameOfFolder(folder)
  const held = await agentFolderIn(context.spaceId, name)
  if (!held || held === folder) return null
  if (movingFrom && (movingFrom === `${held}/index.md` || movingFrom.startsWith(`${held}/`))) return null
  return `An agent named "${name}" already exists at ${held}/ — an agent's name is its folder's name, and one space holds one of each.`
}

/**
 * A namespace belongs to a tool, and a tool that is off does not get one.
 *
 * `channels/` and `sections/` are the case today — both owned by `channels`,
 * which is off in every new space — and the table in ./shared/namespaces.ts is
 * what adds the next one. Without this a member could hand-write the note and
 * conjure the namespace for a surface the space does not run, which is the same
 * hole the Channels routes close on their own side.
 *
 * FREEZE, DON'T STRAND: the refusal is for a namespace holding NOTHING. Once a
 * space has channels, switching the tool off leaves every note openable,
 * editable and renamable — it just gains no new ones. That predicate is also
 * the only one that survives the three ways "is this path new" is wrong here:
 * canonicalEntityWritePath rewrites `channels/foo.md` to `channels/foo/index.md`,
 * a sub-note under an existing channel is a new path, and a rename produces a
 * new `to` path with nothing at it. Read off the vault index, so no query.
 */
export async function namespaceFeatureDenial(
  context: Context,
  path: string,
): Promise<string | null> {
  if (!isShared(context)) return null
  const config = await getFeatureConfig(context.spaceId)
  if (!togglableNamespaceFeature(path, config)) return null
  const dir = path.split('/')[0]
  const { metas } = await getVault(context)
  return namespaceFeatureRefusal(path, config, metas.some((m) => m.path.startsWith(`${dir}/`)))
}

/**
 * The full async write check: the folder gate, the switched-off tool, and the
 * replica block — an ACTIVE publication target is read-only in its destination
 * (the next source save would clobber any local edit). Every content write goes
 * through this.
 */
export async function writeDenialFull(
  p: ContextPrincipal,
  context: Context,
  path: string,
): Promise<string | null> {
  if (isShared(context) && isGlobalSpace(context.spaceId) && !p.system && !principalIsSuperAdmin(p)) {
    return globalSelfRecordDenial(p.userId, path)
  }
  const denial = writeDenial(p, context, path)
  if (denial) return denial
  // After writeDenial so the admin-only and subspaces/ sentences keep priority:
  // they say who you are, this says what the space runs.
  const namespace = await namespaceFeatureDenial(context, path)
  if (namespace) return namespace
  if (isShared(context)) return replicaDenial(context.spaceId, path)
  return null
}

/**
 * The gate that follows the DECLARATION rather than the path
 * (lib/notes/shared/configKinds.ts). A note that says `type: connector` or
 * `type: model` is machine configuration wherever it was filed, so only a
 * space admin writes, edits, moves or deletes it — the note it is becoming
 * (`next`) and the note already at `path` (`current`) are both asked, which is
 * what stops a member from stripping the type off a connector in a folder
 * they may otherwise edit, or from minting one there.
 *
 * For a connector or a model two more things hold: it sits where one may
 * (`configHomeDenial` — `<home>/<name>.md` or a folder of the space's
 * own), and its name is unique in the context, because the name is what a
 * brief's `connectors:` line, a secret suffix and the node id are cut from.
 * `movingFrom` is the note's own path during a move, so it is not its own
 * clash.
 *
 * `current` may be passed by a caller that has already read the note; left
 * out, it is read here. Personal contexts hold no gate.
 */
export async function configKindDenial(
  p: ContextPrincipal,
  context: Context,
  path: string,
  next: string | null,
  opts: { current?: string | null; movingFrom?: string } = {},
): Promise<string | null> {
  if (!isShared(context)) return null
  const admin = p.system || principalIsSuperAdmin(p)
  const nextKind = configKindOfContent(next)
  const current = opts.current === undefined ? await store.readNoteOrNull(context, opts.movingFrom ?? path) : opts.current
  const currentKind = configKindOfContent(current)
  const kind: ConfigKind | null = nextKind ?? currentKind
  if (!kind) return null
  if (!admin) return configKindWriteDenial(kind)
  if (nextKind === null && !opts.movingFrom) return null
  // A legacy model (connectors/<name>.md, kind: model) is read where it is
  // until db:models:migrate moves it; nothing new is shaped that way.
  if (kind === 'model' && !opts.movingFrom && path.startsWith('connectors/')) return null
  const home = configHomeDenial(kind, path)
  if (home) return home
  const name = configNameOfPath(kind, path)
  if (!name) return null
  const noun = kind === 'connector' ? 'connector' : 'model'
  // The name is the identity — a brief's `connectors:` / `model:` line, the
  // stored connections and the secrets all key on it — so it changes folder,
  // never file name.
  if (opts.movingFrom && configNameOfPath(kind, opts.movingFrom) !== name) {
    return `A ${noun}’s name is its file name, and everything that uses it keys on that name — move it between folders, or write it again under the new name.`
  }
  const held = kind === 'connector' ? await connectorNotePathIn(context, name) : await modelNotePathIn(context, name)
  if (held && held !== path && held !== opts.movingFrom) {
    return `A ${noun} named "${name}" already exists at ${held} — a ${noun}'s name is its file name, and one space holds one of each.`
  }
  return null
}

/**
 * Why a non-admin may not rename or delete `folder`, or null: it holds a
 * connector or a model, which move and go with it, and those are the admin's
 * (see configKindDenial). Nothing for an admin, or for a folder of ordinary
 * notes.
 */
export async function folderConfigKindDenial(p: ContextPrincipal, context: Context, folder: string): Promise<string | null> {
  if (!isShared(context) || p.system || principalIsSuperAdmin(p)) return null
  const prefix = folder ? `${folder}/` : ''
  const raws = await store.listRaw(context)
  for (const raw of raws) {
    if (prefix && !raw.path.startsWith(prefix)) continue
    const kind = configKindOfContent(raw.content)
    if (!kind) continue
    const what = kind === 'connector' ? 'connector' : 'model'
    return `"${folder}" holds the ${what} ${raw.path} — only a space admin can move or delete a folder with one in it.`
  }
  return null
}

/**
 * Where a NEW note addressed to a landing folder is written. `agents/`,
 * `tools/`, `connectors/` and `models/` may have been moved into a folder of
 * the space's own (lib/notes/landing.ts); the built-in name then stands for
 * wherever it went, so `connectors/hubspot.md` written by an AI following a
 * recipe lands beside the space's other connectors. A note that already
 * exists at the path is written where it is.
 */
async function landingPath(context: Context, path: string): Promise<string> {
  if (!isShared(context)) return path
  const clean = path.replace(/^\/+/, '')
  const dir = clean.split('/')[0]
  if (!isLandingDir(dir) || clean === dir) return path
  const home = await landingFolderOf(context, dir)
  if (home === dir || (await store.readNoteOrNull(context, clean)) !== null) return path
  return `${home}${clean.slice(dir.length)}`
}

/**
 * A resource lives under `resources/` (lib/resources/shared/resourceTree.ts):
 * a note declaring `type: Resource` anywhere else is refused, unless the note
 * already there declared it (older data keeps saving).
 */
async function resourceHomeDenial(context: Context, path: string, next: string | null): Promise<string | null> {
  if (!isShared(context) || isUnderResources(path) || !next) return null
  const declares = (content: string | null) => content !== null && entityKindOf(String(parseFrontmatter(content).type ?? '')) === 'resource'
  if (!declares(next) || declares(await store.readNoteOrNull(context, path))) return null
  return 'A resource lives under resources/ — file it in a folder there.'
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
  path = await landingPath(context, path)
  const denial =
    (await writeDenialFull(p, context, path)) ??
    lockedDenial(p, context, path, origin, model) ??
    (await namedFolderDenial(p, context, path, content, origin, model)) ??
    (await configKindDenial(p, context, path, content)) ??
    (await resourceHomeDenial(context, path, content))
  if (denial) return { status: 'denied', reason: denial }
  const runKeys = await briefRunKeyDenial(p, context, path, content)
  if (runKeys) return { status: 'denied', reason: runKeys }
  await store.writeNote(context, path, content, actorOf(p), origin, model)
  return { status: 'applied', path }
}

/**
 * How an agent runs — model, connectors, tools, schedule, who it runs as and
 * for, its share — is its RECORD (lib/agents/shared/agentConfig.ts), changed
 * only through `configure_agent` / the agent's Config, where each field has
 * its own gate. So a brief note may not ADD or CHANGE a run key; taking one
 * out is fine, and a note written before the record keeps the ones it has
 * until the store hook folds them in. The system writes the older shape freely.
 */
async function briefRunKeyDenial(p: ContextPrincipal, context: Context, path: string, content: string): Promise<string | null> {
  if (!isShared(context) || p.system) return null
  if (!(isAgentBriefPath(path) || isAgentActivationPath(path) || briefFolderOf(path, content))) return null
  const after = parseFrontmatter(content)
  const keys = runKeysOf(after)
  if (keys.length === 0) return null
  const current = await store.readNoteOrNull(context, path)
  const before = current ? parseFrontmatter(current) : {}
  const changed = keys.filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]))
  if (changed.length === 0) return null
  return `How an agent runs is not written in its note — ${changed.map((k) => `\`${k}\``).join(', ')} ${changed.length === 1 ? 'is' : 'are'} set with configure_agent (or on the agent's Config). The note holds its title, description, tags and brief.`
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
  const denial =
    (await writeDenialFull(p, context, path)) ??
    lockedDenial(p, context, path, origin, model) ??
    (await namedFolderDenial(p, context, path, null, origin, model))
  if (denial) return { status: 'denied', reason: denial }
  const current = await store.readNote(context, path)
  const declared = await configKindDenial(p, context, path, null, { current })
  if (declared) return { status: 'denied', reason: declared }
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
    const denial =
      writeDenial(p, context, end) ??
      lockedDenial(p, context, end, origin) ??
      (await namedFolderDenial(p, context, end, null, origin, model, end === to ? { movingFrom: from } : {}))
    if (denial) return { status: 'denied', reason: denial }
  }
  // The destination only: a note may always be moved OUT of a namespace whose
  // tool was switched off, and gating `from` would trap it there.
  const namespace = await namespaceFeatureDenial(context, to)
  if (namespace) return { status: 'denied', reason: namespace }
  // A connector or model moves as what it is: an admin's, to a place a
  // connector may sit, under a name the context does not already hold.
  const declared =
    (await configKindDenial(p, context, to, null, { movingFrom: from })) ??
    (await resourceHomeDenial(context, to, await store.readNoteOrNull(context, from)))
  if (declared) return { status: 'denied', reason: declared }
  // A note arriving at an agent's brief is held to what a write there is: it
  // may not bring run keys with it, or a move would set how an agent runs —
  // who it runs as, its reach — without the record's gates.
  const incoming = isShared(context) && !p.system ? await store.readNoteOrNull(context, from) : null
  if (incoming !== null && (isAgentBriefPath(to) || isAgentActivationPath(to) || briefFolderOf(to, incoming))) {
    const keys = incoming ? runKeysOf(parseFrontmatter(incoming)) : []
    if (keys.length) {
      return { status: 'denied', reason: `A note that says how an agent runs (${keys.map((k) => `\`${k}\``).join(', ')}) cannot become its brief — take those out, then set them with configure_agent.` }
    }
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
