/**
 * The Tool bridge protocol — the one contract shared by everything in the
 * Tools feature, and the reason it lives on its own with no dependencies but
 * `lib/redirects`.
 *
 * Three parties speak it:
 *   • the in-frame SDK (`features/tools/kit/client.ts`), running inside a
 *     sandboxed, cookie-less iframe on a foreign origin;
 *   • the host `ToolFrame` component in the Visvine page, which relays frame
 *     messages to the server and host messages back;
 *   • `POST /api/tools/bridge`, which is the only thing that ever touches real
 *     data, under the viewer's own principal.
 *
 * Two shapes, deliberately separate. `HostMessage`/`FrameMessage` are the
 * postMessage wire; `BridgeRequest`/`BridgeResponse` are the REST envelope the
 * host uses on the frame's behalf. A frame never names its own target — the
 * host supplies it — so a Tool cannot ask for another install's data by
 * rewriting a message.
 *
 * Everything crossing the postMessage boundary arrives from an untrusted
 * document, so `isHostMessage`/`isFrameMessage` are real validators, not casts:
 * both sides must run the incoming value through them before reading a field.
 * They check structure only. Authorisation (perimeter, grants, caps) is the
 * server's job and cannot be done here.
 */
import { safeRelativePath } from './paths'

/**
 * Bumped for a new family of methods or a breaking wire change; the frame
 * reports the version it speaks. Version 2 adds records, resources, links,
 * actions, AI, per-viewer state and the host's own `ui.*` services — every
 * one additive, so the host answers a version 1 frame exactly as it always did.
 */
export const PROTOCOL_VERSION = 2

/** Every version a host still answers. */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly number[] = [1, 2]

/**
 * Hard caps the bridge enforces server-side. They live here because the SDK
 * documents them to Tool authors and the host sizes its own guards from the
 * same numbers — one place to change, no drift between doc and gate.
 */
export const BRIDGE_LIMITS = {
  /** Most rows any list/search call returns, whatever `k` asked for. */
  maxRows: 200,
  /** Largest note body a single `context.read` will hand back. */
  maxReadBytes: 256_000,
  /** Largest note body a single `context.write`/`context.append` may send. */
  maxWriteBytes: 128_000,
  /** Largest serialized `params` a single call may carry. */
  maxParamsBytes: 64_000,
  /** Per install, per viewer. */
  callsPerMinute: 120,
  /** Wall clock for one `data.call` in the isolate. */
  dataCallTimeoutMs: 20_000,
  /** Largest file `resources.blob` hands back inline, as a data URL. */
  maxBlobBytes: 2_000_000,
  /** Most text one `resources.read` page returns. */
  maxResourceReadChars: 20_000,
  /** Longest answer `ai.complete` asks the model for, in tokens. */
  aiMaxOutputTokens: 1_024,
  /** Most items one `ai.decide` judges. */
  aiMaxDecideItems: 100,
} as const

// ── subject ──

/**
 * What the Tool is being shown "about", when it is shown on something. A Tool
 * on its own rail page has no subject; one owning a type page is handed the
 * note or node whose page it is rendering.
 */
export type ToolSubject =
  | { kind: 'note'; path: string; type: string | null; title: string | null }
  | { kind: 'node'; nodeId: string; type: string; notePath: string | null }

// ── errors ──

/**
 * Every refusal the bridge can give, as a code the SDK can branch on and a
 * message safe to render. `perimeter` means the Tool never declared this reach;
 * `forbidden` means the viewer lacks it — the distinction matters to an author
 * because only the first is theirs to fix. Two codes are the HOST's, and a
 * Tool never sees them: `revoked` — the version was pulled (or its listing
 * suspended), and the host removes the frame (lib/tools/verdicts.ts) — and
 * `consent_required` — a Tool from outside the space is about to act as the
 * viewer for the first time, and the host asks them before sending the call
 * again (lib/tools/consents.ts).
 */
export type BridgeErrorCode =
  | 'perimeter'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'too_large'
  | 'timeout'
  | 'invalid'
  | 'degraded'
  | 'revoked'
  | 'consent_required'
  | 'internal'

export interface BridgeError {
  code: BridgeErrorCode
  message: string
}

// ── methods ──

/** One row of `context.list`. */
export interface ContextEntry {
  path: string
  title: string | null
  type: string | null
  /** ISO 8601. */
  updatedAt: string
}

/** A note body plus its parsed frontmatter, capped at `maxReadBytes`. */
export interface ContextNote {
  path: string
  content: string
  frontmatter: Record<string, unknown>
}

/**
 * One page of a paged `context.list`/`context.search`. Only returned when the
 * caller passed `cursor` or `page: true` — the unpaged call still answers a
 * plain (capped) array, so a Tool written before paging existed keeps working.
 * `nextCursor` is opaque; hand it back unchanged. Null means the last page.
 */
export interface ContextPage<T> {
  items: T[]
  nextCursor: string | null
}

/** One `context.search` hit. `snippet` is already excerpted server-side. */
export interface ContextHit {
  path: string
  title: string | null
  snippet: string
  score: number
}

/** A record as a Tool reads it: a note of one of the space's types, or a node's. */
export interface ToolRecord {
  /** Its note — the handle `records.get`/`update` take — or '' for a node with no note. */
  path: string
  /** A node-backed record's node id. */
  nodeId?: string
  type: string
  title: string
  tags: string[]
  /** ISO 8601. */
  updatedAt: string
  /** Its fields, typed as their kind reads (a number, a date `YYYY-MM-DD`, true/false, text). */
  fields: Record<string, unknown>
  /** Fields whose written value does not read as their kind; shown, never trusted. */
  invalid: string[]
}

/** One predicate over a record field. */
export type RecordWhere =
  | { key: string; op: 'eq'; value: string | number | boolean }
  | { key: string; op: 'in'; values: Array<string | number> }
  | { key: string; op: 'range'; min?: string | number; max?: string | number }
  | { key: string; op: 'contains'; value: string }

/** A file or a link, as a Tool reads it. Its bytes are `resources.blob`; its text `resources.read`. */
export interface ToolResource {
  id: string
  name: string
  /** `image`, `pdf`, `doc`, `sheet`, `slides`, `video`, `audio`, `text`, `code`, `archive`, `link`… */
  kind: string
  source: 'upload' | 'link'
  mimeType: string | null
  fileSize: number | null
  /** The page a link points at. */
  url: string | null
  /** Its note, under `resources/`. */
  notePath: string | null
  /** Text was extracted from it, so `resources.read` has something to return. */
  hasText: boolean
  /** ISO 8601. */
  createdAt: string
}

/** A note another links to, or one it links to. */
export interface ContextLink {
  path: string
  title: string | null
  /** The passage the link sits in — incoming links only. */
  excerpt?: string
}

/** One question `ai.decide` asks of every item. */
export type DecideQuestion =
  | { id: string; type?: 'yes_no'; ask: string }
  | { id: string; type: 'choice' | 'scale'; ask: string; options: string[] }

/** One item's answers: a probability for yes/no, a pick for a choice, a place on a scale. */
export type DecideAnswer = Record<
  string,
  | { type: 'yes_no'; probability: number }
  | { type: 'choice'; choice: string; confidence: number }
  | { type: 'scale'; option: string; score: number; confidence: number }
>

/** Where a Tool's `state` lives: the viewer's own (SDK 2's default), or one value every viewer shares. */
export type StateScope = 'user' | 'install'

/**
 * The method table: every capability a Tool has, with the params it takes and
 * what it gets back. Adding a row here is the whole surface change — the SDK,
 * the host relay and the server handler map all key off it.
 */
export interface BridgeMethods {
  'context.list': {
    params: { glob?: string; cursor?: string; page?: boolean }
    result: ContextEntry[] | ContextPage<ContextEntry>
  }
  'context.read': { params: { path: string }; result: ContextNote }
  'context.search': {
    params: { query: string; k?: number; cursor?: string; page?: boolean }
    result: ContextHit[] | ContextPage<ContextHit>
  }
  'context.write': { params: { path: string; content: string }; result: { path: string } }
  'context.append': { params: { path: string; text: string }; result: { path: string } }
  'connectors.call': {
    /** Exactly one of `code` (JavaScript) or `action` (a declared action name, with `args`). */
    params: { name: string; code?: string; action?: string; args?: unknown }
    result: unknown
  }
  'agents.run': { params: { name: string }; result: { runId: string } }
  'data.call': { params: { fn: string; args: unknown }; result: unknown }
  /** `scope` absent is `install` — what a version 1 Tool has always had. */
  'state.get': { params: { key: string; scope?: StateScope }; result: unknown }
  'state.set': { params: { key: string; value: unknown; scope?: StateScope }; result: null }
  'subject.get': { params: Record<string, never>; result: ToolSubject | null }
  'context.links': { params: { path: string }; result: { outgoing: ContextLink[]; incoming: ContextLink[] } }
  'records.query': {
    params: {
      type: string
      where?: RecordWhere[]
      order?: { key: string; direction: 'asc' | 'desc' }
      limit?: number
      cursor?: string
    }
    result: { type: string; rows: ToolRecord[]; nextCursor: string | null; total: number }
  }
  'records.get': { params: { path?: string; nodeId?: string }; result: ToolRecord }
  'records.update': {
    params: { path?: string; nodeId?: string; fields: Record<string, unknown> }
    result: { record: string; fields: Record<string, unknown> }
  }
  'resources.list': {
    params: { folder?: string; kind?: string; q?: string; cursor?: string }
    result: { items: ToolResource[]; nextCursor: string | null }
  }
  'resources.get': { params: { id: string }; result: ToolResource }
  'resources.read': {
    params: { id: string; offset?: number }
    result: { text: string; offset: number; totalChars: number; nextOffset: number | null }
  }
  'resources.blob': {
    params: { id: string; rendition?: 'original' | 'thumb' | 'preview' }
    result: { mimeType: string; dataUrl: string }
  }
  /** One of the space's actions from the fixed allowlist, in this space only. */
  'actions.run': { params: { name: string; input?: Record<string, unknown> }; result: unknown }
  'ai.complete': {
    params: {
      prompt?: string
      system?: string
      messages?: Array<{ role: 'user' | 'assistant'; content: string }>
      maxTokens?: number
    }
    result: { text: string }
  }
  'ai.decide': { params: { items: string[]; questions: DecideQuestion[] }; result: Array<DecideAnswer | null> }
}

export type BridgeMethod = keyof BridgeMethods
export type BridgeParams<M extends BridgeMethod> = BridgeMethods[M]['params']
export type BridgeResult<M extends BridgeMethod> = BridgeMethods[M]['result']

/** The runtime half of `BridgeMethod`, for validating a value off the wire. */
export const BRIDGE_METHODS = [
  'context.list',
  'context.read',
  'context.search',
  'context.write',
  'context.append',
  'connectors.call',
  'agents.run',
  'data.call',
  'state.get',
  'state.set',
  'subject.get',
  'context.links',
  'records.query',
  'records.get',
  'records.update',
  'resources.list',
  'resources.get',
  'resources.read',
  'resources.blob',
  'actions.run',
  'ai.complete',
  'ai.decide',
] as const satisfies readonly BridgeMethod[]

export function isBridgeMethod(value: unknown): value is BridgeMethod {
  return typeof value === 'string' && (BRIDGE_METHODS as readonly string[]).includes(value)
}

/**
 * The host's own services: drawn and answered by the page around the frame,
 * never sent to the server — a toast, a confirm, a download it names and asks
 * about, opening a record or a file in the app.
 */
export interface HostMethods {
  'ui.toast': { params: { message: string; tone?: 'info' | 'success' | 'warning' | 'error' }; result: null }
  'ui.confirm': {
    params: { title: string; body?: string; confirmLabel?: string; destructive?: boolean }
    result: { confirmed: boolean }
  }
  /** Needs `permissions.ui.download`; the host names the file and asks before saving. */
  'ui.download': { params: { filename: string; content: string; mimeType?: string }; result: { saved: boolean } }
  'ui.openRecord': { params: { path?: string; nodeId?: string }; result: null }
  'ui.openResource': { params: { id: string }; result: null }
}

export type HostMethod = keyof HostMethods

export const HOST_METHODS = [
  'ui.toast',
  'ui.confirm',
  'ui.download',
  'ui.openRecord',
  'ui.openResource',
] as const satisfies readonly HostMethod[]

export function isHostMethod(value: unknown): value is HostMethod {
  return typeof value === 'string' && (HOST_METHODS as readonly string[]).includes(value)
}

// ── messages ──

/** Who is looking. `isAdmin` is this space's admin, not super-admin. */
export interface ToolViewer {
  id: string
  name: string
  isAdmin: boolean
}

/**
 * Which Tool this frame is. An installed Tool carries its rail key so it can
 * link to itself; a preview is the author's unpublished working copy and has
 * no install to name.
 */
export type ToolInstallInfo =
  | {
      slug: string
      title: string
      key: string
      /** The install's settings as an admin set them (manifest 2's `settings`). */
      settings?: Record<string, unknown>
      /** What each binding slot is bound to in this space. */
      bindings?: Record<string, string>
      /** The kit major the Tool was written against; absent reads as 1. */
      sdk?: number
    }
  | { preview: true; name: string; settings?: Record<string, unknown>; bindings?: Record<string, string>; sdk?: number }

/**
 * What the space is missing for this Tool to run whole. Reads against the
 * missing pieces come back empty rather than failing the install, and the host
 * shows a banner — see the degraded-install rule in the brief.
 */
export interface ToolDegraded {
  missing: {
    connectors: string[]
    types: string[]
    agents: string[]
    /** Binding slots nobody has bound here, by their labels. Absent from a host older than bindings. */
    bindings?: string[]
  }
}

/** The one-shot handshake payload; also the shape `onInit` hands the Tool. */
export interface ToolInitMessage {
  type: 'visvine:init'
  version: number
  /** CSS custom properties (`--color-brand-green`, `--vv-*`) to set on `:root`. */
  theme: Record<string, string>
  subject: ToolSubject | null
  install: ToolInstallInfo
  degraded: ToolDegraded | null
  viewer: ToolViewer
  /**
   * The Tool's active section when its page draws `surfaces.nav`, else null.
   * Absent from a host older than sections.
   */
  section?: string | null
}

export type HostMessage =
  | ToolInitMessage
  | { type: 'visvine:result'; id: string; ok: true; value: unknown }
  | { type: 'visvine:result'; id: string; ok: false; error: BridgeError }
  | { type: 'visvine:theme'; theme: Record<string, string> }
  | { type: 'visvine:subject'; subject: ToolSubject | null }
  /**
   * Notes inside the Tool's read perimeter changed (written, renamed to,
   * deleted). Best-effort and per-process — see lib/notes/changes.ts. A Tool
   * that cares re-reads; the message carries paths, never content.
   */
  | { type: 'visvine:changed'; paths: string[] }
  /** The person chose another of the Tool's sections on the band or the side list. */
  | { type: 'visvine:route'; section: string | null }
  /** The person pressed one of the Tool's band buttons. */
  | { type: 'visvine:action'; id: string }

export type FrameMessage =
  | { type: 'visvine:ready'; version: number }
  | { type: 'visvine:call'; id: string; method: BridgeMethod | HostMethod; params: unknown }
  | { type: 'visvine:resize'; height: number }
  | { type: 'visvine:error'; message: string; stack?: string }
  /** The host validates the path with `isInAppPath` before routing anywhere. */
  | { type: 'visvine:navigate'; path: string }
  /** Switch the Tool's own section; the host moves only to one the Tool declared. */
  | { type: 'visvine:section'; section: string }

// ── REST envelope ──

/**
 * Which Tool the host is calling for. The frame never sees or sets this: the
 * host page knows which install it embedded, and the server re-checks that the
 * viewer may use it.
 */
export type BridgeTarget =
  | { kind: 'install'; installId: string }
  | { kind: 'preview'; spaceId: string; name: string }
  /** A version under Visvine's dynamic run, in its honeypot space — resolvable by the review runner alone. */
  | { kind: 'review'; runId: string }

export interface BridgeRequest {
  target: BridgeTarget
  method: BridgeMethod
  params: unknown
}

export type BridgeResponse =
  | { ok: true; value: unknown }
  | { ok: false; error: BridgeError }

// ── guards ──

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringMap(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((v) => typeof v === 'string')
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

function isSubject(value: unknown): value is ToolSubject {
  if (!isRecord(value)) return false
  if (value.kind === 'note') {
    return (
      typeof value.path === 'string' &&
      (typeof value.type === 'string' || value.type === null) &&
      (typeof value.title === 'string' || value.title === null)
    )
  }
  if (value.kind === 'node') {
    return (
      typeof value.nodeId === 'string' &&
      typeof value.type === 'string' &&
      (typeof value.notePath === 'string' || value.notePath === null)
    )
  }
  return false
}

function isSubjectOrNull(value: unknown): value is ToolSubject | null {
  return value === null || isSubject(value)
}

function isBridgeError(value: unknown): value is BridgeError {
  if (!isRecord(value) || typeof value.message !== 'string') return false
  const codes: readonly string[] = [
    'perimeter',
    'forbidden',
    'not_found',
    'rate_limited',
    'too_large',
    'timeout',
    'invalid',
    'degraded',
    'revoked',
    'consent_required',
    'internal',
  ]
  return typeof value.code === 'string' && codes.includes(value.code)
}

function isInstallInfo(value: unknown): value is ToolInstallInfo {
  if (!isRecord(value)) return false
  if (value.preview === true) return typeof value.name === 'string'
  return (
    typeof value.slug === 'string' &&
    typeof value.title === 'string' &&
    typeof value.key === 'string'
  )
}

function isDegraded(value: unknown): value is ToolDegraded | null {
  if (value === null) return true
  if (!isRecord(value) || !isRecord(value.missing)) return false
  const { connectors, types, agents, bindings } = value.missing
  return (
    isStringArray(connectors) &&
    isStringArray(types) &&
    isStringArray(agents) &&
    (bindings === undefined || isStringArray(bindings))
  )
}

function isViewer(value: unknown): value is ToolViewer {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.isAdmin === 'boolean'
  )
}

/**
 * Host → frame. Run every `message` event through this before reading it: the
 * frame's own document is hostile by assumption, and so is anything else that
 * reached its window.
 */
export function isHostMessage(value: unknown): value is HostMessage {
  if (!isRecord(value)) return false
  switch (value.type) {
    case 'visvine:init':
      return (
        typeof value.version === 'number' &&
        isStringMap(value.theme) &&
        isSubjectOrNull(value.subject) &&
        isInstallInfo(value.install) &&
        isDegraded(value.degraded) &&
        isViewer(value.viewer) &&
        (value.section === undefined || value.section === null || typeof value.section === 'string')
      )
    case 'visvine:result':
      if (typeof value.id !== 'string') return false
      if (value.ok === true) return 'value' in value
      if (value.ok === false) return isBridgeError(value.error)
      return false
    case 'visvine:theme':
      return isStringMap(value.theme)
    case 'visvine:subject':
      return isSubjectOrNull(value.subject)
    case 'visvine:changed':
      return isStringArray(value.paths)
    case 'visvine:route':
      return value.section === null || typeof value.section === 'string'
    case 'visvine:action':
      return typeof value.id === 'string'
    default:
      return false
  }
}

/**
 * Frame → host. `params` is deliberately unchecked here — only the server knows
 * what each method's params must look like, and it validates them itself.
 */
export function isFrameMessage(value: unknown): value is FrameMessage {
  if (!isRecord(value)) return false
  switch (value.type) {
    case 'visvine:ready':
      return typeof value.version === 'number'
    case 'visvine:call':
      return (
        typeof value.id === 'string' &&
        (isBridgeMethod(value.method) || isHostMethod(value.method)) &&
        'params' in value
      )
    case 'visvine:resize':
      return typeof value.height === 'number' && Number.isFinite(value.height) && value.height >= 0
    case 'visvine:error':
      return (
        typeof value.message === 'string' &&
        (value.stack === undefined || typeof value.stack === 'string')
      )
    case 'visvine:navigate':
      return typeof value.path === 'string'
    case 'visvine:section':
      return typeof value.section === 'string' && value.section.length <= 32
    default:
      return false
  }
}

/**
 * Is this a path the host may navigate to? A Tool asking to navigate is asking
 * the *app* to move, so the answer has to be "somewhere in this app" and
 * nothing else — `safeRelativePath` already knows every way a string can look
 * relative and resolve off-site, so defer to it rather than re-deriving them.
 */
export function isInAppPath(path: string): boolean {
  return safeRelativePath(path) === path
}
