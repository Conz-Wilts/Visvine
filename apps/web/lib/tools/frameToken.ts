/**
 * The frame token — the single credential a Tool iframe is handed.
 *
 * The frame is served from a cookie-less origin (lib/tools/origin.ts), so the
 * runtime routes cannot authenticate with a session. Instead the HOST page —
 * which does have the viewer's session — mints a short-lived, single-purpose
 * HS256 token naming what the frame may load and who is watching, and passes it
 * in the frame URL. The token says nothing about permissions: every actual read
 * or write goes back through the bridge on the app origin under the viewer's
 * own grants. Its only job is to keep bundle URLs from being public and to tell
 * the runtime route WHICH bundle to serve.
 *
 * Same signing key and algorithm as the session (lib/session.ts) but a distinct
 * `aud`, so a session JWT can never be replayed as a frame token or the reverse.
 * TTL is minutes: the host page re-mints on reload.
 */
import { SignJWT, jwtVerify } from 'jose'

/** Single-purpose audience — a session token can never stand in for this. */
export const FRAME_TOKEN_AUDIENCE = 'visvine-tool-frame'

/** Default lifetime. Long enough for a page load, short enough to be worthless later. */
const DEFAULT_TTL_SEC = 300

interface FrameTokenBase {
  /** The user the frame renders for. The bridge re-checks their grants per call. */
  viewerId: string
  /** The space the Tool runs in. */
  spaceId: string
}

/**
 * What the frame is allowed to load: an installed Tool's pinned version, an
 * author's working copy while they are building it, or a version under
 * Visvine's dynamic run in its honeypot (lib/tools/review).
 */
export type FrameTokenPayload =
  | (FrameTokenBase & { kind: 'install'; installId: string })
  | (FrameTokenBase & { kind: 'preview'; name: string })
  | (FrameTokenBase & { kind: 'review'; runId: string })

function getSecret(): Uint8Array {
  // Mirrors lib/session.ts#getSecret — same key, same minimum entropy. Kept
  // separate rather than exported from there because that module is edge-bundled
  // for proxy.ts and this one is only ever used by route handlers.
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET environment variable is not set')
  if (secret.length < 32) {
    throw new Error('AUTH_SECRET must be at least 32 characters (use `openssl rand -hex 32`)')
  }
  return new TextEncoder().encode(secret)
}

export async function mintFrameToken(
  payload: FrameTokenPayload,
  ttlSec: number = DEFAULT_TTL_SEC,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(FRAME_TOKEN_AUDIENCE)
    .setIssuedAt(now)
    // Absolute epoch seconds rather than a duration string so a non-positive
    // TTL means "already expired" instead of parsing as something else.
    .setExpirationTime(now + ttlSec)
    .sign(getSecret())
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Verifies signature, expiry and audience, then the payload SHAPE — an
 * unrecognised `kind`, or a variant missing its own field, is a rejection rather
 * than a half-filled object handed to a route. Returns null on any failure; the
 * caller answers 403 without leaking which check failed.
 */
export async function verifyFrameToken(
  token: string,
  opts: { toleranceSec?: number } = {},
): Promise<FrameTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ['HS256'],
      audience: FRAME_TOKEN_AUDIENCE,
      ...(opts.toleranceSec ? { clockTolerance: opts.toleranceSec } : {}),
    })
    const { kind, viewerId, spaceId, installId, name, runId } = payload as Record<string, unknown>
    if (!isNonEmptyString(viewerId) || !isNonEmptyString(spaceId)) return null
    if (kind === 'install' && isNonEmptyString(installId)) {
      return { kind: 'install', viewerId, spaceId, installId }
    }
    if (kind === 'preview' && isNonEmptyString(name)) {
      return { kind: 'preview', viewerId, spaceId, name }
    }
    if (kind === 'review' && isNonEmptyString(runId)) {
      return { kind: 'review', viewerId, spaceId, runId }
    }
    return null
  } catch {
    return null
  }
}
