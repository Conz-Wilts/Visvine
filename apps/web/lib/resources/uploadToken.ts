/**
 * The upload token — how a file attached to an AI chat reaches a space's Drive.
 *
 * A chat client holds the bytes (in its code sandbox, or in the person's
 * browser); the model never can. So `request_upload` mints this token and hands
 * back two doors that carry it: `PUT /api/uploads/<token>` for a sandbox with
 * curl, and the `/drop/<token>` page for a person with the file on their
 * device. Neither has a session, so the token is the credential.
 *
 * It names WHO is uploading and WHERE, nothing else: the route re-asks that
 * person's standing in that space at upload time, so a member removed after
 * the token was minted uploads nothing. It is a bearer capability to add files
 * to one space's Drive as one person, which is why its life is minutes and its
 * audience is its own — a session JWT can never stand in for it, or it for one.
 */
import { SignJWT, jwtVerify } from 'jose'

const UPLOAD_TOKEN_AUDIENCE = 'visvine-drive-upload'

/** Long enough to find the file and press drop; short enough to be worthless later. */
const UPLOAD_TOKEN_TTL_SEC = 15 * 60

export interface UploadTokenPayload {
  userId: string
  spaceId: string
  /** The folder of `resources/` files land in; null is the top. */
  folder: string | null
}

function getSecret(): Uint8Array {
  // Same key and minimum entropy as lib/session.ts#getSecret; the audience is
  // what keeps the two tokens apart.
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET environment variable is not set')
  if (secret.length < 32) {
    throw new Error('AUTH_SECRET must be at least 32 characters (use `openssl rand -hex 32`)')
  }
  return new TextEncoder().encode(secret)
}

export async function mintUploadToken(
  payload: UploadTokenPayload,
  ttlSec: number = UPLOAD_TOKEN_TTL_SEC,
): Promise<{ token: string; expiresAt: Date }> {
  const now = Math.floor(Date.now() / 1000)
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(UPLOAD_TOKEN_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSec)
    .sign(getSecret())
  return { token, expiresAt: new Date((now + ttlSec) * 1000) }
}

/** The payload, or null for any failure — the caller answers without saying which. */
export async function verifyUploadToken(token: string): Promise<UploadTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ['HS256'],
      audience: UPLOAD_TOKEN_AUDIENCE,
    })
    const { userId, spaceId, folder } = payload as Record<string, unknown>
    if (typeof userId !== 'string' || !userId || typeof spaceId !== 'string' || !spaceId) return null
    if (folder !== null && folder !== undefined && typeof folder !== 'string') return null
    return { userId, spaceId, folder: typeof folder === 'string' && folder ? folder : null }
  } catch {
    return null
  }
}
