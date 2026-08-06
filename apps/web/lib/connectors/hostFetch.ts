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
import { refuseHost, refusePath, type GatePerimeter } from './perimeter'

/** Longest a single request may take, independent of the run's total budget. */
const PER_REQUEST_TIMEOUT_MS = 15_000
const REQUEST_BODY_CAP_BYTES = 1024 * 1024
const MAX_HEADERS = 32
const MAX_HEADER_BYTES = 8 * 1024
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'])
const BODYLESS = new Set(['GET', 'HEAD'])

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
  /** Present only on a 3xx, since redirects are not followed. */
  location?: string
}

export interface HostFetchInit {
  method?: unknown
  headers?: unknown
  body?: unknown
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

function normaliseHeaders(raw: unknown): Record<string, string> {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object') {
    throw new ConnectorError('config', 'fetch headers must be an object of string values')
  }
  const out: Record<string, string> = {}
  let bytes = 0
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = key.trim().toLowerCase()
    if (FORBIDDEN_HEADERS.has(name) || name.startsWith('proxy-')) continue
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
 * `catch` gets the reason, instead of the bare connection failure the proxy
 * used to leave it with).
 */
export async function hostFetch(
  ctx: HostContext,
  rawUrl: unknown,
  init: HostFetchInit = {},
): Promise<HostFetchResult> {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    throw new ConnectorError('config', 'fetch needs a URL string')
  }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new ConnectorError('config', `fetch could not parse the URL: ${rawUrl}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConnectorError('denied', ctx.deny(`egress denied: ${url.protocol} is not an allowed scheme`))
  }

  const method = (typeof init.method === 'string' ? init.method : 'GET').toUpperCase()
  if (!METHODS.has(method)) {
    throw new ConnectorError('config', `fetch method is not allowed: ${method}`)
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

  const headers = normaliseHeaders(init.headers)

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

  const timeout = AbortSignal.timeout(budgetFor(ctx))
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers,
      body,
      // Manual, not 'error': the 3xx comes back with a readable `location` and
      // code that re-issues goes through this whole gate again. That is the
      // per-hop re-judgement the proxy gave us, without following anything to
      // a host that never passed the check.
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

  const { text, truncated } = await readCapped(res, SANDBOX_LIMITS.outputCapBytes)

  const outHeaders: Record<string, string> = {}
  for (const [key, value] of res.headers) outHeaders[key] = redactSecrets(value, ctx.redact)

  const result: HostFetchResult = {
    status: res.status,
    ok: res.ok,
    headers: outHeaders,
    body: redactSecrets(text, ctx.redact),
    truncated,
  }
  const location = res.headers.get('location')
  if (location) result.location = location
  return result
}
