/**
 * A deliberately awkward fake vendor API, for stress-testing connectors against
 * the things real third-party services actually do:
 *
 *   • OAuth2 — no static API key. You exchange a client id + secret for an
 *     access token (`client_credentials`), and the token expires in 5 seconds,
 *     so any command doing more than one call has to handle expiry.
 *   • Refresh — the token response carries a refresh_token, and the
 *     `refresh_token` grant is the cheaper way back once expired.
 *   • Rate limiting — 6 requests per 10s window per client, then 429 with
 *     `Retry-After` and `X-RateLimit-*` headers.
 *   • Pagination — contacts come back 2 at a time behind an opaque cursor.
 *   • Expiry looks like 401 `invalid_token` with a WWW-Authenticate header,
 *     which is what forces a re-auth loop rather than a single call.
 *
 * None of this is handled by platform code: the connector note's prose teaches
 * the dance, the agent writes the retry loop, the perimeter contains it. That
 * is the whole v2 thesis, tested at its hardest point.
 *
 * Dev-only, guarded like the rest of /api/dev. Seed with `pnpm db:connectors:oauth`,
 * verify with `pnpm connectors:verify:oauth`.
 */
import { isDevAuthEnabled, devAuthDisabledResponse } from '@/lib/dev-auth'
import { randomBytes } from 'node:crypto'

const CLIENT_ID = process.env.CONNECTOR_OAUTH_CLIENT_ID || 'crm_client_local_dev'
const CLIENT_SECRET = process.env.CONNECTOR_OAUTH_CLIENT_SECRET || 'sk_crm_secret_local_dev'

const ACCESS_TTL_MS = 5_000
const RATE_LIMIT = 6
const RATE_WINDOW_MS = 10_000

interface Token {
  clientId: string
  expiresAt: number
  refresh: string
}

/**
 * Module-scope state. Fine for a dev-only fixture on a single Node process; a
 * real service would keep this in Redis. Cleared by a process restart, which is
 * also how you reset the rate limiter.
 */
const ACCESS_TOKENS = new Map<string, Token>()
const REFRESH_TOKENS = new Map<string, string>() // refresh → clientId
const HITS = new Map<string, number[]>() // clientId → request timestamps

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } })

const CONTACTS = [
  { id: 'con_01', name: 'Ada Lovelace', company: 'Analytical Engines', arr_usd: 240_000, stage: 'customer' },
  { id: 'con_02', name: 'Grace Hopper', company: 'Compiler Co', arr_usd: 180_000, stage: 'customer' },
  { id: 'con_03', name: 'Alan Turing', company: 'Bombe Systems', arr_usd: 96_000, stage: 'trial' },
  { id: 'con_04', name: 'Katherine Johnson', company: 'Orbital Maths', arr_usd: 310_000, stage: 'customer' },
  { id: 'con_05', name: 'Margaret Hamilton', company: 'Apollo Software', arr_usd: 415_000, stage: 'customer' },
  { id: 'con_06', name: 'Radia Perlman', company: 'Spanning Tree Ltd', arr_usd: 58_000, stage: 'churned' },
  { id: 'con_07', name: 'Barbara Liskov', company: 'Substitution Inc', arr_usd: 122_000, stage: 'trial' },
]
const PAGE_SIZE = 2

function issueTokens(clientId: string) {
  const access = `at_${randomBytes(12).toString('hex')}`
  const refresh = `rt_${randomBytes(12).toString('hex')}`
  ACCESS_TOKENS.set(access, { clientId, expiresAt: Date.now() + ACCESS_TTL_MS, refresh })
  REFRESH_TOKENS.set(refresh, clientId)
  return {
    access_token: access,
    refresh_token: refresh,
    token_type: 'Bearer',
    expires_in: Math.round(ACCESS_TTL_MS / 1000),
  }
}

/**
 * 401-shaped bearer failure, with the WWW-Authenticate a client should read.
 * Header values must be latin-1: a non-ASCII character (an em dash, say) makes
 * `Response` throw, and the 401 surfaces to the caller as a 500.
 */
function unauthorized(error: string, description: string) {
  const headerSafe = description.replace(/[^\x20-\x7e]/g, '-').replace(/"/g, "'")
  return json(
    { error, error_description: description },
    401,
    { 'www-authenticate': `Bearer error="${error}", error_description="${headerSafe}"` },
  )
}

/**
 * Verify the bearer AND spend a unit of rate budget. Returns a Response when
 * the caller should stop (401 or 429), otherwise null.
 */
function gate(req: Request): Response | null {
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  if (!token) return unauthorized('invalid_request', 'Send an OAuth2 bearer token - see POST /oauth/token')

  const record = ACCESS_TOKENS.get(token)
  if (!record) return unauthorized('invalid_token', 'Unknown access token')
  if (Date.now() > record.expiresAt) {
    ACCESS_TOKENS.delete(token)
    return unauthorized('invalid_token', 'The access token expired - refresh it and retry')
  }

  const now = Date.now()
  const recent = (HITS.get(record.clientId) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  if (recent.length >= RATE_LIMIT) {
    const retryAfterMs = RATE_WINDOW_MS - (now - recent[0])
    HITS.set(record.clientId, recent)
    return json(
      {
        error: 'rate_limited',
        message: `Max ${RATE_LIMIT} requests per ${RATE_WINDOW_MS / 1000}s`,
        // Mirrored into the body as well as the header: a client reading
        // response headers is painful, and the note's example loop reads this.
        retry_after: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      },
      429,
      {
        'retry-after': String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
        'x-ratelimit-limit': String(RATE_LIMIT),
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(Math.ceil((now + retryAfterMs) / 1000)),
      },
    )
  }
  recent.push(now)
  HITS.set(record.clientId, recent)
  return null
}

function rateHeaders(clientId: string): Record<string, string> {
  const now = Date.now()
  const recent = (HITS.get(clientId) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  return {
    'x-ratelimit-limit': String(RATE_LIMIT),
    'x-ratelimit-remaining': String(Math.max(0, RATE_LIMIT - recent.length)),
  }
}

function clientIdOf(req: Request): string {
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  return ACCESS_TOKENS.get(token)?.clientId ?? 'unknown'
}

async function handle(req: Request, segments: string[]): Promise<Response> {
  if (!isDevAuthEnabled()) return devAuthDisabledResponse()

  const url = new URL(req.url)
  const path = '/' + segments.join('/')
  const method = req.method.toUpperCase()

  // the token endpoint: form-encoded, like every real OAuth2 server
  if (method === 'POST' && path === '/oauth/token') {
    const form = new URLSearchParams(await req.text())
    const grant = form.get('grant_type')

    if (grant === 'client_credentials') {
      // Credentials may arrive in the body or as HTTP Basic — accept both, as
      // real servers do, so the note can teach whichever is simpler.
      let id = form.get('client_id') ?? ''
      let secret = form.get('client_secret') ?? ''
      const basic = req.headers.get('authorization') ?? ''
      if (basic.toLowerCase().startsWith('basic ')) {
        const [bid, bsecret] = Buffer.from(basic.slice(6), 'base64').toString('utf8').split(':')
        id = id || bid || ''
        secret = secret || bsecret || ''
      }
      if (id !== CLIENT_ID || secret !== CLIENT_SECRET) {
        return json({ error: 'invalid_client', error_description: 'client_id or client_secret is wrong' }, 401)
      }
      return json(issueTokens(id))
    }

    if (grant === 'refresh_token') {
      const refresh = form.get('refresh_token') ?? ''
      const clientId = REFRESH_TOKENS.get(refresh)
      if (!clientId) return json({ error: 'invalid_grant', error_description: 'Unknown refresh token' }, 401)
      REFRESH_TOKENS.delete(refresh) // one-shot: refresh tokens rotate
      return json(issueTokens(clientId))
    }

    return json(
      { error: 'unsupported_grant_type', supported: ['client_credentials', 'refresh_token'] },
      400,
    )
  }

  // everything below needs a live bearer and spends rate budget
  const denied = gate(req)
  if (denied) return denied
  const clientId = clientIdOf(req)

  // GET /v1/contacts?cursor= — 2 per page behind an opaque cursor.
  if (method === 'GET' && path === '/v1/contacts') {
    const rawCursor = url.searchParams.get('cursor')
    const offset = rawCursor ? Number(Buffer.from(rawCursor, 'base64url').toString('utf8')) : 0
    if (!Number.isInteger(offset) || offset < 0 || offset > CONTACTS.length) {
      return json({ error: 'invalid_cursor' }, 400, rateHeaders(clientId))
    }
    const page = CONTACTS.slice(offset, offset + PAGE_SIZE)
    const next = offset + PAGE_SIZE
    return json(
      {
        contacts: page,
        next_cursor: next < CONTACTS.length ? Buffer.from(String(next)).toString('base64url') : null,
      },
      200,
      rateHeaders(clientId),
    )
  }

  // GET /v1/me — cheap call for probing token validity.
  if (method === 'GET' && path === '/v1/me') {
    return json({ client_id: clientId, scopes: ['contacts:read'] }, 200, rateHeaders(clientId))
  }

  return json(
    {
      error: 'not_found',
      method,
      path,
      routes: ['POST /oauth/token', 'GET /v1/me', 'GET /v1/contacts?cursor='],
    },
    404,
    rateHeaders(clientId),
  )
}

type Ctx = { params: Promise<{ path: string[] }> }

export async function GET(req: Request, ctx: Ctx) {
  return handle(req, (await ctx.params).path)
}
export async function POST(req: Request, ctx: Ctx) {
  return handle(req, (await ctx.params).path)
}
