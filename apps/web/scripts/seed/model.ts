/**
 * The seed's in-memory model: the dataset, resolved.
 *
 * Slugs are the join between layers — a person's note lives at
 * `people/<slug>/index.md` and their directory card is `person:<slug>`, and the
 * two MUST agree or `[[mentions]]`, backlinks and the entity-folder pointer all
 * drift. The Blackbird scripts derived slugs twice, in two files, with a comment
 * asking whoever edited one to remember the other. This module derives them
 * once and both layers import it.
 */

import { ORGS, TEAM, type SeedOrg, type SeedPerson, type SeedTeamMember } from './dataset'
import { orgNodeId, personNodeId, SEGMENTS, slugify, type Segment } from './space'

export interface ResolvedPerson {
  slug: string
  nodeId: string
  name: string
  role: string
  bio: string | null
  location: string | null
  email: string
  /** The organisation they belong to, or null for the team. */
  orgSlug: string | null
  /** Set for the team; carries what they own. */
  team: SeedTeamMember | null
}

export interface ResolvedOrg {
  slug: string
  nodeId: string
  org: SeedOrg
  people: ResolvedPerson[]
}

export interface SeedModel {
  orgs: ResolvedOrg[]
  orgBySlug: Map<string, ResolvedOrg>
  orgByName: Map<string, ResolvedOrg>
  /** Every person: organisation contacts and the team. */
  people: ResolvedPerson[]
  team: ResolvedPerson[]
  /** Organisations by segment, in canonical SEGMENTS order, non-empty only. */
  orgsBySegment: Map<Segment, ResolvedOrg[]>
  segmentsPresent: Segment[]
}

/** `first.last@<org-slug>.example.com`, or `@visvine.example.com` for the team. */
function seedEmail(name: string, orgSlug: string | null): string {
  const local = slugify(name).replace(/-/g, '.')
  return `${local}@${orgSlug ?? 'visvine'}.example.com`
}

function claimSlug(base: string, seen: Map<string, string>, owner: string, fallbackSuffix: string): string {
  let slug = base || fallbackSuffix
  if (seen.has(slug) && seen.get(slug) !== owner) {
    let n = 2
    while (seen.has(`${slug}-${n}`) && seen.get(`${slug}-${n}`) !== owner) n++
    slug = `${slug}-${n}`
  }
  seen.set(slug, owner)
  return slug
}

export function buildModel(): SeedModel {
  const orgSlugs = new Map<string, string>()
  const personSlugs = new Map<string, string>()

  const orgs: ResolvedOrg[] = []
  const people: ResolvedPerson[] = []

  for (const org of ORGS) {
    const slug = claimSlug(slugify(org.name), orgSlugs, org.name, `org-${orgs.length}`)
    const resolved: ResolvedOrg = { slug, nodeId: orgNodeId(slug), org, people: [] }
    for (const person of org.people) {
      const p = resolvePerson(person, slug, personSlugs, people.length)
      resolved.people.push(p)
      people.push(p)
    }
    orgs.push(resolved)
  }

  const team: ResolvedPerson[] = TEAM.map((member, i) => {
    const p = resolvePerson(
      { name: member.name, role: member.role, bio: member.focus, location: member.location },
      null,
      personSlugs,
      i,
    )
    p.team = member
    people.push(p)
    return p
  })

  const orgBySlug = new Map(orgs.map((o) => [o.slug, o]))
  const orgByName = new Map(orgs.map((o) => [o.org.name.trim().toLowerCase(), o]))

  const orgsBySegment = new Map<Segment, ResolvedOrg[]>()
  for (const o of orgs) {
    const list = orgsBySegment.get(o.org.segment)
    if (list) list.push(o)
    else orgsBySegment.set(o.org.segment, [o])
  }
  const segmentsPresent = SEGMENTS.filter((s) => orgsBySegment.has(s))

  return { orgs, orgBySlug, orgByName, people, team, orgsBySegment, segmentsPresent }
}

function resolvePerson(
  person: SeedPerson,
  orgSlug: string | null,
  seen: Map<string, string>,
  index: number,
): ResolvedPerson {
  const slug = claimSlug(slugify(person.name), seen, person.name, `person-${index}`)
  return {
    slug,
    nodeId: personNodeId(slug),
    name: person.name.trim(),
    role: person.role,
    bio: person.bio ?? null,
    location: person.location ?? null,
    email: seedEmail(person.name, orgSlug),
    orgSlug,
    team: null,
  }
}

/** The alias chip an organisation wears, by what it is to us. */
export function orgAlias(org: SeedOrg): string {
  switch (org.relationship) {
    case 'customer':
      return 'Customer'
    case 'design-partner':
      return 'Design Partner'
    case 'prospect':
      return 'Prospect'
    case 'investor':
      return 'Investor'
    case 'partner':
      return 'Partner'
  }
}

/**
 * The alias chip a person wears. A contact at a space that runs on Visvine is a
 * Champion — the operator we design for; people on the investor and partner
 * side are Advisors, except the one board seat, which holds the single-note
 * grant (see ALIASES in ./space).
 */
export function personAlias(person: ResolvedPerson, org: SeedOrg | null): string {
  if (person.team) return 'Team'
  if (!org) return 'Champion'
  if (org.relationship === 'investor') {
    return /board/i.test(person.bio ?? '') ? 'Board' : 'Advisor'
  }
  if (org.relationship === 'partner') return 'Advisor'
  return 'Champion'
}

/** Sorted by display name — the order every index renders in. */
export const byName = (a: { name?: string; org?: SeedOrg }, b: { name?: string; org?: SeedOrg }) =>
  (a.name ?? a.org?.name ?? '').localeCompare(b.name ?? b.org?.name ?? '')
