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
import { featureAccessForbidden } from '@/lib/auth'
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
import { globMatch, refuseAgent, refuseConnector, refuseRead, refuseWrite } from './perimeter'
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
  featureAccessForbidden: typeof featureAccessForbidden
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
  featureAccessForbidden,
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

const P = {
  list: z.object({ glob: z.string().max(PATH_MAX).optional() }),
  read: z.object({ path: z.string().min(1).max(PATH_MAX) }),
  search: z.object({
    query: z.string().min(1).max(2_000),
    k: z.number().int().min(1).max(BRIDGE_LIMITS.maxRows).optional(),
  }),
  write: z.object({ path: z.string().min(1).max(PATH_MAX), content: z.string() }),
  append: z.object({ path: z.string().min(1).max(PATH_MAX), text: z.string().min(1) }),
  connector: z.object({ name: z.string().min(1).max(64), code: z.string().min(1) }),
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
 * `writeDenial` already keeps non-admins out of `connectors/` and `agents/live/`,
 * so this is the belt to that pair of braces, and it binds admins too.
 */
const SEALED_WRITE_DIRS = ['tools', 'agents', 'connectors'] as const

function sealedNamespace(path: string): string | null {
  const top = path.split('/')[0]
  return (SEALED_WRITE_DIRS as readonly string[]).includes(top) ? top : null
}

/** How a Tool is named in an audit line — the store has no `tool` origin to carry it. */
function toolLabel(t: ResolvedTarget): string {
  return t.installId === null ? `tool:${t.config.name} (preview)` : `tool:${t.config.name}`
}

// ── context ───────────────────────────────────────────────────────────────────

async function contextList(t: ResolvedTarget, params: unknown, deps: BridgeDeps): Promise<BridgeResponse> {
  const parsed = parseParams(P.list, params)
  if (!parsed.ok) return parsed.response
  const { glob } = parsed.value

  // An undeclared reach must say so rather than come back empty: "no rows" and
  // "you never asked for any" look identical to an author otherwise. The path
  // handed in is irrelevant — with no read globs the gate answers the same way
  // for every one of them.
  if (t.perimeter.read.length === 0) return err('perimeter', refuseRead(t.perimeter, glob ?? '**')!)

  const { metas } = await deps.visibleVault(t.principal, t.context)
  const rows: ContextEntry[] = []
  for (const meta of [...metas].sort((a, b) => a.path.localeCompare(b.path))) {
    if (glob && !globMatch(glob, meta.path)) continue
    if (refuseRead(t.perimeter, meta.path)) continue
    const type = meta.frontmatter.type
    rows.push({
      path: meta.path,
      title: meta.title || null,
      type: typeof type === 'string' ? type : null,
      updatedAt: new Date(meta.mtime).toISOString(),
    })
    // Truncate rather than refuse — the SDK documents a capped list, so a Tool
    // over a big folder degrades to a page instead of failing outright.
    if (rows.length >= BRIDGE_LIMITS.maxRows) break
  }
  return ok(rows)
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
  const { query, k } = parsed.value
  if (t.perimeter.read.length === 0) return err('perimeter', refuseRead(t.perimeter, query)!)

  // Ask for the full cap and narrow afterwards: search ranks over everything the
  // VIEWER can read, and cutting to `k` first would spend the budget on hits the
  // perimeter is about to drop.
  const { hits } = await deps.searchContext(t.principal, t.context, query, {}, BRIDGE_LIMITS.maxRows)
  const rows: ContextHit[] = hits
    .filter((hit) => refuseRead(t.perimeter, hit.path) === null)
    .slice(0, Math.min(k ?? BRIDGE_LIMITS.maxRows, BRIDGE_LIMITS.maxRows))
    .map((hit) => ({
      path: hit.path,
      title: hit.title || null,
      snippet: hit.snippet ?? '',
      score: hit.score,
    }))
  return ok(rows)
}

/** The shared front half of write and append: same path rules, same caps. */
function checkWrite(
  t: ResolvedTarget,
  rawPath: string,
  body: string,
): { ok: true; path: string } | { ok: false; response: BridgeResponse } {
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

  const sealed = sealedNamespace(path)
  if (sealed) {
    return {
      ok: false,
      response: err(
        'forbidden',
        `${sealed}/ holds configuration that runs — no tool may write there, whatever its perimeter declares.`,
      ),
    }
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
  const checked = checkWrite(t, parsed.value.path, parsed.value.content)
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
    action: 'write',
    path: result.path ?? checked.path,
    detail: `${toolLabel(t)} write`,
  })
  return ok({ path: result.path ?? checked.path })
}

async function contextAppend(t: ResolvedTarget, params: unknown, deps: BridgeDeps): Promise<BridgeResponse> {
  const parsed = parseParams(P.append, params)
  if (!parsed.ok) return parsed.response
  const checked = checkWrite(t, parsed.value.path, parsed.value.text)
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
    action: 'write',
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
}

/** Is this name one the install's requirements marked missing? */
function missingHere(list: string[] | undefined, name: string): boolean {
  return (list ?? []).some((entry) => entry.toLowerCase() === name.trim().toLowerCase())
}

async function connectorsCall(t: ResolvedTarget, params: unknown, deps: BridgeDeps): Promise<BridgeResponse> {
  const parsed = parseParams(P.connector, params)
  if (!parsed.ok) return parsed.response
  const { name, code } = parsed.value

  const refusal = refuseConnector(t.perimeter, name)
  if (refusal) return err('perimeter', refusal)
  if (missingHere(t.degraded?.missing.connectors, name)) {
    return err('degraded', `This space has no "${name}" connector — the tool is running degraded.`)
  }

  try {
    // Exactly what MCP's run_connector does: load through the visibility lens
    // (so folder permissions decide whether the connector is even there) and
    // execute under the viewer's principal. No admin widening, no thinner path.
    const loaded = await deps.loadConnector(t.principal, t.context, name)
    if (!loaded) return err('not_found', `No connector named "${name}" here.`)
    const result = await deps.executeConnectorScript(t.principal, t.context, t.spaceId, loaded, code)
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
  // The same two checks run_agent applies, in the same order: the feature must
  // be available to this viewer, and running is author-or-admin.
  if (await deps.featureAccessForbidden(t.principal.userId, t.spaceId, 'agents', t.principal.email)) {
    return err('forbidden', 'The Agents tool is not available to you in this space.')
  }
  if (!(await deps.canTriggerRun(t.principal, t.spaceId, name))) {
    return err('forbidden', "Only the agent's author or a space admin can run it.")
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
    console.error(`[tools] bridge ${method} failed`, e)
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
    'context.list': (args) => call('context.list', args[0] === undefined ? {} : { glob: args[0] }),
    'context.read': (args) => call('context.read', { path: args[0] }),
    'context.search': (args) =>
      call('context.search', args[1] === undefined ? { query: args[0] } : { query: args[0], k: args[1] }),
    'context.write': (args) => call('context.write', { path: args[0], content: args[1] }),
    'context.append': (args) => call('context.append', { path: args[0], text: args[1] }),
    'connectors.call': (args) => call('connectors.call', { name: args[0], code: args[1] }),
    'agents.run': (args) => call('agents.run', { name: args[0] }),
    'state.get': (args) => call('state.get', { key: args[0] }),
    'state.set': (args) => call('state.set', { key: args[0], value: args[1] }),
  }
}
