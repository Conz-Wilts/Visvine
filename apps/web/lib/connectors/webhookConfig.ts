/**
 * The `webhook:` block — parsing half. Client-safe: no node: imports, so the
 * connector page and Create panel may import `parseConnectorWebhook` via
 * lib/connectors/config.ts without pulling node:crypto into a browser bundle.
 * Verification (which needs node:crypto) lives in ./webhook.ts.
 *
 * Grammar and presets are documented in ./webhook.ts's header.
 */

type WebhookSignature =
  | 'none'
  | 'token'
  | 'hmac-sha256'
  | 'hmac-sha1'
  | 'github'
  | 'stripe'
  | 'slack'
  | 'hubspot'
  | 'linear'

export type WebhookEncoding = 'hex' | 'base64'

export interface ConnectorWebhook {
  signature: WebhookSignature
  /** Secret NAME (from `{{secret:NAME}}`); null only for `signature: none`. */
  secretName: string | null
  /** Header carrying the signature/token, lowercased. Null for `none`. */
  header: string | null
  /** Literal prefix stripped from the header value before comparing (e.g. `sha256=`). */
  prefix: string
  encoding: WebhookEncoding
  /** Header whose value dedupes redeliveries (e.g. `x-github-delivery`), lowercased. */
  idHeader: string | null
  /** Dotted path into a JSON body for the one-line summary (e.g. `event.type`). */
  eventField: string | null
  /** Request body cap in bytes; a larger delivery is refused with 413. */
  maxBytes: number
}

export type ParseWebhookResult =
  | { ok: true; webhook: ConnectorWebhook | null }
  | { ok: false; error: string }

/** Timestamp skew presets tolerate (Stripe's and Slack's documented default). */
export const WEBHOOK_TOLERANCE_SECONDS = 300

const WEBHOOK_MAX_BYTES = { min: 1024, max: 1_048_576, default: 262_144 } as const

const SIGNATURES: readonly WebhookSignature[] = [
  'none',
  'token',
  'hmac-sha256',
  'hmac-sha1',
  'github',
  'stripe',
  'slack',
  'hubspot',
  'linear',
]

const SECRET_REF_ONLY_RE = /^\{\{\s*secret:([A-Z][A-Z0-9_]{0,63})\s*\}\}$/
const HEADER_RE = /^[a-z0-9-]{1,128}$/
const EVENT_FIELD_RE = /^[A-Za-z0-9_$-]+(\.[A-Za-z0-9_$-]+)*$/

/** Per-preset defaults; a note may override `header`/`prefix`/`encoding` only where it makes sense. */
const PRESETS: Partial<Record<WebhookSignature, { header: string; prefix: string; encoding: WebhookEncoding; idHeader?: string; eventField?: string }>> = {
  github: { header: 'x-hub-signature-256', prefix: 'sha256=', encoding: 'hex', idHeader: 'x-github-delivery', eventField: 'action' },
  stripe: { header: 'stripe-signature', prefix: '', encoding: 'hex', eventField: 'type' },
  slack: { header: 'x-slack-signature', prefix: 'v0=', encoding: 'hex', eventField: 'event.type' },
  hubspot: { header: 'x-hubspot-signature-v3', prefix: '', encoding: 'base64', eventField: 'subscriptionType' },
  linear: { header: 'linear-signature', prefix: '', encoding: 'hex', idHeader: 'linear-delivery', eventField: 'type' },
}

function lowerHeader(raw: unknown, field: string): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (typeof raw !== 'string' || !HEADER_RE.test(raw.trim().toLowerCase())) {
    return { ok: false, error: `\`webhook.${field}\` must be a header name like "x-hub-signature-256"` }
  }
  return { ok: true, value: raw.trim().toLowerCase() }
}

/**
 * Parse the optional `webhook:` block. `webhook: true` is the shorthand for
 * "an address, no signature" — the URL token is the credential.
 */
export function parseConnectorWebhook(raw: unknown): ParseWebhookResult {
  if (raw === undefined || raw === null || raw === false) return { ok: true, webhook: null }
  if (raw === true) {
    return {
      ok: true,
      webhook: { signature: 'none', secretName: null, header: null, prefix: '', encoding: 'hex', idHeader: null, eventField: null, maxBytes: WEBHOOK_MAX_BYTES.default },
    }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '`webhook` must be `true` or a mapping with `signature`' }
  }
  const block = raw as Record<string, unknown>

  const sigRaw = typeof block.signature === 'string' ? block.signature.trim().toLowerCase() : 'none'
  if (!(SIGNATURES as readonly string[]).includes(sigRaw)) {
    return { ok: false, error: `\`webhook.signature\` must be one of ${SIGNATURES.join(', ')}` }
  }
  const signature = sigRaw as WebhookSignature
  const preset = PRESETS[signature]

  let secretName: string | null = null
  if (block.secret !== undefined && block.secret !== null) {
    const m = typeof block.secret === 'string' ? SECRET_REF_ONLY_RE.exec(block.secret.trim()) : null
    if (!m) {
      return { ok: false, error: '`webhook.secret` must be exactly one secret reference like "{{secret:GITHUB_WEBHOOK_SECRET}}"' }
    }
    secretName = m[1]
  }
  if (signature !== 'none' && !secretName) {
    return { ok: false, error: `\`webhook.secret\` is required for signature ${signature} — a "{{secret:NAME}}" reference` }
  }
  if (signature === 'none' && secretName) {
    return { ok: false, error: '`webhook.secret` has no effect with `signature: none` — remove it or choose a scheme' }
  }

  const header = lowerHeader(block.header, 'header')
  if (!header.ok) return header
  const idHeader = lowerHeader(block.id_header, 'id_header')
  if (!idHeader.ok) return idHeader

  let prefix = ''
  if (block.prefix !== undefined && block.prefix !== null) {
    if (typeof block.prefix !== 'string' || block.prefix.length > 32) {
      return { ok: false, error: '`webhook.prefix` must be a short string like "sha256="' }
    }
    prefix = block.prefix
  } else if (preset) prefix = preset.prefix

  let encoding: WebhookEncoding = preset?.encoding ?? 'hex'
  if (block.encoding !== undefined && block.encoding !== null) {
    const enc = typeof block.encoding === 'string' ? block.encoding.trim().toLowerCase() : ''
    if (enc !== 'hex' && enc !== 'base64') return { ok: false, error: '`webhook.encoding` must be hex or base64' }
    encoding = enc
  }

  let eventField: string | null = preset?.eventField ?? null
  if (block.event_field !== undefined && block.event_field !== null) {
    const raw = typeof block.event_field === 'string' ? block.event_field.trim().replace(/^\$\.?/, '') : ''
    if (!raw || !EVENT_FIELD_RE.test(raw)) {
      return { ok: false, error: '`webhook.event_field` must be a dotted path into the JSON body, like "$.event.type"' }
    }
    eventField = raw
  }

  let maxBytes: number = WEBHOOK_MAX_BYTES.default
  if (block.max_bytes !== undefined && block.max_bytes !== null) {
    const n = typeof block.max_bytes === 'number' ? Math.floor(block.max_bytes) : NaN
    if (!Number.isFinite(n) || n < WEBHOOK_MAX_BYTES.min || n > WEBHOOK_MAX_BYTES.max) {
      return { ok: false, error: `\`webhook.max_bytes\` must be between ${WEBHOOK_MAX_BYTES.min} and ${WEBHOOK_MAX_BYTES.max}` }
    }
    maxBytes = n
  }

  const resolvedHeader = header.value ?? preset?.header ?? null
  if (signature !== 'none' && !resolvedHeader) {
    return { ok: false, error: `\`webhook.header\` is required for signature ${signature} — the header the provider puts its signature in` }
  }

  return {
    ok: true,
    webhook: {
      signature,
      secretName,
      header: signature === 'none' ? null : resolvedHeader,
      prefix,
      encoding,
      idHeader: idHeader.value ?? preset?.idHeader ?? null,
      eventField,
      maxBytes,
    },
  }
}

