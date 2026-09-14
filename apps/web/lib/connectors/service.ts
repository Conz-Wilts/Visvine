/**
 * The connectors service — the only file that touches the notes layer, the
 * secrets table AND the isolate runtime. Deliberately MCP-free: not-found is
 * `null`, everything else is a ConnectorError, and the tool layer maps both
 * onto McpError. All note reads go through the context visibility lens
 * (readVisible/visibleVault), so folder permissions govern who can even see a
 * connector exists.
 *
 * Execution is one path for everyone: {@link executeConnectorScript} is what
 * an agent's run_connector calls and what the console's terminal calls — same
 * perimeter, same secrets, same audit line. There is no thinner admin path.
 */
import prisma from '@/lib/prisma'
import { decryptSecret } from '@/lib/crypto/secrets'
import { canReadPath, readVisible, visibleVault } from '@/lib/notes/contextService'
import { getVault } from '@/lib/notes/vaultCache'
import { personalPrincipal } from '@/lib/notes/principal'
import { personalSpaceId } from '@/lib/spaces/personalSpaceAccess'
import { SHARED_OWNER_KEY } from '@/lib/notes/store'
import { listAudit, logAudit } from '@/lib/notes/audit'
import { parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'
import type { Context } from '@/lib/notes/store'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import type { NoteFrontmatter } from '@/lib/notes/shared/types'
import {
  allowPrivateHosts,
  ConnectorError,
  interpolateSecrets,
  isConnectorEnabled,
  parseConnectorPerimeter,
  perimeterSecretRefs,
  type ConnectorAction,
  type ConnectorPerimeter,
  type ConnectorShare,
} from './config'
import { connectorCryptoCapabilities } from './hostCrypto'
import { connectorStateCapabilities } from './hostState'
import { acquireConnectorRun, takeConnectorRun } from './quota'
import { identitySecretName, type ResolvedIdentity } from './identity'
import { connectionOwner } from './auth'
import { resolveConnection } from './connections'
import { connectorConnectUrl } from './connectUrl'
import { runInIsolate, type IsolateRunResult } from './isolate'
import { mcpAllTools, type McpToolInfo } from './hostMcp'
import { MAX_DENIALS } from './perimeter'
import { toolGroup, toolPermission, type ToolGroup, type ToolPermission } from './toolPolicy'
import { isLegacyModelConnector } from '@/lib/models/config'
import { catalogEntryFor } from './catalog'
import { declaredReachHosts } from '@/lib/vm/policy'
import { parentShare, readSharedFromParent } from '@/lib/notes/federation'
import { rebaseParentPath } from '@/lib/spaces/subspaces'

const CONNECTORS_DIR = 'connectors/'
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i
const DOCS_CAP_CHARS = 4_000

/**
 * Where a connector name resolved to — and therefore whose secrets, whose
 * linked account, whose run budget and whose audit trail the run uses.
 *
 * Three places are searched, in this order: the space the caller is in, then
 * — for a sub-space — what its PARENT shares with it (`share: subspaces` on
 * the parent's note, docs/sub-spaces.md), then the caller's OWN personal
 * space. The parent's note runs with the parent's secrets and accounts, under
 * the parent's quota and on the parent's audit trail, exactly as a personal
 * one runs with the person's: `spaceId` says whose it is, and every executor
 * reads that rather than the caller's space. The third look is what makes a
 * connector you connected once in Settings work everywhere you go — you sign
 * in to Google once, and any space you are a member of can spend it, because
 * it is still only ever YOUR account being spent (`principal` is you, in
 * your own space).
 *
 * The order matters and is not a preference. A space that has written its own
 * `google-drive` note has made a decision about what its agents reach and
 * whose credentials they use; neither a parent's note nor a personal one may
 * quietly displace it. So each later look fills a gap and never overrides.
 *
 * Only a person has a personal space, so a system/maintenance pass never
 * falls back — and neither does a Tool (lib/tools/bridge.ts), which is code a
 * space wrote running against a viewer who never chose it. An agent run and a
 * direct action call are acts of the person they run as; a page render is not.
 */
interface ConnectorSource {
  content: string
  path: string
  /** The space whose secrets, connections, quota and audit line this uses. */
  spaceId: string
  /** The principal those reads and that audit happen as. */
  principal: ContextPrincipal
  /** True when the note came from the caller's personal space. */
  personal: boolean
  /** True when the note is the parent space's, shared with this sub-space. */
  shared: boolean
  /** Which space shared it, when `shared`. */
  sharedFrom: { id: string; name: string } | null
}

/** How wide a connector lookup reaches. */
export interface ConnectorLookup {
  /**
   * Consult what the parent space shares with this sub-space when this one
   * has no such connector. Default true. Pass false where the question is
   * about THIS space's own note — the console's edit and test surfaces,
   * a machine sign-in — rather than about what a run here can reach.
   */
  shared?: boolean
  /**
   * Consult the caller's own personal space when this one has no such
   * connector. Default true. Pass false where the question is about a
   * PARTICULAR space's note — the console's test run, a Tool's render — rather
   * than about what this person can do.
   */
  personal?: boolean
  /**
   * WHOSE own space to look in, when it isn't the caller's. The one caller is
   * the agent page asking whether a subscriber's runs would work: those runs
   * resolve through that person's connectors, so readiness has to ask the same
   * question rather than the viewer's version of it.
   */
  personalFor?: string
}

/**
 * A person in their own personal space, or null when there is no such place to
 * look. Read-only by use: the principal is theirs, so nothing here widens what
 * anyone can see — it narrows the lookup to one person's own notes.
 */
function personalLens(userId: string, context: Context): { principal: ContextPrincipal; context: Context } | null {
  if (!userId) return null
  const spaceId = personalSpaceId(userId)
  // Already looking there — a second identical read would find the same nothing.
  if (context.spaceId === spaceId) return null
  return {
    principal: personalPrincipal({ userId, email: '', name: '' }),
    context: { spaceId, ownerKey: SHARED_OWNER_KEY },
  }
}

/**
 * Find a connector note by name: this space's, else the caller's own. Null
 * when neither has it — or when the caller cannot see it, which is the same
 * answer for the same reason readVisible gives it.
 */
async function readConnectorNote(
  p: ContextPrincipal,
  context: Context,
  name: string,
  opts: ConnectorLookup = {},
): Promise<ConnectorSource | null> {
  if (!NAME_RE.test(name)) return null
  const path = `${CONNECTORS_DIR}${name}.md`
  const here = await readVisible(p, context, path)
  if (here !== null) {
    return { content: here, path, spaceId: context.spaceId, principal: p, personal: false, shared: false, sharedFrom: null }
  }
  if (opts.shared !== false) {
    // The parent's flag is the whole grant (lib/notes/federation.ts): no
    // standing in the parent is asked for, and none is given — the principal
    // is the same person, in the parent's space, an admin of nothing there.
    const fromParent = await readSharedFromParent(context, path)
    if (fromParent) {
      const owner = fromParent.share.space
      return {
        content: fromParent.content,
        path,
        spaceId: owner.id,
        principal: { ...p, spaceId: owner.id, spaceAdmin: false },
        personal: false,
        shared: true,
        sharedFrom: owner,
      }
    }
  }
  if (opts.personal === false || p.system) return null
  const lens = personalLens(opts.personalFor ?? p.userId, context)
  if (!lens) return null
  const mine = await readVisible(lens.principal, lens.context, path)
  if (mine === null) return null
  // The principal keeps the caller's own name and email where it IS them, so
  // the audit line and any identity assertion still say who ran it.
  const principal =
    lens.principal.userId === p.userId ? { ...lens.principal, email: p.email, name: p.name } : lens.principal
  return { content: mine, path, spaceId: lens.context.spaceId, principal, personal: true, shared: false, sharedFrom: null }
}

export interface ConnectorSummary {
  name: string
  path: string
  /** Raw frontmatter `alias` — display metadata only (chip colour), any string. */
  alias: string | null
  /**
   * The catalog recipe this connection was written from, when it says so. A
   * space may hold several connections to one service, so the name no longer
   * identifies the service — this does. Display only: no perimeter, key or
   * permission is read from it (lib/connectors/catalog.ts#catalogEntryFor).
   */
  recipe: string | null
  /** Frontmatter `title` — what the connection is called where two share a service. */
  title: string | null
  description: string | null
  /** Hosts the run may reach; empty = no network (documentation-only connector). */
  hosts: string[]
  /** Human-readable method+path rules; empty = host-gated only. */
  allow: string[]
  /** `enabled: false` in the note — switched off from the console; every run is refused. */
  enabled: boolean
  /** Parse failure, so admins (and agents) can see a broken connector. */
  invalid: string | null
  /** Caveats worth surfacing (mostly legacy notes the migration hasn't rewritten). */
  warnings: string[]
  /** Secret NAMES this connector references — never values. */
  secrets: string[]
  /** Named actions callers can run by name instead of writing code. */
  actions: ConnectorActionSummary[]
  /**
   * The MCP server this connector IS, when its note declares one (`mcp.url`).
   * What tells a surface it has tools to ask about, rather than inferring it
   * from a recipe id — which is display metadata and may be wrong or absent.
   */
  mcp: { url: string } | null
  /** The site this connector signs a machine into, when it is a Website login. */
  login: { url: string } | null
  docs: string
  /**
   * The caller's own connector, brought from their Settings rather than
   * belonging to this space. Only ever true where the lookup asked for them.
   */
  personal?: boolean
  /** Who else resolves this connector — `share:` in the note. */
  share: ConnectorShare
  /**
   * The parent space's connector, shared with this sub-space. Its `path` is
   * where this space reads it (`parent/connectors/<name>.md`); nothing here
   * may change it — its secrets, its switch and its note are the parent's.
   */
  shared?: boolean
  sharedFrom?: { id: string; name: string } | null
}

/** One action as list_connectors reports it — everything but the code. */
export interface ConnectorActionSummary {
  name: string
  description: string | null
  params: unknown | null
}

/** The actions of a perimeter, in declaration order, code omitted. */
function summariseActions(actions: Record<string, ConnectorAction>): ConnectorActionSummary[] {
  return Object.entries(actions).map(([name, a]) => ({ name, description: a.description, params: a.params }))
}

function connectorName(path: string): string {
  return path.slice(CONNECTORS_DIR.length).replace(/\.md$/, '')
}

/**
 * Is this note's frontmatter marked `type: connector`? Case-insensitive: every
 * other entity namespace writes its `type:` capitalised (`Person`, `Space`), so
 * a note authored by hand as `type: Connector` must count.
 */
/**
 * A connector note declares `type: connector`. The pre-`models/` shape of a
 * model — `type: connector` with `kind: model` — is NOT one: it is a model
 * (lib/agents/spaceModels.ts reads it until `db:models:migrate` moves it),
 * so nothing here lists, loads or runs it.
 */
function isConnectorNote(fm: NoteFrontmatter): boolean {
  return typeof fm.type === 'string' && fm.type.trim().toLowerCase() === 'connector' && !isLegacyModelConnector(fm)
}

/** Human-readable form of an allow rule — the shape admins wrote in the note. */
function formatAllowRule(rule: { method: string; path: string; prefix: boolean }): string {
  return `${rule.method} ${rule.path}${rule.prefix ? '*' : ''}`
}

/**
 * The MCP endpoint a connector stands for, or null when it is not one.
 *
 * The note's own `mcp:` block first, and then — for a connection made before
 * that block was written — the recipe's. A connector written from a vetted MCP
 * server recipe carries `recipe:`, which names the entry, which pins the URL;
 * so a Notion connected last month answers here without a backfill having been
 * run first.
 *
 * The fallback decides only WHICH URL to ask for tools, never what may be
 * reached: `hosts:` is in the note and the host gate reads it, so a stale or
 * wrong recipe costs an egress denial rather than a call somewhere unlisted.
 */
function mcpEndpoint(name: string, recipe: string | null, declared: { url: string } | null): { url: string } | null {
  if (declared) return declared
  const entry = catalogEntryFor(name, recipe)
  return entry?.mcp ? { url: entry.mcp.url } : null
}

/** One connector note → its summary, or null when the note isn't a connector. */
function summariseNote(path: string, content: string): ConnectorSummary | null {
  const fm = parseFrontmatter(content)
  if (!isConnectorNote(fm)) return null
  const body = splitFrontmatter(content).body.trim()
  const docs = body.length > DOCS_CAP_CHARS ? body.slice(0, DOCS_CAP_CHARS) + '…' : body
  const base = {
    name: connectorName(path),
    path,
    alias: typeof fm.alias === 'string' ? fm.alias : null,
    recipe: typeof fm.recipe === 'string' ? fm.recipe.trim().toLowerCase() : null,
    title: typeof fm.title === 'string' ? fm.title : null,
    description: typeof fm.description === 'string' ? fm.description : null,
    enabled: isConnectorEnabled(fm),
    docs,
  }
  const parsed = parseConnectorPerimeter(fm)
  return {
    ...base,
    hosts: parsed.ok ? [...parsed.perimeter.hosts] : [],
    allow: parsed.ok ? parsed.perimeter.allow.map(formatAllowRule) : [],
    invalid: parsed.ok ? null : parsed.error,
    warnings: parsed.ok ? parsed.warnings : [],
    secrets: parsed.ok ? perimeterSecretRefs(parsed.perimeter) : [],
    actions: parsed.ok ? summariseActions(parsed.perimeter.actions) : [],
    mcp: parsed.ok ? mcpEndpoint(base.name, base.recipe, parsed.perimeter.mcp) : null,
    login: parsed.ok ? parsed.perimeter.login : null,
    share: parsed.ok ? parsed.perimeter.share : 'none',
  }
}

/**
 * The parent's shared connectors as this sub-space lists them: read-only
 * rows, addressed under `parent/`, that a same-named note of this space's
 * wins over — the order a run resolves them in. Empty for a top-level space.
 */
async function listSharedFromParent(context: Context): Promise<ConnectorSummary[]> {
  const share = await parentShare(context)
  if (!share) return []
  const out: ConnectorSummary[] = []
  for (const raw of share.notes) {
    if (!raw.path.startsWith(CONNECTORS_DIR) || !raw.path.endsWith('.md')) continue
    const summary = summariseNote(raw.path, raw.content)
    if (!summary) continue
    out.push({ ...summary, path: rebaseParentPath(raw.path), shared: true, sharedFrom: share.space })
  }
  return out
}

/** Every valid-or-broken connector note in one context. */
async function listConnectorsIn(p: ContextPrincipal, context: Context): Promise<ConnectorSummary[]> {
  const { raws } = await visibleVault(p, context)
  const summaries: ConnectorSummary[] = []
  for (const raw of raws) {
    if (!raw.path.startsWith(CONNECTORS_DIR) || !raw.path.endsWith('.md')) continue
    const summary = summariseNote(raw.path, raw.content)
    if (summary) summaries.push(summary)
  }
  return summaries
}

/** A connector the caller cannot open — enough to name it, nothing it reaches. */
export interface HiddenConnector {
  name: string
  path: string
  title: string | null
  recipe: string | null
}

/**
 * The space's connector notes the principal may NOT read.
 *
 * A member sees what the space has connected even where a grant does not
 * reach the note, so they can ask for it (a ContextAccessRequest on its path)
 * rather than find out from a refused run. What is said about it is the
 * name, title and recipe — what the row shows — and never the hosts, secrets
 * or body: those are the note's, and the note is what they have no access to.
 * Empty for anyone who sees the vault unfiltered.
 */
export async function listHiddenConnectors(p: ContextPrincipal, context: Context): Promise<HiddenConnector[]> {
  const { raws } = await getVault(context)
  const hidden: HiddenConnector[] = []
  for (const raw of raws) {
    if (!raw.path.startsWith(CONNECTORS_DIR) || !raw.path.endsWith('.md')) continue
    if (canReadPath(p, context, raw.path)) continue
    const summary = summariseNote(raw.path, raw.content)
    if (!summary) continue
    hidden.push({ name: summary.name, path: summary.path, title: summary.title, recipe: summary.recipe })
  }
  return hidden.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Every valid-or-broken connector note the principal can see.
 *
 * With `personal: true` the caller's own connectors are appended — the ones
 * they connected in Settings, which their runs in this space would resolve
 * ({@link ConnectorSource}). Anything the space itself has wins the name, so
 * the list can never show two rows a caller has to choose between. Default
 * off, because the console's list is about what the SPACE has and must not
 * offer to disable or delete something that isn't its.
 */
export async function listConnectors(
  p: ContextPrincipal,
  context: Context,
  opts: ConnectorLookup = {},
): Promise<ConnectorSummary[]> {
  const own = await listConnectorsIn(p, context)
  const taken = new Set(own.map((c) => c.name))
  // What the parent shares is listed by default: it is what a run here
  // resolves, and the row says whose it is so no surface offers to change it.
  if (opts.shared !== false) {
    for (const theirs of await listSharedFromParent(context)) {
      if (!taken.has(theirs.name)) {
        own.push(theirs)
        taken.add(theirs.name)
      }
    }
  }
  const lens = opts.personal === true && !p.system ? personalLens(p.userId, context) : null
  if (lens) {
    for (const mine of await listConnectorsIn(lens.principal, lens.context)) {
      if (!taken.has(mine.name)) own.push({ ...mine, personal: true })
    }
  }
  return own.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * One connector, in the detail the console's Connector tab renders: the summary
 * every caller gets, plus the parsed perimeter and its env templates. `perimeter`
 * is null exactly when `invalid` is set — a broken note still describes itself
 * so an admin can see what to fix.
 *
 * Null (rather than an error) when the note is absent, invisible to this
 * principal, or isn't a connector at all — the same indistinguishable
 * not-found readVisible gives, so a page can 404 uniformly.
 */
export interface ConnectorDetail extends ConnectorSummary {
  perimeter: ConnectorPerimeter | null
  /**
   * The space whose connector this is — whose secrets, linked accounts and
   * audit trail. The space asked about, unless the note is the parent's,
   * shared with this sub-space (`shared`), in which case the parent's.
   */
  ownerSpaceId: string
}

/**
 * One connector by name, in the detail the console renders. This space's
 * note, else — for a sub-space — the parent's shared one (`opts.shared`
 * false asks only about this space's own).
 */
export async function describeConnector(
  p: ContextPrincipal,
  context: Context,
  name: string,
  opts: Pick<ConnectorLookup, 'shared'> = {},
): Promise<ConnectorDetail | null> {
  if (!NAME_RE.test(name)) return null
  const path = `${CONNECTORS_DIR}${name}.md`
  const content = await readVisible(p, context, path)
  if (content !== null) {
    const summary = summariseNote(path, content)
    if (!summary) return null
    const parsed = parseConnectorPerimeter(parseFrontmatter(content))
    return { ...summary, perimeter: parsed.ok ? parsed.perimeter : null, ownerSpaceId: context.spaceId }
  }
  if (opts.shared === false) return null
  const fromParent = await readSharedFromParent(context, path)
  if (!fromParent) return null
  const summary = summariseNote(path, fromParent.content)
  if (!summary) return null
  const parsed = parseConnectorPerimeter(parseFrontmatter(fromParent.content))
  return {
    ...summary,
    path: rebaseParentPath(path),
    shared: true,
    sharedFrom: fromParent.share.space,
    perimeter: parsed.ok ? parsed.perimeter : null,
    ownerSpaceId: fromParent.share.space.id,
  }
}

/** One past run of a connector, as the audit trail recorded it. */
export interface ConnectorCall {
  at: number
  /** Who asked — the principal's display name, agent or admin alike. */
  by: string
  /** The code that ran, truncated at write time to AUDIT_CODE_CHARS. */
  code: string
  /** What came back: `ok`, `timeout`, `error: …`, `missing_secret: …`. */
  outcome: string
}

/**
 * A connector's call history, newest first. Every execution audits itself
 * (see {@link executeConnectorScript}), so this is a read of that trail
 * narrowed to one connector rather than a second record to keep in step.
 *
 * The stored detail is `run [code] → outcome`; the split is here so the
 * shape callers see survives a change to that wording.
 */
export async function listConnectorCalls(
  spaceId: string,
  path: string,
  limit = 25,
): Promise<ConnectorCall[]> {
  const entries = await listAudit(spaceId)
  const calls: ConnectorCall[] = []
  for (const entry of entries) {
    if (entry.action !== 'connector' || entry.path !== path) continue
    const match = /^run \[([^]*)\] → ([^]*)$/.exec(entry.detail ?? '')
    calls.push({
      at: entry.at,
      by: entry.name,
      code: match?.[1] ?? '',
      outcome: match?.[2] ?? (entry.detail ?? ''),
    })
    if (calls.length >= limit) break
  }
  return calls
}

export interface LoadedConnector {
  perimeter: ConnectorPerimeter
  path: string
  warnings: string[]
  /**
   * The space this connector belongs to — its secrets, its linked accounts, its
   * run budget, its audit trail. Usually the space the caller is in; the
   * caller's own personal space for a connector they brought with them
   * ({@link ConnectorSource}). Carried on the loaded connector rather than
   * passed alongside it so no executor can pair a note with the wrong space.
   */
  spaceId: string
  /** Who the run acts as, in that space. */
  principal: ContextPrincipal
  /** True when this is the caller's own connector, reached from another space. */
  personal: boolean
  /** True when this is the parent space's connector, shared with this sub-space. */
  shared: boolean
  sharedFrom: { id: string; name: string } | null
}

/**
 * Load one connector through the visibility lens. Null when the note is absent
 * OR not visible (indistinguishable, matching readVisible semantics); throws
 * ConnectorError('config') when the note exists but isn't a valid connector —
 * and a model, which lives under models/ and is deliberately not a connector
 * (lib/models/config.ts). Every executor (MCP run_connector, the agent
 * tool, the console terminal) loads through here, so that refusal is one line.
 */
export async function loadConnector(
  p: ContextPrincipal,
  context: Context,
  name: string,
  opts: ConnectorLookup = {},
): Promise<LoadedConnector | null> {
  const source = await readConnectorNote(p, context, name, opts)
  if (source === null) return null
  const { content, path } = source
  const fm = parseFrontmatter(content)
  if (!isConnectorNote(fm)) {
    throw new ConnectorError('config', `The note at ${path} is not a connector (missing \`type: connector\`)`)
  }
  // Off is a refusal, not a not-found: the note is there and the caller named
  // it correctly, so say so rather than letting them hunt for a typo.
  if (!isConnectorEnabled(fm)) {
    throw new ConnectorError(
      'config',
      `${name} is turned off — an admin can switch it back on in the Space Console under Connectors.`,
    )
  }
  const parsed = parseConnectorPerimeter(fm)
  if (!parsed.ok) throw new ConnectorError('config', parsed.error)
  return {
    perimeter: {
      ...parsed.perimeter,
      mcp: mcpEndpoint(name, typeof fm.recipe === 'string' ? fm.recipe : null, parsed.perimeter.mcp),
    },
    path,
    warnings: parsed.warnings,
    spaceId: source.spaceId,
    principal: source.principal,
    personal: source.personal,
    shared: source.shared,
    sharedFrom: source.sharedFrom,
  }
}

type ConnectorReadinessStatus = 'ok' | 'missing' | 'disabled' | 'invalid' | 'needs_connection' | 'broken'

/** One declared connector, judged for ONE person's runs. */
export interface ConnectorReadiness {
  connector: string
  status: ConnectorReadinessStatus
  /** Set for an `auth:` connector — which provider, and whether each person connects their own account. */
  auth: { provider: string; mode: 'user' | 'space'; accountLabel: string | null } | null
  /** The OAuth start link, when connecting (or reconnecting) is the fix. */
  connectUrl: string | null
  detail: string | null
  /** This is the person's own connector, brought from Settings — not the space's. */
  personal: boolean
  /** This is the parent space's connector, shared with this sub-space. */
  shared: boolean
}

/**
 * Would this person's runs of these connectors work? The check the agent page
 * asks before someone turns an agent on or puts their name down to run it:
 * the note exists, is on and parses, and — for an `auth:` connector — the
 * connection its runs would spend (THEIRS for `mode: user`, the space's for
 * `mode: space`) is present and not broken. Read through the CALLER's lens;
 * `forUserId` only decides whose connection row is judged.
 */
export async function connectorReadiness(
  p: ContextPrincipal,
  context: Context,
  names: readonly string[],
  forUserId: string,
): Promise<ConnectorReadiness[]> {
  return Promise.all(
    names.map(async (name): Promise<ConnectorReadiness> => {
      const none = { auth: null, connectUrl: null, detail: null, personal: false, shared: false }
      if (!NAME_RE.test(name)) return { connector: name, status: 'invalid', ...none, detail: 'not a connector name' }
      // Judged for ONE person, so their own connectors count: what a run would
      // actually resolve is what readiness must ask about.
      const source = await readConnectorNote(p, context, name, { personalFor: forUserId })
      if (source === null) return { connector: name, status: 'missing', ...none }
      const { content, spaceId: ownerSpaceId, personal, shared } = source
      const fm = parseFrontmatter(content)
      if (!isConnectorNote(fm)) return { connector: name, status: 'invalid', ...none, detail: 'the note is not a connector' }
      if (!isConnectorEnabled(fm)) return { connector: name, status: 'disabled', ...none, personal, shared }
      const parsed = parseConnectorPerimeter(fm)
      if (!parsed.ok) return { connector: name, status: 'invalid', ...none, personal, shared, detail: parsed.error }
      const auth = parsed.perimeter.auth
      if (!auth) return { connector: name, status: 'ok', ...none, personal, shared }
      const connectUrl = connectorConnectUrl(ownerSpaceId, name)
      const row = await prisma.connectorConnection.findUnique({
        where: {
          connection_identity: { spaceId: ownerSpaceId, provider: auth.provider, userId: connectionOwner(auth, forUserId) },
        },
        select: { mode: true, accountLabel: true, brokenAt: true, brokenReason: true },
      })
      const authInfo = { provider: auth.provider, mode: auth.mode, accountLabel: row?.accountLabel ?? null }
      if (!row || row.mode !== auth.mode) {
        return { connector: name, status: 'needs_connection', auth: authInfo, connectUrl, detail: null, personal, shared }
      }
      if (row.brokenAt) {
        return { connector: name, status: 'broken', auth: authInfo, connectUrl, detail: row.brokenReason, personal, shared }
      }
      return { connector: name, status: 'ok', auth: authInfo, connectUrl: null, detail: null, personal, shared }
    }),
  )
}


/**
 * What an agent's declared connectors give it, read once per run.
 *
 * `actions` is what each declares, for a tool description that lists them by
 * name, read under the caller so an invisible note contributes none. `hosts`
 * is every host they name, as machine policy patterns — the reach the agent's
 * machine is narrowed to (`lib/vm/lease.ts#taskAllow`), so the browser and the
 * isolate answer to the SAME declaration. Hosts are read grant-free
 * (`declaredReachHosts`): the machine is the space's, its reach is the space's
 * configuration, and a note read from the caller's own space is not part of it.
 */
export async function connectorReachFor(
  p: ContextPrincipal,
  context: Context,
  names: readonly string[],
): Promise<{ actions: Record<string, ConnectorActionSummary[]>; hosts: string[] }> {
  const actions: Record<string, ConnectorActionSummary[]> = {}
  const [hosts] = await Promise.all([
    declaredReachHosts(context.spaceId, names),
    ...names.map(async (name) => {
      actions[name] = []
      const source = await readConnectorNote(p, context, name)
      if (source === null) return
      const parsed = parseConnectorPerimeter(parseFrontmatter(source.content))
      if (!parsed.ok) return
      actions[name] = summariseActions(parsed.perimeter.actions)
    }),
  ])
  return { actions, hosts }
}

/** Decrypt the named secrets for a space; every name must exist. */
async function resolveSecretValues(
  spaceId: string,
  names: readonly string[],
): Promise<Map<string, string>> {
  if (names.length === 0) return new Map()
  const rows = await prisma.connectorSecret.findMany({
    where: { spaceId, name: { in: [...names] } },
    select: { name: true, ciphertext: true },
  })
  const byName = new Map(rows.map((r) => [r.name, r.ciphertext]))
  const missing = names.filter((n) => !byName.has(n))
  if (missing.length > 0) {
    throw new ConnectorError(
      'missing_secret',
      `Secret${missing.length > 1 ? 's' : ''} ${missing.join(', ')} not set for this space — an admin must add ${missing.length > 1 ? 'them' : 'it'} on the connector's page`,
    )
  }
  const values = new Map<string, string>()
  for (const [name, ciphertext] of byName) {
    try {
      values.set(name, decryptSecret(ciphertext))
    } catch (e) {
      // SECRETS_KEY unset/rotated or a corrupt row — never leak the detail.
      const misconfigured = e instanceof Error && e.message.includes('SECRETS_KEY')
      throw new ConnectorError(
        'config',
        misconfigured
          ? 'Connector secrets are not configured on this server'
          : `Stored secret ${name} cannot be decrypted — it may need to be set again`,
      )
    }
  }
  return values
}

/** The perimeter's `env` with every `{{secret:…}}` filled in. */
function envFromSecrets(perimeter: ConnectorPerimeter, secrets: Map<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, template] of Object.entries(perimeter.env)) {
    const resolved = interpolateSecrets(template, secrets)
    if (!resolved.ok) {
      throw new ConnectorError('missing_secret', `Secret ${resolved.missing.join(', ')} not set`)
    }
    env[key] = resolved.value
  }
  return env
}

/**
 * A website login's account, in plaintext, for the machine's sign-in and
 * nothing else (lib/vm/signin.ts). The one read of a connector's secrets that
 * does not end in the isolate; it exists so the sign-in never has to hold a
 * decryption path of its own.
 */
export async function loginCredentialsOf(loaded: LoadedConnector): Promise<{ url: string; user: string; password: string } | null> {
  const login = loaded.perimeter.login
  if (!login) return null
  const secrets = await resolveSecretValues(loaded.spaceId, perimeterSecretRefs(loaded.perimeter))
  const env = envFromSecrets(loaded.perimeter, secrets)
  return { url: login.url, user: env.LOGIN_USER ?? '', password: env.LOGIN_PASSWORD ?? '' }
}

const CODE_MAX_CHARS = 32_768
const AUDIT_CODE_CHARS = 200
/** Largest `args` payload an action call accepts, serialised. */
const ARGS_MAX_CHARS = 64 * 1024

/**
 * What to run: caller-written JavaScript, or one of the note's named actions
 * with the caller's arguments. A bare string is `{ code }` — the shape every
 * pre-actions caller passes.
 */
export type ConnectorRun = { code: string; action?: undefined } | { action: string; args?: unknown; code?: undefined }

/**
 * Resolve a run request against the loaded connector: the code that will
 * actually execute, the globals it needs, and the audit summary. Throws
 * ConnectorError('config') for an unknown action or a malformed request.
 */
function resolveRun(
  loaded: LoadedConnector,
  run: string | ConnectorRun,
): { code: string; globals: Record<string, unknown> | undefined; summary: string } {
  const req: { code?: unknown; action?: unknown; args?: unknown } = typeof run === 'string' ? { code: run } : run
  if (typeof req.action === 'string') {
    if (typeof req.code === 'string' && req.code.trim()) {
      throw new ConnectorError('config', 'Pass either `action` or `code`, not both')
    }
    const action = Object.prototype.hasOwnProperty.call(loaded.perimeter.actions, req.action)
      ? loaded.perimeter.actions[req.action]
      : null
    if (!action) {
      const known = Object.keys(loaded.perimeter.actions)
      throw new ConnectorError(
        'config',
        known.length > 0
          ? `No action named "${req.action}" — this connector declares: ${known.join(', ')}`
          : `No action named "${req.action}" — this connector declares no actions; pass \`code\` instead`,
      )
    }
    const args = req.args === undefined ? {} : req.args
    const json = JSON.stringify(args)
    if (json === undefined) throw new ConnectorError('config', '`args` must be JSON-serialisable')
    if (json.length > ARGS_MAX_CHARS) throw new ConnectorError('config', `\`args\` is too large (max ${ARGS_MAX_CHARS} characters)`)
    const shown = json.length > AUDIT_CODE_CHARS ? json.slice(0, AUDIT_CODE_CHARS) + '…' : json
    return { code: action.code, globals: { args: JSON.parse(json) as unknown }, summary: `action ${req.action} ${shown}` }
  }
  const code = typeof req.code === 'string' ? req.code : ''
  if (!code.trim()) throw new ConnectorError('config', 'Nothing to run — pass JavaScript to evaluate, or an action name')
  if (code.length > CODE_MAX_CHARS) {
    throw new ConnectorError('config', `Script too long (max ${CODE_MAX_CHARS} characters)`)
  }
  return { code, globals: undefined, summary: code.slice(0, AUDIT_CODE_CHARS).replace(/\s+/g, ' ').trim() }
}

/**
 * Run one connector script inside its perimeter — the whole execution path,
 * shared by the agent tool, the MCP tool, the Tools bridge and the console
 * terminal: the owning space's quota is charged, secrets resolve server-side
 * into the isolate's `env`, the isolate's only egress is the capability functions gated
 * on the note's hosts, secret values are redacted from everything that comes
 * back, and the run is audited win or lose.
 *
 * `run` is either JavaScript (a string, or `{ code }`) or a named action from
 * the note's `actions:` block (`{ action, args }`), whose fixed code runs with
 * `args` installed as a frozen global.
 */
export interface ConnectorRunOptions {
  /**
   * Is a person present, right now, for this run?
   *
   * The only thing it changes is an MCP tool set to `ask`
   * (lib/connectors/toolPolicy.ts), which runs when someone is here and is
   * refused when nobody is. False unless a caller says otherwise, so the
   * question every executor has to answer is "is someone watching this" rather
   * than "did I remember to lock it down".
   */
  attended?: boolean
}

export async function executeConnectorScript(
  loaded: LoadedConnector,
  run: string | ConnectorRun,
  opts: ConnectorRunOptions = {},
): Promise<IsolateRunResult> {
  // Both come off the loaded connector, never from the caller: a note and the
  // space whose secrets it opens are one fact, and pairing them at the call
  // site is how a personal connector would end up reading a space's keys.
  const { spaceId, principal: p } = loaded
  // A website login is not a service to call: its env is a password, and
  // caller-written code in the isolate reads env. The one path that password
  // takes is sign_in on the agent's machine (lib/vm/signin.ts).
  if (loaded.perimeter.login) {
    throw new ConnectorError('config', 'This connector is a website login — it is used by sign_in on an agent\'s machine and has nothing to run.')
  }
  const { code, globals, summary } = resolveRun(loaded, run)

  // Quota BEFORE any secret leaves the store, and per space rather than per
  // caller: the runtime is shared, and this is the one line every path crosses.
  const budget = takeConnectorRun(spaceId)
  if (!budget.ok) {
    const e = new ConnectorError(
      'rate_limited',
      `This space is over its connector run budget — try again in ${Math.ceil(budget.retryAfterMs / 1000)}s`,
    )
    auditConnectorCall(p, loaded.path, `run [${summary}] → ${e.code}: ${e.message}`)
    throw e
  }
  const releaseSlot = acquireConnectorRun(spaceId)
  if (!releaseSlot) {
    const e = new ConnectorError('rate_limited', 'This space already has its maximum number of connector runs in flight — try again shortly')
    auditConnectorCall(p, loaded.path, `run [${summary}] → ${e.code}: ${e.message}`)
    throw e
  }

  try {
    const secrets = await resolveSecretValues(spaceId, perimeterSecretRefs(loaded.perimeter))
    const env = envFromSecrets(loaded.perimeter, secrets)

    // Identity is assembled OUTSIDE `env` on purpose. Isolate code reads `env`;
    // if the signing key were in there, connector code could mint an assertion
    // naming anyone, which is exactly the forgery this feature exists to
    // prevent. It still joins the redact list, so it cannot come back out
    // through a log line or a reflected header either.
    const identity = resolveRunIdentity(p, loaded.perimeter, secrets)

    // An `auth:` connector resolves a stored OAuth token here. A missing or
    // dead connection throws a step-up ConnectorError naming the connect link,
    // which reaches the caller as readable text rather than a bare 401 — the
    // only useful answer for someone sitting in an MCP client with no browser
    // we can open.
    const auth = loaded.perimeter.auth
    const bearer = auth
      ? await (async () => {
          const connection = await resolveConnection({
            spaceId,
            auth,
            userId: p.userId,
            connectUrl: connectorConnectUrl(spaceId, connectorName(loaded.path)),
          })
          return { token: connection.accessToken, hosts: auth.hosts }
        })()
      : null

    const result = await runInIsolate(
      { ...loaded.perimeter, env, allowPrivate: allowPrivateHosts() },
      code,
      {
        // The bearer joins the redact list for the same reason secrets do: an
        // upstream that echoes its Authorization header back must not hand the
        // model a live access token.
        redact: [...secrets.values(), ...(bearer ? [bearer.token] : [])],
        identity,
        bearer,
        attended: opts.attended === true,
        // `visvine.crypto.*` (sigv4 reads AWS keys from `env` by NAME, host-side)
        // and `visvine.state.*` (this connector's memory between runs).
        capabilities: {
          ...connectorCryptoCapabilities(env),
          ...connectorStateCapabilities({ spaceId, path: loaded.path }),
        },
        globals,
      },
    )
    auditConnectorCall(
      p,
      loaded.path,
      `run [${summary}] → ${
        result.timedOut ? 'timeout' : result.ok ? 'ok' : `error: ${result.error?.message ?? 'unknown'}`
      }${result.denials.length > 0 ? `, ${result.denials.length} egress denial(s)` : ''}`,
    )
    return result
  } catch (e) {
    if (e instanceof ConnectorError) {
      auditConnectorCall(p, loaded.path, `run [${summary}] → ${e.code}: ${e.message}`)
    }
    throw e
  } finally {
    releaseSlot()
  }
}

/** One tool an MCP connector's server advertises, with what this note allows it. */
export interface ConnectorTool {
  name: string
  /** The server's human name for it, when it gives one. */
  title: string | null
  description: string | null
  /** `read` when the server annotates it `readOnlyHint`, else `writes`. */
  group: ToolGroup
  permission: ToolPermission
}

export interface ConnectorToolListing {
  /** The endpoint the tools were read from. */
  url: string
  tools: ConnectorTool[]
  /** What an unlisted tool is allowed — the policy's default. */
  default: ToolPermission
}

/**
 * The tools an MCP connector's server advertises, each carrying what this
 * note currently allows it.
 *
 * Live, every time, and deliberately not cached: an MCP server may add or
 * withdraw a tool between one call and the next, and a permissions screen
 * showing yesterday's list is a screen someone makes a decision on that no
 * longer applies. The cost is one round trip when the panel opens.
 *
 * Unfiltered — {@link mcpAllTools}, not the isolate's `listTools` — because
 * the whole point of the screen is to decide about the tools that are
 * currently refused.
 *
 * Every gate the isolate crosses is crossed here too: the run budget, the
 * host allowlist, SSRF, the secret redaction. What is NOT here is any way to
 * call one — this reads names.
 */
export async function listConnectorTools(loaded: LoadedConnector): Promise<ConnectorToolListing> {
  const url = loaded.perimeter.mcp?.url
  if (!url) {
    throw new ConnectorError('config', `${connectorName(loaded.path)} is not an MCP server — its note declares no \`mcp.url\``)
  }
  const { spaceId, principal: p } = loaded

  const budget = takeConnectorRun(spaceId)
  if (!budget.ok) {
    throw new ConnectorError(
      'rate_limited',
      `This space is over its connector run budget — try again in ${Math.ceil(budget.retryAfterMs / 1000)}s`,
    )
  }

  // Resolved for the redact list alone: a server that echoes a header back
  // must not be able to show a secret on the permissions screen either. A
  // missing one is not fatal here the way it is for a run — listing tools
  // needs the bearer, not the env.
  const secrets = await resolveSecretValues(spaceId, perimeterSecretRefs(loaded.perimeter))

  const auth = loaded.perimeter.auth
  const bearer = auth
    ? await (async () => {
        const connection = await resolveConnection({
          spaceId,
          auth,
          userId: p.userId,
          connectUrl: connectorConnectUrl(spaceId, connectorName(loaded.path)),
        })
        return { token: connection.accessToken, hosts: auth.hosts }
      })()
    : null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), loaded.perimeter.timeoutMs)
  timer.unref?.()
  const denials: string[] = []
  try {
    const tools = await mcpAllTools(
      {
        // Only the gate's own fields: hosts, allow rules, the private-host
        // escape hatch and the tool policy. `env` never crosses, because
        // nothing here runs caller code that could read it.
        perimeter: {
          hosts: loaded.perimeter.hosts,
          allow: loaded.perimeter.allow,
          allowPrivate: allowPrivateHosts(),
          tools: loaded.perimeter.tools,
        },
        redact: [...secrets.values(), ...(bearer ? [bearer.token] : [])],
        deadline: Date.now() + loaded.perimeter.timeoutMs,
        signal: controller.signal,
        deny(reason) {
          if (denials.length < MAX_DENIALS) denials.push(reason)
          return reason
        },
        bearer,
      },
      url,
    )
    auditConnectorCall(p, loaded.path, `list tools → ${tools.length} tool(s)`)
    const policy = loaded.perimeter.tools
    return {
      url,
      default: policy.default,
      tools: tools.map((t: McpToolInfo) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        group: toolGroup(t.annotations),
        permission: toolPermission(policy, t.name),
      })),
    }
  } catch (e) {
    if (e instanceof ConnectorError) auditConnectorCall(p, loaded.path, `list tools → ${e.code}: ${e.message}`)
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Assemble the run's caller identity, or null when there is nothing to attest.
 *
 * Null in three cases, all of which leave the upstream seeing an unattributed
 * call — its most restrictive path, and therefore safe to reach silently:
 *   • the note declares no `identity:` block (the overwhelming majority);
 *   • the run is a system/maintenance pass, which is not acting for a person;
 *   • the principal has no email, so there is no name to put in the claim.
 *
 * A SCHEDULED AGENT RUN IS NOT ONE OF THOSE CASES. An agent already acts as a
 * named person — its author, or whoever the admin-only live note names in
 * `runs_as` — for every note it reads, so stamping that same person here is
 * what keeps the upstream's view consistent with Visvine's. The consequence is
 * worth stating plainly: the far side's audit log will name that person for
 * work the agent did while they were asleep. Repoint `runs_as` at a service
 * account where the provider offers one.
 *
 * A declared block whose secret is missing is NOT silent — that is a
 * misconfiguration an admin needs to see, and resolveSecretValues has already
 * thrown by the time we get here.
 */
function resolveRunIdentity(
  p: ContextPrincipal,
  perimeter: ConnectorPerimeter,
  secrets: Map<string, string>,
): ResolvedIdentity | null {
  const declared = perimeter.identity
  if (!declared) return null
  if (p.system) return null

  const actorEmail = p.email?.trim().toLowerCase() ?? ''
  if (!actorEmail) return null

  const name = identitySecretName(declared)
  const secret = secrets.get(name)
  if (!secret) {
    throw new ConnectorError('missing_secret', `Secret ${name} not set`)
  }

  return {
    header: declared.header,
    audience: declared.audience,
    secret,
    ttlSeconds: declared.ttlSeconds,
    hosts: declared.hosts,
    actorEmail,
  }
}

/** One audit line per connector execution, success or denial. */
function auditConnectorCall(
  p: ContextPrincipal,
  path: string,
  detail: string,
): void {
  void logAudit(p.spaceId, { userId: p.userId, name: p.name, action: 'connector', path, detail })
}
