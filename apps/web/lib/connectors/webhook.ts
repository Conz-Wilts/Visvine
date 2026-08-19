/**
 * The `webhook:` block — a connector that RECEIVES calls.
 *
 * Everything else a connector does is outbound, when someone runs it. A
 * webhook block turns the note into an inbound address as well: the provider
 * posts to `/api/hooks/<space>/<connector>/<token>` and every active agent
 * whose live note says `on.webhook: <connector>` gets the delivery as an
 * `agent_events` row (lib/agents/events.ts). Nothing here runs connector code;
 * the delivery is DATA for the next agent run, not a call.
 *
 * Declarative only. There is no `verify:` JavaScript — an unauthenticated
 * request must be refused before anything of the note's runs, and the small
 * set of schemes providers actually use is finite:
 *
 *   none          the URL token is the only secret (32 random bytes; fine for
 *                 providers that cannot sign)
 *   token         a shared secret sent verbatim in a header
 *   hmac-sha256   HMAC of the raw body in a header, hex or base64, optional prefix
 *   hmac-sha1     the same with SHA-1 (legacy GitHub, some older services)
 *   github        `x-hub-signature-256: sha256=<hex>`
 *   stripe        `stripe-signature: t=<ts>,v1=<hex>` over `<ts>.<body>`, ≤5 min skew
 *   slack         `x-slack-signature: v0=<hex>` over `v0:<ts>:<body>`, ≤5 min skew
 *   hubspot       `x-hubspot-signature-v3: <base64>` over `<method><url><body><ts>`, ≤5 min skew
 *   linear        `linear-signature: <hex>` over the body
 *
 * The secret is a `{{secret:NAME}}` reference resolved ONLY on the inbound
 * path. It deliberately never joins the perimeter's `env`: a connector's own
 * code has no business reading the key that authenticates its inbox.
 *
 * Pure — no I/O — so every scheme is unit-tested against known vectors
 * (tests/connector-webhook.test.ts).
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import {
  WEBHOOK_TOLERANCE_SECONDS,
  type ConnectorWebhook,
  type WebhookEncoding,
} from './webhookConfig'

export { parseConnectorWebhook, type ConnectorWebhook } from './webhookConfig'

// ── Verification ────────────────────────────────────────────────────────────

interface VerifyInput {
  /** Header lookup, case-insensitive; null when absent. */
  header: (name: string) => string | null
  /** The raw request body, exactly as received. */
  body: Uint8Array
  /** The decrypted shared secret; null only for `signature: none`. */
  secret: string | null
  /** For `hubspot`: the request URL exactly as the provider addressed it. */
  url?: string
  method?: string
  /** Seconds since epoch; defaults to now. Injectable for tests. */
  nowSeconds?: number
}

type VerifyResult = { ok: true } | { ok: false; reason: string }

/** Constant-time equality of two strings (length leak is unavoidable and harmless here). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

function hmac(algo: 'sha256' | 'sha1', secret: string, ...parts: (string | Uint8Array)[]): Buffer {
  const h = createHmac(algo, secret)
  for (const p of parts) h.update(p)
  return h.digest()
}

function encode(digest: Buffer, encoding: WebhookEncoding): string {
  return digest.toString(encoding)
}

/** Compare a presented digest against the expected one under the declared encoding. */
function digestMatches(presented: string, expected: Buffer, encoding: WebhookEncoding): boolean {
  const want = encode(expected, encoding)
  const got = encoding === 'hex' ? presented.trim().toLowerCase() : presented.trim()
  return safeEqual(got, want)
}

function withinTolerance(ts: number, nowSeconds: number): boolean {
  return Number.isFinite(ts) && Math.abs(nowSeconds - ts) <= WEBHOOK_TOLERANCE_SECONDS
}

/**
 * Verify one delivery. Never throws; a `false` carries a short reason meant
 * for the audit line, not the caller — the route answers a bare 401.
 */
export function verifyWebhookSignature(webhook: ConnectorWebhook, input: VerifyInput): VerifyResult {
  if (webhook.signature === 'none') return { ok: true }
  const secret = input.secret
  if (!secret) return { ok: false, reason: 'signature secret not set' }
  const headerName = webhook.header
  const raw = headerName ? input.header(headerName) : null
  if (raw === null || raw === '') return { ok: false, reason: `missing ${headerName ?? 'signature'} header` }
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)

  const stripPrefix = (value: string): string | null => {
    if (!webhook.prefix) return value
    return value.startsWith(webhook.prefix) ? value.slice(webhook.prefix.length) : null
  }

  switch (webhook.signature) {
    case 'token':
      return safeEqual(raw.trim(), secret) ? { ok: true } : { ok: false, reason: 'token mismatch' }

    case 'hmac-sha256':
    case 'hmac-sha1':
    case 'github':
    case 'linear': {
      const presented = stripPrefix(raw)
      if (presented === null) return { ok: false, reason: 'signature prefix mismatch' }
      const algo = webhook.signature === 'hmac-sha1' ? 'sha1' : 'sha256'
      return digestMatches(presented, hmac(algo, secret, input.body), webhook.encoding)
        ? { ok: true }
        : { ok: false, reason: 'signature mismatch' }
    }

    case 'stripe': {
      // `t=<unix>,v1=<hex>[,v1=<hex>][,v0=…]` — several v1 during a secret roll.
      let tsRaw: string | null = null
      const sigs: string[] = []
      for (const part of raw.split(',')) {
        const eq = part.indexOf('=')
        if (eq < 0) continue
        const k = part.slice(0, eq).trim()
        const v = part.slice(eq + 1).trim()
        if (k === 't') tsRaw = v
        else if (k === 'v1') sigs.push(v)
      }
      if (tsRaw === null || sigs.length === 0) return { ok: false, reason: 'malformed stripe-signature header' }
      if (!withinTolerance(Number(tsRaw), now)) return { ok: false, reason: 'timestamp outside tolerance' }
      // Sign the timestamp exactly as presented, never a re-serialised number.
      const expected = hmac('sha256', secret, `${tsRaw}.`, input.body)
      return sigs.some((s) => digestMatches(s, expected, 'hex')) ? { ok: true } : { ok: false, reason: 'signature mismatch' }
    }

    case 'slack': {
      const tsRaw = (input.header('x-slack-request-timestamp') ?? '').trim()
      if (!withinTolerance(Number(tsRaw), now)) return { ok: false, reason: 'timestamp outside tolerance' }
      const presented = stripPrefix(raw)
      if (presented === null) return { ok: false, reason: 'signature prefix mismatch' }
      // Slack signs the header string verbatim.
      const expected = hmac('sha256', secret, `v0:${tsRaw}:`, input.body)
      return digestMatches(presented, expected, 'hex') ? { ok: true } : { ok: false, reason: 'signature mismatch' }
    }

    case 'hubspot': {
      const tsRaw = input.header('x-hubspot-request-timestamp')
      const tsMs = tsRaw ? Number(tsRaw) : NaN
      if (!withinTolerance(tsMs / 1000, now)) return { ok: false, reason: 'timestamp outside tolerance' }
      if (!input.url) return { ok: false, reason: 'request url unavailable' }
      const method = (input.method ?? 'POST').toUpperCase()
      const expected = hmac('sha256', secret, method, input.url, input.body, tsRaw ?? '')
      return digestMatches(raw, expected, 'base64') ? { ok: true } : { ok: false, reason: 'signature mismatch' }
    }
    default:
      return { ok: false, reason: 'unsupported scheme' }
  }
}

// ── Helpers the inbound path and the admin route share ──────────────────────

/** The stored name of a connector's URL token: `WEBHOOK_TOKEN_<NAME>` (non-alphanumerics → `_`). */
export function webhookTokenSecretName(connector: string): string {
  // Readable prefix + a short hash of the EXACT name, so `foo-bar` and
  // `foo_bar` (which normalise alike) never share a token, and a 64-char
  // connector name still fits the secret-name grammar (<= 64 chars).
  const readable = connector.toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 32)
  const tag = createHash('sha256').update(connector).digest('hex').slice(0, 8).toUpperCase()
  return `WEBHOOK_TOKEN_${readable}_${tag}`
}

/** Path half of the inbound address; the caller prefixes the app origin. */
export function webhookPath(spaceId: string, connector: string, token: string): string {
  return `/api/hooks/${encodeURIComponent(spaceId)}/${encodeURIComponent(connector)}/${encodeURIComponent(token)}`
}

/** URL token shape: 32 random bytes, hex. */
export const WEBHOOK_TOKEN_RE = /^[a-f0-9]{64}$/

/** Read a dotted path (`event.type`) out of a parsed JSON body; primitives only. */
export function extractEventField(body: unknown, field: string | null): string | null {
  if (!field) return null
  let cur: unknown = body
  for (const seg of field.split('.')) {
    if (cur === null || typeof cur !== 'object') return null
    cur = Array.isArray(cur) ? cur[Number(seg)] : (cur as Record<string, unknown>)[seg]
  }
  if (typeof cur === 'string') return cur.length > 120 ? cur.slice(0, 120) + '…' : cur
  if (typeof cur === 'number' || typeof cur === 'boolean') return String(cur)
  return null
}

/** Dedupe key: the provider's delivery id when it sends one, else a hash of the body. */
export function webhookDedupeKey(
  webhook: ConnectorWebhook,
  header: (name: string) => string | null,
  body: Uint8Array,
  connector: string,
): string {
  // Scoped by connector: two providers feeding one agent may reuse delivery ids.
  const id = webhook.idHeader ? header(webhook.idHeader) : null
  if (id && id.trim()) return `webhook:${connector}:id:${id.trim().slice(0, 200)}`
  return `webhook:${connector}:sha256:${createHash('sha256').update(body).digest('hex')}`
}

/**
 * Request headers worth handing to the run — content type, who sent it, the
 * provider's event/delivery ids. Never a signature: those authenticate the
 * inbox and have no business in an agent's transcript.
 */
const WEBHOOK_HEADER_ALLOWLIST = [
  'content-type',
  'user-agent',
  'x-github-event',
  'x-github-delivery',
  'x-hubspot-signature-version',
  'linear-delivery',
  'linear-event',
] as const

export function pickWebhookHeaders(webhook: ConnectorWebhook, header: (name: string) => string | null): Record<string, string> {
  const names = new Set<string>(WEBHOOK_HEADER_ALLOWLIST)
  if (webhook.idHeader) names.add(webhook.idHeader)
  const out: Record<string, string> = {}
  for (const name of names) {
    const value = header(name)
    if (value !== null && value !== '') out[name] = value.slice(0, 500)
  }
  return out
}

/** One line for the run's "Triggered by" message: `<connector> <event> (<id>)`. */
export function webhookSummary(connector: string, event: string | null, method: string, id: string | null): string {
  const what = event ?? method.toUpperCase()
  return id ? `${connector} ${what} (${id})` : `${connector} ${what}`
}
