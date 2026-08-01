/**
 * The HTTP connector executor. Order of operations is load-bearing:
 * allowlist first (deny before a secret is even resolved into memory),
 * then header interpolation, then the SSRF check on the final host, then the
 * fetch — with redirects refused so a response can't bounce the interpolated
 * headers to a host that never passed the check. Everything that leaves this
 * module, success or failure, has the resolved secret values redacted out.
 */
import { assertPubliclyRoutable, SsrfError } from '@/lib/net/ssrf'
import {
  allowPrivateHosts,
  ConnectorError,
  interpolateSecrets,
  matchAllowlist,
  normalizeRequestPath,
  redactSecrets,
  type HttpConnectorConfig,
} from './config'

const BODY_CAP_BYTES = 256 * 1024
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'])
const BODYLESS = new Set(['GET', 'HEAD'])

export interface HttpCall {
  method: string
  path: string
  query?: Record<string, string>
  body?: string
}

export interface HttpCallResult {
  status: number
  content_type: string | null
  body: string
  truncated: boolean
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

export async function executeHttpConnector(
  config: HttpConnectorConfig,
  secrets: ReadonlyMap<string, string>,
  call: HttpCall,
): Promise<HttpCallResult> {
  const method = call.method.toUpperCase()
  if (!METHODS.has(method)) {
    throw new ConnectorError('denied', `Method '${call.method}' is not supported`)
  }

  // Split an inline query string off before matching; matching is pathname-only.
  const [rawPath, inlineQuery] = ((i) => (i < 0 ? [call.path, null] : [call.path.slice(0, i), call.path.slice(i + 1)]))(
    call.path.indexOf('?'),
  )
  const path = normalizeRequestPath(rawPath)
  if (!path) {
    throw new ConnectorError('denied', `Path '${call.path}' is not an acceptable request path`)
  }
  if (!matchAllowlist(config.allow, method, path)) {
    const allowed = config.allow.map((r) => `${r.method} ${r.path}${r.prefix ? '*' : ''}`)
    throw new ConnectorError(
      'denied',
      allowed.length === 0
        ? 'This connector has no allow list — it is documentation-only'
        : `This connector does not allow ${method} ${path}. Allowed: ${allowed.join(', ')}`,
    )
  }

  const headers: Record<string, string> = {}
  for (const [key, template] of Object.entries(config.headers)) {
    const result = interpolateSecrets(template, secrets)
    if (!result.ok) {
      throw new ConnectorError(
        'missing_secret',
        `Secret${result.missing.length > 1 ? 's' : ''} ${result.missing.join(', ')} not set for this community — an admin must add ${result.missing.length > 1 ? 'them' : 'it'} on the connector's page`,
      )
    }
    headers[key] = result.value
  }
  const secretValues = [...secrets.values()]

  const url = new URL(config.baseUrl + path)
  if (inlineQuery) url.search = inlineQuery
  for (const [k, v] of Object.entries(call.query ?? {})) url.searchParams.append(k, v)

  try {
    await assertPubliclyRoutable(url.hostname, { allowPrivate: allowPrivateHosts() })
  } catch (e) {
    if (e instanceof SsrfError) throw new ConnectorError('ssrf', e.message)
    throw e
  }

  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers,
      body: BODYLESS.has(method) ? undefined : call.body,
      redirect: 'error',
      signal: AbortSignal.timeout(config.timeoutMs),
      cache: 'no-store',
    })
  } catch (e) {
    const name = e instanceof Error ? e.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new ConnectorError('timeout', `Connector call timed out after ${config.timeoutMs}ms`)
    }
    const message = e instanceof Error ? e.message : String(e)
    throw new ConnectorError('upstream', redactSecrets(message, secretValues))
  }

  const { text, truncated } = await readCapped(res, BODY_CAP_BYTES)
  return {
    status: res.status,
    content_type: res.headers.get('content-type'),
    body: redactSecrets(text, secretValues),
    truncated,
  }
}
