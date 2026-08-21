/**
 * The `fetch` a connector's code actually calls.
 *
 * This is the perimeter. Under the v2 proxy, egress was gated on a CONNECT
 * tunnel, which is opaque: the proxy could see the host but never the method or
 * path, so `allow:` rules were enforceable only on plain HTTP — i.e. essentially
 * never, since every real connector is HTTPS. Here the request is an argument,
 * so method and path are gated for the first time.
 *
 * The order below is load-bearing and matches the v1 executor's: refuse on
 * shape, host and path BEFORE a socket is opened, so a call that was never
 * going to be allowed doesn't reach an upstream at all.
 *
 * What comes back is plain data, never a `Response`. Streams and host objects
 * do not cross into the isolate — see marshal.ts.
 */
import { ConnectorError, redactSecrets, SANDBOX_LIMITS } from './config'
import { hostAllowed, refuseHost, refusePath, type GatePerimeter } from './perimeter'
import { identityAppliesTo, mintActorAssertion, type ResolvedIdentity } from './identity'

/** Longest a single request may take, independent of the run's total budget. */
const PER_REQUEST_TIMEOUT_MS = 15_000
const REQUEST_BODY_CAP_BYTES = 1024 * 1024
const MAX_HEADERS = 32
const MAX_HEADER_BYTES = 8 * 1024
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'])
const BODYLESS = new Set(['GET', 'HEAD'])
/** Most redirects one call may follow when it opts in with `follow`. */
const MAX_FOLLOW = 3

/**
 * Headers a caller may not set: they describe the connection rather than the
 * request, and letting isolate code forge them would let it lie to the upstream
 * about where the call came from.
 */
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding'])

/** What isolate code receives back. Deliberately inert: strings and numbers. */
export interface HostFetchResult {
  status: number
  ok: boolean
  headers: Record<string, string>
  body: string
  truncated: boolean
  /** Redirects followed to reach this response — 0 unless `follow` was set. */
  hops: number
  /** Present on a 3xx that was not followed (the default, or the hop budget ran out). */
  location?: string
}

export interface HostFetchInit {
  method?: unknown
  headers?: unknown
  body?: unknown
  /**
   * Opt-in redirect following: how many 3xx hops to follow (0..MAX_FOLLOW).
   * Every hop is judged against the perimeter exactly like the first request,
   * so a redirect cannot lead anywhere the code could not have gone directly.
   */
  follow?: unknown
}

/**
 * Read at most `cap` bytes of a response body, flagging truncation. The cap is
 * applied *within* the chunk that crosses it, not after appending it — an
 * upstream that answers in one huge chunk must not be able to make us buffer it
 * whole. Cutting at a byte boundary can split a multi-byte character; the final
 * non-streaming decode renders that tail as U+FFFD, which is the right trade
 * for a body that is already truncated.
 */
async function readCapped(res: Response, cap: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: '', truncated: false }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const remaining = cap - bytes
    if (value.byteLength >= remaining) {
      text += decoder.decode(value.subarray(0, remaining))
      await reader.cancel()
      return { text, truncated: true }
    }
    bytes += value.byteLength
    text += decoder.decode(value, { stream: true })
  }
  return { text: text + decoder.decode(), truncated: false }
}

/** What a run's capabilities share: the gate, the clock, and the denial log. */
export interface HostContext {
  perimeter: GatePerimeter
  /** Secret plaintexts, scrubbed from everything re-entering the isolate. */
  redact: readonly string[]
  /** Absolute wall-clock deadline for the whole run. */
  deadline: number
  signal: AbortSignal
  /** Records a refusal for the run result. Returns the same text. */
  deny(reason: string): string
  /**
   * Runtime-stamped caller identity, when the note declares one and the run
   * has a person to name. Held here rather than on the perimeter because it
   * carries a resolved secret — run material, not a gate rule.
   */
  identity?: ResolvedIdentity | null
  /**
   * An OAuth bearer Visvine holds on someone's behalf (lib/connectors/auth.ts).
   * Stamped on outbound requests to `hosts`, and deliberately NOT placed in
   * `env`: a per-person access token handed to isolate code could be logged,
   * returned, or posted somewhere else inside the perimeter. Held here so the
   * only thing that can spend it is the host.
   */
  bearer?: { token: string; hosts: readonly string[] } | null
}

/**
 * Wait, bounded by the run's deadline.
 *
 * Timers are deliberately absent from the isolate — nothing should be able to
 * schedule work that outlives a run — but backing off is not optional against
 * a real API: a 429 with `Retry-After` has exactly one correct response. This
 * gives that, and only that. It cannot outlast the run, because the deadline
 * caps it and the run-scoped signal cuts it short.
 */
export async function hostSleep(ctx: HostContext, rawMs: unknown): Promise<null> {
  const ms = typeof rawMs === 'number' && Number.isFinite(rawMs) ? Math.max(0, Math.floor(rawMs)) : 0
  const remaining = ctx.deadline - Date.now()
  if (remaining <= 0) throw new ConnectorError('timeout', 'The connector run ran out of time')
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, Math.min(ms, remaining))
    ctx.signal.addEventListener('abort', done, { once: true })
    function done() {
      clearTimeout(timer)
      ctx.signal.removeEventListener('abort', done)
      resolve()
    }
  })
  return null
}

/** Milliseconds this call may take: the smaller of its own cap and what's left. */
function budgetFor(ctx: HostContext): number {
  const remaining = ctx.deadline - Date.now()
  if (remaining <= 0) {
    throw new ConnectorError('timeout', 'The connector run ran out of time')
  }
  return Math.min(PER_REQUEST_TIMEOUT_MS, remaining)
}

function normaliseHeaders(raw: unknown, reserved?: ReadonlySet<string>): Record<string, string> {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object') {
    throw new ConnectorError('config', 'fetch headers must be an object of string values')
  }
  const out: Record<string, string> = {}
  let bytes = 0
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = key.trim().toLowerCase()
    if (FORBIDDEN_HEADERS.has(name) || name.startsWith('proxy-')) continue
    // Runtime-managed headers — the identity assertion and, when the note has
    // an `auth:` block, Authorization. Dropping a caller-supplied one silently
    // rather than erroring keeps the isolate from probing for whether either is
    // configured, and matches how FORBIDDEN_HEADERS behaves.
    if (reserved?.has(name)) continue
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) {
      throw new ConnectorError('config', `fetch header name is not valid: ${key}`)
    }
    const text = typeof value === 'string' ? value : String(value)
    // A header value carrying a newline is header injection, not a header.
    if (/[\r\n]/.test(text)) {
      throw new ConnectorError('config', `fetch header ${key} may not contain a newline`)
    }
    bytes += name.length + text.length
    if (Object.keys(out).length >= MAX_HEADERS || bytes > MAX_HEADER_BYTES) {
      throw new ConnectorError('config', 'fetch headers are too large')
    }
    out[name] = text
  }
  return out
}

/**
 * One outbound request, judged against the perimeter.
 *
 * A refusal is BOTH recorded on the run (so an operator sees why a connector
 * failed) and thrown into the isolate as a catchable error (so the model's own
 * `catch` gets the reason rather than a bare connection failure).
 */
export async function hostFetch(
  ctx: HostContext,
  rawUrl: unknown,
  init: HostFetchInit = {},
): Promise<HostFetchResult> {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    throw new ConnectorError('config', 'fetch needs a URL string')
  }
  const follow = followBudget(init.follow)

  let url = parseUrl(rawUrl)
  let method = (typeof init.method === 'string' ? init.method : 'GET').toUpperCase()
  if (!METHODS.has(method)) {
    throw new ConnectorError('config', `fetch method is not allowed: ${method}`)
  }

  let body: string | undefined
  if (init.body !== undefined && init.body !== null) {
    if (BODYLESS.has(method)) {
      throw new ConnectorError('config', `a ${method} request cannot carry a body`)
    }
    body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body)
    if (body.length > REQUEST_BODY_CAP_BYTES) {
      throw new ConnectorError('config', 'fetch body is too large')
    }
  }

  for (let hops = 0; ; hops++) {
    const res = await fetchOnce(ctx, url, method, init.headers, body)
    const location = res.headers.get('location')
    const redirected = res.status >= 300 && res.status < 400 && location !== null
    if (redirected && hops < follow) {
      // The body of the 3xx itself is of no interest; drop it before moving on.
      await res.body?.cancel().catch(() => {})
      const next = parseUrl(location, url)
      // The same method change every browser makes: 303 always becomes GET;
      // 301/302 do too for anything but GET/HEAD; 307/308 keep the method and
      // body — and the body only re-goes when the method survives.
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && !BODYLESS.has(method))) {
        method = 'GET'
        body = undefined
      }
      url = next
      continue
    }

    const { text, truncated } = await readCapped(res, SANDBOX_LIMITS.outputCapBytes)
    const outHeaders: Record<string, string> = {}
    for (const [key, value] of res.headers) outHeaders[key] = redactSecrets(value, ctx.redact)
    const result: HostFetchResult = {
      status: res.status,
      ok: res.ok,
      headers: outHeaders,
      body: redactSecrets(text, ctx.redact),
      truncated,
      hops,
    }
    if (location) result.location = redactSecrets(location, ctx.redact)
    return result
  }
}

/** `follow` as an integer 0..MAX_FOLLOW; absent/false is 0, true is the max. */
function followBudget(raw: unknown): number {
  if (raw === true) return MAX_FOLLOW
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0
  return Math.min(MAX_FOLLOW, Math.max(0, Math.floor(raw)))
}

function parseUrl(raw: string, base?: URL): URL {
  try {
    return base ? new URL(raw, base) : new URL(raw)
  } catch {
    throw new ConnectorError('config', `fetch could not parse the URL: ${raw}`)
  }
}

/**
 * One request to one URL — the whole gate, then the socket. Called once per
 * hop, so a redirect target is judged exactly as the first URL was: scheme,
 * host (with the SSRF check), method+path rules, and the identity/bearer
 * stamps re-decided for the host it actually reaches.
 */
async function fetchOnce(
  ctx: HostContext,
  url: URL,
  method: string,
  rawHeaders: unknown,
  body: string | undefined,
): Promise<Response> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConnectorError('denied', ctx.deny(`egress denied: ${url.protocol} is not an allowed scheme`))
  }

  // Host before path, so the denial names the more fundamental fact. A call to
  // an unlisted host usually fails the allow rules too — reporting the rules
  // would send the reader off to edit `allow:` when the answer is `hosts:`.
  const defaultPort = url.protocol === 'https:' ? 443 : 80
  const port = url.port ? Number(url.port) : defaultPort
  const hostDenial = await refuseHost(ctx.perimeter, url.hostname, port, defaultPort)
  if (hostDenial) throw new ConnectorError('denied', ctx.deny(hostDenial))

  const pathDenial = refusePath(ctx.perimeter, method, url.pathname)
  if (pathDenial) throw new ConnectorError('denied', ctx.deny(pathDenial))

  const reserved = new Set<string>()
  if (ctx.identity) reserved.add(ctx.identity.header)
  if (ctx.bearer) reserved.add('authorization')
  const headers = normaliseHeaders(rawHeaders, reserved)

  // Stamped AFTER normalisation, so nothing the isolate passed can shadow it.
  // Skipped silently when there is no person to name (an agent or maintenance
  // run) or the host is outside the identity block's reach — in both cases the
  // upstream simply sees an unattributed call, which is its restrictive path.
  if (ctx.identity && identityAppliesTo(ctx.identity, url.hostname, port, defaultPort)) {
    headers[ctx.identity.header] = await mintActorAssertion(ctx.identity)
  }

  // Same rule for the OAuth bearer, and the host scoping matters more here: an
  // access token is a credential, so sending it to the wrong host in the
  // perimeter is a leak rather than a privacy slip. An empty host list means
  // the note reaches one service and the whole perimeter is that service.
  if (ctx.bearer) {
    const scoped =
      ctx.bearer.hosts.length === 0 || hostAllowed(ctx.bearer.hosts, url.hostname, port, defaultPort)
    if (scoped) headers.authorization = `Bearer ${ctx.bearer.token}`
  }

  const timeout = AbortSignal.timeout(budgetFor(ctx))
  try {
    return await fetch(url, {
      method,
      headers,
      body,
      // Manual, not 'follow': a 3xx comes back with a readable `location`, and
      // whether code re-issues it by hand or opts in with `follow`, the next
      // hop goes through this whole gate again. That is the per-hop
      // re-judgement the proxy gave us, without following anything to a host
      // that never passed the check.
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.any([ctx.signal, timeout]),
    })
  } catch (e) {
    if (ctx.signal.aborted || timeout.aborted) {
      throw new ConnectorError('timeout', `The request to ${url.host} timed out`)
    }
    const message = e instanceof Error ? e.message : String(e)
    throw new ConnectorError('upstream', redactSecrets(message, ctx.redact))
  }
}
