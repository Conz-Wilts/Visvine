/**
 * Sendblue, as the one client the deployment holds (docs/imessage.md).
 *
 * Visvine owns the account and every line on it; a space is assigned a line
 * and never sees a key. The three secrets are deployment env, like
 * OPENROUTER_API_KEY: `SENDBLUE_API_KEY_ID`, `SENDBLUE_API_SECRET` for calls
 * out, `SENDBLUE_WEBHOOK_SECRET` for the `sb-signing-secret` header on calls
 * in. Unconfigured, `configured()` is false and nothing here is reached: the
 * inbound door answers 503, the console says so, sends are skipped with a
 * warn. A send failing is the app working as designed at the edge of a
 * third-party service — `warn`, never `error`.
 */
import { timingSafeEqual } from 'node:crypto'
import { logger } from '@/lib/logger'

const BASE = 'https://api.sendblue.com'
const TIMEOUT_MS = 10_000

export function sendblueConfigured(): boolean {
  return Boolean(process.env.SENDBLUE_API_KEY_ID && process.env.SENDBLUE_API_SECRET && process.env.SENDBLUE_WEBHOOK_SECRET)
}

/** The header Sendblue puts the configured signing secret in, compared in constant time. */
export function webhookSecretMatches(headers: Headers): boolean {
  const expected = process.env.SENDBLUE_WEBHOOK_SECRET
  if (!expected || expected.length < 16) return false
  const given = headers.get('sb-signing-secret') ?? ''
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function authHeaders(): Record<string, string> {
  return {
    'sb-api-key-id': process.env.SENDBLUE_API_KEY_ID ?? '',
    'sb-api-secret-key': process.env.SENDBLUE_API_SECRET ?? '',
    'content-type': 'application/json',
  }
}

async function call<T = unknown>(path: string, body: Record<string, unknown>, method: 'POST' | 'DELETE' = 'POST'): Promise<T | null> {
  if (!sendblueConfigured()) return null
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: authHeaders(),
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      logger.warn('imessage.sendblue.refused', { path, status: res.status, detail: (await res.text().catch(() => '')).slice(0, 300) })
      return null
    }
    return (await res.json().catch(() => ({}))) as T
  } catch (err) {
    logger.warn('imessage.sendblue.failed', { path, err })
    return null
  }
}

export interface SendResult {
  ok: boolean
  handle: string | null
}

/** One text from a line to a phone. `from` must be a line on the account. */
export async function sendText(input: { from: string; to: string; content: string }): Promise<SendResult> {
  const data = await call<{ message_handle?: string }>('/api/send-message', {
    number: input.to,
    from_number: input.from,
    content: input.content,
  })
  return { ok: data !== null, handle: data?.message_handle ?? null }
}

/** The "…" bubble, for up to `ms`. iMessage only, and only inside an existing conversation — a no-op otherwise. */
export async function typing(input: { from: string; to: string; ms?: number; stop?: boolean }): Promise<void> {
  await call('/api/send-typing-indicator', {
    number: input.to,
    from_number: input.from,
    state: input.stop ? 'stop' : 'start',
    ...(input.stop ? {} : { max_duration_ms: Math.min(300_000, Math.max(1_000, input.ms ?? 60_000)) }),
  })
}

/** Name & photo the line presents in Messages. `photoUrl` must be a public JPEG/PNG. */
export async function setLineProfile(input: { from: string; firstName: string; lastName?: string; photoUrl?: string | null }): Promise<boolean> {
  const data = await call('/api/v2/contact-sharing/profile', {
    fromNumber: input.from,
    firstName: input.firstName,
    lastName: input.lastName ?? '',
    ...(input.photoUrl ? { photoUrl: input.photoUrl } : { clearPhoto: true }),
  })
  return data !== null
}

/** Push the line's card into one direct iMessage conversation (deduped by Sendblue per 24h). */
export async function shareLineProfile(input: { from: string; to: string }): Promise<boolean> {
  return (await call('/api/v2/contact-sharing/share', { fromNumber: input.from, toNumber: input.to })) !== null
}

export interface AccountLine {
  number: string
  /** Whatever else Sendblue says about it, passed through for the super-admin's eyes. */
  raw: Record<string, unknown>
}

/** The lines on the account — what a super-admin may assign. */
export async function listAccountLines(): Promise<AccountLine[] | null> {
  if (!sendblueConfigured()) return null
  try {
    const res = await fetch(`${BASE}/api/lines`, { headers: authHeaders(), cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) {
      logger.warn('imessage.sendblue.refused', { path: '/api/lines', status: res.status })
      return null
    }
    const data = (await res.json().catch(() => null)) as unknown
    const rows: unknown[] = Array.isArray(data) ? data : Array.isArray((data as { lines?: unknown[] })?.lines) ? (data as { lines: unknown[] }).lines : []
    return rows
      .map((r) => {
        const o = (r ?? {}) as Record<string, unknown>
        const number = [o.number, o.phone_number, o.phoneNumber, o.from_number].find((v): v is string => typeof v === 'string' && v.startsWith('+'))
        return number ? { number, raw: o } : null
      })
      .filter((r): r is AccountLine => r !== null)
  } catch (err) {
    logger.warn('imessage.sendblue.failed', { path: '/api/lines', err })
    return null
  }
}
