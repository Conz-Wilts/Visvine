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
export const SPACE_COUNTRY = 'NZ'
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
  { name: 'Resource', color: '#0d9488', shape: 'circle' },
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
  { name: 'Channel', color: '#e0685f', shape: 'rectangle' },
  { name: 'Connector', color: '#6366f1', shape: 'rectangle' },
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
export const SPACE_GRANTS: Array<[string, number]> = [['segments', VIEW]]

// ---- sub-spaces -------------------------------------------------------------

/**
 * Three sub-spaces (docs/sub-spaces.md), one per listing, so every dial is on
 * screen from the first seed: Design Partners is a Programme the world can see,
 * whose context, events and PEOPLE flow up; Leadership is a Council the house's
 * members see the door of and ask through, keeping its notes to itself; and
 * Compensation is a Committee — secret, named nowhere outside its own members.
 * All three are provisioned the way the New sub-space dialog does it, so `id`
 * is what provisionSpace derives from the name (the seed asserts it). Dev Admin
 * administers all three (they created them); Dev Member is in the Programme,
 * and waiting at the Council's door, so signing in as them shows exactly what a
 * parent's member sees: a room they are in, a room they have asked to join, and
 * no sign at all that the third one exists.
 */
export interface SeedSubspace {
  /** What provisionSpace derives from the name — asserted, never trusted. */
  id: string
  name: string
  description: string
  /** The preset whose dials it starts from (lib/spaces/subspaces.ts#PRESETS). */
  preset: string
  flowContext?: boolean
  flowEvents?: boolean
  flowPeople?: boolean
  parentAdmins?: boolean
  /**
   * People who belong to the ROOM and not to the house — directory records of
   * its own, which is what a room's `flowPeople` dial actually carries upward.
   * Written as nodes first, then as the notes that name them.
   */
  people?: ReadonlyArray<{ slug: string; name: string; role: string; org: string; location: string }>
  /** Active members. The creator (Dev Admin) is one by provisioning. */
  members: readonly string[]
  /** People waiting at an `ask` door. */
  pending?: readonly string[]
  notes: ReadonlyArray<{ path: string; content: string }>
}

export const SUBSPACES: readonly SeedSubspace[] = [
  {
    id: 'design-partners',
    name: 'Design Partners',
    description: 'The spaces shaping the product with us: office hours, feedback and what shipped because of it.',
    // A Programme: listed to everyone, the house's members walk in, strangers ask.
    preset: 'programme',
    // ...and the partners themselves are people the house should see, so this
    // room's directory flows up as read-only `via_space` rows.
    flowPeople: true,
    people: [
      { slug: 'marama-whitiora', name: 'Marama Whitiora', role: 'Head of Programmes', org: 'Southerly Accelerator', location: 'Ōtautahi Christchurch' },
      { slug: 'tomas-reiter', name: 'Tomás Reiter', role: 'Operations Lead', org: 'Quarterdeck Partners', location: 'Tāmaki Makaurau Auckland' },
    ],
    members: [ADMIN_USER, MEMBER_USER],
    notes: [
      {
        path: 'playbooks/office-hours.md',
        content:
          '---\ntype: Note\ntitle: Office hours\ntags: [design-partners, playbook]\n---\n\nEvery Thursday, 45 minutes, no agenda slides. A partner brings one thing that is\nawkward in their space and we watch them do it. See the [feedback loop](feedback-loop.md)\nfor what happens to what we learn.\n',
      },
      {
        path: 'playbooks/feedback-loop.md',
        content:
          '---\ntype: Note\ntitle: The feedback loop\ntags: [design-partners, playbook]\n---\n\nEvery piece of feedback lands as a note in this space, gets a decision or a\n"not now", and the partner hears which one it was. Silence is the one outcome\nthat loses a design partner. Booked through [office hours](office-hours.md).\n',
      },
      // The room's own people, as their records' notes.
      {
        path: 'people/marama-whitiora/index.md',
        content:
          '---\ntype: Person\ntitle: Marama Whitiora\ndescription: Head of Programmes, Southerly Accelerator\nnode: person:marama-whitiora\ntags: [person, design-partner]\n---\n\nRuns the Thursday session for Southerly, and brings a real cohort problem every\ntime — which is why the [feedback loop](../../playbooks/feedback-loop.md) has\nher name on half its entries.\n',
      },
      {
        path: 'people/tomas-reiter/index.md',
        content:
          '---\ntype: Person\ntitle: Tomás Reiter\ndescription: Operations Lead, Quarterdeck Partners\nnode: person:tomas-reiter\ntags: [person, design-partner]\n---\n\nThe first partner to load a member list big enough to hurt. Everything about\nthe table view that is fast is fast because of what he reported.\n',
      },
    ],
  },
  {
    id: 'leadership',
    name: 'Leadership',
    description: 'Board packs, hiring plans and the numbers behind them. Private to the leadership group.',
    // A Council with its notes kept to itself: the house's members see the
    // door and ask; nothing of its context flows up, its events do.
    preset: 'council',
    flowContext: false,
    members: [ADMIN_USER],
    // Dev Member pressed Join on a door set to `ask` — Members → Wants to join.
    pending: [MEMBER_USER],
    notes: [
      {
        path: 'board/2026-q3.md',
        content:
          '---\ntype: Note\ntitle: Q3 2026 board pack\ntags: [board, leadership]\n---\n\nThree things the board asked for: net revenue retention by segment, the hiring\nplan against runway, and a straight answer on the enterprise pipeline. Not for\nthe wider team.\n',
      },
    ],
  },
  {
    id: 'compensation',
    name: 'Compensation',
    description: 'Bands, offers and the review cycle. A secret room: it is named nowhere outside itself.',
    // A Committee: listing `secret`, so the switcher, the tree and the console
    // say nothing about it to anyone who is not in it.
    preset: 'committee',
    members: [ADMIN_USER],
    notes: [
      {
        path: 'bands/2026-review.md',
        content:
          '---\ntype: Note\ntitle: 2026 review cycle\ntags: [compensation]\n---\n\nBands re-cut in March, offers benchmarked against them since. Nothing here\nflows anywhere: a secret room keeps its context, its events and its people.\n',
      },
    ],
  },
]

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
