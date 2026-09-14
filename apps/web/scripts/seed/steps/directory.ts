/**
 * The directory: every organisation that runs on Visvine (or wants to, or funds
 * us), the people at them, and the team — as directory records.
 *
 * Records first and notes second, because an entity note is a note ABOUT a
 * node: `people/<slug>/index.md` becomes that person's folder only when the
 * node it names already exists (lib/notes/store.ts#createNote). Links are not
 * written here at all — founder/contact edges come from the notes, drawn by the
 * store as each entity note lands.
 */

import prisma from '../../../lib/prisma'
import { buildModel, orgAlias, personAlias } from '../model'
import { SPACE_ID, SPACE_NAME } from '../space'
import { daysAgo } from '../write'

/** Deterministic, fictional by construction (RFC 2606 reserves example.com). */
const websiteFor = (slug: string) => `https://${slug}.example.com`

export async function seedDirectory(): Promise<{ orgs: number; people: number }> {
  const model = buildModel()

  for (const { slug, nodeId, org } of model.orgs) {
    const alias = orgAlias(org)
    await prisma.node.create({
      data: {
        id: nodeId,
        type: 'company',
        name: org.name,
        subtitle: org.subtitle,
        location: org.location,
        url: websiteFor(slug),
        tags: [org.segment, alias, org.plan, org.stage, org.round].filter(
          (t): t is string => typeof t === 'string' && t.length > 0,
        ),
        metadata: {
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
        },
        spaceId: SPACE_ID,
        alias,
        createdAt: daysAgo(org.since ? (2026 - org.since) * 120 + 30 : 90),
      },
    })
  }

  for (const person of model.people) {
    const org = person.orgSlug ? (model.orgBySlug.get(person.orgSlug)?.org ?? null) : null
    const alias = personAlias(person, org)
    const employer = org?.name ?? SPACE_NAME
    await prisma.node.create({
      data: {
        id: person.nodeId,
        type: 'person',
        name: person.name,
        subtitle: `${person.role}, ${employer}`,
        location: person.location ?? org?.location ?? null,
        tags: [alias, org ? org.segment : 'Visvine'],
        metadata: {
          kind: person.team ? 'team' : 'contact',
          role: person.role,
          bio: person.bio,
          email: person.email,
          org: employer,
          orgNode: person.orgSlug ? `company:${person.orgSlug}` : null,
          ...(person.team
            ? { focus: person.team.focus, segments: person.team.segments ?? [], accounts: person.team.accounts ?? [] }
            : {}),
          seeded: true,
        },
        spaceId: SPACE_ID,
        alias,
        createdAt: daysAgo(person.team ? 300 : 120),
      },
    })
  }

  return { orgs: model.orgs.length, people: model.people.length }
}
