/**
 * The space's connector secret store — the one place a credential is written,
 * rotated or removed. The admin HTTP route and the MCP `set_connector_secret`
 * tool both come through here so the two can never drift on validation,
 * encryption or the audit line.
 *
 * Two properties this module exists to keep true:
 *
 *   • WRITE-ONLY. Nothing here returns a value. `listSecretNames` returns names
 *     and timestamps; the only decryption in the codebase happens inside a
 *     connector run (lib/connectors/service.ts), into an isolate whose output is
 *     redacted. A stored secret can be overwritten or deleted, never read back —
 *     not by an admin, not by an agent, not by this module's callers.
 *
 *   • NO AUTHORIZATION OF ITS OWN. Every caller must have already proved the
 *     actor is an admin OF THIS SPACE. That check deliberately lives next to the
 *     session or token that establishes identity, because the two paths in
 *     (a browser cookie, an OAuth access token) establish it differently and a
 *     check here would have to trust whatever it was handed.
 */
import prisma from '@/lib/prisma'
import { encryptSecret } from '@/lib/crypto/secrets'
import { isValidSecretName } from '@/lib/connectors/config'
import { logAudit } from '@/lib/notes/audit'

/** Longest value the store accepts — generous for a PEM, absurd for an API key. */
export const SECRET_MAX_CHARS = 8192

/**
 * Whoever is writing. Both names are carried because the two records want
 * different ones: `connector_secrets.created_by` is the admin's EMAIL (schema.prisma
 * says so — it is the stable handle you grep for months later), while the audit
 * row carries the display name, like every other audit row.
 */
export interface SecretActor {
  userId: string
  /** Display name, for the audit row. */
  name: string
  /** Email, for `created_by` on the stored row. */
  email: string
}

type SecretWriteFailure =
  | 'invalid_name'
  | 'invalid_value'
  | 'already_set'
  | 'unconfigured'

export type SetSecretResult =
  | { ok: true; name: string; rotated: boolean }
  | { ok: false; code: SecretWriteFailure; error: string }

export interface SetSecretInput {
  name: string
  value: string
  /**
   * Whether an existing value may be replaced. The connector page passes `true`
   * — an admin clicking Rotate means it. Automated callers pass `false` so that
   * a re-run of a setup script cannot silently overwrite a working credential
   * with a stale one; they get `already_set` and can decide.
   */
  overwrite: boolean
}

/**
 * Store or rotate one secret. Returns a discriminated result rather than
 * throwing: both callers need to turn a refusal into their own idiom (an HTTP
 * status, an McpError) and neither wants a stack trace that might carry the
 * value in a frame.
 */
export async function setSpaceSecret(
  spaceId: string,
  actor: SecretActor,
  input: SetSecretInput,
): Promise<SetSecretResult> {
  const name = input.name.trim()
  if (!isValidSecretName(name)) {
    return {
      ok: false,
      code: 'invalid_name',
      error: 'Secret names are UPPER_SNAKE_CASE: start with A-Z, then A-Z, 0-9 or _ (max 64 chars)',
    }
  }
  // Not trimmed: leading/trailing whitespace is legal inside a private key and
  // trimming one would produce a credential that fails for no visible reason.
  const value = input.value
  if (value.length === 0 || value.length > SECRET_MAX_CHARS) {
    return { ok: false, code: 'invalid_value', error: `Secret value must be 1–${SECRET_MAX_CHARS} characters` }
  }

  const existing = await prisma.connectorSecret.findUnique({
    where: { secret_identity: { spaceId, name } },
    select: { name: true },
  })
  if (existing && !input.overwrite) {
    return {
      ok: false,
      code: 'already_set',
      error: `${name} already has a value stored. Pass overwrite: true to rotate it — the old value cannot be read back to compare.`,
    }
  }

  let ciphertext: string
  try {
    ciphertext = encryptSecret(value)
  } catch {
    return {
      ok: false,
      code: 'unconfigured',
      error: 'Connector secrets are not configured on this server (SECRETS_KEY)',
    }
  }

  await prisma.connectorSecret.upsert({
    where: { secret_identity: { spaceId, name } },
    create: { spaceId, name, ciphertext, createdBy: actor.email },
    update: { ciphertext, createdBy: actor.email },
  })
  // Rotation leaves a trace — the name only, never the value.
  await logAudit(spaceId, {
    userId: actor.userId,
    name: actor.name,
    action: 'secret',
    path: name,
    detail: existing ? 'rotated' : 'set',
  })

  return { ok: true, name, rotated: existing !== null }
}

/** Remove a secret. Absent is not an error — the end state is the same. */
export async function deleteSpaceSecret(
  spaceId: string,
  actor: SecretActor,
  rawName: string,
): Promise<void> {
  const name = rawName.trim()
  await prisma.connectorSecret.deleteMany({ where: { spaceId, name } })
  await logAudit(spaceId, {
    userId: actor.userId,
    name: actor.name,
    action: 'secret',
    path: name,
    detail: 'deleted',
  })
}

/** Names and timestamps of what is stored — never a value. */
export async function listSecretNames(spaceId: string) {
  return prisma.connectorSecret.findMany({
    where: { spaceId },
    select: { name: true, createdBy: true, updatedAt: true },
    orderBy: { name: 'asc' },
  })
}

/**
 * Which of `names` already have a value. The join behind "is this connector
 * ready to run?" — the same one the connector page's GET does, so the page and
 * the tool answer identically.
 */
export async function storedSecretNames(
  spaceId: string,
  names: readonly string[],
): Promise<Set<string>> {
  if (names.length === 0) return new Set()
  const rows = await prisma.connectorSecret.findMany({
    where: { spaceId, name: { in: [...names] } },
    select: { name: true },
  })
  return new Set(rows.map((r) => r.name))
}
