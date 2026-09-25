/**
 * A native app signs in through a BROWSER and comes back over its own custom
 * scheme — the desktop shell (`visvine-desktop://`) and the phone apps
 * (`visvine://`). A custom scheme is not owned: any app on the device may
 * register it, so nothing durable may ever travel over one.
 *
 * The round trip is PKCE (RFC 7636), and it holds no server state:
 *
 *   1. the app mints a random VERIFIER, keeps it in memory, and starts the
 *      sign-in with `challenge = base64url(sha256(verifier))`;
 *   2. the browser signs the person in the ordinary way — for the desktop the
 *      page at `/desktop/signin` offers one link (the press is the approval),
 *      for the phones Google's consent returns to
 *      `/api/auth/callback/google-mobile`;
 *   3. the app's scheme receives a HANDOFF: a 2-minute token naming the user,
 *      the challenge and which app it is for, and nothing else;
 *   4. the app POSTs it back with the verifier and receives the real session
 *      (`/api/auth/desktop/token`, `/api/auth/mobile/token`).
 *
 * So the deep link is worthless on its own: whoever intercepts it does not hold
 * the verifier, and the handoff is expired long before it could be guessed.
 * Each app's handoff carries its own audience, so one app's link can never be
 * redeemed at the other's door.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

/** How long the browser's press stays good for. */
const HANDOFF_TTL_SECONDS = 120;

export type HandoffApp = 'desktop' | 'mobile';

const AUDIENCE: Record<HandoffApp, string> = {
  desktop: 'visvine-desktop-handoff',
  mobile: 'visvine-mobile-handoff',
};

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
export function isWellFormedChallenge(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export interface HandoffClaims {
  userId: string;
  challenge: string;
}

/** Mint the token the browser hands to the app over its deep link. */
export async function createHandoff(claims: HandoffClaims, app: HandoffApp): Promise<string> {
  return new SignJWT({ chal: claims.challenge })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setAudience(AUDIENCE[app])
    .setIssuedAt()
    .setExpirationTime(`${HANDOFF_TTL_SECONDS}s`)
    .sign(secret());
}

/** The claims, or null if the token is forged, expired or for another app. */
export async function readHandoff(token: string, app: HandoffApp): Promise<HandoffClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ['HS256'],
      audience: AUDIENCE[app],
    });
    const userId = typeof payload.sub === 'string' ? payload.sub : null;
    const challenge = typeof payload.chal === 'string' ? payload.chal : null;
    if (!userId || !challenge) return null;
    return { userId, challenge };
  } catch {
    return null;
  }
}
