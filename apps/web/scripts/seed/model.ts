/**
 * The seed's in-memory model: the dataset, resolved.
 *
 * Slugs are the join between layers — a person's note lives at
 * `people/<slug>/index.md` and their directory card is `person:<slug>`, and the
 * two MUST agree or `[[mentions]]`, backlinks and the entity-folder pointer all
 * drift. This module derives them once and every layer imports it.
 *
 * A person is one record however many hats they wear: Nick Crocker co-founded
 * Sessions and is a Blackbird partner, Kate Glazebrook co-founded Applied and
 * runs impact, Tim Kentley-Klay founded both Zoox and HYPR. People are keyed by
 * name, so each of them is one node with every affiliation on it.
 */

import { PORTFOLIO, type SeedCompany, type SeedStory } from './portfolio'
import { TEAM, type SeedTeamMember } from './team'
import { orgNodeId, personNodeId, SECTORS, slugify, type Sector } from './space'

export interface Affiliation {
  orgSlug: string
  role: string
  bio: string | null
}

export interface ResolvedPerson {
  slug: string
  nodeId: string
  name: string
  /** The role their card leads with: Blackbird's, else their first company's. */
  role: string
  bio: string | null
  location: string | null
  email: string
  /** Every company they founded or run, in portfolio order. */
  founded: Affiliation[]
  /** Set for the Blackbird team. */
  team: SeedTeamMember | null
  /** Blackbird posts they wrote about a portfolio company. */
  wrote: Array<{ orgSlug: string; story: SeedStory }>
}

export interface ResolvedOrg {
  slug: string
  nodeId: string
  org: SeedCompany
  people: ResolvedPerson[]
  /** The team members who wrote Blackbird's notes on it, most recent first. */
  writers: ResolvedPerson[]
}

export interface SeedModel {
  orgs: ResolvedOrg[]
  orgBySlug: Map<string, ResolvedOrg>
  orgByName: Map<string, ResolvedOrg>
  /** Every person: founders and the team. */
  people: ResolvedPerson[]
  personByName: Map<string, ResolvedPerson>
  team: ResolvedPerson[]
  founders: ResolvedPerson[]
  /** Companies by sector, in canonical SECTORS order, non-empty only. */
  orgsBySector: Map<Sector, ResolvedOrg[]>
  sectorsPresent: Sector[]
}

const nameKey = (name: string) => slugify(name)

/** `first.last@<company>.example.com`, or `@blackbird.example.com` for the team. */
function seedEmail(name: string, domain: string): string {
  return `${slugify(name).replace(/-/g, '.')}@${domain}.example.com`
}

function claimSlug(base: string, seen: Set<string>, fallback: string): string {
  let slug = base || fallback
  if (seen.has(slug)) {
    let n = 2
    while (seen.has(`${slug}-${n}`)) n++
    slug = `${slug}-${n}`
  }
  seen.add(slug)
  return slug
}

let cached: SeedModel | null = null

export function buildModel(): SeedModel {
  if (cached) return cached
  const orgSlugs = new Set<string>()
  const personSlugs = new Set<string>()
  const byKey = new Map<string, ResolvedPerson>()

  const person = (name: string, domain: string): ResolvedPerson => {
    const key = nameKey(name)
    const found = byKey.get(key)
    if (found) return found
    const slug = claimSlug(slugify(name), personSlugs, `person-${byKey.size}`)
    const p: ResolvedPerson = {
      slug,
      nodeId: personNodeId(slug),
      name: name.trim(),
      role: '',
      bio: null,
      location: null,
      email: seedEmail(name, domain),
      founded: [],
      team: null,
      wrote: [],
    }
    byKey.set(key, p)
    return p
  }

  // The team first, so a partner who once founded a company keeps Blackbird's
  // address and role on their card.
  for (const member of TEAM) {
    const p = person(member.name, 'blackbird')
    p.team = member
    p.role = member.role
    p.bio = member.does ?? null
    p.location = member.location
  }

  const orgs: ResolvedOrg[] = []
  for (const org of PORTFOLIO) {
    const slug = claimSlug(slugify(org.name), orgSlugs, `company-${orgs.length}`)
    const resolved: ResolvedOrg = { slug, nodeId: orgNodeId(slug), org, people: [], writers: [] }
    for (const f of org.founders) {
      const p = person(f.name, slug)
      p.founded.push({ orgSlug: slug, role: f.role, bio: f.bio ?? null })
      if (!p.team && !p.role) {
        p.role = f.role
        p.bio = f.bio ?? null
      }
      p.location ??= f.location ?? org.hq ?? null
      resolved.people.push(p)
    }
    orgs.push(resolved)
  }

  const people = [...byKey.values()]
  const personByName = new Map(people.map((p) => [nameKey(p.name), p]))
  const orgBySlug = new Map(orgs.map((o) => [o.slug, o]))
  const orgByName = new Map(orgs.map((o) => [o.org.name.trim().toLowerCase(), o]))

  // Who wrote what: a post's credits are names, matched to the team. A credit
  // to someone who has since left (Mason Yates, Melia Rayner) stays on the
  // post and draws no edge.
  for (const o of orgs) {
    const writers = new Set<ResolvedPerson>()
    for (const story of o.org.notes ?? []) {
      for (const by of story.by) {
        const p = personByName.get(nameKey(by))
        if (!p?.team) continue
        p.wrote.push({ orgSlug: o.slug, story })
        writers.add(p)
      }
    }
    o.writers = [...writers]
  }

  const orgsBySector = new Map<Sector, ResolvedOrg[]>()
  for (const o of orgs) {
    const list = orgsBySector.get(o.org.sector)
    if (list) list.push(o)
    else orgsBySector.set(o.org.sector, [o])
  }
  const sectorsPresent = SECTORS.filter((s) => orgsBySector.has(s))

  cached = {
    orgs,
    orgBySlug,
    orgByName,
    people,
    personByName,
    team: people.filter((p) => p.team),
    founders: people.filter((p) => p.founded.length > 0),
    orgsBySector,
    sectorsPresent,
  }
  return cached
}

/** Look a person up by display name — the join events and deals use. */
export function personNamed(name: string): ResolvedPerson {
  const p = buildModel().personByName.get(nameKey(name))
  if (!p) throw new Error(`seed: no person named "${name}"`)
  return p
}

/** The alias chip a company wears, by where it stands. */
export function orgAlias(org: SeedCompany): string {
  switch (org.status) {
    case 'Active':
      return 'Portfolio'
    case 'Acquired':
    case 'IPO':
      return 'Exited'
    case 'Closed':
      return 'Closed'
  }
}

/** The alias chip a person wears: the team, or a founder in the portfolio. */
export function personAlias(person: ResolvedPerson): string {
  return person.team ? 'Team' : 'Founder'
}

/** Where a company's Blackbird page lives. */
export const blackbirdPage = (org: SeedCompany) => `https://www.blackbird.vc/portfolio/${org.bbSlug}`
/** Where a team member's Blackbird page lives. */
export const teamPage = (member: SeedTeamMember) => `https://www.blackbird.vc/team/${member.bbSlug}`
