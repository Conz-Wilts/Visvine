/**
 * The directory: every company in Blackbird's portfolio, the founders behind
 * them, and the Blackbird team — as directory records.
 *
 * Records first and notes second, because an entity note is a note ABOUT a
 * node: `people/<slug>/index.md` becomes that person's folder only when the
 * node it names already exists (lib/notes/store.ts#createNote). Links are not
 * written here at all — founder and team edges come from the notes, drawn by
 * the store as each entity note lands.
 */

import prisma from '../../../lib/prisma'
import { blackbirdPage, buildModel, orgAlias, personAlias, teamPage } from '../model'
import { SPACE_ID } from '../space'
import { daysAgo } from '../write'

/** Days since the first of July of a year — close enough for "since". */
const sinceYear = (year: number | null) => (year ? Math.max(30, (2026 - year) * 365 + 80) : 90)

export async function seedDirectory(): Promise<{ companies: number; people: number }> {
  const model = buildModel()

  for (const { nodeId, org } of model.orgs) {
    const alias = orgAlias(org)
    await prisma.node.create({
      data: {
        id: nodeId,
        type: 'company',
        name: org.name,
        subtitle: org.subtitle,
        location: org.hq,
        url: org.website,
        tags: [org.sector, alias, org.stage, org.field].filter(
          (t): t is string => typeof t === 'string' && t.length > 0,
        ),
        metadata: {
          kind: 'portfolio',
          sector: org.sector,
          stage: org.stage,
          status: org.status,
          exit: org.exit ?? null,
          invested: org.invested,
          founded: org.founded,
          field: org.field,
          lastRound: org.lastRound,
          country: org.country,
          longDescription: org.description,
          website: org.website,
          blackbirdPage: blackbirdPage(org),
          seeded: true,
        },
        spaceId: SPACE_ID,
        alias,
        createdAt: daysAgo(sinceYear(org.invested)),
      },
    })
  }

  for (const person of model.people) {
    const alias = personAlias(person)
    const firstOrg = person.founded[0] ? model.orgBySlug.get(person.founded[0].orgSlug) : undefined
    const employer = person.team ? 'Blackbird' : (firstOrg?.org.name ?? null)
    await prisma.node.create({
      data: {
        id: person.nodeId,
        type: 'person',
        name: person.name,
        subtitle: employer ? `${person.role}, ${employer}` : person.role,
        location: person.location,
        url: person.team ? teamPage(person.team) : null,
        tags: [alias, person.team ? person.team.group : (firstOrg?.org.sector ?? null)].filter(
          (t): t is string => Boolean(t),
        ),
        metadata: {
          kind: person.team ? 'team' : 'founder',
          role: person.role,
          bio: person.bio,
          email: person.email,
          org: employer,
          orgNode: person.team ? null : (firstOrg?.nodeId ?? null),
          founded: person.founded.map((f) => `company:${f.orgSlug}`),
          ...(person.team
            ? { group: person.team.group, before: person.team.before ?? null, quote: person.team.quote ?? null }
            : {}),
          seeded: true,
        },
        spaceId: SPACE_ID,
        alias,
        createdAt: daysAgo(person.team ? 300 : sinceYear(firstOrg?.org.invested ?? null)),
      },
    })
  }

  return { companies: model.orgs.length, people: model.people.length }
}
