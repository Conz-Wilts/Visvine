/**
 * Re-encrypt every stored secret under the current SECRETS_KEY.
 *
 * Step 2 of the three-step rotation documented in lib/crypto/secrets.ts and
 * docs/runbook.md. It expects to be run with BOTH keys present:
 *
 *   SECRETS_KEY           the new key — everything is rewritten under this
 *   SECRETS_KEY_PREVIOUS  the retiring key — what the old rows are readable with
 *
 * Every ciphertext column in the schema is covered:
 *   connector_secrets.ciphertext
 *   connector_connections.access_token, .refresh_token
 *   connector_oauth_clients.client_secret
 *   connector_accounts.access_token, .refresh_token
 *   connector_account_clients.client_secret
 *
 * Idempotent: a row that already decrypts under the primary key is skipped, so
 * an interrupted run resumes and a second run is a no-op. Each row is written
 * in its own statement — there is no batch to half-apply, and a row that cannot
 * be decrypted under EITHER key is reported and left exactly as it was rather
 * than being destroyed by a rewrite.
 *
 * Usage:
 *   SECRETS_KEY=<new> SECRETS_KEY_PREVIOUS=<old> \
 *     pnpm --filter @visvine/web db:secrets:rotate [--dry-run]
 */
import 'dotenv/config'
import prisma from '../lib/prisma'
import { decryptSecret, encryptSecret, encryptedUnderPrimaryKey } from '../lib/crypto/secrets'

const dryRun = process.argv.includes('--dry-run')

let rotated = 0
let skipped = 0
const failures: string[] = []

/** Re-encrypt one column value, or record why it could not be. */
function reencrypt(label: string, stored: string | null): string | null | 'unchanged' {
  if (!stored) return 'unchanged'
  if (encryptedUnderPrimaryKey(stored)) {
    skipped++
    return 'unchanged'
  }
  try {
    const plain = decryptSecret(stored)
    rotated++
    return encryptSecret(plain)
  } catch {
    // Readable under neither key. Leave it alone and say so — an unreadable
    // secret is a reconnect; an overwritten one is unrecoverable.
    failures.push(label)
    return 'unchanged'
  }
}

async function main() {
  if (!process.env.SECRETS_KEY) throw new Error('SECRETS_KEY is not set')
  if (!process.env.SECRETS_KEY_PREVIOUS) {
    console.warn(
      'SECRETS_KEY_PREVIOUS is not set — only rows already under SECRETS_KEY can be read. ' +
        'If you are mid-rotation, set it to the retiring key and re-run.',
    )
  }

  for (const row of await prisma.connectorSecret.findMany({
    select: { id: true, spaceId: true, name: true, ciphertext: true },
  })) {
    const next = reencrypt(`connector_secrets ${row.spaceId}/${row.name}`, row.ciphertext)
    if (next === 'unchanged' || next === null) continue
    if (!dryRun) {
      await prisma.connectorSecret.update({ where: { id: row.id }, data: { ciphertext: next } })
    }
  }

  for (const row of await prisma.connectorConnection.findMany({
    select: { id: true, spaceId: true, provider: true, accessToken: true, refreshToken: true },
  })) {
    const label = `connector_connections ${row.spaceId}/${row.provider}`
    const access = reencrypt(`${label} access_token`, row.accessToken)
    const refresh = reencrypt(`${label} refresh_token`, row.refreshToken)
    const data: { accessToken?: string; refreshToken?: string } = {}
    if (access !== 'unchanged' && access !== null) data.accessToken = access
    if (refresh !== 'unchanged' && refresh !== null) data.refreshToken = refresh
    if (Object.keys(data).length === 0) continue
    if (!dryRun) await prisma.connectorConnection.update({ where: { id: row.id }, data })
  }

  for (const row of await prisma.connectorOAuthClient.findMany({
    select: { id: true, spaceId: true, provider: true, clientSecret: true },
  })) {
    const next = reencrypt(
      `connector_oauth_clients ${row.spaceId}/${row.provider} client_secret`,
      row.clientSecret,
    )
    if (next === 'unchanged' || next === null) continue
    if (!dryRun) {
      await prisma.connectorOAuthClient.update({ where: { id: row.id }, data: { clientSecret: next } })
    }
  }

  for (const row of await prisma.connectorAccount.findMany({
    select: { id: true, userId: true, name: true, accessToken: true, refreshToken: true },
  })) {
    const label = `connector_accounts ${row.userId}/${row.name}`
    const access = reencrypt(`${label} access_token`, row.accessToken)
    const refresh = reencrypt(`${label} refresh_token`, row.refreshToken)
    const data: { accessToken?: string; refreshToken?: string } = {}
    if (access !== 'unchanged' && access !== null) data.accessToken = access
    if (refresh !== 'unchanged' && refresh !== null) data.refreshToken = refresh
    if (Object.keys(data).length === 0) continue
    if (!dryRun) await prisma.connectorAccount.update({ where: { id: row.id }, data })
  }

  for (const row of await prisma.connectorAccountClient.findMany({
    select: { id: true, userId: true, recipe: true, clientSecret: true },
  })) {
    const next = reencrypt(`connector_account_clients ${row.userId}/${row.recipe} client_secret`, row.clientSecret)
    if (next === 'unchanged' || next === null) continue
    if (!dryRun) await prisma.connectorAccountClient.update({ where: { id: row.id }, data: { clientSecret: next } })
  }

  console.log(
    `${dryRun ? '[dry run] ' : ''}rotate-secrets-key: ${rotated} re-encrypted, ${skipped} already current.`,
  )
  if (failures.length > 0) {
    console.error(
      `\n${failures.length} value(s) decrypt under NEITHER key and were left untouched.\n` +
        'Each needs the secret re-entered, or the connection reconnected:\n  ' +
        failures.join('\n  '),
    )
    process.exitCode = 1
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
