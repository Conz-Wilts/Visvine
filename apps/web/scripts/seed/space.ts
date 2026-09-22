/**
 * The local-dev demo space, in one place.
 *
 * Every seed step (scripts/seed/steps) reads the space's identity from here, so the
 * demo space is named ONCE. The layers used to spell
 * `space:blackbird-ventures` into six files, which is why swapping the
 * demo content meant editing all six.
 *
 * The space is **Visvine HQ**: Visvine's own working space, dogfooding the
 * product — the team, the spaces that run on Visvine (customers, design
 * partners, prospects), the investors and partners around them, and the
 * product's own roadmap and decisions.
 *
 * Note the id: the bare `visvine` id is RESERVED for the platform's global
 * public-record space (lib/spaces/globalSpace.ts), which is a different thing
 * with different access rules. This is a normal tenant that happens to be us,
 * so it is created the way every tenant is (lib/spaces/provision.ts), which
 * derives its id from its name — `visvine-hq` — and the seed asserts the two
 * agree rather than inventing an id no real space could have.
 *
 * Everyone in this space is INVENTED. The fixture gets dumped and passed
 * between machines (`pnpm db:publish` / `pnpm db:restore`), so it must not
 * carry real people's details or a real organisation's data — the names,
 * emails (`@example.com`, RFC 2606) and domains (`*.example.com`) are all
 * reserved-for-documentation placeholders.
 */

import { ADMIN_ALIAS, ADMIN_ALIAS_ID, ADMIN_ALIAS_NAME } from '../../lib/types/context'

export const SPACE_ID = 'visvine-hq'
export const SPACE_NAME = 'Visvine HQ'
export const SPACE_DESCRIPTION =
  'Visvine building Visvine. The spaces that run on us, the people who run them, ' +
  'and the product decisions behind it all.'
export const SPACE_LOCATION = 'Auckland, New Zealand'
export const SPACE_TAGS = ['Product', 'Community', 'SaaS', 'New Zealand']
export const SPACE_TIMEZONE = 'Pacific/Auckland'

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

export const ANCHORS: Anchor[] = [
  {
    id: ADMIN_USER,
    name: 'Dev Admin',
    email: 'admin@local.dev',
    aliases: [ADMIN_ALIAS_NAME, 'Team'],
    personNodeId: ADMIN_NODE,
    profile: {
      subtitle: 'Head of Community, Visvine',
      bio:
        'Runs the Visvine HQ space: onboarding new spaces, keeping the directory honest and turning what customers '
        + 'tell us into the next thing we build.\n\n'
        + 'Before Visvine, spent six years running founder programmes and investor networks across Aotearoa, which is '
        + "mostly where the conviction came from that a community's memory should outlive the people who keep it.",
      location: 'Auckland, New Zealand',
      website: 'https://example.com/dev-admin',
      phone: '+64 21 555 0101',
      pronouns: 'they/them',
      joinedDaysAgo: 540,
    },
  },
  {
    id: MEMBER_USER,
    name: 'Dev Member',
    email: 'member@local.dev',
    aliases: ['Champion'],
    personNodeId: MEMBER_NODE,
    profile: {
      subtitle: 'Programme Manager, Harbourside Innovation Hub',
      bio:
        'Looks after a cohort of early-stage founders and the mentors, investors and partners around them. '
        + 'Uses Visvine to keep track of who knows whom, what each founder needs next and which intros actually landed.\n\n'
        + 'Happiest when a warm intro turns into a pilot.',
      location: 'Wellington, New Zealand',
      website: 'https://example.com/dev-member',
      phone: '+64 21 555 0102',
      pronouns: 'she/her',
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
  { name: 'Person', color: '#2563eb', shape: 'rectangle' },
  { name: 'Space', color: '#78d870', shape: 'square' },
  // An organisation that runs on Visvine is a RECORD here, not a tenant of
  // this space: it has a directory card and a context note
  // (spaces/<slug>/index.md, the org namespace — see lib/notes/entities.ts)
  // but its own Visvine space, if it has one, is its own tenant. `company`
  // folds onto `space` in TYPE_SYNONYMS so the entity machinery is unchanged;
  // declaring the type here is what makes this spelling win in
  // findNodeTypeConfig and paints it its own colour.
  { name: 'Company', color: '#0891b2', shape: 'square' },
  { name: 'Event', color: '#ef4444', shape: 'rectangle' },
  { name: 'Resource', color: '#f97316', shape: 'circle' },
  { name: 'Note', color: '#8b5cf6', shape: 'rectangle' },
  // The segment vocabulary — how we cut the customer base. (Blackbird's space
  // called the same shape a Sector.)
  { name: 'Segment', color: '#f97316', shape: 'rectangle' },
  { name: 'Journal', color: '#ec4899', shape: 'rectangle' },
  { name: 'Meeting', color: '#14b8a6', shape: 'rectangle' },
  // Structural/document built-ins the demo layers create nodes for (channels,
  // sections, connectors, agents). Because this list is explicit, omitting one
  // hides it from the console's Types page even though DEFAULT_NODE_TYPES knows
  // it — so every kind a seed script writes is declared. Colours match
  // lib/types/context.ts DEFAULT_NODE_TYPES. `Tool` stays out on purpose: it is
  // a RESERVED machine type (lib/types/nodeTypeRegistry.ts) the console must
  // never offer to a note picker.
  { name: 'Section', color: '#0ea5e9', shape: 'square' },
  { name: 'Channel', color: '#ec4899', shape: 'rectangle' },
  { name: 'Connector', color: '#4f46e5', shape: 'rectangle' },
  { name: 'Agent', color: '#0d9488', shape: 'rectangle' },
  // Note-only vocabulary: `type: Deal` on a pipeline note, `type: Decision` on
  // a product decision. Scoped to notes, the way the draft-context surface
  // would have created them.
  { name: 'Deal', color: '#b45309', shape: 'rectangle', scope: 'note' },
  { name: 'Decision', color: '#7c3aed', shape: 'rectangle', scope: 'note' },
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
 *   Team       edit on the working set — spaces/, deals/, data/, product/
 *   Champion   view on spaces/ and product/ — a customer's own operator
 *   Advisor    view on spaces/ and segments/
 *   Board      view on ONE note — the tightest grant there is
 *   Everyone   view on segments/ (the space-wide grant)
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
    color: '#7c3aed',
    nodeType: 'Person',
    admin: false,
    system: false,
    grants: [['spaces', EDIT], ['deals', EDIT], ['data', EDIT], ['product', EDIT]],
  },
  {
    name: 'Champion',
    color: '#16a34a',
    nodeType: 'Person',
    admin: false,
    system: false,
    grants: [['spaces', VIEW], ['product', VIEW]],
  },
  {
    name: 'Advisor',
    color: '#0ea5e9',
    nodeType: 'Person',
    admin: false,
    system: false,
    grants: [['spaces', VIEW], ['segments', VIEW]],
  },
  {
    name: 'Board',
    color: '#d97706',
    nodeType: 'Person',
    admin: false,
    system: false,
    grants: [['data/revenue-roll-up.md', VIEW]],
  },
  { name: 'Customer', color: '#0891b2', nodeType: 'Company', admin: false, system: false, grants: [] },
  { name: 'Design Partner', color: '#0d9488', nodeType: 'Company', admin: false, system: false, grants: [] },
  { name: 'Prospect', color: '#f59e0b', nodeType: 'Company', admin: false, system: false, grants: [] },
  { name: 'Investor', color: '#db2777', nodeType: 'Company', admin: false, system: false, grants: [] },
  { name: 'Partner', color: '#6366f1', nodeType: 'Company', admin: false, system: false, grants: [] },
]

/** What every member reaches without holding anything — the "Everyone" card. */
// `agents/phone` is readable by every member because a text to the space's
// line runs it AS the texter, who must be able to read the brief that runs
// (docs/imessage.md). Console → iMessage writes the same grant when it makes one.
export const SPACE_GRANTS: Array<[string, number]> = [['segments', VIEW], ['agents/phone', VIEW]]

// ---- segments ---------------------------------------------------------------

/** How we cut the customer base. Order is canonical — indexes render in it. */
export const SEGMENTS = [
  'Accelerators & Incubators',
  'Venture Capital',
  'Universities & Research',
  'Coworking & Campuses',
  'Industry Bodies',
  'Nonprofits & Foundations',
  'Corporate Innovation',
  'Economic Development',
] as const

export type Segment = (typeof SEGMENTS)[number]

export const SEGMENT_BLURB: Record<Segment, string> = {
  'Accelerators & Incubators': 'Cohort programmes: founders, mentors, demo days and the alumni who keep coming back.',
  'Venture Capital': 'Funds running their portfolio, their founders and their LP reporting in one place.',
  'Universities & Research': 'Research offices, student enterprise and the spinouts between them.',
  'Coworking & Campuses': 'Buildings full of members, where the directory is the product.',
  'Industry Bodies': 'Sector associations and chambers: members, working groups and submissions.',
  'Nonprofits & Foundations': 'Grantees, volunteers and programmes, tracked without a CRM licence per seat.',
  'Corporate Innovation': 'Internal venture teams mapping startups, pilots and the people running them.',
  'Economic Development': 'Regional agencies mapping the ecosystem they are paid to grow.',
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

/** An organisation's node id. Its entity note is spaces/<slug>/index.md. */
export const orgNodeId = (slug: string) => `company:${slug}`
/** A person's node id. Their entity note is people/<slug>/index.md. */
export const personNodeId = (slug: string) => `person:${slug}`
