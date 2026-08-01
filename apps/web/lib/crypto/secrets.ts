/**
 * At-rest encryption for community connector secrets (the CommunitySecret
 * table). AES-256-GCM under a single server key, stored as
 * `aes256gcm$<ivHex>$<tagHex>$<cipherHex>` — same self-describing string style
 * as lib/auth/password.ts, so a future scheme can live alongside this one.
 *
 * Rotating SECRETS_KEY orphans every stored ciphertext: there is no key ring.
 * Values only ever decrypt server-side at connector-call time; no API returns
 * a plaintext secret.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const SCHEME = 'aes256gcm'
const IV_BYTES = 12

/** Lazy so builds don't need the key; throws at first use when unset. */
function getSecretsKey(): Buffer {
  const raw = process.env.SECRETS_KEY
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      'SECRETS_KEY environment variable must be 64 hex characters (openssl rand -hex 32)',
    )
  }
  return Buffer.from(raw, 'hex')
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', getSecretsKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${SCHEME}$${iv.toString('hex')}$${tag.toString('hex')}$${encrypted.toString('hex')}`
}

/** Throws on an unknown scheme, malformed parts, or a failed auth tag. */
export function decryptSecret(stored: string): string {
  const [scheme, ivHex, tagHex, cipherHex] = stored.split('$')
  if (scheme !== SCHEME || !ivHex || !tagHex || cipherHex === undefined) {
    throw new Error('Unrecognized secret ciphertext format')
  }
  const decipher = createDecipheriv('aes-256-gcm', getSecretsKey(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(cipherHex, 'hex')), decipher.final()]).toString(
    'utf8',
  )
}
