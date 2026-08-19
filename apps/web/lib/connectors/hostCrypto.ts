/**
 * `visvine.crypto` — the hashing and signing an isolate cannot do for itself.
 *
 * QuickJS has no WebCrypto, no Buffer and no TextEncoder, and request signing
 * (AWS SigV4, HMAC-signed webhooks, any "sign the body" API) needs all three.
 * Rather than let a vendor SDK in, the host lends exactly these primitives:
 * strings in, strings out, no keys of ours involved. Every function here is
 * pure computation over what the isolate already holds — with ONE exception,
 * `sigv4`, which reads the AWS key pair from the connector's resolved env by
 * NAME so the secret never has to round-trip through connector code at all.
 *
 * Installed through `IsolateRunOptions.capabilities` as dotted keys, so the
 * isolate sees `visvine.crypto.hmac(...)` etc. on the frozen namespace. Every
 * call is async on the isolate side (that is how capabilities work), even
 * though nothing here awaits.
 *
 * Nothing that comes back is a secret of ours: an HMAC over the caller's own
 * data with the caller's own key is theirs to see. It still leaves the isolate
 * through the same redaction as everything else.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto'
import { ConnectorError } from './config'

type Capability = (args: unknown[]) => Promise<unknown>

const ALGORITHMS = new Set(['sha256', 'sha1', 'sha512'] as const)
type Algorithm = 'sha256' | 'sha1' | 'sha512'
type KeyEncoding = 'utf8' | 'hex' | 'base64'
type OutEncoding = 'hex' | 'base64'

/** Largest input any one call accepts — well under the run's output cap. */
const MAX_INPUT_CHARS = 1024 * 1024
const MAX_RANDOM_BYTES = 64

function fail(message: string): never {
  throw new ConnectorError('config', `visvine.crypto: ${message}`)
}

function str(v: unknown, what: string): string {
  if (typeof v !== 'string') fail(`${what} must be a string`)
  if (v.length > MAX_INPUT_CHARS) fail(`${what} is too large`)
  return v
}

function algorithm(v: unknown): Algorithm {
  if (typeof v !== 'string' || !ALGORITHMS.has(v as Algorithm)) {
    fail(`alg must be one of sha256, sha1, sha512`)
  }
  return v as Algorithm
}

function opts(v: unknown): { keyEncoding: KeyEncoding; encoding: OutEncoding } {
  const o = (v !== null && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const keyEncoding = o.keyEncoding ?? 'utf8'
  const encoding = o.encoding ?? 'hex'
  if (keyEncoding !== 'utf8' && keyEncoding !== 'hex' && keyEncoding !== 'base64') {
    fail(`keyEncoding must be utf8, hex or base64`)
  }
  if (encoding !== 'hex' && encoding !== 'base64') fail(`encoding must be hex or base64`)
  return { keyEncoding, encoding }
}

function keyBytes(key: string, encoding: KeyEncoding): Buffer {
  return Buffer.from(key, encoding)
}

// ── the pure helpers ─────────────────────────────────────────────────────────

function hmac(args: unknown[]): string {
  const alg = algorithm(args[0])
  const key = str(args[1], 'key')
  const data = str(args[2], 'data')
  const o = opts(args[3])
  return createHmac(alg, keyBytes(key, o.keyEncoding)).update(data, 'utf8').digest(o.encoding)
}

function hash(args: unknown[]): string {
  const alg = algorithm(args[0])
  const data = str(args[1], 'data')
  const o = opts(args[2])
  return createHash(alg).update(data, 'utf8').digest(o.encoding)
}

function randomHex(args: unknown[]): string {
  const n = typeof args[0] === 'number' && Number.isFinite(args[0]) ? Math.floor(args[0]) : 16
  if (n < 1 || n > MAX_RANDOM_BYTES) fail(`randomHex takes 1..${MAX_RANDOM_BYTES} bytes`)
  return randomBytes(n).toString('hex')
}

function base64Encode(args: unknown[]): string {
  return Buffer.from(str(args[0], 'text'), 'utf8').toString('base64')
}

function base64Decode(args: unknown[]): string {
  const b64 = str(args[0], 'base64')
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(b64.replace(/\s+/g, ''))) fail('base64.decode: input is not base64')
  return Buffer.from(b64, 'base64').toString('utf8')
}

function timingSafeEqual(args: unknown[]): boolean {
  const a = Buffer.from(str(args[0], 'a'), 'utf8')
  const b = Buffer.from(str(args[1], 'b'), 'utf8')
  if (a.length !== b.length) return false
  return nodeTimingSafeEqual(a, b)
}

// ── AWS Signature Version 4 ──────────────────────────────────────────────────

/** RFC 3986 encoding as SigV4 wants it: `!'()*` encoded, `~` not. */
function awsEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

function canonicalUri(pathname: string, service: string): string {
  if (!pathname) return '/'
  const segments = pathname.split('/').map((seg) => {
    let decoded: string
    try {
      decoded = decodeURIComponent(seg)
    } catch {
      decoded = seg
    }
    const once = awsEncode(decoded)
    // Every service except S3 signs the path double-encoded.
    return service === 's3' ? once : awsEncode(once)
  })
  return segments.join('/') || '/'
}

function canonicalQuery(url: URL): string {
  const pairs: Array<[string, string]> = []
  for (const [k, v] of url.searchParams) pairs.push([awsEncode(k), awsEncode(v)])
  pairs.sort((x, y) => (x[0] === y[0] ? (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0) : x[0] < y[0] ? -1 : 1))
  return pairs.map(([k, v]) => `${k}=${v}`).join('&')
}

function amzDate(now: Date): { dateTime: string; date: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  return { dateTime: iso, date: iso.slice(0, 8) }
}

interface SigV4Request {
  accessKeyEnv: string
  secretEnv: string
  sessionTokenEnv: string | null
  region: string
  service: string
  method: string
  url: URL
  headers: Record<string, string>
  body: string
}

function parseSigV4Request(raw: unknown): SigV4Request {
  if (raw === null || typeof raw !== 'object') fail('sigv4 takes an options object')
  const o = raw as Record<string, unknown>
  const name = (v: unknown, what: string) => {
    if (typeof v !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) fail(`${what} must name an env variable`)
    return v
  }
  const accessKeyEnv = name(o.accessKeyEnv, 'accessKeyEnv')
  const secretEnv = name(o.secretEnv, 'secretEnv')
  const sessionTokenEnv = o.sessionTokenEnv === undefined || o.sessionTokenEnv === null ? null : name(o.sessionTokenEnv, 'sessionTokenEnv')
  const region = str(o.region, 'region').trim()
  const service = str(o.service, 'service').trim().toLowerCase()
  if (!/^[a-z0-9-]+$/.test(region) || !/^[a-z0-9-]+$/.test(service)) fail('region and service must be plain identifiers')
  const method = (typeof o.method === 'string' ? o.method : 'GET').toUpperCase()
  if (!/^[A-Z]+$/.test(method)) fail('method must be an HTTP method')
  let url: URL
  try {
    url = new URL(str(o.url, 'url'))
  } catch {
    fail('url must be absolute')
  }
  const headers: Record<string, string> = {}
  if (o.headers !== undefined && o.headers !== null) {
    if (typeof o.headers !== 'object') fail('headers must be an object')
    for (const [k, v] of Object.entries(o.headers as Record<string, unknown>)) {
      const key = k.trim().toLowerCase()
      const value = (typeof v === 'string' ? v : String(v)).trim().replace(/\s+/g, ' ')
      if (/[\r\n]/.test(value)) fail(`header ${k} may not contain a newline`)
      headers[key] = value
    }
  }
  const body =
    o.body === undefined || o.body === null ? '' : typeof o.body === 'string' ? o.body : (JSON.stringify(o.body) ?? '')
  if (body.length > MAX_INPUT_CHARS) fail('body is too large to sign')
  return { accessKeyEnv, secretEnv, sessionTokenEnv, region, service, method, url, headers, body }
}

/**
 * Sign one request with SigV4. The credentials are looked up in the run's
 * resolved `env` by the NAMES the caller passes — connector code names the
 * variable, the host reads it, and the isolate never has to hold the secret in
 * a local. Returns the complete header set to pass to `fetch`; `host` is in it
 * for completeness (hostFetch drops it and lets the socket set it).
 */
export function signSigV4(
  raw: unknown,
  env: Readonly<Record<string, string>>,
  now: Date = new Date(),
): { headers: Record<string, string> } {
  const req = parseSigV4Request(raw)
  const accessKey = env[req.accessKeyEnv]
  const secretKey = env[req.secretEnv]
  if (!accessKey || !secretKey) {
    fail(`sigv4: env has no ${!accessKey ? req.accessKeyEnv : req.secretEnv} — name a variable from the connector's env:`)
  }
  const sessionToken = req.sessionTokenEnv ? env[req.sessionTokenEnv] : undefined
  if (req.sessionTokenEnv && !sessionToken) fail(`sigv4: env has no ${req.sessionTokenEnv}`)

  const { dateTime, date } = amzDate(now)
  const payloadHash = createHash('sha256').update(req.body, 'utf8').digest('hex')

  const headers: Record<string, string> = { ...req.headers }
  headers.host = req.url.host
  headers['x-amz-date'] = dateTime
  headers['x-amz-content-sha256'] = payloadHash
  if (sessionToken) headers['x-amz-security-token'] = sessionToken
  delete headers.authorization

  const signedNames = Object.keys(headers).sort()
  const canonicalHeaders = signedNames.map((k) => `${k}:${headers[k]}\n`).join('')
  const signedHeaders = signedNames.join(';')

  const canonicalRequest = [
    req.method,
    canonicalUri(req.url.pathname, req.service),
    canonicalQuery(req.url),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const scope = `${date}/${req.region}/${req.service}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    dateTime,
    scope,
    createHash('sha256').update(canonicalRequest, 'utf8').digest('hex'),
  ].join('\n')

  const kDate = createHmac('sha256', `AWS4${secretKey}`).update(date).digest()
  const kRegion = createHmac('sha256', kDate).update(req.region).digest()
  const kService = createHmac('sha256', kRegion).update(req.service).digest()
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest()
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex')

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, ` + `SignedHeaders=${signedHeaders}, Signature=${signature}`
  return { headers }
}

// ── the capability map ───────────────────────────────────────────────────────

/**
 * The pure helpers — safe anywhere an isolate runs, including a Tool's data.js,
 * because they touch nothing but their arguments.
 */
export function cryptoCapabilities(): Record<string, Capability> {
  return {
    'crypto.hmac': async (args) => hmac(args),
    'crypto.hash': async (args) => hash(args),
    'crypto.randomHex': async (args) => randomHex(args),
    'crypto.base64.encode': async (args) => base64Encode(args),
    'crypto.base64.decode': async (args) => base64Decode(args),
    'crypto.timingSafeEqual': async (args) => timingSafeEqual(args),
  }
}

/**
 * The full set for a connector run: the pure helpers plus `sigv4`, which needs
 * the connector's resolved env to find the AWS keys by name.
 */
export function connectorCryptoCapabilities(env: Readonly<Record<string, string>>): Record<string, Capability> {
  return {
    ...cryptoCapabilities(),
    'crypto.sigv4': async (args) => signSigV4(args[0], env),
  }
}
