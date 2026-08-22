/**
 * At-rest encryption for space connector secrets and stored OAuth tokens
 * (ConnectorSecret.ciphertext, ConnectorConnection.accessToken/refreshToken,
 * ConnectorOAuthClient.clientSecret). AES-256-GCM, stored as
 * `aes256gcm$<ivHex>$<tagHex>$<cipherHex>` — the same self-describing string
 * style as lib/auth/password.ts, so a future scheme can live alongside this one.
 *
 * THERE IS A KEY RING, and it exists so that rotation is a procedure rather
 * than a data loss event. `SECRETS_KEY` is the only key anything is ever
 * encrypted UNDER; `SECRETS_KEY_PREVIOUS`, when set, is additionally accepted on
 * decrypt. That makes the rotation:
 *
 *   1. SECRETS_KEY_PREVIOUS := the current key, SECRETS_KEY := a new one; deploy.
 *      Everything still decrypts (old ciphertext under the old key, anything
 *      written from now on under the new one).
 *   2. `pnpm --filter @visvine/web db:secrets:rotate` re-encrypts every stored
 *      row under the new key.
 *   3. Unset SECRETS_KEY_PREVIOUS; deploy. The old key is now inert.
 *
 * Trial decryption is safe here because GCM authenticates: the wrong key fails
 * the tag check rather than returning plausible garbage, so "which key was this
 * written under" needs no key id in the ciphertext and old rows stay readable
 * with no format change.
 *
 * Values only ever decrypt server-side at connector-call time; no API returns a
 * plaintext secret.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const SCHEME = 'aes256gcm'
const IV_BYTES = 12
const KEY_RE = /^[0-9a-fA-F]{64}$/

function parseKey(raw: string | undefined, name: string): Buffer | null {
  if (!raw) return null
  if (!KEY_RE.test(raw)) {
    throw new Error(`${name} environment variable must be 64 hex characters (openssl rand -hex 32)`)
  }
  return Buffer.from(raw, 'hex')
}

/** The key everything is written under. Lazy so builds don't need it. */
function primaryKey(): Buffer {
  const key = parseKey(process.env.SECRETS_KEY, 'SECRETS_KEY')
  if (!key) {
    throw new Error(
      'SECRETS_KEY environment variable must be 64 hex characters (openssl rand -hex 32)',
    )
  }
  return key
}

/** Primary first, then the retiring key. Order matters only for speed. */
function decryptionKeys(): Buffer[] {
  const keys = [primaryKey()]
  const previous = parseKey(process.env.SECRETS_KEY_PREVIOUS, 'SECRETS_KEY_PREVIOUS')
  if (previous && !previous.equals(keys[0])) keys.push(previous)
  return keys
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', primaryKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${SCHEME}$${iv.toString('hex')}$${tag.toString('hex')}$${encrypted.toString('hex')}`
}

/** Throws on an unknown scheme, malformed parts, or a failed auth tag under every key. */
export function decryptSecret(stored: string): string {
  const [scheme, ivHex, tagHex, cipherHex] = stored.split('$')
  if (scheme !== SCHEME || !ivHex || !tagHex || cipherHex === undefined) {
    throw new Error('Unrecognized secret ciphertext format')
  }
  for (const key of decryptionKeys()) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
      return Buffer.concat([
        decipher.update(Buffer.from(cipherHex, 'hex')),
        decipher.final(),
      ]).toString('utf8')
    } catch {
      // Wrong key, or genuinely corrupt. Fall through to the next key; the
      // final failure below is what the caller sees, and it never says which.
    }
  }
  throw new Error('Secret could not be decrypted under SECRETS_KEY')
}

/**
 * True when `stored` decrypts under the PRIMARY key specifically. The rotation
 * script uses this to skip rows it has already migrated, so a re-run is cheap
 * and an interrupted run resumes.
 */
export function encryptedUnderPrimaryKey(stored: string): boolean {
  const [scheme, ivHex, tagHex, cipherHex] = stored.split('$')
  if (scheme !== SCHEME || !ivHex || !tagHex || cipherHex === undefined) return false
  try {
    const decipher = createDecipheriv('aes-256-gcm', primaryKey(), Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
    Buffer.concat([decipher.update(Buffer.from(cipherHex, 'hex')), decipher.final()])
    return true
  } catch {
    return false
  }
}
