/**
 * The deployment's signing key ring — Ed25519, for the one thing Visvine signs:
 * the export of a Tool version Visvine has listed (lib/tools/package). A
 * signature says "Visvine published this, as this release, by this
 * publisher"; nothing else carries one, because a signature on a private
 * space's Tool would read as an endorsement nobody gave.
 *
 * A RING, like the secrets key beside it (./secrets.ts): `TOOLS_SIGNING_KEY`
 * is the key everything is signed UNDER, and `TOOLS_SIGNING_KEY_PREVIOUS`, when
 * set, still verifies — so a rotation never strands a package already handed
 * out. Each is a 32-byte seed as 64 hex characters (`openssl rand -hex 32`).
 * Unset, the pair is derived from `SECRETS_KEY` / `SECRETS_KEY_PREVIOUS` with
 * HKDF, so a deployment that can hold secrets can sign without a second key to
 * provision — and rotating the secrets key rotates this one in step.
 *
 * A signature names its key by id (the first 16 hex characters of the public
 * key's SHA-256), and `publicSigningKeys` is what anyone verifying a package
 * offline needs.
 */
import { createHash, createPrivateKey, createPublicKey, hkdfSync, sign, verify, type KeyObject } from 'node:crypto'

const SEED_RE = /^[0-9a-fA-F]{64}$/

/** PKCS#8 DER prefix of an Ed25519 private key; the 32-byte seed follows it. */
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

const DERIVE_INFO = 'visvine-tool-signing-v1'

interface SigningPair {
  keyId: string
  privateKey: KeyObject
  publicKey: KeyObject
  /** The raw 32-byte public key, base64. */
  publicKeyBase64: string
}

export interface PublicSigningKey {
  keyId: string
  alg: 'ed25519'
  /** The raw 32-byte public key, base64. */
  publicKey: string
}

type Env = Record<string, string | undefined>

function parseSeed(raw: string | undefined, name: string): Buffer | null {
  if (!raw) return null
  if (!SEED_RE.test(raw)) throw new Error(`${name} must be 64 hex characters (openssl rand -hex 32)`)
  return Buffer.from(raw, 'hex')
}

function derivedSeed(secretsKey: string | undefined): Buffer | null {
  if (!secretsKey || !SEED_RE.test(secretsKey)) return null
  return Buffer.from(hkdfSync('sha256', Buffer.from(secretsKey, 'hex'), Buffer.alloc(0), DERIVE_INFO, 32))
}

function pairOf(seed: Buffer): SigningPair {
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: 'der', type: 'pkcs8' })
  const publicKey = createPublicKey(privateKey)
  const jwk = publicKey.export({ format: 'jwk' }) as { x?: string }
  const raw = Buffer.from(jwk.x ?? '', 'base64url')
  return {
    keyId: createHash('sha256').update(raw).digest('hex').slice(0, 16),
    privateKey,
    publicKey,
    publicKeyBase64: raw.toString('base64'),
  }
}

/** The ring, newest first: the key signatures are made under, then the retiring one. Empty when neither is configured. */
function ring(env: Env): SigningPair[] {
  const current = parseSeed(env.TOOLS_SIGNING_KEY, 'TOOLS_SIGNING_KEY') ?? derivedSeed(env.SECRETS_KEY)
  const previous =
    parseSeed(env.TOOLS_SIGNING_KEY_PREVIOUS, 'TOOLS_SIGNING_KEY_PREVIOUS') ??
    (env.TOOLS_SIGNING_KEY ? null : derivedSeed(env.SECRETS_KEY_PREVIOUS))
  const seeds = [current, previous].filter((seed): seed is Buffer => seed !== null)
  const unique = seeds.filter((seed, at) => seeds.findIndex((other) => other.equals(seed)) === at)
  return unique.map(pairOf)
}

/** Whether this deployment can sign at all. */
export function signingConfigured(env: Env = process.env): boolean {
  return ring(env).length > 0
}

/** Sign under the current key, or null when the deployment has none. */
export function signBytes(data: Uint8Array | string, env: Env = process.env): { keyId: string; signature: string } | null {
  const [current] = ring(env)
  if (!current) return null
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data)
  return { keyId: current.keyId, signature: sign(null, bytes, current.privateKey).toString('base64') }
}

/** Whether `signature` is this ring's key `keyId` over `data`. An unknown key id is false. */
export function verifyBytes(
  data: Uint8Array | string,
  signed: { keyId: string; signature: string },
  env: Env = process.env,
): boolean {
  const pair = ring(env).find((candidate) => candidate.keyId === signed.keyId)
  if (!pair) return false
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data)
  try {
    return verify(null, bytes, pair.publicKey, Buffer.from(signed.signature, 'base64'))
  } catch {
    return false
  }
}

/** The public half of every key that verifies — what an offline verifier needs. */
export function publicSigningKeys(env: Env = process.env): PublicSigningKey[] {
  return ring(env).map((pair) => ({ keyId: pair.keyId, alg: 'ed25519', publicKey: pair.publicKeyBase64 }))
}
