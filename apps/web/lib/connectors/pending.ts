/**
 * The in-flight authorization, carried in a signed cookie between /start and
 * /callback.
 *
 * A cookie rather than a database row because everything in it is scoped to one
 * browser and one minute: nothing else ever needs to read it, and a table would
 * need sweeping. Signed with `AUTH_SECRET` (same key as sessions, different
 * `typ`) so the callback can trust what it reads back.
 *
 * The PKCE verifier lives HERE and never in the `state` parameter, because
 * `state` travels to the provider and back through the address bar. Sending the
 * verifier there would defeat PKCE entirely — the point is that the party
 * redeeming the code proves it also began the flow.
 */
import { SignJWT, jwtVerify } from 'jose'

export const PENDING_COOKIE = 'connector_oauth_pending'
export const PENDING_TTL_SECONDS = 600

const TYP = 'connector_oauth_pending'

export interface PendingAuthorization {
  /** The space the connection lands in — the connector note's own. */
  spaceId: string
  /**
   * The space the flow was started FROM, when it is not `spaceId`: a sub-space
   * linking an account behind a connector its parent shares. The callback
   * re-reads the note through that space, as the run will.
   */
  viaSpaceId?: string
  connector: string
  provider: string
  mode: 'user' | 'space'
  /** '' for a space connection. Fixed at /start so the callback cannot be steered. */
  userId: string
  verifier: string
  state: string
  scopes: string[]
  /**
   * Where to send the browser when the dance is done — a relative path,
   * validated at /start (safeReturnTo) and carried here rather than through the
   * provider, which would hand the round trip back an unsigned destination.
   */
  returnTo?: string
}

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET
  if (!value) throw new Error('AUTH_SECRET environment variable is not set')
  return new TextEncoder().encode(value)
}

export async function signPending(pending: PendingAuthorization): Promise<string> {
  return new SignJWT({ ...pending, typ: TYP })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${PENDING_TTL_SECONDS}s`)
    .sign(secret())
}

/** Verify and read it back, or null for anything we cannot vouch for. */
export async function readPending(raw: string | undefined): Promise<PendingAuthorization | null> {
  if (!raw) return null
  try {
    const { payload } = await jwtVerify(raw, secret())
    // The `typ` guard is what stops a session cookie being replayed here — the
    // same rule lib/mcp/tokens.ts applies in the other direction.
    if (payload.typ !== TYP) return null
    const mode = payload.mode
    if (mode !== 'user' && mode !== 'space') return null
    if (typeof payload.spaceId !== 'string' || typeof payload.connector !== 'string') return null
    if (typeof payload.provider !== 'string' || typeof payload.userId !== 'string') return null
    if (typeof payload.verifier !== 'string' || typeof payload.state !== 'string') return null
    return {
      spaceId: payload.spaceId,
      connector: payload.connector,
      provider: payload.provider,
      mode,
      userId: payload.userId,
      verifier: payload.verifier,
      state: payload.state,
      scopes: Array.isArray(payload.scopes) ? payload.scopes.filter((s): s is string => typeof s === 'string') : [],
      // Spread rather than an explicit undefined: the pending record is
      // compared whole, and a key that is present-but-undefined is a different
      // object from one that was never set.
      ...(typeof payload.returnTo === 'string' ? { returnTo: payload.returnTo } : {}),
    }
  } catch {
    return null
  }
}
