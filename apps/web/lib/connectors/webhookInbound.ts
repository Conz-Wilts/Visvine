/**
 * The inbound half of a `webhook:` connector — what
 * `POST /api/hooks/[spaceId]/[connector]/[token]` does, plus the admin side
 * that mints and rotates the URL token.
 *
 * Order of refusal is the point of this file, because the route is public (no
 * session — a provider is calling):
 *
 *   1. shape        bad connector name / token shape → 404
 *   2. rate         per-(space, connector) bucket, 60/min → 429
 *   3. note         no note / not a connector / `kind: model` / no `webhook:`
 *                   block / URL token mismatch → 404, all indistinguishable, so
 *                   the URL cannot be used to enumerate a space's connectors
 *   4. size         body over `max_bytes` → 413 (checked before it is read)
 *   5. signature    scheme fails → 401 + one audit line
 *   6. deliver      one `agent_events` row per listening agent → 202 {accepted}
 *
 * The note is read RAW — the machine path the agent runner also takes — because
 * nobody is signed in: the provider is a stranger and the note's visibility
 * rules are about members. What it may do is bounded by the note anyway (only
 * agents whose admin-only live note names this connector ever hear about it).
 *
 * Nothing is written to a note. The delivery is DATA on the next run's second
 * user message (payload clipped there), never instructions and never code.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import prisma from '@/lib/prisma'
import { SHARED_OWNER_KEY } from '@/lib/notes/store'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { logAudit } from '@/lib/notes/audit'
import { takeToken } from '@/lib/rateLimit'
import { decryptSecret, encryptSecret } from '@/lib/crypto/secrets'
import { enqueueAgentEvent, webhookRecipients } from '@/lib/agents/events'
import { parseConnectorPerimeter } from './config'
import { appOrigin } from './connectUrl'
import { connectorKind } from './model'
import {
  extractEventField,
  pickWebhookHeaders,
  verifyWebhookSignature,
  webhookDedupeKey,
  webhookPath,
  webhookSummary,
  webhookTokenSecretName,
  WEBHOOK_TOKEN_RE,
  type ConnectorWebhook,
} from './webhook'

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i
const CONNECTORS_DIR = 'connectors/'

/** 60 deliveries a minute per hook, refilling continuously. */
const HOOK_RATE = { capacity: 60, refillPerSec: 1 }
// Pre-auth guard keyed by client address: an unauthenticated flood at a guessed
// (space, connector) can neither lock the real provider out (the per-hook
// bucket is charged only AFTER the token matched) nor grow the bucket map
// without bound (rateLimit.ts sweeps past its cap).
const HOOK_PREAUTH_RATE = { capacity: 120, refillPerSec: 2 }

function clientKey(req: Request): string {
  // Cloud Run puts the caller first in x-forwarded-for; locally it is absent.
  const xff = req.headers.get('x-forwarded-for')
  const ip = (xff ? xff.split(',')[0] : '').trim() || 'local'
  return `webhook-ip:${ip.slice(0, 64)}`
}

/** The full inbound address for a connector's current token. */
export function webhookUrl(spaceId: string, connector: string, token: string): string {
  return appOrigin() + webhookPath(spaceId, connector, token)
}

// ── The note, raw ────────────────────────────────────────────────────────────

interface WebhookConnectorNote {
  path: string
  webhook: ConnectorWebhook
}

/**
 * The connector's `webhook:` block, read from the shared context without a
 * principal. Null for every way it can be absent (no note, not a connector, a
 * model connector, invalid frontmatter, no block) — the caller answers 404 for
 * all of them alike.
 */
async function loadWebhookConnector(spaceId: string, connector: string): Promise<WebhookConnectorNote | null> {
  if (!NAME_RE.test(connector)) return null
  const path = `${CONNECTORS_DIR}${connector}.md`
  const row = await prisma.contextNote.findFirst({
    where: { spaceId, ownerKey: SHARED_OWNER_KEY, path, deletedAt: null },
    select: { content: true },
  })
  if (!row) return null
  const fm = parseFrontmatter(row.content)
  if (typeof fm.type !== 'string' || fm.type.trim().toLowerCase() !== 'connector') return null
  if (connectorKind(fm) === 'model') return null
  const parsed = parseConnectorPerimeter(fm)
  if (!parsed.ok || !parsed.perimeter.webhook) return null
  return { path, webhook: parsed.perimeter.webhook }
}

// ── The URL token ────────────────────────────────────────────────────────────

async function readSecret(spaceId: string, name: string): Promise<string | null> {
  const row = await prisma.connectorSecret.findUnique({
    where: { secret_identity: { spaceId, name } },
    select: { ciphertext: true },
  })
  if (!row) return null
  try {
    return decryptSecret(row.ciphertext)
  } catch {
    return null
  }
}

/** The connector's current URL token, or null when none has been provisioned. */
async function currentWebhookToken(spaceId: string, connector: string): Promise<string | null> {
  const value = await readSecret(spaceId, webhookTokenSecretName(connector))
  return value && WEBHOOK_TOKEN_RE.test(value) ? value : null
}

/**
 * Mint (or replace) the URL token: 32 random bytes, hex, stored encrypted in
 * `connector_secrets` beside every other secret. Rotation is the same call —
 * the old URL stops working the moment the row is rewritten.
 */
export async function provisionWebhookToken(spaceId: string, connector: string, by: string | null): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const name = webhookTokenSecretName(connector)
  await prisma.connectorSecret.upsert({
    where: { secret_identity: { spaceId, name } },
    create: { spaceId, name, ciphertext: encryptSecret(token), createdBy: by },
    update: { ciphertext: encryptSecret(token), createdBy: by },
  })
  return token
}

/** Return the existing token or mint one — the admin GET's lazy provisioning. */
export async function ensureWebhookToken(spaceId: string, connector: string, by: string | null): Promise<string> {
  return (await currentWebhookToken(spaceId, connector)) ?? provisionWebhookToken(spaceId, connector, by)
}

function tokenMatches(presented: string, stored: string | null): boolean {
  if (!stored) return false
  const a = Buffer.from(presented, 'utf8')
  const b = Buffer.from(stored, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

// ── The delivery ─────────────────────────────────────────────────────────────

/** Read at most `maxBytes` of a request body; null when it runs over. */
async function readBodyCapped(req: Request, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) return null
  if (!req.body) return new Uint8Array(0)
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

/** Body → what the run sees: parsed JSON when the provider says so, else text. */
function bodyForPayload(contentType: string | null, body: Uint8Array): unknown {
  const text = Buffer.from(body).toString('utf8')
  if (contentType && /json/i.test(contentType)) {
    try {
      return JSON.parse(text)
    } catch {
      /* fall through — hand over the text */
    }
  }
  return text
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/**
 * Handle one delivery. `params` come straight from the route; nothing is
 * trusted until the token matches.
 */
export async function handleInboundWebhook(
  req: Request,
  params: { spaceId: string; connector: string; token: string },
): Promise<Response> {
  const { spaceId, connector, token } = params
  if (!NAME_RE.test(connector) || !WEBHOOK_TOKEN_RE.test(token) || !spaceId || spaceId.length > 128) {
    return json(404, { error: 'Not found' })
  }

  const tooMany = (retryAfterMs: number) =>
    new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': String(Math.ceil(retryAfterMs / 1000)) },
    })
  const pre = await takeToken(clientKey(req), HOOK_PREAUTH_RATE)
  if (!pre.ok) return tooMany(pre.retryAfterMs)

  const note = await loadWebhookConnector(spaceId, connector)
  if (!note) return json(404, { error: 'Not found' })
  const stored = await currentWebhookToken(spaceId, connector)
  if (!tokenMatches(token, stored)) return json(404, { error: 'Not found' })
  const { webhook, path } = note

  // Only a caller holding the token can spend this hook's own budget.
  const bucket = await takeToken(`webhook:${spaceId}:${connector}`, HOOK_RATE)
  if (!bucket.ok) return tooMany(bucket.retryAfterMs)

  const body = await readBodyCapped(req, webhook.maxBytes)
  if (body === null) return json(413, { error: `Body exceeds ${webhook.maxBytes} bytes` })

  const header = (name: string): string | null => req.headers.get(name)

  if (webhook.signature !== 'none') {
    const secret = webhook.secretName ? await readSecret(spaceId, webhook.secretName) : null
    const verdict = verifyWebhookSignature(webhook, {
      header,
      body,
      secret,
      url: webhookUrl(spaceId, connector, token),
      method: req.method,
    })
    if (!verdict.ok) {
      void logAudit(spaceId, {
        userId: 'system',
        name: 'webhook',
        action: 'connector',
        path,
        detail: `webhook rejected: signature (${verdict.reason})`,
      })
      return json(401, { error: 'Signature verification failed' })
    }
  }

  const dedupeKey = webhookDedupeKey(webhook, header, body, connector)
  const deliveryId = webhook.idHeader ? header(webhook.idHeader) : null
  const contentType = header('content-type')
  const parsedBody = bodyForPayload(contentType, body)
  const event = extractEventField(parsedBody, webhook.eventField)
  const summary = webhookSummary(connector, event, req.method, deliveryId ? deliveryId.slice(0, 80) : null)
  const payload = {
    connector,
    receivedAt: new Date().toISOString(),
    headers: pickWebhookHeaders(webhook, header),
    body: parsedBody,
  }

  const recipients = await webhookRecipients(spaceId, connector)
  const results = await Promise.all(
    recipients.map((agentName) =>
      enqueueAgentEvent({ spaceId, agentName, kind: 'webhook', source: connector, summary, payload, dedupeKey }),
    ),
  )
  const accepted = results.filter((r) => r.ok).length

  void logAudit(spaceId, {
    userId: 'system',
    name: 'webhook',
    action: 'connector',
    path,
    detail: `webhook accepted → ${accepted} agent(s)${event ? ` [${event}]` : ''}`,
  })

  return json(202, { accepted })
}

// ── Admin browse ─────────────────────────────────────────────────────────────

interface WebhookEventRow {
  id: string
  agentName: string
  summary: string
  createdAt: string
  /** The run that consumed it, or null while pending. */
  consumedBy: string | null
}

/** The last `limit` deliveries this connector produced, newest first. */
export async function listWebhookEvents(spaceId: string, connector: string, limit = 50): Promise<WebhookEventRow[]> {
  const rows = await prisma.agentEvent.findMany({
    where: { spaceId, kind: 'webhook', source: connector },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, agentName: true, summary: true, createdAt: true, consumedBy: true },
  })
  return rows.map((r) => ({
    id: r.id,
    agentName: r.agentName,
    summary: r.summary,
    createdAt: r.createdAt.toISOString(),
    consumedBy: r.consumedBy,
  }))
}
