/**
 * Write (or remove) one set of demo connectors on a local space — the same
 * notes and secrets `pnpm db:seed` puts in Visvine HQ (scripts/seed/connectors.ts),
 * for re-seeding a set without reseeding everything, or for another space.
 *
 *   pnpm db:connectors:demo  [spaceId] [--remove]   sandbox (http) + appdb (postgres)
 *   pnpm db:connectors:funds [spaceId] [--remove]   fund-metrics + the funds/ notes
 *   pnpm db:connectors:oauth [spaceId] [--remove]   the OAuth2 CRM
 *
 * Notes go through the note store, so the connector nodes, links and folder
 * indexes follow exactly as they would from the console. Secrets are encrypted
 * under SECRETS_KEY the way the console stores them.
 *
 * Local-only — guarded like the destructive db:* scripts. The appdb connector
 * points at your dev database with no table allowlist, which is fine for seeded
 * local data and is exactly why this refuses anything but a local database.
 */

import '../../../scripts/guard-local-db.mjs'
import 'dotenv/config'
import prisma from '../lib/prisma'
import { ADMIN_ALIAS_ID } from '../lib/types/context'
import { encryptSecret } from '../lib/crypto/secrets'
import { deleteNote, readNoteOrNull, SHARED_OWNER_KEY } from '../lib/notes/store'
import { CONNECTOR_DEMOS, connectorDemo, type ConnectorDemo } from './seed/connectors'
import { putNote } from './seed/write'
import { SPACE_ID } from './seed/space'

async function main() {
  const [kindArg, ...rest] = process.argv.slice(2)
  const kind = kindArg as ConnectorDemo
  if (!CONNECTOR_DEMOS.includes(kind)) {
    throw new Error(`usage: add-connector-demos.ts <${CONNECTOR_DEMOS.join('|')}> [spaceId] [--remove]`)
  }
  const spaceId = rest.find((a) => !a.startsWith('--')) ?? SPACE_ID
  const remove = rest.includes('--remove')

  const space = await prisma.space.findUnique({ where: { id: spaceId }, select: { id: true, name: true } })
  if (!space) throw new Error(`space ${spaceId} not found — run \`pnpm db:seed\` first`)
  const context = { spaceId, ownerKey: SHARED_OWNER_KEY }
  const set = connectorDemo(kind, spaceId)

  if (remove) {
    let notes = 0
    for (const note of set.notes) {
      if ((await readNoteOrNull(context, note.path)) === null) continue
      await deleteNote(context, note.path)
      notes++
    }
    const secrets = await prisma.connectorSecret.deleteMany({
      where: { spaceId, name: { in: set.secrets.map((s) => s.name) } },
    })
    console.log(`Removed ${notes} note(s) and ${secrets.count} secret(s) from ${space.name}`)
    return
  }

  // Someone who manages the space authors the notes; else any member.
  const owner =
    (await prisma.userAlias.findFirst({ where: { spaceId, aliasId: ADMIN_ALIAS_ID }, select: { userId: true } })) ??
    (await prisma.spaceMember.findFirst({ where: { spaceId }, select: { userId: true } }))
  if (!owner) throw new Error(`space ${spaceId} has no members to attribute the notes to`)
  const user = await prisma.user.findUnique({ where: { id: owner.userId }, select: { name: true, email: true } })
  const actor = { id: owner.userId, name: user?.name ?? 'Admin', email: user?.email ?? null }

  for (const note of set.notes) await putNote(context, note.path, note.content, actor)
  for (const secret of set.secrets) {
    await prisma.connectorSecret.upsert({
      where: { secret_identity: { spaceId, name: secret.name } },
      create: { spaceId, name: secret.name, ciphertext: encryptSecret(secret.value), createdBy: owner.userId },
      update: { ciphertext: encryptSecret(secret.value) },
    })
  }

  console.log(`=== Seeded the ${kind} connectors into ${space.name} (${spaceId}) ===`)
  for (const note of set.notes) console.log(`  note   shared:${note.path}`)
  for (const secret of set.secrets) console.log(`  secret ${secret.name}`)
  console.log('  Needs ENABLE_DEV_AUTH=true and CONNECTORS_ALLOW_PRIVATE_HOSTS=true in apps/web/.env')
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
