/**
 * The bridge — the ONLY door from a running Tool to Visvine data.
 *
 * A Tool's UI runs in a sandboxed, cookie-less iframe and reaches nothing by
 * itself. It posts a message to the host page, which calls
 * `POST /api/tools/bridge` with the VIEWER's session, and that route calls this
 * file. `data.js` handlers reach the same functions as isolate capabilities
 * (lib/tools/dataRun.ts), so both halves of a Tool are gated identically — there
 * is no server-side path that a browser-side one lacks.
 *
 * Three rules hold for every method here, and everything else follows from them:
 *
 *   1. **Auth is always the viewer's own principal.** Nothing runs as the Tool,
 *      its author, or the space. contextService applies the viewer's grants and
 *      never learns a Tool was involved, so a Tool can never surface a note the
 *      viewer could not already open.
 *   2. **The perimeter only narrows.** It is checked BEFORE the grant check and
 *      can only subtract. A Tool declaring `read: ["**"]` still sees exactly what
 *      the viewer sees.
 *   3. **Nothing throws.** Every refusal is a BridgeError with a code the SDK
 *      branches on and a message safe to render in the Tool's own pane. A method
 *      that threw would surface as a broken frame instead of a failure the Tool
 *      can handle.
 *
 * The two codes an author must be able to tell apart are `perimeter` (this Tool
 * never declared the reach — fix the frontmatter) and `forbidden` (the viewer
 * lacks it — not the author's to fix). Keeping them distinct is why the
 * perimeter gate runs first: a Tool asking for something it never declared must
 * hear about the declaration, whether or not the viewer happened to have access.
 *
 * Every data function is reachable through `deps` so the tests can drive the
 * whole gate with stubs, and `REAL_DEPS` is the only place the real ones are
 * named.
 */
import { z } from 'zod'
import { logAudit } from '@/lib/notes/audit'
import {
  appendLogGated,
  canReadPath,
  readVisible,
  searchContext,
  visibleVault,
  writeDenial,
  writeGated,
} from '@/lib/notes/contextService'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { executeConnectorScript, loadConnector } from '@/lib/connectors/service'
import { ConnectorError, type ConnectorErrorCode } from '@/lib/connectors/config'
import { canTriggerRun } from '@/lib/agents/service'
import { claimManualRun } from '@/lib/agents/schedule'
import {
  configNamespaceOf,
  globMatch,
  isValidGlobEntry,
  refuseAgent,
  refuseConnector,
  refuseRead,
  refuseWrite,
} from './perimeter'
import { configFolderOf, configFoldersOf, type ConfigFolders } from './configReach'
import {
  BRIDGE_LIMITS,
  type BridgeErrorCode,
  type BridgeMethod,
  type BridgeResponse,
  type ContextEntry,
  type ContextHit,
} from './protocol'
import { runDataHandler, type IsolateCapabilities } from './dataRun'
import { getToolState, setToolState, STATE_MAX_BYTES, STATE_MAX_KEYS } from './state'
import { getRecord, queryRecords, setFields, type SetFieldsTarget } from '@/lib/records/service'
import { listResources } from '@/lib/resources/list'
import { loadView } from '@/lib/resources/views'
import { readResourceTextAs } from '@/lib/resources/text'
import { requireVisibleResource, resourceViewer } from '@/lib/resources/visibility'
import { logResourceAccess } from '@/lib/resources/accessLog'
import { referencesFor } from '@/lib/notes/contextService'
import { excerptsForTargets } from '@/lib/notes/shared/references'
import { splitFrontmatter } from '@/lib/notes/shared/markdown'
import type { ActionCaller } from '@/lib/actions/types'
import type { ToolReach } from '@visvine/tool-protocol/bindings'
import {
  refuseAction,
  refuseAi,
  refuseConnectorCall,
  refuseRecordRead,
  refuseRecordWrite,
  refuseResourceList,
  refuseResourceRead,
  usesAi,
} from '@visvine/tool-protocol/reach'
import { planToolAction, toolActionActs } from './actionAllowlist'
import { tenantArgDenial } from './toolActions'
import { resourceBlob, toToolResource } from './toolResources'
import { toolComplete, toolDecide } from './toolAi'
import { acquireDataCall, acquireDataCallShared } from './limits'
import { targetKey, type ResolvedTarget } from './target'
import { logger } from '@/lib/logger'
import { agentNameOfPath, isAgentBriefPath } from '@/lib/notes/entities'
import { configKindOfContent } from '@/lib/notes/shared/configKinds'
import { briefFolderOf } from '@/lib/agents/shared/folder'
import { declaresTool, toolFolderOfIndex } from './config'
import { actingReachOf, actsAsViewer, consentCovers, consentSentence, isActingMethod, type ActingReach } from './shared/listing'
import { consentFor } from './consents'
import { recordReviewEvent } from './review/events'
import { ISOLATE_METHODS, ISOLATE_PARAMS } from '@visvine/tool-protocol/isolate'
import { countRows, deleteRow, getRow, insertRow, listRows, updateRow, type CollectionAnswer } from './collections'
import { collectionDenial, LIST_LIMIT_MAX } from './shared/collections'
import { manifestOf } from './config'

/**
 * Everything the handlers touch that isn't pure. Injectable as one object so a
 * test can prove the perimeter refuses BEFORE any of it is called — which is the
 * property that actually matters, and the one a mocked module cannot show.
 */
export interface BridgeDeps {
  visibleVault: typeof visibleVault
  readVisible: typeof readVisible
  searchContext: typeof searchContext
  writeGated: typeof writeGated
  appendLogGated: typeof appendLogGated
  loadConnector: typeof loadConnector
  executeConnectorScript: typeof executeConnectorScript
  canTriggerRun: typeof canTriggerRun
  claimManualRun: typeof claimManualRun
  getToolState: typeof getToolState
  setToolState: typeof setToolState
  runDataHandler: typeof runDataHandler
  logAudit: typeof logAudit
  /** A `data.call` slot for a target; absent, the in-process gate (tests). */
  acquireDataSlot?: (key: string) => Promise<(() => void) | null>
  queryRecords: typeof queryRecords
  getRecord: typeof getRecord
  setFields: typeof setFields
  referencesFor: typeof referencesFor
  resourceViewer: typeof resourceViewer
  listResources: typeof listResources
  loadView: typeof loadView
  requireVisibleResource: typeof requireVisibleResource
  readResourceText: typeof readResourceTextAs
  resourceBlob: typeof resourceBlob
  logResourceAccess: typeof logResourceAccess
  tenantArgDenial: typeof tenantArgDenial
  /** Run one action as the viewer (lib/actions/run.ts), reached lazily: the registry imports half the app. */
  runAction: (caller: ActionCaller, name: string, input: unknown) => Promise<unknown>
  complete: typeof toolComplete
  decide: typeof toolDecide
  /** What a member last consented to for an install (lib/tools/consents.ts). Absent: no first-use gate (tests). */
  consentFor?: (installId: string, userId: string) => Promise<ActingReach | null>
  /** Where a dynamic run's evidence goes (lib/tools/review/events.ts). Absent: nothing recorded (tests). */
  recordReviewEvent?: typeof recordReviewEvent
  /** The Tool's collections (lib/tools/collections.ts). */
  collections: {
    insert: typeof insertRow
    list: typeof listRows
    get: typeof getRow
    update: typeof updateRow
    delete: typeof deleteRow
    count: typeof countRows
  }
}

/** The real ones, named in exactly one place. Not exported: a caller wanting
 *  the real bridge simply omits `deps`, and a caller wanting stubs passes them. */
const REAL_DEPS: BridgeDeps = {
  visibleVault,
  readVisible,
  searchContext,
  writeGated,
  appendLogGated,
  loadConnector,
  executeConnectorScript,
  canTriggerRun,
  claimManualRun,
  getToolState,
  setToolState,
  runDataHandler,
  logAudit,
  acquireDataSlot: acquireDataCallShared,
  queryRecords,
  getRecord,
  setFields,
  referencesFor,
  resourceViewer,
  listResources,
  loadView,
  requireVisibleResource,
  readResourceText: readResourceTextAs,
  resourceBlob,
  logResourceAccess,
  tenantArgDenial,
  runAction: async (caller, name, input) => (await (await import('@/lib/actions/run')).runAction(caller, name, input)).result,
  complete: toolComplete,
  decide: toolDecide,
  consentFor,
  recordReviewEvent,
  collections: { insert: insertRow, list: listRows, get: getRow, update: updateRow, delete: deleteRow, count: countRows },
}

// ── shapes ────────────────────────────────────────────────────────────────────

function err(code: BridgeErrorCode, message: string): BridgeResponse {
  return { ok: false, error: { code, message } }
}

function ok(value: unknown): BridgeResponse {
  return { ok: true, value }
}

/** Params off the wire → a typed value, or the `invalid` error saying why not. */
function parseParams<T>(
  schema: z.ZodType<T>,
  params: unknown,
): { ok: true; value: T } | { ok: false; response: BridgeResponse } {
  const parsed = schema.safeParse(params ?? {})
  if (parsed.success) return { ok: true, value: parsed.data }
  const detail = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || 'params'}: ${issue.message}`)
    .join('; ')
  return { ok: false, response: err('invalid', detail) }
}

const PATH_MAX = 512

/**
 * Paging. A cursor is opaque to the Tool but plain here: base64url of the
 * last path handed out (list, which is path-ordered) or of the offset (search,
 * which is rank-ordered). Nothing in it is secret — the perimeter and grants
 * are re-applied on every page — so a forged cursor can only ever skip rows.
 */
const CURSOR_MAX = 1_024
/** How far a paged search will go in total; ranking past this is noise. */
const SEARCH_PAGE_MAX_TOTAL = 1_000

function encodeCursor(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): string | null {
  try {
    const text = Buffer.from(cursor, 'base64url').toString('utf8')
    return encodeCursor(text) === cursor ? text : null
  } catch {
    return null
  }
}

const RECORD_KEY = z.string().min(1).max(64)
const RECORD_SCALAR = z.union([z.string().max(500), z.number()])
const RECORD_WHERE = z.discriminatedUnion('op', [
  z.object({ key: RECORD_KEY, op: z.literal('eq'), value: z.union([z.string().max(500), z.number(), z.boolean()]) }),
  z.object({ key: RECORD_KEY, op: z.literal('in'), values: z.array(RECORD_SCALAR).max(100) }),
  z.object({ key: RECORD_KEY, op: z.literal('range'), min: RECORD_SCALAR.optional(), max: RECORD_SCALAR.optional() }),
  z.object({ key: RECORD_KEY, op: z.literal('contains'), value: z.string().max(500) }),
])
const RECORD_TARGET = z
  .object({ path: z.string().min(1).max(PATH_MAX).optional(), nodeId: z.string().min(1).max(200).optional() })
  .refine((v) => (v.path === undefined) !== (v.nodeId === undefined), { message: 'pass exactly one of path or nodeId' })

const COLLECTION = z.string().min(1).max(64)
const ROW_ID = z.string().min(1).max(200)
const ROW_DATA = z.record(z.string().min(1).max(64), z.unknown())
const COLLECTION_WHERE = z.record(z.string().min(1).max(64), z.union([z.string().max(500), z.number(), z.boolean(), z.null()]))

const P = {
  list: z.object({
    glob: z.string().max(PATH_MAX).optional(),
    cursor: z.string().min(1).max(CURSOR_MAX).optional(),
    page: z.boolean().optional(),
  }),
  read: z.object({ path: z.string().min(1).max(PATH_MAX) }),
  search: z.object({
    query: z.string().min(1).max(2_000),
    k: z.number().int().min(1).max(BRIDGE_LIMITS.maxRows).optional(),
    cursor: z.string().min(1).max(CURSOR_MAX).optional(),
    page: z.boolean().optional(),
  }),
  write: z.object({ path: z.string().min(1).max(PATH_MAX), content: z.string() }),
  append: z.object({ path: z.string().min(1).max(PATH_MAX), text: z.string().min(1) }),
  connector: z
    .object({
      name: z.string().min(1).max(64),
      code: z.string().min(1).optional(),
      action: z.string().min(1).max(64).optional(),
      args: z.unknown().optional(),
    })
    .refine((v) => (v.code === undefined) !== (v.action === undefined), {
      message: 'pass exactly one of code or action',
    }),
  agent: z.object({ name: z.string().min(1).max(64) }),
  data: z.object({ fn: z.string().min(1).max(64), args: z.unknown() }),
  stateGet: z.object({ key: z.string().min(1).max(200), scope: z.enum(['user', 'install']).optional() }),
  stateSet: z.object({ key: z.string().min(1).max(200), value: z.unknown(), scope: z.enum(['user', 'install']).optional() }),
  links: z.object({ path: z.string().min(1).max(PATH_MAX) }),
  recordsQuery: z.object({
    type: z.string().min(1).max(64),
    where: z.array(RECORD_WHERE).max(10).optional(),
    order: z.object({ key: z.string().min(1).max(64), direction: z.enum(['asc', 'desc']) }).optional(),
    limit: z.number().int().min(1).max(BRIDGE_LIMITS.maxRows).optional(),
    cursor: z.string().min(1).max(CURSOR_MAX).optional(),
  }),
  recordTarget: RECORD_TARGET,
  recordsUpdate: z
    .object({
      path: z.string().min(1).max(PATH_MAX).optional(),
      nodeId: z.string().min(1).max(200).optional(),
      fields: z.record(z.string().min(1).max(64), z.unknown()),
    })
    .refine((v) => (v.path === undefined) !== (v.nodeId === undefined), { message: 'pass exactly one of path or nodeId' })
    .refine((v) => Object.keys(v.fields).length > 0 && Object.keys(v.fields).length <= 50, { message: 'name 1–50 fields' }),
  resourcesList: z.object({
    folder: z.string().min(1).max(PATH_MAX).optional(),
    kind: z.string().min(1).max(20).optional(),
    q: z.string().min(1).max(200).optional(),
    cursor: z.string().min(1).max(CURSOR_MAX).optional(),
  }),
  resource: z.object({ id: z.string().min(1).max(200) }),
  resourceRead: z.object({ id: z.string().min(1).max(200), offset: z.number().int().min(0).optional() }),
  resourceBlob: z.object({ id: z.string().min(1).max(200), rendition: z.enum(['original', 'thumb', 'preview']).optional() }),
  action: z.object({ name: z.string().min(1).max(64), input: z.record(z.string(), z.unknown()).optional() }),
  complete: z
    .object({
      prompt: z.string().min(1).max(32_000).optional(),
      system: z.string().min(1).max(8_000).optional(),
      messages: z
        .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(32_000) }))
        .min(1)
        .max(40)
        .optional(),
      maxTokens: z.number().int().min(1).max(BRIDGE_LIMITS.aiMaxOutputTokens).optional(),
    })
    .refine((v) => (v.prompt === undefined) !== (v.messages === undefined), { message: 'pass exactly one of prompt or messages' }),
  decide: z.object({
    items: z.array(z.string().max(6_000)).min(1).max(BRIDGE_LIMITS.aiMaxDecideItems),
    questions: z.array(z.unknown()).min(1).max(6),
  }),
  collectionInsert: z.object({ collection: COLLECTION, data: ROW_DATA }),
  collectionList: z.object({
    collection: COLLECTION,
    where: COLLECTION_WHERE.optional(),
    mine: z.boolean().optional(),
    order: z.enum(['asc', 'desc']).optional(),
    limit: z.number().int().min(1).max(LIST_LIMIT_MAX).optional(),
    cursor: z.string().min(1).max(CURSOR_MAX).optional(),
  }),
  collectionRow: z.object({ collection: COLLECTION, id: ROW_ID }),
  collectionUpdate: z.object({ collection: COLLECTION, id: ROW_ID, data: ROW_DATA }),
  collectionCount: z.object({
    collection: COLLECTION,
    where: COLLECTION_WHERE.optional(),
    mine: z.boolean().optional(),
    groupBy: z.string().min(1).max(64).optional(),
  }),
}

// ── paths ─────────────────────────────────────────────────────────────────────

/**
 * A path a Tool asked for → the stored form, or null when it is not a path a
 * note can have.
 *
 * The perimeter matches literally, so this runs FIRST and refuses everything
 * that could mean two things: `..` segments, backslashes, doubled slashes,
 * control characters. `deals/../../secrets/pay.md` must never reach a glob test
 * as a string that starts with `deals/`.
 */
function normalizeNotePath(raw: string): string | null {
  const trimmed = raw.trim().replace(/^\/+/, '')
  if (!trimmed || trimmed.length > PATH_MAX) return null
  if (trimmed.includes('\\') || /[\u0000-\u001f\u007f]/.test(trimmed)) return null
  const segments = trimmed.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null
  return segments.join('/')
}

/**
 * Namespaces a Tool may never write, whatever its perimeter says.
 *
 * These three hold EXECUTABLE configuration: connector notes carry the hosts and
 * secret names a run may use, agent briefs are run unattended on the space's
 * model key, and a Tool's own sources are compiled and served as code. A Tool
 * that could write them could grant itself reach that no reviewer ever saw — the
 * declared perimeter is meant to be the whole story, and a write into these
 * folders is how it would stop being one.
 *
 * `writeDenial` already keeps non-admins out of `connectors/`, so this is the
 * belt to that pair of braces, and it binds admins too.
 *
 * ONE exception, in {@link agentBriefExemption}: creating the brief of an agent
 * the Tool's own perimeter names. See that comment for why the brief is not the
 * thing that runs.
 *
 * That exception has a second-order effect worth stating, because it looks like a
 * hole and is not: creating `agents/<name>/index.md` also creates or updates
 * `agents/index.md`, since the note store maintains a folder index beside every
 * folder. So an exempt write does touch a second path inside a sealed namespace.
 * It is benign — the index is a generated children listing, and it can only ever
 * name briefs this Tool was already permitted to create.
 */
const SEALED_WRITE_DIRS = ['tools', 'agents', 'connectors', 'models'] as const

function sealedNamespace(path: string): string | null {
  const top = path.split('/')[0]
  return (SEALED_WRITE_DIRS as readonly string[]).includes(top) ? top : null
}

/**
 * `agents/<name>/index.md` → `<name>`. The brief and nothing else in the
 * folder: everything else under `agents/<name>/` is the agent's own output,
 * and it gets nothing from the exception below.
 */
function agentBriefName(path: string): string | null {
  return isAgentBriefPath(path) ? agentNameOfPath(path) : null
}

/**
 * Does this perimeter name that agent BY NAME? A bare `*` does not: the whole
 * point of the exemption is that an admin reading the install screen saw which
 * agent this Tool would author, and `agents: ["*"]` tells them nothing. A prefix
 * (`digest-*`) does count — it is a namespace the reviewer can read.
 *
 * Reuses refuseAgent rather than re-implementing nameMatch, so "which names does
 * this entry cover" has exactly one answer in the codebase.
 */
function declaresAgentByName(perimeter: ResolvedTarget['perimeter'], name: string): boolean {
  const named = perimeter.agents.filter((entry) => entry.trim() !== '*')
  if (named.length === 0) return false
  return refuseAgent({ ...perimeter, agents: named }, name) === null
}

/**
 * The brief is the one thing under a sealed namespace a Tool may write, and only
 * ever by creating it.
 *
 * The brief (`agents/<name>/index.md`) is member-writable on purpose. What
 * makes an agent RUN is `active:` in that same frontmatter, and the check
 * above refuses a Tool-written brief that carries it — so a Tool creating a
 * brief hands a person something to read and switch on; it does not start
 * anything. `claimManualRun` refuses an inactive agent, so even `agents.run`
 * on a Tool-authored brief does nothing until a person has said yes.
 *
 * CREATE, never overwrite, and never append. An admin who activated an agent
 * approved a specific brief; the hook that auto-deactivates on a member's edit
 * (lib/agents/hooks.ts, rule 2) deliberately exempts admins, so a Tool allowed to
 * rewrite briefs could swap an approved agent's instructions while an admin
 * happened to be viewing it and reach connectors it never declared. A Tool has no
 * delete and no move, so "the path is free" is a property it cannot manufacture.
 *
 * Returns null when the write is exempt, else the reason it is not.
 */
function agentBriefExemption(
  t: ResolvedTarget,
  path: string,
  body: string,
  mode: 'write' | 'append',
): string | null {
  if (mode === 'append') {
    return 'a tool may create the brief of an agent it declared, never append to one'
  }
  const name = agentBriefName(path)
  if (!name) {
    return 'only a brief at agents/<name>/index.md is exempt — the rest of the folder is written by the agent itself'
  }
  // The brief carries the activation now (lib/agents/config.ts), so "a Tool
  // hands a person something to approve" has to be enforced on the CONTENT,
  // not just the path: a brief that arrives already switched on would be a
  // Tool starting an unattended run on the space's model key, which is the
  // one thing this exemption promises it cannot do.
  if (parseFrontmatter(body).active === true) {
    return 'a tool writes a brief for a person to switch on — `active: true` in it would be the tool starting the agent itself'
  }
  if (!declaresAgentByName(t.perimeter, name)) {
    return t.perimeter.agents.length > 0
      ? `this tool's perimeter does not name the agent "${name}" (it declares ${t.perimeter.agents.join(', ')}, and a bare "*" names nobody)`
      : `this tool declares no agents, so it may not author "${name}"`
  }
  return null
}

// ── a draft's authors ─────────────────────────────────────────────────────────

/**
 * A preview runs unreviewed code, so it runs with the INTERSECTION of the
 * viewer and everyone else who wrote the draft since its last approval
 * (lib/tools/draftAuthors.ts): each of these asks "could all of them?".
 */
function coAuthors(t: ResolvedTarget): ContextPrincipal[] {
  return t.coPrincipals ?? []
}

function coAuthorsCanRead(t: ResolvedTarget, path: string): boolean {
  return coAuthors(t).every((p) => canReadPath(p, t.context, path))
}

const DRAFT_REACH =
  'This draft runs with the reach of the people who wrote it since it was last approved'

// ── configuration that runs ───────────────────────────────────────────────────

/**
 * Configuration filed outside the namespaces, by declaration. The namespaces
 * themselves are refuseRead's own rule; this finds the rest from the vault the
 * viewer can see.
 */
async function declaredConfig(t: ResolvedTarget, deps: BridgeDeps): Promise<ConfigFolders> {
  const { metas } = await deps.visibleVault(t.principal, t.context)
  return configFoldersOf(metas)
}

function readRefusal(t: ResolvedTarget, path: string, config: ConfigFolders | null): string | null {
  return refuseRead(t.perimeter, path, config ? { configFolder: configFolderOf(path, config) } : {})
}

/** How a Tool is named in an audit line — the store has no `tool` origin to carry it. */
function toolLabel(t: ResolvedTarget): string {
  return t.installId === null ? `tool:${t.config.name} (preview)` : `tool:${t.config.name}`
}

// ── context ───────────────────────────────────────────────────────────────────

async function contextList(t: ResolvedTarget, params: unknown, deps: BridgeDeps): Promise<BridgeResponse> {
  const parsed = parseParams(P.list, params)
  if (!parsed.ok) return parsed.response
  const { glob, cursor, page } = parsed.value
  const paged = page === true || cursor !== undefined
  const after = cursor === undefined ? null : decodeCursor(cursor)
  if (cursor !== undefined && after === null) return err('invalid', 'That cursor is not one this Tool was given.')

  // A caller-supplied glob gets no more trust than an author's declared one:
  // it must pass the same grammar and backtracking cap before it ever reaches
  // globMatch, or a member could hang the whole Node process with one call
  // (see the file comment on isGlobPatternSafe in perimeter.ts).
  if (glob && !isValidGlobEntry(glob)) return err('invalid', `"${glob}" is not a usable glob.`)

  // An undeclared reach must say so rather than come back empty: "no rows" and
  // "you never asked for any" look identical to an author otherwise. The path
  // handed in is irrelevant — with no read globs the gate answers the same way
  // for every one of them.
  if (t.perimeter.read.length === 0) return err('perimeter', refuseRead(t.perimeter, glob ?? '**')!)

  const { metas } = await deps.visibleVault(t.principal, t.context)
  const config = configFoldersOf(metas)
  const rows: ContextEntry[] = []
  let more = false
  // Path order (not localeCompare) so the cursor's "after this path" test and
  // the sort agree byte for byte.
  for (const meta of [...metas].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    if (after !== null && meta.path <= after) continue
    if (glob && !globMatch(glob, meta.path)) continue
    if (readRefusal(t, meta.path, config)) continue
    if (!coAuthorsCanRead(t, meta.path)) continue
    // Truncate rather than refuse — the SDK documents a capped list, so a Tool
    // over a big folder degrades to a page instead of failing outright. A paged
    // caller learns there is more; an unpaged one gets the first page as before.
    if (rows.length >= BRIDGE_LIMITS.maxRows) {
      more = true
      break
    }
    const type = meta.frontmatter.type
    rows.push({
      path: meta.path,
      title: meta.title || null,
      type: typeof type === 'string' ? type : null,
      updatedAt: new Date(meta.mtime).toISOString(),
    })
  }
  if (!paged) return ok(rows)
  const last = rows[rows.length - 1]
  return ok({ items: rows, nextCursor: more && last ? encodeCursor(last.path) : null })
}

async function contextRead(t: ResolvedTarget, params: unknown, deps: BridgeDeps): Promise<BridgeResponse> {
  const parsed = parseParams(P.read, params)
  if (!parsed.ok) return parsed.response
  const path = normalizeNotePath(parsed.value.path)
  if (!path) return err('invalid', `"${parsed.value.path}" is not a note path.`)

  const refusal = refuseRead(t.perimeter, path)
  if (refusal) return err('perimeter', refusal)
  // A draft's author who could not read it makes it absent, like the viewer.
  if (!coAuthorsCanRead(t, path)) return err('not_found', `No note at ${path}.`)

  const content = await deps.readVisible(t.principal, t.context, path)
  // readVisible answers null for absent AND for invisible, on purpose: a Tool
  // must not be able to map a folder it cannot read by watching which paths
  // fail differently.
  if (content === null) return err('not_found', `No note at ${path}.`)

  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes > BRIDGE_LIMITS.maxReadBytes) {
    return err(
      'too_large',
      `${path} is ${bytes} bytes, over the ${BRIDGE_LIMITS.maxReadBytes} byte read limit.`,
    )
  }
  if (!configNamespaceOf(path)) {
    const declared = readRefusal(t, path, await declaredConfig(t, deps))
    if (declared) return err('perimeter', declared)
  }
  return ok({ path, content, frontmatter: parseFrontmatter(content) })
}

async function contextSearch(t: ResolvedTarget, params: unknown, deps: BridgeDeps): Promise<BridgeResponse> {
  const parsed = parseParams(P.search, params)
  if (!parsed.ok) return parsed.response
  const { query, k, cursor, page } = parsed.value
  if (t.perimeter.read.length === 0) return err('perimeter', refuseRead(t.perimeter, query)!)
  const paged = page === true || cursor !== undefined
  let offset = 0
  if (cursor !== undefined) {
    const decoded = decodeCursor(cursor)
    offset = decoded === null ? Number.NaN : Number(decoded)
    if (!Number.isInteger(offset) || offset < 0 || offset > SEARCH_PAGE_MAX_TOTAL) {
      return err('invalid', 'That cursor is not one this Tool was given.')
    }
  }
  const pageSize = Math.min(k ?? BRIDGE_LIMITS.maxRows, BRIDGE_LIMITS.maxRows)

  // Ask for the full cap and narrow afterwards: search ranks over everything the
  // VIEWER can read, and cutting to `k` first would spend the budget on hits the
  // perimeter is about to drop. A later page asks for everything up to its end
  // (ranking is not offset-able) and skips the pages already handed out; the
  // one extra hit past the page is how the caller learns there is a next one.
  const want = Math.min(Math.max(BRIDGE_LIMITS.maxRows, offset + pageSize + 1), SEARCH_PAGE_MAX_TOTAL + 1)
  const { hits } = await deps.searchContext(t.principal, t.context, query, {}, want)
  const reachable = hits.filter((hit) => refuseRead(t.perimeter, hit.path) === null && coAuthorsCanRead(t, hit.path))
  const config = reachable.some((hit) => !configNamespaceOf(hit.path)) ? await declaredConfig(t, deps) : null
  const inPerimeter = config ? reachable.filter((hit) => readRefusal(t, hit.path, config) === null) : reachable
  const slice = inPerimeter.slice(offset, offset + pageSize)
  const rows: ContextHit[] = slice.map((hit) => ({
    path: hit.path,
    title: hit.title || null,
    snippet: hit.snippet ?? '',
    score: hit.score,
  }))
  if (!paged) return ok(rows)
  const end = offset + rows.length
  const more = inPerimeter.length > end && end < SEARCH_PAGE_MAX_TOTAL
  return ok({ items: rows, nextCursor: more ? encodeCursor(String(end)) : null })
}

/** The shared front half of write and append: same path rules, same caps. */
async function checkWrite(
  t: ResolvedTarget,
  rawPath: string,
  body: string,
  mode: 'write' | 'append',
  deps: BridgeDeps,
): Promise<{ ok: true; path: string } | { ok: false; response: BridgeResponse }> {
  const path = normalizeNotePath(rawPath)
  if (!path) return { ok: false, response: err('invalid', `"${rawPath}" is not a note path.`) }
  if (!path.toLowerCase().endsWith('.md')) {
    return {
      ok: false,
      response: err('invalid', `Tools write markdown notes — ${path} must end in .md.`),
    }
  }
  const refusal = refuseWrite(t.perimeter, path)
  if (refusal) return { ok: false, response: err('perimeter', refusal) }
  if (coAuthors(t).some((p) => writeDenial(p, t.context, path) !== null)) {
    return { ok: false, response: err('forbidden', `${DRAFT_REACH}, and one of them may not write ${path}.`) }
  }

  const bytes = Buffer.byteLength(body, 'utf8')
  if (bytes > BRIDGE_LIMITS.maxWriteBytes) {
    return {
      ok: false,
      response: err(
        'too_large',
        `That is ${bytes} bytes, over the ${BRIDGE_LIMITS.maxWriteBytes} byte write limit.`,
      ),
    }
  }

  const sealed = sealedNamespace(path)
  if (sealed) {
    const notExempt = sealed === 'agents' ? agentBriefExemption(t, path, body, mode) : 'no tool may write there, whatever its perimeter declares'
    if (notExempt) {
      return {
        ok: false,
        response: err('forbidden', `${sealed}/ holds configuration that runs — ${notExempt}.`),
      }
    }
    // Create-only, checked last because it costs a read: an existing brief is an
    // admin's approved instructions and a Tool never edits one. readVisible
    // answers null for absent AND for invisible, and an invisible note is not
    // writable either — writeGated refuses it a moment later on the same grants.
    if ((await deps.readVisible(t.principal, t.context, path)) !== null) {
      return {
        ok: false,
        response: err(
          'forbidden',
          `${path} already exists — a tool may create an agent brief but never change one. ` +
            'Editing the instructions an admin approved is a person’s act.',
        ),
      }
    }
  } else {
    // A connector, a model or an agent is what a note DECLARES, wherever it is
    // filed (lib/notes/shared/configKinds.ts, lib/agents/shared/folder.ts), so
    // the seal follows the declaration too: a Tool neither mints one in a
    // folder of the space's own nor edits one already there.
    const current = await deps.readVisible(t.principal, t.context, path)
    // A Tool's folder is the note's own, or — for a module under `src/` — the
    // one above it: both are sealed, wherever the Tool is filed.
    const dir = path.slice(0, path.lastIndexOf('/'))
    const homes = dir && !path.endsWith('/index.md') ? [dir, ...(dir.endsWith('/src') ? [dir.slice(0, -'/src'.length)] : [])] : []
    let inTool = false
    for (const home of homes) {
      if (declaresTool(await deps.readVisible(t.principal, t.context, `${home}/index.md`))) inTool = true
    }
    const kind =
      configKindOfContent(body) ??
      configKindOfContent(current) ??
      (briefFolderOf(path, body) || briefFolderOf(path, current) ? 'agent brief' : null) ??
      (inTool || toolFolderOfIndex(path, declaresTool(body) || declaresTool(current)) ? 'tool’s source' : null)
    if (kind) {
      return {
        ok: false,
        response: err('forbidden', `${kind === 'agent brief' ? 'an' : 'a'} ${kind} is configuration that runs — no tool may write one, whatever its perimeter declares.`),
      }
    }
  }
  return { ok: true, path }
}

/**
 * The revision origin a Tool's write is recorded under.
 *
 * NoteRevisionOrigin has no `tool` member and this is deliberately not the place
 * to add one — the store's origin list drives the "Freeze for AI" gate
 * (contextService#lockedDenial), and a new value would silently be outside it.
 * `edit` is the honest reading: a Tool write happens because a person clicked
 * something in a Tool's pane, under that person's own principal, in the same
 * moment. Which Tool did it goes in the audit line instead.
 */
const TOOL_WRITE_ORIGIN = 'edit'

/**
 * A Tool that may ask the space's AI writes as AI-assisted text: its text may
 * be the model's, so a folder frozen for AI refuses it as it refuses an
 * agent's. Everything else about the write is the viewer's own.
 */
const TOOL_AI_WRITE_ORIGIN = 'ai-enrich'

function writeOrigin(t: ResolvedTarget): typeof TOOL_WRITE_ORIGIN | typeof TOOL_AI_WRITE_ORIGIN {
  return usesAi(reachOf(t)) ? TOOL_AI_WRITE_ORIGIN : TOOL_WRITE_ORIGIN
}

/** The bound reach, with manifest 2's families empty for a target resolved without one. */
function reachOf(t: ResolvedTarget): ToolReach {
  return (
    t.reach ?? {
      ...t.perimeter,
      records: { read: [], write: [] },
      resources: { read: [] },
      connectorActions: {},
      actions: [],
      ai: { complete: false, decide: false },
      ui: { download: false },
    }
  )
}

async function contextWrite(t: ResolvedTarget, params: unknown, deps: BridgeDeps): Promise<BridgeResponse> {
  const parsed = parseParams(P.write, params)
  if (!parsed.ok) return parsed.response
  const checked = await checkWrite(t, parsed.value.path, parsed.value.content, 'write', deps)
  if (!checked.ok) return checked.response

  const result = await deps.writeGated(
    t.principal,
    t.context,
    checked.path,
    parsed.value.content,
    writeOrigin(t),
  )
  if (result.status === 'denied') return err('forbidden', result.reason)
  void deps.logAudit(t.spaceId, {
    userId: t.principal.userId,
    name: t.principal.name,
    action: 'tool',
    path: result.path ?? checked.path,
    detail: `${toolLabel(t)} write`,
  })
  return ok({ path: result.path ?? checked.path })
}

async function contextAppend(t: ResolvedTarget, params: unknown, deps: BridgeDeps): Promise<BridgeResponse> {
  const parsed = parseParams(P.append, params)
  if (!parsed.ok) return parsed.response
  const checked = await checkWrite(t, parsed.value.path, parsed.value.text, 'append', deps)
  if (!checked.ok) return checked.response

  const result = await deps.appendLogGated(
    t.principal,
    t.context,
    checked.path,
    parsed.value.text,
    writeOrigin(t),
  )
  if (result.status === 'denied') return err('forbidden', result.reason)
  void deps.logAudit(t.spaceId, {
    userId: t.principal.userId,
    name: t.principal.name,
    action: 'tool',
    path: result.path ?? checked.path,
    detail: `${toolLabel(t)} append`,
  })
  return ok({ path: result.path ?? checked.path })
}

// ── connectors ────────────────────────────────────────────────────────────────

/** A connector failure → the bridge code that says the same thing to a Tool. */
const CONNECTOR_CODES: Record<ConnectorErrorCode, BridgeErrorCode> = {
  denied: 'forbidden',
  config: 'invalid',
  // The space never set the secret this connector needs: the Tool declared it,
  // the space lacks it — which is exactly what `degraded` means.
  missing_secret: 'degraded',
  ssrf: 'forbidden',
  timeout: 'timeout',
  upstream: 'internal',
  rate_limited: 'rate_limited',
}

/** Is this name one the install's requirements marked missing? */
function missingHere(list: string[] | undefined, name: string): boolean {
  return (list ?? []).some((entry) => entry.toLowerCase() === name.trim().toLowerCase())
}

async function connectorsCall(t: ResolvedTarget, params: unknown, deps: BridgeDeps): Promise<BridgeResponse> {
  const parsed = parseParams(P.connector, params)
  if (!parsed.ok) return parsed.response
  const { name, code, action, args } = parsed.value

  const refusal = refuseConnector(t.perimeter, name) ?? refuseConnectorCall(reachOf(t), name, { code, action }, { foreign: t.foreign })
  if (refusal) return err('perimeter', refusal)
  const held = await heldForReview(t, 'connectors.call', { name, action: action ?? null, code: code ?? null, args: args ?? null }, deps)
  if (held) return held
  if (missingHere(t.degraded?.missing.connectors, name)) {
    return err('degraded', `This space has no "${name}" connector — the tool is running degraded.`)
  }

  try {
    // Exactly what MCP's run_connector does: load through the visibility lens
    // (so folder permissions decide whether the connector is even there) and
    // execute under the viewer's principal. No admin widening, no thinner path.
    // `personal: false` — a Tool reaches only what the space that wrote it has.
    // The viewer never chose to run this code, so their own connectors (and
    // the accounts behind them) are not this page's to spend. What the PARENT
    // shares with this sub-space is the space's to spend — the parent chose
    // to lend it — so that lookup stays on (`shared` defaults true).
    const loaded = await deps.loadConnector(t.principal, t.context, name, { personal: false })
    if (!loaded) return err('not_found', `No connector named "${name}" here.`)
    for (const author of coAuthors(t)) {
      if (!(await deps.loadConnector(author, t.context, name, { personal: false }))) {
        return err('forbidden', `${DRAFT_REACH}, and one of them may not use "${name}".`)
      }
    }
    const result = await deps.executeConnectorScript(
      loaded,
      action !== undefined ? { action, args: args ?? {} } : { code: code! },
    )
    return ok({
      ok: result.ok,
      value: result.value,
      logs: result.logs,
      error: result.error,
      truncated: result.truncated,
      timedOut: result.timedOut,
      denials: result.denials,
      durationMs: result.durationMs,
    })
  } catch (e) {
    if (e instanceof ConnectorError) return err(CONNECTOR_CODES[e.code], e.message)
    throw e
  }
}

// ── agents ────────────────────────────────────────────────────────────────────

async function agentsRun(t: ResolvedTarget, params: unknown, deps: BridgeDeps): Promise<BridgeResponse> {
  const parsed = parseParams(P.agent, params)
  if (!parsed.ok) return parsed.response
  const { name } = parsed.value

  const refusal = refuseAgent(t.perimeter, name)
  if (refusal) return err('perimeter', refusal)
  const held = await heldForReview(t, 'agents.run', { name, params }, deps)
  if (held) return held
  if (missingHere(t.degraded?.missing.agents, name)) {
    return err('degraded', `This space has no "${name}" agent — the tool is running degraded.`)
  }
  // The same check run_agent applies: running is for whoever can edit the
  // brief. There is no feature gate — agents are Context, and Context is always on.
  if (!(await deps.canTriggerRun(t.principal, t.spaceId, name))) {
    return err('forbidden', 'Only someone who can edit this agent can run it.')
  }
  for (const author of coAuthors(t)) {
    if (!(await deps.canTriggerRun(author, t.spaceId, name))) {
      return err('forbidden', `${DRAFT_REACH}, and one of them may not run "${name}".`)
    }
  }

  const claimed = await deps.claimManualRun(t.spaceId, name, t.principal.userId)
  if (!claimed.ok) {
    // 'busy' is "try again shortly", which is what rate_limited tells a Tool to
    // do; 'inactive' is a decision an admin has to make.
    return err(claimed.code === 'unknown' ? 'not_found' : claimed.code === 'busy' ? 'rate_limited' : 'forbidden', claimed.message)
  }
  // The run is dispatched, not awaited: an agent run can take minutes and the
  // Tool holds a bridge call open. The runId is what it needs to poll with.
  void claimed.dispatch?.catch(() => {
    /* the run records its own failure; a rejected dispatch must not become an unhandled rejection */
  })
  return ok({ runId: claimed.runId })
}

// ── data ──────────────────────────────────────────────────────────────────────

async function dataCall(t: ResolvedTarget, params: unknown, deps: BridgeDeps): Promise<BridgeResponse> {
  const parsed = parseParams(P.data, params)
  if (!parsed.ok) return parsed.response

  const key = targetKey(t)
  const release = deps.acquireDataSlot ? await deps.acquireDataSlot(key) : acquireDataCall(key)
  if (!release) {
    return err('rate_limited', 'This tool already has two data handlers running — try again in a moment.')
  }
  try {
    return await deps.runDataHandler(t, parsed.value.fn, parsed.value.args ?? null, {
      capabilities: bridgeCapabilities(t, deps),
    })
  } finally {
    release()
  }
}

// ── state ─────────────────────────────────────────────────────────────────────

async function stateGet(t: ResolvedTarget, params: unknown, deps: BridgeDeps): Promise<BridgeResponse> {
  const parsed = parseParams(P.stateGet, params)
  if (!parsed.ok) return parsed.response
  return ok(await deps.getToolState(t, parsed.value.key, parsed.value.scope ?? 'install'))
}

async function stateSet(t: ResolvedTarget, params: unknown, deps: BridgeDeps): Promise<BridgeResponse> {
  const parsed = parseParams(P.stateSet, params)
  if (!parsed.ok) return parsed.response
  const result = await deps.setToolState(t, parsed.value.key, parsed.value.value ?? null, parsed.value.scope ?? 'install')
  if (!result.ok) {
    if (result.reason === 'key_limit') {
      return err(
        'too_large',
        `This tool already has ${STATE_MAX_KEYS} state keys stored, the per-install limit — ` +
          'clear one before adding a new one.',
      )
    }
    return err(
      'too_large',
      `That value is ${result.bytes} bytes, over the ${STATE_MAX_BYTES} byte state limit — ` +
        'write a note instead if it is space data.',
    )
  }
  return ok(null)
}

// ── links ─────────────────────────────────────────────────────────────────────

/**
 * The notes a note links to, and the notes that link to it — each one a note
 * the Tool may read and the viewer can open. A link from a note outside either
 * is not reported at all: not even that it exists.
 */
async function contextLinks(t: ResolvedTarget, params: unknown, deps: BridgeDeps): Promise<BridgeResponse> {
  const parsed = parseParams(P.links, params)
  if (!parsed.ok) return parsed.response
  const path = normalizeNotePath(parsed.value.path)
  if (!path) return err('invalid', `"${parsed.value.path}" is not a note path.`)
  const refusal = refuseRead(t.perimeter, path)
  if (refusal) return err('perimeter', refusal)
  if (!coAuthorsCanRead(t, path)) return err('not_found', `No note at ${path}.`)
  const content = await deps.readVisible(t.principal, t.context, path)
  if (content === null) return err('not_found', `No note at ${path}.`)

  const { metas } = await deps.visibleVault(t.principal, t.context)
  const config = configFoldersOf(metas)
  const declared = readRefusal(t, path, config)
  if (declared) return err('perimeter', declared)
  const titles = new Map(metas.map((m) => [m.path, m.title || null]))
  const reachable = (other: string) => titles.has(other) && readRefusal(t, other, config) === null && coAuthorsCanRead(t, other)
  const outgoing = [...excerptsForTargets(path, splitFrontmatter(content).body).keys()]
    .filter((target) => target !== path && reachable(target))
    .slice(0, BRIDGE_LIMITS.maxRows)
    .map((target) => ({ path: target, title: titles.get(target) ?? null }))
  const refs = await deps.referencesFor(t.principal, t.context, path)
  const seen = new Set<string>()
  const incoming = refs.linked
    .filter((ref) => reachable(ref.fromPath) && !seen.has(ref.fromPath) && seen.add(ref.fromPath))
    .slice(0, BRIDGE_LIMITS.maxRows)
    .map((ref) => ({ path: ref.fromPath, title: ref.fromTitle || null, excerpt: ref.excerpt }))
  return ok({ outgoing, incoming })
}

// ── records ───────────────────────────────────────────────────────────────────

/** A service refusal's status → the code a Tool branches on. */
function codeOfStatus(status: number): BridgeErrorCode {
  if (status === 404) return 'not_found'
  if (status === 403 || status === 401) return 'forbidden'
  if (status === 409) return 'forbidden'
  if (status === 429) return 'rate_limited'
  return status >= 500 ? 'internal' : 'invalid'
}

/** A record the Tool may not see through its notes: configuration, or a draft co-author's blind spot. */
function recordHidden(t: ResolvedTarget, path: string): boolean {
  if (!path) return false
  return configNamespaceOf(path) !== null || !coAuthorsCanRead(t, path)
}

/** A record named by its note or its node; null when the path is not one a note can have. */
function recordTargetOf(value: { path?: string; nodeId?: string }): SetFieldsTarget | null {
  if (value.path === undefined) return { nodeId: value.nodeId! }
  const path = normalizeNotePath(value.path)
  return path ? { path } : null
}

function declaresRecords(reach: ToolReach): boolean {
  return reach.records.read.length > 0 || reach.records.write.length > 0
}

async function recordsQuery(t: ResolvedTarget, params: unknown, deps: BridgeDeps): Promise<BridgeResponse> {
  const parsed = parseParams(P.recordsQuery, params)
  if (!parsed.ok) return parsed.response
  const refusal = refuseRecordRead(reachOf(t), parsed.value.type)
  if (refusal) return err('perimeter', refusal)
  const page = await deps.queryRecords(t.principal, t.context, {
    type: parsed.value.type,
    where: parsed.value.where,
    order: parsed.value.order,
    limit: parsed.value.limit,
    cursor: parsed.value.cursor ?? null,
  })
  if (!page.ok) return err(codeOfStatus(page.status), page.error)
  return ok({ type: page.type, rows: page.rows.filter((row) => !recordHidden(t, row.path)), nextCursor: page.nextCursor, total: page.total })
}

async function recordsGet(t: ResolvedTarget, params: unknown, deps: BridgeDeps): Promise<BridgeResponse> {
  const parsed = parseParams(P.recordTarget, params)
  if (!parsed.ok) return parsed.response
  const reach = reachOf(t)
  // Which type a record is, is only known by reading it — but a Tool that
  // declared no records at all is told so before anything is read.
  if (!declaresRecords(reach)) return err('perimeter', refuseRecordRead(reach, 'records')!)
  const target = recordTargetOf(parsed.value)
  if (!target) return err('invalid', `"${parsed.value.path}" is not a note path.`)
  if ('path' in target && recordHidden(t, target.path)) return err('not_found', 'No such record.')
  const found = await deps.getRecord(t.principal, t.context, target)
  if (!found.ok) return err(codeOfStatus(found.status), found.error)
  const refusal = refuseRecordRead(reach, found.record.type)
  if (refusal) return err('perimeter', refusal)
  if (recordHidden(t, found.record.path)) return err('not_found', 'No such record.')
  return ok(found.record)
}

async function recordsUpdate(t: ResolvedTarget, params: unknown, deps: BridgeDeps): Promise<BridgeResponse> {
  const parsed = parseParams(P.recordsUpdate, params)
  if (!parsed.ok) return parsed.response
  const reach = reachOf(t)
  if (reach.records.write.length === 0) {
    return err('perimeter', refuseRecordWrite(reach, 'records', Object.keys(parsed.value.fields))!)
  }
  const target = recordTargetOf(parsed.value)
  if (!target) return err('invalid', `"${parsed.value.path}" is not a note path.`)
  const found = await deps.getRecord(t.principal, t.context, target)
  if (!found.ok) return err(codeOfStatus(found.status), found.error)
  const refusal = refuseRecordWrite(reach, found.record.type, Object.keys(parsed.value.fields))
  if (refusal) return err('perimeter', refusal)
  const notePath = found.record.path
  if (recordHidden(t, notePath)) return err('not_found', 'No such record.')
  if (notePath && coAuthors(t).some((p) => writeDenial(p, t.context, notePath) !== null)) {
    return err('forbidden', `${DRAFT_REACH}, and one of them may not edit ${notePath}.`)
  }
  const written = await deps.setFields(
    t.principal,
    t.context,
    target,
    parsed.value.fields,
    { origin: writeOrigin(t) },
  )
  if (!written.ok) return err(codeOfStatus(written.status), written.error)
  void deps.logAudit(t.spaceId, {
    userId: t.principal.userId,
    name: t.principal.name,
    action: 'tool',
    path: notePath || written.record,
    detail: `${toolLabel(t)} set ${Object.keys(parsed.value.fields).join(', ')}`,
  })
  return ok({ record: written.record, fields: written.fields })
}

// ── resources ─────────────────────────────────────────────────────────────────

/**
 * One resource the viewer can see, in this space, inside the Tool's
 * `permissions.resources` — or the refusal. The declaration is asked first;
 * where a resource sits is only known once it is found, and one the viewer
 * cannot see reads as absent whatever the Tool declared.
 */
async function gatedResource(
  t: ResolvedTarget,
  id: string,
  deps: BridgeDeps,
): Promise<{ ok: true; view: NonNullable<Awaited<ReturnType<BridgeDeps['loadView']>>> } | { ok: false; response: BridgeResponse }> {
  const reach = reachOf(t)
  const declared = refuseResourceList(reach)
  if (declared) return { ok: false, response: err('perimeter', declared) }
  let gated
  try {
    gated = await deps.requireVisibleResource(id, t.principal.userId, t.principal.email)
  } catch {
    return { ok: false, response: err('not_found', 'No such file here.') }
  }
  if (gated.spaceId !== t.spaceId) return { ok: false, response: err('not_found', 'No such file here.') }
  for (const author of coAuthors(t)) {
    try {
      await deps.requireVisibleResource(id, author.userId, author.email)
    } catch {
      return { ok: false, response: err('forbidden', `${DRAFT_REACH}, and one of them may not see this file.`) }
    }
  }
  const view = await deps.loadView(id, gated.viewer)
  if (!view) return { ok: false, response: err('not_found', 'No such file here.') }
  const refusal = refuseResourceRead(reach, view.notePath)
  if (refusal) return { ok: false, response: err('perimeter', refusal) }
  return { ok: true, view }
}

function logToolUse(t: ResolvedTarget, resourceId: string, action: 'read' | 'download', deps: BridgeDeps): Promise<void> {
  return deps.logResourceAccess({
    resourceId,
    spaceId: t.spaceId,
    userId: t.principal.userId,
    via: 'tool',
    action,
    agentName: toolLabel(t),
  })
}

async function resourcesList(t: ResolvedTarget, params: unknown, deps: BridgeDeps): Promise<BridgeResponse> {
  const parsed = parseParams(P.resourcesList, params)
  if (!parsed.ok) return parsed.response
  const reach = reachOf(t)
  const declared = refuseResourceList(reach)
  if (declared) return err('perimeter', declared)
  const offset = parsed.value.cursor === undefined ? 0 : Number(decodeCursor(parsed.value.cursor))
  if (!Number.isInteger(offset) || offset < 0) return err('invalid', 'That cursor is not one this Tool was given.')
  const kinds = ['image', 'pdf', 'doc', 'sheet', 'slides', 'video', 'audio', 'text', 'code', 'archive', 'link', 'files', 'all']
  const kind = parsed.value.kind ?? 'all'
  if (!kinds.includes(kind)) return err('invalid', `kind is one of ${kinds.join(', ')}`)
  const folder = parsed.value.folder ? normalizeNotePath(parsed.value.folder) : null
  if (parsed.value.folder && (!folder || !`${folder}/`.startsWith('resources/'))) {
    return err('invalid', 'folder is a folder under resources/.')
  }
  const viewer = await deps.resourceViewer(t.spaceId, t.principal.userId, t.principal.email)
  const page = await deps.listResources(t.spaceId, viewer, {
    kind: kind as never,
    channelId: null,
    by: null,
    q: parsed.value.q ?? null,
    since: null,
    sort: 'recent' as never,
    trash: false,
    folder,
    offset,
    limit: Math.min(60, BRIDGE_LIMITS.maxRows),
  })
  const items = page.items.filter((view) => refuseResourceRead(reach, view.notePath) === null).map(toToolResource)
  return ok({ items, nextCursor: page.nextOffset === null ? null : encodeCursor(String(page.nextOffset)) })
}

async function resourcesGet(t: ResolvedTarget, params: unknown, deps: BridgeDeps): Promise<BridgeResponse> {
  const parsed = parseParams(P.resource, params)
  if (!parsed.ok) return parsed.response
  const found = await gatedResource(t, parsed.value.id, deps)
  if (!found.ok) return found.response
  return ok(toToolResource(found.view))
}

async function resourcesRead(t: ResolvedTarget, params: unknown, deps: BridgeDeps): Promise<BridgeResponse> {
  const parsed = parseParams(P.resourceRead, params)
  if (!parsed.ok) return parsed.response
  const found = await gatedResource(t, parsed.value.id, deps)
  if (!found.ok) return found.response
  const text = await deps.readResourceText(t.principal, t.spaceId, found.view.id, {
    offsetChars: parsed.value.offset ?? 0,
    maxChars: BRIDGE_LIMITS.maxResourceReadChars,
  })
  if (!text) return err('not_found', `${found.view.name} has no text to read.`)
  await logToolUse(t, found.view.id, 'read', deps)
  return ok(text)
}

async function resourcesBlob(t: ResolvedTarget, params: unknown, deps: BridgeDeps): Promise<BridgeResponse> {
  const parsed = parseParams(P.resourceBlob, params)
  if (!parsed.ok) return parsed.response
  const found = await gatedResource(t, parsed.value.id, deps)
  if (!found.ok) return found.response
  const blob = await deps.resourceBlob(found.view.id, parsed.value.rendition ?? 'original', BRIDGE_LIMITS.maxBlobBytes)
  if (!blob.ok) {
    return blob.reason === 'too_large'
      ? err('too_large', `That is ${blob.bytes} bytes, over the ${BRIDGE_LIMITS.maxBlobBytes} byte limit — ask for its thumb or preview.`)
      : err('not_found', `${found.view.name} has no ${parsed.value.rendition ?? 'original'} to hand back.`)
  }
  await logToolUse(t, found.view.id, 'download', deps)
  return ok({ mimeType: blob.mimeType, dataUrl: blob.dataUrl })
}

// ── actions ───────────────────────────────────────────────────────────────────

/**
 * One of the space's actions from the allowlist (lib/tools/toolActions.ts),
 * run as the viewer with that action's scope alone, in this space alone.
 */
async function actionsRun(t: ResolvedTarget, params: unknown, deps: BridgeDeps): Promise<BridgeResponse> {
  const parsed = parseParams(P.action, params)
  if (!parsed.ok) return parsed.response
  const { name } = parsed.value
  const reach = reachOf(t)
  const declared = refuseAction(reach, name)
  if (declared) return err('perimeter', declared)
  const plan = planToolAction(name, parsed.value.input ?? {}, t.spaceId)
  if (!plan.ok) return err(plan.code, plan.message)
  const held = await heldForReview(t, 'actions.run', { name, input: plan.input }, deps)
  if (held) return held
  if (coAuthors(t).length > 0) return err('forbidden', `${DRAFT_REACH}; a draft runs no actions until it is approved.`)
  for (const arg of plan.tenantArgs) {
    const denial = await deps.tenantArgDenial(arg.thing, arg.value, t.spaceId, reach)
    if (denial) return err(denial.code, `${arg.arg}: ${denial.message}`)
  }
  const { actionByName } = await import('@/lib/actions/registry')
  const def = actionByName(name)
  if (!def) return err('not_found', `No action named ${name}.`)
  const caller: ActionCaller = {
    userId: t.principal.userId,
    name: t.principal.name,
    email: t.principal.email ?? '',
    scopes: [def.scope],
    via: 'tool',
    agentName: toolLabel(t),
    runId: null,
    client: 'app',
  }
  try {
    const value = await deps.runAction(caller, name, plan.input)
    void deps.logAudit(t.spaceId, {
      userId: t.principal.userId,
      name: t.principal.name,
      action: 'tool',
      path: `tools/${t.config.name}`,
      detail: `${toolLabel(t)} ran ${name}`,
    })
    return ok(value)
  } catch (e) {
    const status = typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : null
    if (status !== null && e instanceof Error) return err(codeOfStatus(status), e.message)
    throw e
  }
}

// ── ai ────────────────────────────────────────────────────────────────────────

async function aiComplete(t: ResolvedTarget, params: unknown, deps: BridgeDeps): Promise<BridgeResponse> {
  const parsed = parseParams(P.complete, params)
  if (!parsed.ok) return parsed.response
  const refusal = refuseAi(reachOf(t), 'complete')
  if (refusal) return err('perimeter', refusal)
  const { prompt, system, messages, maxTokens } = parsed.value
  const held = await heldForReview(t, 'ai.complete', { prompt: prompt ?? null, system: system ?? null, messages: messages ?? null }, deps)
  if (held) return held
  const answer = await deps.complete({
    spaceId: t.spaceId,
    toolName: t.config.name,
    messages: [
      ...(system ? [{ role: 'system' as const, content: system }] : []),
      ...(messages
        ? messages.map((m) => (m.role === 'assistant' ? { role: 'assistant' as const, content: m.content } : { role: 'user' as const, content: m.content }))
        : [{ role: 'user' as const, content: prompt! }]),
    ],
    maxTokens: maxTokens ?? BRIDGE_LIMITS.aiMaxOutputTokens,
  })
  return answer.ok ? ok({ text: answer.text }) : err(answer.code, answer.message)
}

async function aiDecide(t: ResolvedTarget, params: unknown, deps: BridgeDeps): Promise<BridgeResponse> {
  const parsed = parseParams(P.decide, params)
  if (!parsed.ok) return parsed.response
  const refusal = refuseAi(reachOf(t), 'decide')
  if (refusal) return err('perimeter', refusal)
  const held = await heldForReview(t, 'ai.decide', { items: parsed.value.items, questions: parsed.value.questions }, deps)
  if (held) return held
  const answer = await deps.decide({ spaceId: t.spaceId, items: parsed.value.items, questions: parsed.value.questions })
  return answer.ok ? ok(answer.answers) : err(answer.code, answer.message)
}

// ── review and first use ──────────────────────────────────────────────────────

/**
 * Under Visvine's dynamic run a door out of the space is recorded and never
 * opened: the honeypot has nothing behind its connectors and agents, and the
 * run must not spend or send anything. The Tool is told the door is not
 * available here — a refusal every Tool already handles.
 */
async function heldForReview(
  t: ResolvedTarget,
  method: BridgeMethod,
  detail: Record<string, unknown>,
  deps: BridgeDeps,
): Promise<BridgeResponse | null> {
  if (!t.review) return null
  await deps.recordReviewEvent?.(t.review.runId, 'door', method, detail)
  return err('degraded', 'Not available while Visvine reviews this tool.')
}

/**
 * The first-use gate: a Tool from outside the space acts as a member only
 * after they said yes to what it does as them, and again when an upgrade
 * widened that. Refused with `consent_required` and the sentence the host
 * shows (lib/tools/consents.ts).
 */
async function consentRefusal(t: ResolvedTarget, method: BridgeMethod, deps: BridgeDeps): Promise<BridgeResponse | null> {
  if (!t.foreign || !t.installId || !deps.consentFor || !isActingMethod(method)) return null
  const acting = actingReachOf(reachOf(t), toolActionActs)
  if (!actsAsViewer(acting)) return null
  const given = await deps.consentFor(t.installId, t.principal.userId)
  if (given && consentCovers(given, acting)) return null
  return err('consent_required', consentSentence({ title: t.config.title, publisher: t.publisher ?? null, acting }))
}

// ── collections ───────────────────────────────────────────────────────────────

type CollectionMethod = Extract<BridgeMethod, `collections.${string}`>

function answered<T>(answer: CollectionAnswer<T>): BridgeResponse {
  return answer.ok ? ok(answer.value) : err(answer.code, answer.message)
}

/**
 * The Tool's own store. Whether it declared the collection, and whether the
 * viewer may read or write it at all, is settled here before anything is
 * read; whether they may change THIS row (`write: own`) is the row's to say,
 * so the service asks it after finding the row. A preview's rows are keyed
 * apart from every install's, so a draft reads and writes only its own.
 */
async function collectionsCall(t: ResolvedTarget, method: CollectionMethod, params: unknown, deps: BridgeDeps): Promise<BridgeResponse> {
  const name = (params as { collection?: unknown } | null)?.collection
  if (typeof name !== 'string' || !name) return err('invalid', 'collection: name the collection')
  const spec = manifestOf(t.config).collections[name]
  const act = method === 'collections.list' || method === 'collections.get' || method === 'collections.count' ? 'read' : 'insert'
  const refused = collectionDenial(spec, name, act, { isAdmin: t.isAdmin })
  if (refused) return err(refused.code, refused.message)
  switch (method) {
    case 'collections.insert': {
      const parsed = parseParams(P.collectionInsert, params)
      if (!parsed.ok) return parsed.response
      return answered(await deps.collections.insert(t, name, parsed.value.data))
    }
    case 'collections.list': {
      const parsed = parseParams(P.collectionList, params)
      if (!parsed.ok) return parsed.response
      return answered(await deps.collections.list(t, name, parsed.value))
    }
    case 'collections.get': {
      const parsed = parseParams(P.collectionRow, params)
      if (!parsed.ok) return parsed.response
      return answered(await deps.collections.get(t, name, parsed.value.id))
    }
    case 'collections.update': {
      const parsed = parseParams(P.collectionUpdate, params)
      if (!parsed.ok) return parsed.response
      return answered(await deps.collections.update(t, name, parsed.value.id, parsed.value.data))
    }
    case 'collections.delete': {
      const parsed = parseParams(P.collectionRow, params)
      if (!parsed.ok) return parsed.response
      return answered(await deps.collections.delete(t, name, parsed.value.id))
    }
    case 'collections.count': {
      const parsed = parseParams(P.collectionCount, params)
      if (!parsed.ok) return parsed.response
      return answered(await deps.collections.count(t, name, parsed.value))
    }
  }
  return err('invalid', `Unknown method ${String(method)}.`)
}

// ── the door ──────────────────────────────────────────────────────────────────

/**
 * Handle one bridge call. Returns a BridgeResponse for everything, including
 * every refusal and every unexpected failure — see rule 3 in the file comment.
 */
export async function handleBridgeCall(
  t: ResolvedTarget,
  method: BridgeMethod,
  params: unknown,
  deps: BridgeDeps = REAL_DEPS,
): Promise<BridgeResponse> {
  try {
    if (t.review) await deps.recordReviewEvent?.(t.review.runId, 'bridge', method, { params: params ?? null })
    const unconsented = await consentRefusal(t, method, deps)
    if (unconsented) return unconsented
    switch (method) {
      case 'context.list':
        return await contextList(t, params, deps)
      case 'context.read':
        return await contextRead(t, params, deps)
      case 'context.search':
        return await contextSearch(t, params, deps)
      case 'context.write':
        return await contextWrite(t, params, deps)
      case 'context.append':
        return await contextAppend(t, params, deps)
      case 'connectors.call':
        return await connectorsCall(t, params, deps)
      case 'agents.run':
        return await agentsRun(t, params, deps)
      case 'data.call':
        return await dataCall(t, params, deps)
      case 'state.get':
        return await stateGet(t, params, deps)
      case 'state.set':
        return await stateSet(t, params, deps)
      case 'subject.get':
        // Takes no params, so there is nothing to validate and nothing to
        // refuse: the host, not the frame, decides what a Tool is shown about.
        return ok(t.subject)
      case 'context.links':
        return await contextLinks(t, params, deps)
      case 'records.query':
        return await recordsQuery(t, params, deps)
      case 'records.get':
        return await recordsGet(t, params, deps)
      case 'records.update':
        return await recordsUpdate(t, params, deps)
      case 'resources.list':
        return await resourcesList(t, params, deps)
      case 'resources.get':
        return await resourcesGet(t, params, deps)
      case 'resources.read':
        return await resourcesRead(t, params, deps)
      case 'resources.blob':
        return await resourcesBlob(t, params, deps)
      case 'actions.run':
        return await actionsRun(t, params, deps)
      case 'ai.complete':
        return await aiComplete(t, params, deps)
      case 'ai.decide':
        return await aiDecide(t, params, deps)
      case 'collections.insert':
      case 'collections.list':
      case 'collections.get':
      case 'collections.update':
      case 'collections.delete':
      case 'collections.count':
        return await collectionsCall(t, method, params, deps)
      default:
        return err('invalid', `Unknown method ${String(method)}.`)
    }
  } catch (e) {
    // The message is deliberately not the exception's: it may name a table, a
    // column or an upstream host, and the Tool is untrusted code shown to a
    // viewer. The server log keeps the real one.
    logger.error('tools.bridge.failed', { method, err: e })
    return err('internal', 'Something went wrong on Visvine’s side.')
  }
}

/**
 * The same handlers as the isolate sees them: positional arguments in, the value
 * out, a refusal as a thrown Error carrying the message. This is what makes
 * `visvine.context.read(path)` mean the same thing in `ui.tsx` and `data.js`.
 *
 * Which methods, and how positional arguments become params, is one table
 * (@visvine/tool-protocol/isolate) the offline runtime reads too.
 */
export function bridgeCapabilities(t: ResolvedTarget, deps: BridgeDeps = REAL_DEPS): IsolateCapabilities {
  const call = async (method: BridgeMethod, params: unknown): Promise<unknown> => {
    const response = await handleBridgeCall(t, method, params, deps)
    if (response.ok) return response.value
    throw new Error(response.error.message)
  }
  return Object.fromEntries(
    ISOLATE_METHODS.map((method) => [method, (args: unknown[]) => call(method, ISOLATE_PARAMS[method]!(args))]),
  )
}
