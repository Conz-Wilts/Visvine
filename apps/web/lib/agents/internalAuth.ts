/**
 * Auth for the two internal endpoints under /api/internal/agents/*, which
 * carry no user session (proxy.ts lists /api/internal/ as public — "public"
 * only in the sense that the route authenticates itself):
 *
 * - the TICK is called by Cloud Scheduler with a Google OIDC token for a
 *   dedicated service account. Cloud Run is deployed --allow-unauthenticated,
 *   so IAM cannot gate it; we verify the token here with jose against
 *   Google's JWKS and pin iss / aud / email. In development a shared
 *   `AGENT_TICK_SECRET` bearer is accepted instead (never in production);
 * - the RUN endpoint is called by the tick itself (self-dispatch, one HTTP
 *   request per run so the tick can fan out across instances) with a
 *   60-second HS256 token minted with AUTH_SECRET — the same machinery as
 *   sessions, no new secret to manage.
 */
import { SignJWT, createRemoteJWKSet, jwtVerify } from 'jose'

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const GOOGLE_ISSUER = 'https://accounts.google.com'
const INTERNAL_AUDIENCE = 'visvine:agent-run'
const INTERNAL_TTL_SECONDS = 60

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null

function authSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET
  if (!secret || secret.length < 32) throw new Error('AUTH_SECRET is not configured')
  return new TextEncoder().encode(secret)
}

function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? ''
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : null
}

/** The public URL an internal endpoint is reached at — the OIDC `aud` Scheduler must send. */
function schedulerAudience(path: string): string {
  const base = (process.env.AGENT_INTERNAL_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
  return `${base}${path}`
}

/**
 * Verify a Cloud Scheduler caller. Returns null when accepted, else the reason
 * (also the 401 body). Production accepts ONLY Google OIDC from the configured
 * service account.
 *
 * `path` is the endpoint being protected and must match the OIDC audience the
 * scheduler job was created with. It is a parameter rather than a constant
 * because more than one job now targets this app (the agent tick and the
 * nightly maintenance sweep), and pinning `aud` per-endpoint is what stops a
 * token minted for one from being replayed against the other.
 */
export async function verifyTickCaller(
  req: Request,
  path = '/api/internal/agents/tick',
): Promise<string | null> {
  const token = bearer(req)
  if (!token) return 'missing bearer token'

  const devSecret = process.env.AGENT_TICK_SECRET
  if (process.env.NODE_ENV !== 'production' && devSecret && token === devSecret) return null

  const expectedEmail = process.env.AGENT_TICK_SERVICE_ACCOUNT?.trim().toLowerCase()
  if (!expectedEmail) return 'AGENT_TICK_SERVICE_ACCOUNT is not configured'
  try {
    jwks ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL))
    const { payload } = await jwtVerify(token, jwks, { issuer: GOOGLE_ISSUER, audience: schedulerAudience(path) })
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : ''
    if (email !== expectedEmail) return 'token is not from the scheduler service account'
    if (payload.email_verified !== true) return 'service account email is not verified'
    return null
  } catch (e) {
    return `invalid OIDC token: ${e instanceof Error ? e.message : 'unknown'}`
  }
}

/** Mint the short-lived token the tick hands to the run endpoint. */
export async function mintRunToken(runId: string): Promise<string> {
  return new SignJWT({ runId })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(INTERNAL_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${INTERNAL_TTL_SECONDS}s`)
    .sign(authSecret())
}

/** Verify a run token; returns the runId or null. */
export async function verifyRunToken(req: Request): Promise<string | null> {
  const token = bearer(req)
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, authSecret(), { algorithms: ['HS256'], audience: INTERNAL_AUDIENCE })
    return typeof payload.runId === 'string' ? payload.runId : null
  } catch {
    return null
  }
}
