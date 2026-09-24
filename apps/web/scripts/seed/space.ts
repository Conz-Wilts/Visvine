/**
 * The local-dev demo space, in one place.
 *
 * Every seed step (scripts/seed/steps) reads the space's identity from here, so the
 * demo space is named ONCE.
 *
 * The space is **Blackbird Ventures**: the Australian and New Zealand venture
 * firm, seeded from its own public site (blackbird.vc) — the portfolio page and
 * each company's page, the team page and each person's page, the published fund
 * table and the programmes it runs — researched company by company in
 * September 2026 (./portfolio.ts, ./dataset.ts).
 *
 * What is public is recorded as published. What a firm keeps to itself — its
 * dealflow, its committee's minutes, its channels — is not public, so the seed
 * does not pretend to know it: live deals are CODENAMES (`Project Kea`), and
 * the chatter in channels is about things Blackbird has already said in
 * public. No email address is real: people carry `@<org>.example.com`
 * addresses (RFC 2606), because the fixture is dumped and passed between
 * machines (`pnpm db:publish` / `pnpm db:restore`).
 *
 * The id is what lib/spaces/provision.ts derives from the name —
 * `blackbird-ventures` — and the seed asserts the two agree rather than
 * inventing an id no real space could have.
 */

import { color, palette } from '@visvine/tokens'
import { ADMIN_ALIAS, ADMIN_ALIAS_ID, ADMIN_ALIAS_NAME } from '../../lib/types/context'

export const SPACE_ID = 'blackbird-ventures'
export const SPACE_NAME = 'Blackbird Ventures'
export const SPACE_DESCRIPTION =
  'Backing Australia and New Zealand’s most ambitious founders, right from the very beginning. ' +
  'The portfolio, the founders behind it, the team, the funds and the programmes.'
export const SPACE_LOCATION = 'Sydney, Australia'
export const SPACE_TAGS = ['Venture Capital', 'Startups', 'Australia', 'New Zealand']
export const SPACE_TIMEZONE = 'Australia/Sydney'

/** Access levels, mirrored from lib/notes/shared/authz.ts (the seed stays dep-free). */
export const VIEW = 10
export const EDIT = 30

// ---- anchors ----------------------------------------------------------------

export interface Anchor {
  id: string
  name: string
  email: string
  /** Aliases this anchor holds, by alias name. */
  aliases: string[]
  personNodeId: string
  /** The profile on their `users` row — what /api/profile serves for them. */
  profile: {
    subtitle: string
    bio: string
    location: string
    website: string
    phone: string
    pronouns: string
    /** How long ago they joined, which is what the Experience entry dates from. */
    joinedDaysAgo: number
  }
}

export const ADMIN_USER = 'user_dev_admin'
export const MEMBER_USER = 'user_dev_member'
// The member nodes a join mints (lib/spaces/memberNode.ts): `person:` + the
// slug of the member's name. Named here because events host and invite them.
export const ADMIN_NODE = 'person:dev-admin'
export const MEMBER_NODE = 'person:dev-member'

/**
 * The two sign-in accounts. They are not Blackbird people — the real team is
 * in ./dataset.ts as directory records — but the two seats a developer sits in:
 * someone on the platform team who administers the space, and a founder in the
 * community who reads what founders are given.
 */
export const ANCHORS: Anchor[] = [
  {
    id: ADMIN_USER,
    name: 'Dev Admin',
    email: 'admin@local.dev',
    aliases: [ADMIN_ALIAS_NAME, 'Team'],
    personNodeId: ADMIN_NODE,
    profile: {
      subtitle: 'Platform, Blackbird Ventures',
      bio:
        'Administers the Blackbird space: the portfolio records, the programmes and the tools the team runs on.\n\n'
        + 'A development account — sign in as it to see the space as an admin does.',
      location: 'Sydney, Australia',
      website: 'https://example.com/dev-admin',
      phone: '+61 2 5550 0101',
      pronouns: 'they/them',
      joinedDaysAgo: 540,
    },
  },
  {
    id: MEMBER_USER,
    name: 'Dev Member',
    email: 'member@local.dev',
    aliases: ['Founder'],
    personNodeId: MEMBER_NODE,
    profile: {
      subtitle: 'Founder, Blackbird community',
      bio:
        'A founder in the Blackbird community — through Giants first, then the portfolio.\n\n'
        + 'A development account — sign in as it to see what a founder is given.',
      location: 'Auckland, New Zealand',
      website: 'https://example.com/dev-member',
      phone: '+64 21 555 0102',
      pronouns: 'they/them',
      joinedDaysAgo: 150,
    },
  },
]

// ---- node types -------------------------------------------------------------

/**
 * The node types this space uses. Written explicitly because the schema default
 * omits most of them, and because this list is what the console's Types page
 * shows: a type a note claims but the console never created is a type nothing
 * can filter, colour or alias. Add a type here whenever a new one is written
 * into note frontmatter by a seed layer.
 */
export const NODE_TYPES = [
  { name: 'Person', color: color.type.person.default, shape: 'rectangle' },
  { name: 'Space', color: color.type.space.default, shape: 'square' },
  // A portfolio company is a RECORD here, not a tenant of this space: it has a
  // directory card and a context note (spaces/<slug>/index.md, the org
  // namespace — see lib/notes/entities.ts). `company` folds onto `space` in
  // TYPE_SYNONYMS so the entity machinery is unchanged; declaring the type here
  // is what makes this spelling win in findNodeTypeConfig and paints it its
  // own colour.
  { name: 'Company', color: palette.cyan[600], shape: 'square' },
  { name: 'Event', color: color.type.event.default, shape: 'rectangle' },
  { name: 'Resource', color: color.type.resource.default, shape: 'circle' },
  { name: 'Note', color: palette.violet[500], shape: 'rectangle' },
  // Blackbird's own cut of the portfolio — the Category on every company page.
  { name: 'Sector', color: palette.orange[500], shape: 'rectangle' },
  { name: 'Journal', color: palette.pink[500], shape: 'rectangle' },
  { name: 'Meeting', color: palette.teal[500], shape: 'rectangle' },
  // Structural/document built-ins the demo layers create nodes for (channels,
  // sections, connectors, agents). Because this list is explicit, omitting one
  // hides it from the console's Types page even though DEFAULT_NODE_TYPES knows
  // it — so every kind a seed script writes is declared. Built-in types take
  // the design tokens' type palette, as DEFAULT_NODE_TYPES does. `Tool` stays out on purpose: it is
  // a RESERVED machine type (lib/types/nodeTypeRegistry.ts) the console must
  // never offer to a note picker.
  { name: 'Section', color: color.type.section.default, shape: 'square' },
  { name: 'Channel', color: color.type.channel.default, shape: 'rectangle' },
  { name: 'Connector', color: color.type.connector.default, shape: 'rectangle' },
  { name: 'Agent', color: color.type.agent.default, shape: 'rectangle' },
  // Note-only vocabulary: `type: Deal` on a dealflow note, `type: Fund` on a
  // vintage, `type: Program` on a programme. Scoped to notes, the way the
  // draft-context surface would have created them.
  { name: 'Deal', color: palette.amber[700], shape: 'rectangle', scope: 'note' },
  { name: 'Fund', color: palette.violet[600], shape: 'rectangle', scope: 'note' },
  { name: 'Program', color: palette.green[600], shape: 'rectangle', scope: 'note' },
]

// ---- aliases ----------------------------------------------------------------

/**
 * A seeded alias's stable id. Derived from the name so re-seeding is
 * reproducible — everywhere else ids are random, but a seed that produced a
 * different id each run would make holder and grant rows unfixable by hand.
 * The built-in Admin keeps its reserved id.
 */
export function seedAliasId(name: string): string {
  return name === ADMIN_ALIAS_NAME ? ADMIN_ALIAS_ID : `al_seed_${name.toLowerCase().replace(/\W+/g, '-')}`
}

export interface SeedAlias {
  name: string
  /** Chip colour in the directory — the same alias, seen from the graph. */
  color: string
  /** The base node type this alias labels. Only Person aliases grant access. */
  nodeType: 'Person' | 'Space' | 'Company'
  admin: boolean
  system: boolean
  /** [resourcePath, level] — '' is the context root. */
  grants: Array<[string, number]>
}

/**
 * The space's aliases, stored in `Space.aliases` exactly as the console writes
 * them. The Person ones are the permission vocabulary; the Company ones are
 * directory labels with no access meaning.
 *
 * Spread across the permission model so every shape of grant is represented:
 *
 *   Admin      system, is admin of the space — built in, cannot be changed
 *   Team       edit on the working set — spaces/, dealflow/, funds/, team/
 *   Founder    view on spaces/ and sectors/ — the portfolio, read by its own
 *   Mentor     view on sectors/ — a Giants or Foundry mentor
 *   LP         view on ONE note, the published fund table — the tightest grant
 *   Everyone   view on sectors/ (the space-wide grant)
 */
export const ALIASES: SeedAlias[] = [
  {
    // Admins manage the space outright; no grant needed to see everything.
    name: ADMIN_ALIAS_NAME,
    color: ADMIN_ALIAS.color,
    nodeType: 'Person',
    admin: true,
    system: true,
    grants: [],
  },
  {
    name: 'Team',
    color: palette.violet[600],
    nodeType: 'Person',
    admin: false,
    system: false,
    grants: [['spaces', EDIT], ['dealflow', EDIT], ['funds', EDIT], ['team', EDIT]],
  },
  {
    name: 'Founder',
    color: palette.green[600],
    nodeType: 'Person',
    admin: false,
    system: false,
    grants: [['spaces', VIEW], ['sectors', VIEW]],
  },
  {
    name: 'Mentor',
    color: palette.sky[500],
    nodeType: 'Person',
    admin: false,
    system: false,
    grants: [['sectors', VIEW]],
  },
  {
    name: 'LP',
    color: palette.amber[600],
    nodeType: 'Person',
    admin: false,
    system: false,
    grants: [['funds/performance.md', VIEW]],
  },
  { name: 'Portfolio', color: palette.cyan[600], nodeType: 'Company', admin: false, system: false, grants: [] },
  { name: 'Exited', color: palette.indigo[500], nodeType: 'Company', admin: false, system: false, grants: [] },
  { name: 'Closed', color: palette.amber[500], nodeType: 'Company', admin: false, system: false, grants: [] },
]

/** What every member reaches without holding anything — the "Everyone" card. */
export const SPACE_GRANTS: Array<[string, number]> = [['sectors', VIEW]]

// ---- sectors ----------------------------------------------------------------

/**
 * The Category every company page on blackbird.vc carries. Order is canonical —
 * indexes render in it. Blackbird says it invests in founders, not sectors, and
 * the categories are only ever a way to browse.
 */
export const SECTORS = ['Enterprise', 'Consumer', 'Deep Tech', 'Healthcare', 'Hardware', 'Education'] as const

export type Sector = (typeof SECTORS)[number]

export const SECTOR_BLURB: Record<Sector, string> = {
  Enterprise: 'Software businesses buy: AI for functional teams, developer tools, security, fintech infrastructure.',
  Consumer: 'Products people choose for themselves: design, food, money, sport, community.',
  'Deep Tech': 'Science-led companies: space, quantum, energy, lidar, biological compute.',
  Healthcare: 'Clinicians, patients and care: AI scribes, radiology, neurotech, mental health.',
  Hardware: 'Things that are built and shipped: robots, chips, sensors, aircraft.',
  Education: 'How people learn a craft or a career, from classrooms to cloud engineering.',
}

// ---- helpers ----------------------------------------------------------------

/** Stable slug. Mirrors the slugify every other seed layer uses. */
export function slugify(value: string): string {
  if (!value) return ''
  return String(value)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .toLowerCase()
}

/** A company's node id. Its entity note is spaces/<slug>/index.md. */
export const orgNodeId = (slug: string) => `company:${slug}`
/** A person's node id. Their entity note is people/<slug>/index.md. */
export const personNodeId = (slug: string) => `person:${slug}`
