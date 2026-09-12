/**
 * Seeds the local dev DB with the Visvine HQ directory: every organisation that
 * runs on Visvine (or wants to, or funds us), the people at them, and the team.
 *
 * Data comes from ./seed/dataset.ts and is resolved to slugs by ./seed/model.ts,
 * so this script only does the writing. Directory LINKS are deliberately not
 * written here: founder/contact edges are derived from the shared context notes
 * (origin 'context', relationship 'mentioned') seeded by add-visvine-hq-notes.ts
 * and materialised by scripts/backfill-context-links.ts.
 *
 *   pnpm db:hq            (after pnpm db:up && pnpm db:seed)
 *
 * Idempotent: explicit ids + upserts. Loads apps/web/.env (cwd-independent, via
 * the guard) and refuses to run against any non-local host — the same guard the
 * destructive db:* scripts use.
 */

import '../../../scripts/guard-local-db.mjs'
import 'dotenv/config'
import { ADMIN_ALIAS_ID, ADMIN_ALIAS_NAME } from '../lib/types/context'
import prisma from '../lib/prisma'
import { buildModel, orgAlias, personAlias } from './seed/model'
import {
  ALIASES,
  NODE_TYPES,
  SPACE_COUNTRY,
  SPACE_DESCRIPTION,
  SPACE_ID,
  SPACE_LOCATION,
  SPACE_NAME,
  SPACE_TAGS,
  SPACE_TIMEZONE,
  seedAliasId,
} from './seed/space'

const model = buildModel()

/** Deterministic, fictional by construction (RFC 2606 reserves example.com). */
const websiteFor = (slug: string) => `https://${slug}.example.com`

const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 3600_000)

async function main() {
  console.log(`--- Upserting ${SPACE_NAME} ---`)
  await prisma.space.upsert({
    where: { id: SPACE_ID },
    // nodeTypes and aliases are written on CREATE only: the alias list is the
    // permission model (who administers the space, what each alias reaches), so
    // a data re-import must never overwrite it.
    create: {
      id: SPACE_ID,
      name: SPACE_NAME,
      description: SPACE_DESCRIPTION,
      location: SPACE_LOCATION,
      tags: [...SPACE_TAGS],
      country: SPACE_COUNTRY,
      timezone: SPACE_TIMEZONE,
      nodeTypes: NODE_TYPES,
      aliases: ALIASES.map((a) => ({
        id: seedAliasId(a.name),
        name: a.name,
        color: a.color,
        nodeType: a.nodeType,
        ...(a.admin ? { admin: true } : {}),
        ...(a.system ? { system: true } : {}),
      })),
      // Demo content is meant to show up in Discover; the column default is private.
      visibility: 'public',
    },
    update: {
      name: SPACE_NAME,
      description: SPACE_DESCRIPTION,
      location: SPACE_LOCATION,
      tags: [...SPACE_TAGS],
      country: SPACE_COUNTRY,
      timezone: SPACE_TIMEZONE,
    },
  })
  console.log(`  ✓ ${SPACE_ID}`)

  // Make the space visible to local dev users (admin@local.dev etc.) so it
  // shows up in their space list and is browsable in the UI.
  //
  // Membership carries no role — what a person can do comes entirely from the
  // aliases they hold (lib/auth.ts#isAdmin), so admin@local.dev also gets a
  // user_aliases row for Admin. Everyone else is just an active member; the
  // base seed (prisma/seed.ts) is what hands out the rest of the aliases.
  const devUsers = await prisma.user.findMany({
    where: { email: { endsWith: '@local.dev' } },
    select: { id: true, email: true },
  })
  for (const u of devUsers) {
    await prisma.spaceMember.upsert({
      where: { userId_spaceId: { userId: u.id, spaceId: SPACE_ID } },
      create: { userId: u.id, spaceId: SPACE_ID, status: 'active' },
      update: { status: 'active' },
    })
  }
  const owner = devUsers.find((u) => u.email === 'admin@local.dev') ?? devUsers[0] ?? null
  if (owner) {
    const held = await prisma.userAlias.findFirst({
      where: { spaceId: SPACE_ID, userId: owner.id, aliasId: ADMIN_ALIAS_ID },
    })
    if (!held) {
      await prisma.userAlias.create({
        data: { spaceId: SPACE_ID, userId: owner.id, aliasId: ADMIN_ALIAS_ID, addedBy: owner.id },
      })
    }
  }
  console.log(
    `  ✓ ${devUsers.length} local dev user(s) joined` +
      (owner ? `, ${owner.email} holds ${ADMIN_ALIAS_NAME}` : ''),
  )

  // Clear this space's existing records first so re-runs (and any id-scheme
  // change) don't leave orphans. Cascades to links. The `anchor` nodes from
  // prisma/seed.ts are the dev users' own person nodes and are left alone —
  // they have Identity rows pointing at them, so deleting them would strand a
  // profile. `spaceRef` nodes are the sub-space cards, which belong to the
  // structure rather than to this dataset.
  const cleared = await prisma.$executeRaw`
    DELETE FROM nodes WHERE space_id = ${SPACE_ID}
      AND COALESCE(metadata->>'anchor', 'false') <> 'true'
      AND metadata->>'spaceRef' IS NULL`
  console.log(`\n--- Cleared ${cleared} existing node(s) for a clean rebuild ---`)

  console.log('\n--- Inserting organisations ---')
  for (const { slug, nodeId, org } of model.orgs) {
    const alias = orgAlias(org)
    const tags = [org.segment, alias, org.plan, org.stage, org.round].filter(
      (t): t is string => typeof t === 'string' && t.length > 0,
    )
    const metadata = {
      kind: 'organisation',
      relationship: org.relationship,
      segment: org.segment,
      since: org.since ?? null,
      plan: org.plan ?? null,
      seats: org.seats ?? null,
      mrr: org.mrr ?? null,
      health: org.health ?? null,
      useCase: org.useCase ?? null,
      stage: org.stage ?? null,
      nextStep: org.nextStep ?? null,
      expectedMrr: org.expectedMrr ?? null,
      round: org.round ?? null,
      cheque: org.cheque ?? null,
      longDescription: org.description,
      website: websiteFor(slug),
      seeded: true,
    }
    await prisma.node.upsert({
      where: { id: nodeId },
      create: {
        id: nodeId,
        type: 'company',
        name: org.name,
        subtitle: org.subtitle,
        location: org.location,
        url: websiteFor(slug),
        tags,
        metadata,
        spaceId: SPACE_ID,
        alias,
        createdAt: daysAgo(org.since ? (2026 - org.since) * 120 + 30 : 90),
      },
      update: {
        type: 'company',
        name: org.name,
        subtitle: org.subtitle,
        location: org.location,
        url: websiteFor(slug),
        tags,
        metadata,
        spaceId: SPACE_ID,
        alias,
      },
    })
  }
  console.log(`  ✓ ${model.orgs.length} organisations`)

  console.log('\n--- Inserting people ---')
  for (const person of model.people) {
    const org = person.orgSlug ? (model.orgBySlug.get(person.orgSlug)?.org ?? null) : null
    const alias = personAlias(person, org)
    const employer = org?.name ?? SPACE_NAME
    const tags = [alias, org ? org.segment : 'Visvine'].filter(Boolean)
    const metadata = {
      kind: person.team ? 'team' : 'contact',
      role: person.role,
      bio: person.bio,
      email: person.email,
      org: org?.name ?? SPACE_NAME,
      orgNode: person.orgSlug ? `company:${person.orgSlug}` : null,
      ...(person.team
        ? { focus: person.team.focus, segments: person.team.segments ?? [], accounts: person.team.accounts ?? [] }
        : {}),
      seeded: true,
    }
    await prisma.node.upsert({
      where: { id: person.nodeId },
      create: {
        id: person.nodeId,
        type: 'person',
        name: person.name,
        subtitle: `${person.role}, ${employer}`,
        location: person.location ?? org?.location ?? null,
        tags,
        metadata,
        spaceId: SPACE_ID,
        alias,
        createdAt: daysAgo(person.team ? 300 : 120),
      },
      update: {
        type: 'person',
        name: person.name,
        subtitle: `${person.role}, ${employer}`,
        location: person.location ?? org?.location ?? null,
        tags,
        metadata,
        spaceId: SPACE_ID,
        alias,
      },
    })
  }
  console.log(`  ✓ ${model.people.length} people (${model.team.length} of them the team)`)

  console.log('\n--- Node type breakdown ---')
  const byType = await prisma.node.groupBy({
    by: ['type'],
    where: { spaceId: SPACE_ID },
    _count: { _all: true },
  })
  console.table(byType.map((r) => ({ type: r.type, count: r._count._all })))

  console.log('\n--- Relationship breakdown ---')
  const counts = new Map<string, number>()
  for (const { org } of model.orgs) counts.set(org.relationship, (counts.get(org.relationship) ?? 0) + 1)
  console.table([...counts].map(([relationship, count]) => ({ relationship, count })))
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
