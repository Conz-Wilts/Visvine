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
  readVisible,
  searchContext,
  visibleVault,
  writeGated,
} from '@/lib/notes/contextService'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { executeConnectorScript, loadConnector } from '@/lib/connectors/service'
import { ConnectorError, type ConnectorErrorCode } from '@/lib/connectors/config'
import { canTriggerRun } from '@/lib/agents/service'
import { claimManualRun } from '@/lib/agents/schedule'
import { globMatch, isValidGlobEntry, refuseAgent, refuseConnector, refuseRead, refuseWrite } from './perimeter'
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
import { acquireDataCall } from './limits'
import { targetKey, type ResolvedTarget } from './target'
import { logger } from '@/lib/logger'
import { agentNameOfPath, isAgentBriefPath } from '@/lib/notes/entities'

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
  stateGet: z.object({ key: z.string().min(1).max(200) }),
  stateSet: z.object({ key: z.string().min(1).max(200), value: z.unknown() }),
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
  const rows: ContextEntry[] = []
  let more = false
  // Path order (not localeCompare) so the cursor's "after this path" test and
  // the sort agree byte for byte.
  for (const meta of [...metas].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    if (after !== null && meta.path <= after) continue
    if (glob && !globMatch(glob, meta.path)) continue
    if (refuseRead(t.perimeter, meta.path)) continue
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
  const inPerimeter = hits.filter((hit) => refuseRead(t.perimeter, hit.path) === null)
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
    TOOL_WRITE_ORIGIN,
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
    TOOL_WRITE_ORIGIN,
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

  const refusal = refuseConnector(t.perimeter, name)
  if (refusal) return err('perimeter', refusal)
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
  if (missingHere(t.degraded?.missing.agents, name)) {
    return err('degraded', `This space has no "${name}" agent — the tool is running degraded.`)
  }
  // The same check run_agent applies: running is for whoever can edit the
  // brief. There is no feature gate — agents are Context, and Context is always on.
  if (!(await deps.canTriggerRun(t.principal, t.spaceId, name))) {
    return err('forbidden', 'Only someone who can edit this agent can run it.')
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

  const release = acquireDataCall(targetKey(t))
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
  return ok(await deps.getToolState(t, parsed.value.key))
}

async function stateSet(t: ResolvedTarget, params: unknown, deps: BridgeDeps): Promise<BridgeResponse> {
  const parsed = parseParams(P.stateSet, params)
  if (!parsed.ok) return parsed.response
  const result = await deps.setToolState(t, parsed.value.key, parsed.value.value ?? null)
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
 * `data.call` is deliberately absent (a handler calling handlers would nest
 * isolates) and so is `subject.get` — `data.js` gets `subject` as a global.
 */
export function bridgeCapabilities(t: ResolvedTarget, deps: BridgeDeps = REAL_DEPS): IsolateCapabilities {
  const call = async (method: BridgeMethod, params: unknown): Promise<unknown> => {
    const response = await handleBridgeCall(t, method, params, deps)
    if (response.ok) return response.value
    throw new Error(response.error.message)
  }
  return {
    'context.list': (args) =>
      call('context.list', {
        ...(args[0] === undefined ? {} : { glob: args[0] }),
        ...(args[1] === undefined ? {} : { cursor: args[1] }),
      }),
    'context.read': (args) => call('context.read', { path: args[0] }),
    'context.search': (args) =>
      call('context.search', {
        query: args[0],
        ...(args[1] === undefined ? {} : { k: args[1] }),
        ...(args[2] === undefined ? {} : { cursor: args[2] }),
      }),
    'context.write': (args) => call('context.write', { path: args[0], content: args[1] }),
    'context.append': (args) => call('context.append', { path: args[0], text: args[1] }),
    // `connectors.call(name, code)` or `connectors.call(name, { action, args } | { code })`.
    'connectors.call': (args) =>
      call('connectors.call', {
        name: args[0],
        ...(typeof args[1] === 'string' ? { code: args[1] } : (args[1] as object | undefined) ?? {}),
      }),
    'agents.run': (args) => call('agents.run', { name: args[0] }),
    'state.get': (args) => call('state.get', { key: args[0] }),
    'state.set': (args) => call('state.set', { key: args[0], value: args[1] }),
  }
}
