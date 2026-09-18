/**
 * Signing in to the desktop shell happens in the SYSTEM BROWSER, never inside
 * the shell's own window — the browser is where a passkey, a saved password and
 * a hardware key already work, and where the person can see whose page they are
 * typing into. Electron has no platform authenticator at all
 * (`isUserVerifyingPlatformAuthenticatorAvailable()` is false), so an in-window
 * Google sign-in simply hangs on "verifying it's you".
 *
 * The round trip is PKCE (RFC 7636), and it holds no server state:
 *
 *   1. the shell mints a random VERIFIER, keeps it in memory, and opens
 *      `/api/auth/desktop/start?challenge=<sha256(verifier)>` in the browser;
 *   2. the browser signs the person in the ordinary way, and that page offers
 *      one link — the press is the approval;
 *   3. the link is `visvine-desktop://auth?handoff=<jwt>`, a 2-minute token
 *      naming the user and the challenge, and nothing else;
 *   4. the shell POSTs it back with the verifier and receives the real session.
 *
 * So the deep link is worthless on its own: whoever intercepts it does not hold
 * the verifier, and the handoff is expired long before it could be guessed.
 * Nothing durable ever travels over the custom scheme.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

/** How long the browser's press stays good for. */
const HANDOFF_TTL_SECONDS = 120;

const AUDIENCE = 'visvine-desktop-handoff';

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error('AUTH_SECRET must be at least 32 characters');
  }
  return new TextEncoder().encode(value);
}

/** The challenge a verifier proves: base64url(sha256(verifier)). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Whether this verifier is the one the challenge was made from. */
export function verifierMatches(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false;
  const expected = Buffer.from(pkceChallenge(verifier));
  const given = Buffer.from(challenge);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** A challenge as it may arrive on a URL: base64url, sha256-sized. */
export function isWellFormedChallenge(value: string | null): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export interface HandoffClaims {
  userId: string;
  challenge: string;
}

/** Mint the token the browser hands to the shell over the deep link. */
export async function createHandoff(claims: HandoffClaims): Promise<string> {
  return new SignJWT({ chal: claims.challenge })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${HANDOFF_TTL_SECONDS}s`)
    .sign(secret());
}

/** The claims, or null if the token is forged, expired or for something else. */
export async function readHandoff(token: string): Promise<HandoffClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ['HS256'],
      audience: AUDIENCE,
    });
    const userId = typeof payload.sub === 'string' ? payload.sub : null;
    const challenge = typeof payload.chal === 'string' ? payload.chal : null;
    if (!userId || !challenge) return null;
    return { userId, challenge };
  } catch {
    return null;
  }
}
