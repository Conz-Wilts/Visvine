/**
 * The Visvine HQ demo dataset.
 *
 * Hand-written, not researched: every organisation and every person here is
 * INVENTED, because this fixture is dumped and shared between machines
 * (`pnpm db:publish` / `pnpm db:restore`). Emails are `@example.com` and
 * domains `*.example.com` — both reserved for documentation by RFC 2606, so
 * nothing here can resolve to, or be mistaken for, a real organisation.
 *
 * The shape is deliberately close to what a real Visvine customer space holds,
 * because the seed's job is to make every surface in the app non-empty:
 * organisations and their people fill the directory and the graph, the
 * relationship field drives the pipeline and revenue notes, and the events,
 * channels and files fill the tools beside them.
 *
 * Adding to it: append to `ORGS` (the generators derive slugs, notes, links and
 * indexes) — nothing else needs to change. Keep `relationship` and `segment`
 * honest, since the roll-ups count them.
 */

import type { Segment } from './space'

// ---- people -----------------------------------------------------------------

export interface SeedPerson {
  name: string
  role: string
  /** One line, first person plural voice avoided — this reads as a record. */
  bio?: string
  location?: string
}

// ---- organisations ----------------------------------------------------------

/**
 * What this organisation is to us. Drives the alias chip, the directory tags,
 * the pipeline note and the revenue roll-up.
 *
 *   customer        — paying, live in their own space
 *   design-partner  — shaping the product, not yet paying
 *   prospect        — in the pipeline
 *   investor        — on our cap table
 *   partner         — implements or resells Visvine
 */
export type Relationship = 'customer' | 'design-partner' | 'prospect' | 'investor' | 'partner'

export type Plan = 'Starter' | 'Team' | 'Growth' | 'Enterprise'
export type Health = 'green' | 'amber' | 'red'
export type DealStage = 'Discovery' | 'Trial' | 'Proposal' | 'Contract'

export interface SeedOrg {
  name: string
  relationship: Relationship
  segment: Segment
  subtitle: string
  description: string
  location: string
  country: string
  /** Year the relationship started. */
  since?: number
  // customers + design partners
  plan?: Plan
  seats?: number
  /** Monthly recurring revenue, NZD. Design partners are deliberately 0. */
  mrr?: number
  health?: Health
  /** What their members do in their space — the reason they stay. */
  useCase?: string
  // prospects
  stage?: DealStage
  nextStep?: string
  /** Deal size we expect, NZD/month. */
  expectedMrr?: number
  // investors
  round?: string
  /** Cheque into Visvine, NZD. */
  cheque?: number
  people: SeedPerson[]
}

export const ORGS: SeedOrg[] = [
  // ---- Accelerators & Incubators -------------------------------------------
  {
    name: 'Kowhai Labs',
    relationship: 'customer',
    segment: 'Accelerators & Incubators',
    subtitle: 'Pre-seed accelerator, three cohorts a year',
    description:
      'A pre-seed programme taking twelve teams per cohort. Their space is the cohort itself: founders, the mentors assigned to them, and every session note from the twelve weeks. Alumni keep their logins, which is why their directory is four cohorts deep and still growing.',
    location: 'Auckland, New Zealand',
    country: 'NZ',
    since: 2024,
    plan: 'Growth',
    seats: 64,
    mrr: 1280,
    health: 'green',
    useCase: 'Cohort directory, mentor matching, demo-day guest lists.',
    people: [
      { name: 'Amiria Nikora', role: 'Programme Director', bio: 'Runs the cohort end to end and was the first person outside the team to ask for sub-spaces.' },
      { name: 'Jonas Petrie', role: 'Mentor Lead', bio: 'Keeps the mentor bench honest — who actually showed up, and for whom.' },
    ],
  },
  {
    name: 'Southerly Accelerator',
    relationship: 'customer',
    segment: 'Accelerators & Incubators',
    subtitle: 'Hardware-leaning accelerator in the South Island',
    description:
      'Hardware and agritech teams, most of them spun out of the university down the road. They live in the graph view more than any other customer: their cohorts overlap with the research institutes, and the links are the point.',
    location: 'Christchurch, New Zealand',
    country: 'NZ',
    since: 2025,
    plan: 'Team',
    seats: 28,
    mrr: 560,
    health: 'green',
    useCase: 'Ecosystem graph, cohort notes, alumni tracking.',
    people: [{ name: 'Rewa Tiakina', role: 'Head of Programmes', bio: 'Asked for the graph to dim on tag, which is now how everyone uses it.' }],
  },
  {
    name: 'Tidewater Studio',
    relationship: 'design-partner',
    segment: 'Accelerators & Incubators',
    subtitle: 'Venture studio building two companies a year',
    description:
      'A studio rather than a programme: they start the companies themselves. Small, opinionated, and the loudest voice in office hours — most of the notes-tree behaviour shipped because Tidewater found it irritating first.',
    location: 'Wellington, New Zealand',
    country: 'NZ',
    since: 2025,
    plan: 'Team',
    seats: 9,
    mrr: 0,
    health: 'green',
    useCase: 'Company-building notes, shared context across ventures.',
    people: [
      { name: 'Felix Amadi', role: 'Studio Partner', bio: 'Design partner number one. Reads every release note and replies to most of them.' },
    ],
  },
  {
    name: 'Fernmark Founders',
    relationship: 'customer',
    segment: 'Accelerators & Incubators',
    subtitle: 'Founder community with a paid membership',
    description:
      'Less a programme than a membership: 300 founders paying annually for the room. Their problem was never the directory, it was working out who had gone quiet — which is what drove the lifecycle work in retrieval.',
    location: 'Hamilton, New Zealand',
    country: 'NZ',
    since: 2024,
    plan: 'Growth',
    seats: 41,
    mrr: 1120,
    health: 'amber',
    useCase: 'Member directory, channels, event RSVPs.',
    people: [
      { name: 'Talia Brandt', role: 'Community Manager', bio: 'The archetype we design the channels surface for.' },
      { name: 'Sione Faletau', role: 'Events Lead' },
    ],
  },
  {
    name: 'Longshore Ventures Lab',
    relationship: 'customer',
    segment: 'Accelerators & Incubators',
    subtitle: 'Corporate-backed accelerator, two programmes',
    description:
      'Backed by a freight group, which shows: their cohort selection is driven by whoever can pilot inside the parent company. They run two spaces, one per programme, and were the reason sub-space context flows up read-only.',
    location: 'Sydney, Australia',
    country: 'AU',
    since: 2025,
    plan: 'Enterprise',
    seats: 88,
    mrr: 2640,
    health: 'green',
    useCase: 'Two programmes as sub-spaces, pilot tracking, corporate reporting.',
    people: [
      { name: 'Priya Chandran', role: 'Director of Innovation' },
      { name: 'Will Oduya', role: 'Programme Manager', bio: 'Files better session notes than we do.' },
    ],
  },
  {
    name: 'Brightwater Incubator',
    relationship: 'design-partner',
    segment: 'Accelerators & Incubators',
    subtitle: 'Regional incubator, food and beverage',
    description:
      'Small regional incubator working with growers and food producers. Their members are not technical, which makes them the best test of whether a surface is actually usable — the Create panel was rebuilt after watching them.',
    location: 'Nelson, New Zealand',
    country: 'NZ',
    since: 2026,
    plan: 'Starter',
    seats: 6,
    mrr: 0,
    health: 'green',
    useCase: 'Simple directory, file library, plain-language notes.',
    people: [{ name: 'Georgia Selwyn', role: 'Incubator Manager' }],
  },
  {
    name: 'Karearea Programme',
    relationship: 'customer',
    segment: 'Accelerators & Incubators',
    subtitle: 'Maori-led enterprise programme',
    description:
      'An iwi-backed enterprise programme supporting kaupapa-driven businesses. They care about who holds what more than anyone else on the list, and their questions shaped the alias grant model.',
    location: 'Dunedin, New Zealand',
    country: 'NZ',
    since: 2025,
    plan: 'Team',
    seats: 22,
    mrr: 660,
    health: 'green',
    useCase: 'Alias-based permissions, private sub-spaces, member records.',
    people: [
      { name: 'Hana Te Kanawa', role: 'Pouwhakahaere', bio: 'Pushed hardest on private-by-default, and was right.' },
    ],
  },
  {
    name: 'Ignition Bay',
    relationship: 'prospect',
    segment: 'Accelerators & Incubators',
    subtitle: 'Coastal accelerator, marine and tourism',
    description:
      'Runs one programme a year out of a shared building, currently on spreadsheets and a mailing list. Warm inbound after a talk at an ecosystem meetup.',
    location: 'Tauranga, New Zealand',
    country: 'NZ',
    stage: 'Trial',
    nextStep: 'Trial ends the 28th — needs the cohort import done before then.',
    expectedMrr: 480,
    people: [{ name: 'Aroha Mikaere', role: 'General Manager' }],
  },
  {
    name: 'Redgum Accelerator',
    relationship: 'prospect',
    segment: 'Accelerators & Incubators',
    subtitle: 'Climate-tech accelerator',
    description:
      'Climate-tech programme with a government co-funding requirement, which means reporting is the deal. Came through a design partner introduction.',
    location: 'Melbourne, Australia',
    country: 'AU',
    stage: 'Proposal',
    nextStep: 'Proposal with the reporting appendix is out; decision at their board.',
    expectedMrr: 1400,
    people: [{ name: 'Dana Whitlock', role: 'Head of Ventures' }],
  },

  // ---- Venture Capital -----------------------------------------------------
  {
    name: 'Harbourline Capital',
    relationship: 'customer',
    segment: 'Venture Capital',
    subtitle: 'Early-stage fund, NZ and Pacific',
    description:
      'A seed fund running its portfolio, its founder community and its LP reporting from one space. The portfolio companies are records, not tenants — the distinction they had to learn, and the one that made the model click.',
    location: 'Auckland, New Zealand',
    country: 'NZ',
    since: 2024,
    plan: 'Enterprise',
    seats: 34,
    mrr: 2280,
    health: 'green',
    useCase: 'Portfolio records, founder community, LP-only note grants.',
    people: [
      { name: 'Marcus Hale', role: 'Partner', bio: 'Wanted one note only visible to LPs, which is now the tightest grant we demo.' },
      { name: 'Ines Duarte', role: 'Platform Director' },
    ],
  },
  {
    name: 'Tussock Ventures',
    relationship: 'customer',
    segment: 'Venture Capital',
    subtitle: 'Pre-seed fund writing first cheques',
    description:
      'Two partners, no analysts, several hundred inbound decks a quarter. They use the pipeline surface harder than the directory, and every scheduled-agent feature traces back to one of their asks.',
    location: 'Wellington, New Zealand',
    country: 'NZ',
    since: 2025,
    plan: 'Growth',
    seats: 11,
    mrr: 880,
    health: 'green',
    useCase: 'Dealflow pipeline, scheduled agents, inbound triage.',
    people: [{ name: 'Oliver Kestrel', role: 'General Partner', bio: 'First customer to run an agent in production against their own pipeline.' }],
  },
  {
    name: 'Overland Capital',
    relationship: 'customer',
    segment: 'Venture Capital',
    subtitle: 'Growth fund, ANZ software',
    description:
      'Later stage, bigger team, real compliance requirements. The only customer whose security review we failed the first time — the findings are in the product decisions.',
    location: 'Melbourne, Australia',
    country: 'AU',
    since: 2025,
    plan: 'Enterprise',
    seats: 52,
    mrr: 3120,
    health: 'amber',
    useCase: 'Audit trail, SSO ask, portfolio reporting.',
    people: [
      { name: 'Rachel Amberly', role: 'Operating Partner' },
      { name: 'Dmitri Sokolov', role: 'Head of IT', bio: 'Ran the security review. SSO is his line in the sand.' },
    ],
  },
  {
    name: 'Windward Collective',
    relationship: 'customer',
    segment: 'Venture Capital',
    subtitle: 'Angel syndicate, 90 members',
    description:
      'A syndicate rather than a fund: members see deals, opt in per deal, and the whole thing runs on who trusts whom. Their directory is the syndicate, and the graph is genuinely load-bearing.',
    location: 'Queenstown, New Zealand',
    country: 'NZ',
    since: 2026,
    plan: 'Team',
    seats: 19,
    mrr: 570,
    health: 'green',
    useCase: 'Member directory, per-deal channels, intro requests.',
    people: [{ name: 'Cassia Moreau', role: 'Syndicate Lead' }],
  },
  {
    name: 'Manuka Fund',
    relationship: 'design-partner',
    segment: 'Venture Capital',
    subtitle: 'Agritech-focused micro fund',
    description:
      'A one-person fund with an unusually good network in the primary sector. Design partner because they will try anything unfinished and tell you precisely how it broke.',
    location: 'Christchurch, New Zealand',
    country: 'NZ',
    since: 2025,
    plan: 'Starter',
    seats: 3,
    mrr: 0,
    health: 'green',
    useCase: 'Connectors against their own data, agent experiments.',
    people: [{ name: 'Bevan Thorne', role: 'Managing Director', bio: 'Wrote the first connector nobody on the team had to help with.' }],
  },
  {
    name: 'Quarterdeck Partners',
    relationship: 'prospect',
    segment: 'Venture Capital',
    subtitle: 'Multi-stage fund, 40 staff',
    description:
      'The biggest name in the pipeline and the slowest process. Three teams want it, procurement does not, and the decision keeps moving a quarter to the right.',
    location: 'Sydney, Australia',
    country: 'AU',
    stage: 'Proposal',
    nextStep: 'Security questionnaire returned; waiting on procurement to schedule.',
    expectedMrr: 4200,
    people: [
      { name: 'Helena Marsh', role: 'Chief Operating Officer' },
      { name: 'Tim Arundel', role: 'Investment Director', bio: 'The internal champion. Everything moves when he pushes it.' },
    ],
  },
  {
    name: 'Basalt Ventures',
    relationship: 'prospect',
    segment: 'Venture Capital',
    subtitle: 'Deep-tech seed fund',
    description:
      'Spun out of a research institute last year and still deciding what they are. Early conversations, no urgency, worth keeping warm.',
    location: 'Auckland, New Zealand',
    country: 'NZ',
    stage: 'Discovery',
    nextStep: 'Second call to scope the portfolio import. Not urgent for them.',
    expectedMrr: 700,
    people: [{ name: 'Yuki Tamura', role: 'Principal' }],
  },
  {
    name: 'Stonefruit Capital',
    relationship: 'prospect',
    segment: 'Venture Capital',
    subtitle: 'Regional fund, food and beverage',
    description:
      'A regional fund whose LPs are the growers themselves, so their reporting is unusually public. Interested specifically in published replicas.',
    location: 'Hastings, New Zealand',
    country: 'NZ',
    stage: 'Discovery',
    nextStep: 'Wants to see publishing to a public space before committing to a trial.',
    expectedMrr: 520,
    people: [{ name: 'Delia Crossan', role: 'Investment Manager' }],
  },

  // ---- Universities & Research ---------------------------------------------
  {
    name: 'Te Awa Institute of Technology',
    relationship: 'customer',
    segment: 'Universities & Research',
    subtitle: 'Polytechnic with a student enterprise arm',
    description:
      'Their enterprise arm runs like an accelerator inside an institution, which means two audiences in one space: students who churn every year, and staff who never do. Seat management matters more here than anywhere.',
    location: 'Hamilton, New Zealand',
    country: 'NZ',
    since: 2024,
    plan: 'Enterprise',
    seats: 120,
    mrr: 2400,
    health: 'green',
    useCase: 'Student cohorts, staff directory, annual roll-over.',
    people: [
      { name: 'Dr Alana Fenwick', role: 'Director, Enterprise', bio: 'Renews annually and asks for the roll-over script every January.' },
      { name: 'Rangi Tuahine', role: 'Student Enterprise Coordinator' },
    ],
  },
  {
    name: 'Coastline University Enterprise',
    relationship: 'customer',
    segment: 'Universities & Research',
    subtitle: 'Technology transfer office',
    description:
      'Commercialisation office tracking spinouts, inventors and the IP between them. The spinouts are organisations with their own spaces, which is the cleanest example of the tenant-versus-record line we have.',
    location: 'Dunedin, New Zealand',
    country: 'NZ',
    since: 2025,
    plan: 'Growth',
    seats: 38,
    mrr: 1520,
    health: 'green',
    useCase: 'Spinout records, inventor directory, IP notes.',
    people: [{ name: 'Professor Ian Holloway', role: 'Head of Commercialisation' }],
  },
  {
    name: 'Harbour City Polytechnic',
    relationship: 'customer',
    segment: 'Universities & Research',
    subtitle: 'Vocational institute, industry partnerships',
    description:
      'Their space is really a partnerships CRM: 200 employers who take their graduates, and who spoke to whom about what. They came for the directory and stayed for the notes.',
    location: 'Wellington, New Zealand',
    country: 'NZ',
    since: 2025,
    plan: 'Growth',
    seats: 44,
    mrr: 1320,
    health: 'green',
    useCase: 'Employer directory, placement tracking, notes on every conversation.',
    people: [
      { name: 'Moana Latu', role: 'Partnerships Manager' },
      { name: 'Grant Ferreira', role: 'Work Placement Lead' },
    ],
  },
  {
    name: 'Kauri Research Trust',
    relationship: 'customer',
    segment: 'Universities & Research',
    subtitle: 'Independent research trust, forestry',
    description:
      'Small trust funding forestry and conservation research. Almost everything they hold is a document, which made them the first customer to care whether the Drive actually indexed files for search.',
    location: 'Whangarei, New Zealand',
    country: 'NZ',
    since: 2026,
    plan: 'Team',
    seats: 14,
    mrr: 420,
    health: 'green',
    useCase: 'Document library, retrieval over research PDFs.',
    people: [{ name: 'Susanna Blyth', role: 'Research Director', bio: 'Found the resource indexing bug by uploading 300 PDFs on day one.' }],
  },
  {
    name: 'Ridgeline Research Park',
    relationship: 'design-partner',
    segment: 'Universities & Research',
    subtitle: 'Campus hosting 40 research-adjacent firms',
    description:
      'A landlord that behaves like a community: the tenants want to meet each other. Design partner for the Tools surface, because their whole ask was a room-booking app that reads the member directory.',
    location: 'Palmerston North, New Zealand',
    country: 'NZ',
    since: 2026,
    plan: 'Team',
    seats: 12,
    mrr: 0,
    health: 'green',
    useCase: 'Tenant directory, a custom Tool, shared events.',
    people: [{ name: 'Nikau Paterson', role: 'Park Manager', bio: 'Built their room-booking Tool themselves, with no help, which was the whole point.' }],
  },
  {
    name: 'Southern Alps Science Hub',
    relationship: 'prospect',
    segment: 'Universities & Research',
    subtitle: 'Multi-institution research collaboration',
    description:
      'Four institutions sharing a research programme and, currently, a shared drive nobody trusts. Governance is the blocker: nobody wants to own the space.',
    location: 'Christchurch, New Zealand',
    country: 'NZ',
    stage: 'Discovery',
    nextStep: 'Needs a governance answer on who administers a space four parties share.',
    expectedMrr: 900,
    people: [{ name: 'Dr Priscilla Yan', role: 'Programme Coordinator' }],
  },
  {
    name: 'Westfields Graduate School',
    relationship: 'prospect',
    segment: 'Universities & Research',
    subtitle: 'Private graduate school, alumni network',
    description:
      'Wants an alumni network that does not feel like a mailing list. Budget exists, urgency does not.',
    location: 'Sydney, Australia',
    country: 'AU',
    stage: 'Trial',
    nextStep: 'Trialling with one alumni cohort; decision after their August intake.',
    expectedMrr: 1100,
    people: [{ name: 'Beatrice Okonjo', role: 'Alumni Relations Director' }],
  },

  // ---- Coworking & Campuses ------------------------------------------------
  {
    name: 'The Sail Loft',
    relationship: 'customer',
    segment: 'Coworking & Campuses',
    subtitle: 'Waterfront coworking, 180 members',
    description:
      'A single building where the directory IS the product: members pay partly to know who else is in the room. Their churn signal is whether someone appears in the directory in their first week.',
    location: 'Auckland, New Zealand',
    country: 'NZ',
    since: 2024,
    plan: 'Growth',
    seats: 180,
    mrr: 1800,
    health: 'green',
    useCase: 'Member directory, channels, events, onboarding.',
    people: [
      { name: 'Leilani Tupou', role: 'Community Lead', bio: 'The single best source of feedback on the member-facing surfaces.' },
      { name: 'Ethan Rafferty', role: 'Operations Manager' },
    ],
  },
  {
    name: 'Foundry Lane',
    relationship: 'customer',
    segment: 'Coworking & Campuses',
    subtitle: 'Maker space and workshop',
    description:
      'Half desks, half workshop. Their members need to know who can operate what machine, which turned into the first real use of aliases as skills rather than permissions.',
    location: 'Wellington, New Zealand',
    country: 'NZ',
    since: 2025,
    plan: 'Team',
    seats: 74,
    mrr: 740,
    health: 'green',
    useCase: 'Skills as aliases, equipment notes, induction tracking.',
    people: [{ name: 'Dev Bhatia', role: 'Space Manager' }],
  },
  {
    name: 'Wharfside Works',
    relationship: 'customer',
    segment: 'Coworking & Campuses',
    subtitle: 'Regional coworking, two sites',
    description:
      'Two buildings, one membership, and a persistent argument about whether that is one space or two. They run it as one space with sections, which settled it.',
    location: 'Napier, New Zealand',
    country: 'NZ',
    since: 2025,
    plan: 'Team',
    seats: 46,
    mrr: 690,
    health: 'amber',
    useCase: 'Two sites in one space, sections, shared events.',
    people: [{ name: 'Cora Bellweather', role: 'General Manager' }],
  },
  {
    name: 'Riverbend Studios',
    relationship: 'customer',
    segment: 'Coworking & Campuses',
    subtitle: 'Creative studios, 60 members',
    description:
      'Designers, film people and a recording studio. They use the file library as a portfolio and almost never open the graph — a useful reminder that not every space wants the same surface.',
    location: 'Queenstown, New Zealand',
    country: 'NZ',
    since: 2026,
    plan: 'Starter',
    seats: 60,
    mrr: 360,
    health: 'green',
    useCase: 'File library, member profiles, channels.',
    people: [{ name: 'Marisol Vance', role: 'Studio Director' }],
  },
  {
    name: 'Third Space Co.',
    relationship: 'design-partner',
    segment: 'Coworking & Campuses',
    subtitle: 'Coworking operator, five sites',
    description:
      'An operator with five buildings who wants one account and five spaces. Design partner for multi-space administration, which is still the roughest edge in the product.',
    location: 'Christchurch, New Zealand',
    country: 'NZ',
    since: 2025,
    plan: 'Team',
    seats: 21,
    mrr: 0,
    health: 'amber',
    useCase: 'Five spaces, one admin, cross-space reporting.',
    people: [
      { name: 'Anton Reyes', role: 'Head of Community', bio: 'Patient about multi-space admin in a way we do not deserve yet.' },
    ],
  },
  {
    name: 'Common Ground Campus',
    relationship: 'prospect',
    segment: 'Coworking & Campuses',
    subtitle: 'Innovation precinct, 400 desks',
    description:
      'A precinct with an anchor tenant and a waiting list. Currently using an off-the-shelf member app they dislike but have already paid for.',
    location: 'Melbourne, Australia',
    country: 'AU',
    stage: 'Contract',
    nextStep: 'Contract out for signature; start date pinned to their renewal in November.',
    expectedMrr: 2600,
    people: [{ name: 'Harriet Zhao', role: 'Precinct Director' }],
  },
  {
    name: 'The Boatshed Collective',
    relationship: 'prospect',
    segment: 'Coworking & Campuses',
    subtitle: 'Small coworking space, 30 members',
    description:
      'Thirty members and a whiteboard. Cheapest deal in the pipeline and the fastest to close if we ever ship self-serve billing.',
    location: 'Tauranga, New Zealand',
    country: 'NZ',
    stage: 'Trial',
    nextStep: 'Blocked on self-serve billing — they will not do an invoice for this size.',
    expectedMrr: 180,
    people: [{ name: 'Jesse Kahu', role: 'Founder' }],
  },

  // ---- Industry Bodies -----------------------------------------------------
  {
    name: 'Agritech Alliance Aotearoa',
    relationship: 'customer',
    segment: 'Industry Bodies',
    subtitle: 'Sector body, 260 member organisations',
    description:
      'A sector association whose members are companies, not people — so the directory is organisations with contacts hanging off them. That distinction drove the entity-folder work.',
    location: 'Palmerston North, New Zealand',
    country: 'NZ',
    since: 2024,
    plan: 'Enterprise',
    seats: 96,
    mrr: 2880,
    health: 'green',
    useCase: 'Member organisations, working groups, submissions.',
    people: [
      { name: 'Wiremu Kahukura', role: 'Chief Executive' },
      { name: 'Freya Lindqvist', role: 'Membership Manager', bio: 'Runs the annual renewal cycle out of the space.' },
    ],
  },
  {
    name: 'Pacific Fintech Council',
    relationship: 'customer',
    segment: 'Industry Bodies',
    subtitle: 'Industry council, regulatory advocacy',
    description:
      'Small secretariat, influential membership. Their working groups are sub-spaces, and their submissions are notes with a lot of history — which is where note revisions earned their keep.',
    location: 'Auckland, New Zealand',
    country: 'NZ',
    since: 2025,
    plan: 'Growth',
    seats: 27,
    mrr: 1080,
    health: 'green',
    useCase: 'Working groups as sub-spaces, submission drafting, revisions.',
    people: [{ name: 'Imogen Whairepo', role: 'Executive Director' }],
  },
  {
    name: 'Creative Industries Chamber',
    relationship: 'customer',
    segment: 'Industry Bodies',
    subtitle: 'Chamber for the creative sector',
    description:
      'A chamber that runs on events: twelve a year, all ticketed. They were the first to push the event surface past what it could do, and most of the registration-questions work is theirs.',
    location: 'Auckland, New Zealand',
    country: 'NZ',
    since: 2025,
    plan: 'Growth',
    seats: 33,
    mrr: 990,
    health: 'green',
    useCase: 'Ticketed events, registration questions, waitlists.',
    people: [
      { name: 'Roshan Mehta', role: 'Events Director', bio: 'Wanted approval-gated registration, and got it.' },
    ],
  },
  {
    name: 'Health Innovation Network ANZ',
    relationship: 'customer',
    segment: 'Industry Bodies',
    subtitle: 'Cross-border health innovation network',
    description:
      'Clinicians, health services and startups in one network, with privacy expectations to match. The only customer who read the access model documentation before signing.',
    location: 'Sydney, Australia',
    country: 'AU',
    since: 2026,
    plan: 'Enterprise',
    seats: 61,
    mrr: 2440,
    health: 'green',
    useCase: 'Private-by-default notes, granular grants, audit trail.',
    people: [
      { name: 'Dr Nadine Aboud', role: 'Network Director' },
      { name: 'Peter Lindsay', role: 'Privacy Officer', bio: 'The reason we can answer access questions in writing.' },
    ],
  },
  {
    name: 'Clean Energy Guild',
    relationship: 'design-partner',
    segment: 'Industry Bodies',
    subtitle: 'Trade body for renewables',
    description:
      'Design partner specifically for connectors: their members report generation data monthly, and they want it pulled rather than emailed.',
    location: 'Wellington, New Zealand',
    country: 'NZ',
    since: 2026,
    plan: 'Team',
    seats: 8,
    mrr: 0,
    health: 'green',
    useCase: 'Connectors pulling member data, scheduled agents, notifications.',
    people: [{ name: 'Toby Renshaw', role: 'Data Lead' }],
  },
  {
    name: 'Southern Manufacturers Federation',
    relationship: 'prospect',
    segment: 'Industry Bodies',
    subtitle: 'Manufacturing federation, 140 members',
    description:
      'Conservative buyer with a long-serving membership and a very old database. The migration is the deal — if we cannot import their data cleanly, there is no conversation.',
    location: 'Dunedin, New Zealand',
    country: 'NZ',
    stage: 'Discovery',
    nextStep: 'Sample export received; needs a migration plan before they will trial.',
    expectedMrr: 1200,
    people: [{ name: 'Alister Crane', role: 'Membership Director' }],
  },
  {
    name: 'Marine Technology Association',
    relationship: 'prospect',
    segment: 'Industry Bodies',
    subtitle: 'Marine tech sector body',
    description:
      'Introduced by a design partner. Enthusiastic, unfunded until their next membership year.',
    location: 'Nelson, New Zealand',
    country: 'NZ',
    stage: 'Discovery',
    nextStep: 'Revisit in their new financial year. Keep on the newsletter.',
    expectedMrr: 420,
    people: [{ name: 'Kirra Donnelly', role: 'Association Manager' }],
  },

  // ---- Nonprofits & Foundations --------------------------------------------
  {
    name: 'Awhi Foundation',
    relationship: 'customer',
    segment: 'Nonprofits & Foundations',
    subtitle: 'Grant-making foundation, youth programmes',
    description:
      'Funds 60 grantees a year and needs to know what each one did with the money. Their reporting cycle is the strongest argument we have for agents: the same three questions, every quarter, to every grantee.',
    location: 'Auckland, New Zealand',
    country: 'NZ',
    since: 2025,
    plan: 'Growth',
    seats: 29,
    mrr: 870,
    health: 'green',
    useCase: 'Grantee records, reporting cycles, scheduled agents.',
    people: [
      { name: 'Miriama Rangi', role: 'Grants Director', bio: 'Her quarterly reporting nag is the canonical agent brief.' },
    ],
  },
  {
    name: 'Manaaki Collective',
    relationship: 'customer',
    segment: 'Nonprofits & Foundations',
    subtitle: 'Community services collective',
    description:
      'A collective of twelve small charities sharing back-office functions. Twelve organisations, one space, and a genuinely hard permissions problem that aliases just about solve.',
    location: 'Rotorua, New Zealand',
    country: 'NZ',
    since: 2025,
    plan: 'Team',
    seats: 36,
    mrr: 540,
    health: 'green',
    useCase: 'Twelve orgs in one space, alias permissions, shared files.',
    people: [{ name: 'Tane Whitiora', role: 'Collective Coordinator' }],
  },
  {
    name: 'Kaitiaki Conservation Network',
    relationship: 'customer',
    segment: 'Nonprofits & Foundations',
    subtitle: 'Volunteer conservation network',
    description:
      'Two thousand volunteers across 40 restoration projects, most of whom will never log in twice. Their whole ask is the opposite of everyone else: fewer surfaces, not more.',
    location: 'Nelson, New Zealand',
    country: 'NZ',
    since: 2026,
    plan: 'Team',
    seats: 18,
    mrr: 450,
    health: 'green',
    useCase: 'Project records, volunteer sign-ups, minimal surface.',
    people: [{ name: 'Jed Alsop', role: 'Network Manager' }],
  },
  {
    name: 'Riverstone Trust',
    relationship: 'design-partner',
    segment: 'Nonprofits & Foundations',
    subtitle: 'Regional community trust',
    description:
      'Design partner by accident: they asked for something small, we built it badly, and they stayed to help us fix it. The nonprofit pricing tier exists because of them.',
    location: 'Hamilton, New Zealand',
    country: 'NZ',
    since: 2025,
    plan: 'Starter',
    seats: 5,
    mrr: 0,
    health: 'green',
    useCase: 'Simple grants register, notes, file library.',
    people: [{ name: 'Yvette Barron', role: 'Trust Administrator' }],
  },
  {
    name: 'Bright Futures Fund',
    relationship: 'prospect',
    segment: 'Nonprofits & Foundations',
    subtitle: 'Education-focused funder',
    description:
      'Wants what Awhi Foundation has, having seen it at a sector event. Straightforward deal, slow procurement.',
    location: 'Wellington, New Zealand',
    country: 'NZ',
    stage: 'Proposal',
    nextStep: 'Proposal sent; they need a board resolution to sign anything.',
    expectedMrr: 760,
    people: [{ name: 'Charlotte Nkemelu', role: 'Executive Officer' }],
  },
  {
    name: 'Second Harvest Aotearoa',
    relationship: 'prospect',
    segment: 'Nonprofits & Foundations',
    subtitle: 'Food rescue, 30 branches',
    description:
      'Thirty branches with thirty different spreadsheets. Real need, no budget line until next year.',
    location: 'Christchurch, New Zealand',
    country: 'NZ',
    stage: 'Discovery',
    nextStep: 'Nonprofit rate quoted; revisit when their funding round closes.',
    expectedMrr: 340,
    people: [{ name: 'Pita Havili', role: 'Operations Director' }],
  },

  // ---- Corporate Innovation ------------------------------------------------
  {
    name: 'Crosswind Freight Labs',
    relationship: 'customer',
    segment: 'Corporate Innovation',
    subtitle: 'Corporate venture arm, logistics',
    description:
      'The innovation arm of a freight group, mapping startups they might pilot with. Their space is a market map that has to survive the team that made it moving on.',
    location: 'Auckland, New Zealand',
    country: 'NZ',
    since: 2025,
    plan: 'Enterprise',
    seats: 42,
    mrr: 2520,
    health: 'green',
    useCase: 'Market map, pilot tracking, internal reporting.',
    people: [
      { name: 'Solomon Reid', role: 'Head of Innovation' },
      { name: 'Aiko Tanaka', role: 'Venture Analyst', bio: 'Keeps the market map current, which nobody else manages.' },
    ],
  },
  {
    name: 'Blue Harbour Utilities',
    relationship: 'customer',
    segment: 'Corporate Innovation',
    subtitle: 'Utility, supplier innovation programme',
    description:
      'A utility running a supplier innovation programme under procurement rules. Every note is potentially discoverable, which makes their audit-trail questions the sharpest we get.',
    location: 'Tauranga, New Zealand',
    country: 'NZ',
    since: 2026,
    plan: 'Enterprise',
    seats: 55,
    mrr: 2200,
    health: 'amber',
    useCase: 'Supplier records, audit trail, procurement-safe notes.',
    people: [{ name: 'Vanessa Kirkbride', role: 'Programme Lead' }],
  },
  {
    name: 'Northbank Bank Labs',
    relationship: 'customer',
    segment: 'Corporate Innovation',
    subtitle: 'Bank innovation lab',
    description:
      'A bank lab with a two-year mandate and a hard reporting requirement to the executive. They will renew or vanish entirely, depending on whether the mandate is extended.',
    location: 'Sydney, Australia',
    country: 'AU',
    since: 2025,
    plan: 'Enterprise',
    seats: 38,
    mrr: 3040,
    health: 'red',
    useCase: 'Startup pipeline, executive reporting, pilot notes.',
    people: [
      { name: 'Gareth Alderton', role: 'Lab Director', bio: 'Champion, but his mandate ends in March and nobody has told him if it renews.' },
    ],
  },
  {
    name: 'Totara Insurance Ventures',
    relationship: 'design-partner',
    segment: 'Corporate Innovation',
    subtitle: 'Insurer venture unit',
    description:
      'Design partner for the Tools marketplace: they want internal apps their own analysts can build, without a developer and without leaving the space.',
    location: 'Wellington, New Zealand',
    country: 'NZ',
    since: 2026,
    plan: 'Team',
    seats: 16,
    mrr: 0,
    health: 'green',
    useCase: 'Author Tools in-house, marketplace installs, bridge permissions.',
    people: [{ name: 'Hamish Croucher', role: 'Ventures Manager' }],
  },
  {
    name: 'Highfield Retail Group',
    relationship: 'prospect',
    segment: 'Corporate Innovation',
    subtitle: 'Retail group, supplier network',
    description:
      'Wants to map its supplier base and cannot get IT sign-off for anything outside its existing vendor list.',
    location: 'Christchurch, New Zealand',
    country: 'NZ',
    stage: 'Discovery',
    nextStep: 'Needs to clear their vendor-approval process before a trial is possible.',
    expectedMrr: 1800,
    people: [{ name: 'Lachlan Prue', role: 'Head of Supply Chain' }],
  },
  {
    name: 'Ashgrove Dairy Innovation',
    relationship: 'prospect',
    segment: 'Corporate Innovation',
    subtitle: 'Dairy co-op innovation team',
    description:
      'A co-op innovation team introduced through the agritech body. Interested, distracted by their own season.',
    location: 'Hamilton, New Zealand',
    country: 'NZ',
    stage: 'Trial',
    nextStep: 'Trial running with four people; check in after their peak season.',
    expectedMrr: 1400,
    people: [{ name: 'Brianna Voss', role: 'Innovation Manager' }],
  },

  // ---- Economic Development ------------------------------------------------
  {
    name: 'Waikato Regional Growth Agency',
    relationship: 'customer',
    segment: 'Economic Development',
    subtitle: 'Regional economic development agency',
    description:
      'Paid to grow a regional ecosystem, and therefore paid to know who is in it. Their space is the most public one we have: most of it is deliberately readable by anyone.',
    location: 'Hamilton, New Zealand',
    country: 'NZ',
    since: 2024,
    plan: 'Growth',
    seats: 31,
    mrr: 1240,
    health: 'green',
    useCase: 'Public ecosystem map, published replicas, Discover presence.',
    people: [
      { name: 'Isla Ngatai', role: 'Ecosystem Lead', bio: 'Publishes their map publicly, which is our best inbound channel.' },
    ],
  },
  {
    name: 'Coastal Districts Economic Board',
    relationship: 'customer',
    segment: 'Economic Development',
    subtitle: 'Multi-district economic board',
    description:
      'Four district councils sharing one economic board, which means four sets of politics and one directory. Sub-spaces per district keep the peace.',
    location: 'Napier, New Zealand',
    country: 'NZ',
    since: 2025,
    plan: 'Team',
    seats: 24,
    mrr: 720,
    health: 'green',
    useCase: 'District sub-spaces, shared directory, event calendar.',
    people: [{ name: 'Robert Fanshawe', role: 'Chief Executive' }],
  },
  {
    name: 'Top of the South Trade Office',
    relationship: 'customer',
    segment: 'Economic Development',
    subtitle: 'Export and trade promotion',
    description:
      'Connects local exporters to offshore buyers, so half their directory is not in the country. The location and country fields matter here in a way they do not elsewhere.',
    location: 'Nelson, New Zealand',
    country: 'NZ',
    since: 2026,
    plan: 'Team',
    seats: 17,
    mrr: 510,
    health: 'green',
    useCase: 'Exporter directory, offshore contacts, trade missions as events.',
    people: [{ name: 'Sunita Raval', role: 'Trade Manager' }],
  },
  {
    name: 'Capital Enterprise Agency',
    relationship: 'design-partner',
    segment: 'Economic Development',
    subtitle: 'City enterprise agency',
    description:
      'Design partner for the public Discover surface: they want their ecosystem findable by people who have never heard of Visvine, which is exactly the thing we want too.',
    location: 'Wellington, New Zealand',
    country: 'NZ',
    since: 2025,
    plan: 'Team',
    seats: 11,
    mrr: 0,
    health: 'green',
    useCase: 'Public space, Discover listing, published replicas.',
    people: [{ name: 'Owen Marsters', role: 'Enterprise Manager' }],
  },
  {
    name: 'Otago Southland Development',
    relationship: 'prospect',
    segment: 'Economic Development',
    subtitle: 'Regional development agency',
    description:
      'Government-funded, procurement-bound, and comparing us to a consultancy that would build them a bespoke map. Winning on the fact that ours stays current.',
    location: 'Invercargill, New Zealand',
    country: 'NZ',
    stage: 'Proposal',
    nextStep: 'Shortlisted against a consultancy build; presentation to their board next month.',
    expectedMrr: 980,
    people: [{ name: 'Fiona Eddington', role: 'Strategy Manager' }],
  },
  {
    name: 'Greater Sydney Industry Office',
    relationship: 'prospect',
    segment: 'Economic Development',
    subtitle: 'Metropolitan industry office',
    description:
      'The largest prospect by seats and the least likely to move quickly. Kept warm because the logo would carry weight in Australia.',
    location: 'Sydney, Australia',
    country: 'AU',
    stage: 'Discovery',
    nextStep: 'Annual planning cycle starts in October; nothing happens before that.',
    expectedMrr: 3200,
    people: [{ name: 'Damien Loch', role: 'Director of Industry' }],
  },

  // ---- investors -----------------------------------------------------------
  {
    name: 'Hillcrest Seed Partners',
    relationship: 'investor',
    segment: 'Venture Capital',
    subtitle: 'Lead investor, seed round',
    description:
      'Led the seed round and holds a board seat. Their partner is the most useful person to bring into a deal that has stalled.',
    location: 'Auckland, New Zealand',
    country: 'NZ',
    since: 2025,
    round: 'Seed',
    cheque: 2500000,
    people: [
      { name: 'Eleanor Vaughn', role: 'Partner', bio: 'Board member. Reads the monthly update properly and asks about churn first.' },
    ],
  },
  {
    name: 'Longbay Capital',
    relationship: 'investor',
    segment: 'Venture Capital',
    subtitle: 'Pre-seed investor',
    description:
      'Wrote the first cheque when the product was a prototype and a strong opinion about community software.',
    location: 'Wellington, New Zealand',
    country: 'NZ',
    since: 2024,
    round: 'Pre-seed',
    cheque: 500000,
    people: [{ name: 'Raymond Osei', role: 'Managing Partner' }],
  },
  {
    name: 'Tasman Angels',
    relationship: 'investor',
    segment: 'Venture Capital',
    subtitle: 'Angel syndicate, pre-seed',
    description:
      'Twenty angels in one SPV. Useful for introductions in the regions, less useful for follow-on.',
    location: 'Nelson, New Zealand',
    country: 'NZ',
    since: 2024,
    round: 'Pre-seed',
    cheque: 350000,
    people: [{ name: 'Judith Warrender', role: 'Syndicate Chair' }],
  },
  {
    name: 'Foundersline Fund',
    relationship: 'investor',
    segment: 'Venture Capital',
    subtitle: 'Seed investor, ANZ software',
    description:
      'Came into the seed round for the ANZ software thesis. Quiet between updates, fast when asked for help with Australian introductions.',
    location: 'Sydney, Australia',
    country: 'AU',
    since: 2025,
    round: 'Seed',
    cheque: 1000000,
    people: [{ name: 'Callie Brennan', role: 'Principal' }],
  },
  {
    name: 'Kea Global Angels',
    relationship: 'investor',
    segment: 'Venture Capital',
    subtitle: 'Diaspora angel network',
    description:
      'Expat angels who invest in New Zealand companies. Small cheques, disproportionate reach offshore.',
    location: 'Auckland, New Zealand',
    country: 'NZ',
    since: 2025,
    round: 'Seed',
    cheque: 250000,
    people: [{ name: 'Nathan Ferrier', role: 'Network Director' }],
  },
  {
    name: 'Ridge and Bay Ventures',
    relationship: 'investor',
    segment: 'Venture Capital',
    subtitle: 'Seed fund, vertical SaaS',
    description:
      'Vertical SaaS specialists who understand the segment better than we do, and say so.',
    location: 'Melbourne, Australia',
    country: 'AU',
    since: 2026,
    round: 'Seed',
    cheque: 750000,
    people: [{ name: 'Sofia Karaminas', role: 'Partner' }],
  },

  // ---- delivery partners ---------------------------------------------------
  {
    name: 'Northlight Consulting',
    relationship: 'partner',
    segment: 'Economic Development',
    subtitle: 'Implementation partner, public sector',
    description:
      'Does the data migration and change management for agency customers, which is work we are bad at and they are good at. Two of our economic-development customers came through them.',
    location: 'Auckland, New Zealand',
    country: 'NZ',
    since: 2025,
    people: [{ name: 'Bridget Nairn', role: 'Managing Consultant' }],
  },
  {
    name: 'Fathom Digital',
    relationship: 'partner',
    segment: 'Corporate Innovation',
    subtitle: 'Build partner for custom Tools',
    description:
      'Builds Tools for customers who want something bespoke inside their space. The marketplace exists partly so this work is repeatable rather than bespoke every time.',
    location: 'Wellington, New Zealand',
    country: 'NZ',
    since: 2026,
    people: [{ name: 'Kelvin Ashby', role: 'Technical Director' }],
  },
  {
    name: 'Cobalt and Co',
    relationship: 'partner',
    segment: 'Industry Bodies',
    subtitle: 'Association management partner',
    description:
      'Manages associations as a service, and runs several of them on Visvine. The closest thing we have to a reseller.',
    location: 'Sydney, Australia',
    country: 'AU',
    since: 2026,
    people: [{ name: 'Marguerite Falzon', role: 'Client Services Director' }],
  },
]

// ---- the team ---------------------------------------------------------------

export interface SeedTeamMember {
  name: string
  role: string
  /** What they own, in a sentence. */
  focus: string
  location: string
  /** Segments they cover, if any. */
  segments?: Segment[]
  /** Organisations they look after directly. */
  accounts?: string[]
  /** True for whoever keeps the numbers — earns a line in the data notes. */
  data?: boolean
}

export const TEAM: SeedTeamMember[] = [
  {
    name: 'Marama Rewi',
    role: 'Co-founder & CEO',
    focus: 'Company strategy, fundraising and the investors.',
    location: 'Auckland, New Zealand',
    accounts: ['Harbourline Capital', 'Quarterdeck Partners'],
  },
  {
    name: 'Tobias Lund',
    role: 'Co-founder & CTO',
    focus: 'The platform: notes, agents, connectors and everything under them.',
    location: 'Auckland, New Zealand',
  },
  {
    name: 'Ngaio Frost',
    role: 'Head of Product',
    focus: 'What we build next, and what we refuse to build.',
    location: 'Wellington, New Zealand',
    segments: ['Accelerators & Incubators', 'Coworking & Campuses'],
  },
  {
    name: 'Callum Vetter',
    role: 'Founding Engineer',
    focus: 'Retrieval and search — why the right note comes back.',
    location: 'Christchurch, New Zealand',
  },
  {
    name: 'Priya Raghunathan',
    role: 'Design Lead',
    focus: 'The pane, the graph and everything that has to feel calm.',
    location: 'Auckland, New Zealand',
  },
  {
    name: 'Hemi Waaka',
    role: 'Customer Success Lead',
    focus: 'Onboarding, the design partners and whether anyone is actually using it.',
    location: 'Hamilton, New Zealand',
    segments: ['Universities & Research', 'Nonprofits & Foundations'],
    accounts: ['Te Awa Institute of Technology', 'Awhi Foundation', 'The Sail Loft'],
  },
  {
    name: 'Sasha Volkov',
    role: 'Growth',
    focus: 'Discover, the marketing site and inbound.',
    location: 'Sydney, Australia',
    segments: ['Economic Development'],
  },
  {
    name: 'Elise Tanoa',
    role: 'Solutions Engineer',
    focus: 'Connectors, migrations and the demos that have to work.',
    location: 'Auckland, New Zealand',
    accounts: ['Agritech Alliance Aotearoa', 'Clean Energy Guild'],
  },
  {
    name: 'Rangi Pehi',
    role: 'Support Lead',
    focus: 'The inbox, and turning it into things we fix.',
    location: 'Tauranga, New Zealand',
  },
  {
    name: 'Nadia Behrens',
    role: 'Finance & Operations',
    focus: 'Billing, the revenue roll-up and the runway.',
    location: 'Wellington, New Zealand',
    data: true,
  },
]

// ---- events -----------------------------------------------------------------

export interface SeedEventAttendee {
  /** Stable suffix for the attendee id, unique within the event. */
  n: number
  name?: string
  email: string
  /** A person node id, for anchors and seeded contacts. */
  person?: string
  company?: string
  role?: string
  status: 'going' | 'waitlisted' | 'pending' | 'checked_in' | 'no_show' | 'cancelled' | 'invited'
  response?: 'going' | 'maybe' | 'declined'
  plusOnes?: number
  plusOneNames?: string[]
  answers?: Record<string, unknown>
}

export interface SeedEvent {
  /**
   * The space that OWNS the event — a sub-space id for a room's own event,
   * which the house then reads rolled up (lib/events/rollup.ts). Default: the
   * house itself.
   */
  space?: string
  slug: string
  name: string
  description: string
  /** Days from now; negative is in the past. */
  startInDays: number
  startHour: number
  endHour: number
  locationLabel: string
  locationAddress: string
  lat: number
  lon: number
  visibility: 'space' | 'public'
  capacity: number
  views: number
  waitlistEnabled?: boolean
  allowPlusOnes?: number
  guestListVisible?: boolean
  form?: {
    enabled: boolean
    slug: string
    requireApproval?: boolean
    schema: Array<Record<string, unknown>>
  }
  attendees?: SeedEventAttendee[]
}

const summitForm = {
  enabled: true,
  slug: 'visvine-user-summit',
  requireApproval: true,
  schema: [
    { id: 'space', label: 'Which space do you run?', type: 'text', required: true, placeholder: 'Your space name' },
    {
      id: 'role',
      label: 'What do you do there?',
      type: 'select',
      required: true,
      options: ['Community manager', 'Programme director', 'Operations', 'Executive', 'Developer', 'Something else'],
    },
    { id: 'talk', label: 'I would like to share what we built', type: 'checkbox' },
    { id: 'dietary', label: 'Dietary requirements', type: 'text', placeholder: 'Vegetarian, GF, …' },
  ],
}

export const EVENTS: SeedEvent[] = [
  {
    slug: 'design-partner-office-hours',
    name: 'Design Partner Office Hours',
    description: 'Weekly 45 minutes with the design partners. One awkward thing each, watched over a screen share, no slides.',
    startInDays: -4,
    startHour: 10,
    endHour: 11,
    locationLabel: 'Online',
    locationAddress: 'Video call',
    lat: -36.8485,
    lon: 174.7633,
    visibility: 'space',
    capacity: 12,
    views: 64,
    attendees: [
      { n: 1, person: 'person:dev-admin', email: 'admin@local.dev', status: 'checked_in', response: 'going' },
      { n: 2, name: 'Felix Amadi', email: 'felix.amadi@tidewater-studio.example.com', company: 'Tidewater Studio', role: 'Studio Partner', status: 'checked_in', response: 'going' },
      { n: 3, name: 'Anton Reyes', email: 'anton.reyes@third-space-co.example.com', company: 'Third Space Co.', role: 'Head of Community', status: 'no_show', response: 'going' },
    ],
  },
  {
    slug: 'community-managers-roundtable',
    name: 'Community Managers Roundtable',
    description: 'The people who actually run the spaces, in one room, complaining productively. Our best source of roadmap input.',
    startInDays: -18,
    startHour: 17,
    endHour: 19,
    locationLabel: 'The Sail Loft',
    locationAddress: 'Princes Wharf, Auckland',
    lat: -36.8423,
    lon: 174.7657,
    visibility: 'space',
    capacity: 30,
    views: 212,
    guestListVisible: true,
    attendees: [
      { n: 1, name: 'Leilani Tupou', email: 'leilani.tupou@the-sail-loft.example.com', company: 'The Sail Loft', role: 'Community Lead', status: 'checked_in', response: 'going' },
      { n: 2, name: 'Talia Brandt', email: 'talia.brandt@fernmark-founders.example.com', company: 'Fernmark Founders', role: 'Community Manager', status: 'checked_in', response: 'going' },
      { n: 3, name: 'Dev Bhatia', email: 'dev.bhatia@foundry-lane.example.com', company: 'Foundry Lane', role: 'Space Manager', status: 'checked_in', response: 'going' },
      { n: 4, name: 'Marisol Vance', email: 'marisol.vance@riverbend-studios.example.com', company: 'Riverbend Studios', role: 'Studio Director', status: 'no_show', response: 'going' },
    ],
  },
  {
    slug: 'q3-investor-update',
    name: 'Q3 Investor Update',
    description: 'Quarterly update for the cap table: revenue, retention by segment, the hiring plan and what we got wrong last quarter.',
    startInDays: -11,
    startHour: 16,
    endHour: 17,
    locationLabel: 'Online',
    locationAddress: 'Video call',
    lat: -36.8485,
    lon: 174.7633,
    visibility: 'space',
    capacity: 20,
    views: 88,
    attendees: [
      { n: 1, person: 'person:dev-admin', email: 'admin@local.dev', status: 'checked_in', response: 'going' },
      { n: 2, name: 'Eleanor Vaughn', email: 'eleanor.vaughn@hillcrest-seed-partners.example.com', company: 'Hillcrest Seed Partners', role: 'Partner', status: 'checked_in', response: 'going' },
      { n: 3, name: 'Raymond Osei', email: 'raymond.osei@longbay-capital.example.com', company: 'Longbay Capital', role: 'Managing Partner', status: 'checked_in', response: 'going' },
      { n: 4, name: 'Callie Brennan', email: 'callie.brennan@foundersline-fund.example.com', company: 'Foundersline Fund', role: 'Principal', status: 'no_show', response: 'going' },
    ],
  },
  {
    slug: 'customer-advisory-board',
    name: 'Customer Advisory Board',
    description: 'Six customers, half a day, and the roadmap on the wall. They vote; we do not have to obey, but we have to answer.',
    startInDays: -32,
    startHour: 9,
    endHour: 13,
    locationLabel: 'Foundry Lane',
    locationAddress: 'Te Aro, Wellington',
    lat: -41.2954,
    lon: 174.7762,
    visibility: 'space',
    capacity: 12,
    views: 96,
    attendees: [
      { n: 1, name: 'Dr Alana Fenwick', email: 'alana.fenwick@te-awa-institute-of-technology.example.com', company: 'Te Awa Institute of Technology', role: 'Director, Enterprise', status: 'checked_in', response: 'going' },
      { n: 2, name: 'Marcus Hale', email: 'marcus.hale@harbourline-capital.example.com', company: 'Harbourline Capital', role: 'Partner', status: 'checked_in', response: 'going' },
      { n: 3, name: 'Wiremu Kahukura', email: 'wiremu.kahukura@agritech-alliance-aotearoa.example.com', company: 'Agritech Alliance Aotearoa', role: 'Chief Executive', status: 'checked_in', response: 'going' },
      { n: 4, name: 'Solomon Reid', email: 'solomon.reid@crosswind-freight-labs.example.com', company: 'Crosswind Freight Labs', role: 'Head of Innovation', status: 'cancelled', response: 'declined' },
    ],
  },
  {
    slug: 'team-offsite',
    name: 'Team Offsite',
    description: 'Two days, no laptops before lunch. The product principles came out of the last one.',
    startInDays: -60,
    startHour: 9,
    endHour: 17,
    locationLabel: 'Riverbend Studios',
    locationAddress: 'Frankton, Queenstown',
    lat: -45.0186,
    lon: 168.7386,
    visibility: 'space',
    capacity: 14,
    views: 41,
    attendees: [
      { n: 1, person: 'person:dev-admin', email: 'admin@local.dev', status: 'checked_in', response: 'going' },
      { n: 2, person: 'person:dev-member', email: 'member@local.dev', status: 'checked_in', response: 'going' },
    ],
  },
  {
    slug: 'onboarding-clinic-accelerators',
    name: 'Onboarding Clinic — Accelerators',
    description: 'Bring your cohort spreadsheet and leave with a working space. Ninety minutes, six spaces at a time, one of us per two.',
    startInDays: 5,
    startHour: 14,
    endHour: 15,
    locationLabel: 'Online',
    locationAddress: 'Video call',
    lat: -36.8485,
    lon: 174.7633,
    visibility: 'space',
    capacity: 12,
    views: 74,
    attendees: [
      { n: 1, name: 'Aroha Mikaere', email: 'aroha.mikaere@ignition-bay.example.com', company: 'Ignition Bay', role: 'General Manager', status: 'going', response: 'going' },
      { n: 2, name: 'Georgia Selwyn', email: 'georgia.selwyn@brightwater-incubator.example.com', company: 'Brightwater Incubator', role: 'Incubator Manager', status: 'going', response: 'going' },
      { n: 3, name: 'Rewa Tiakina', email: 'rewa.tiakina@southerly-accelerator.example.com', company: 'Southerly Accelerator', role: 'Head of Programmes', status: 'pending', response: 'maybe' },
    ],
  },
  {
    slug: 'agents-deep-dive',
    name: 'Agents Deep Dive',
    description: 'What an agent is here: a note that wakes up, with the reach you gave it and nothing more. Bring something you want automated.',
    startInDays: 9,
    startHour: 11,
    endHour: 12,
    locationLabel: 'Online',
    locationAddress: 'Video call',
    lat: -36.8485,
    lon: 174.7633,
    visibility: 'public',
    capacity: 100,
    views: 486,
    waitlistEnabled: true,
    guestListVisible: true,
    attendees: [
      { n: 1, name: 'Oliver Kestrel', email: 'oliver.kestrel@tussock-ventures.example.com', company: 'Tussock Ventures', role: 'General Partner', status: 'going', response: 'going' },
      { n: 2, name: 'Miriama Rangi', email: 'miriama.rangi@awhi-foundation.example.com', company: 'Awhi Foundation', role: 'Grants Director', status: 'going', response: 'going' },
      { n: 3, name: 'Toby Renshaw', email: 'toby.renshaw@clean-energy-guild.example.com', company: 'Clean Energy Guild', role: 'Data Lead', status: 'going', response: 'going' },
      { n: 4, name: 'Bevan Thorne', email: 'bevan.thorne@manuka-fund.example.com', company: 'Manuka Fund', role: 'Managing Director', status: 'waitlisted', response: 'going' },
    ],
  },
  {
    slug: 'tools-build-along',
    name: 'Tools Build-Along',
    description: 'Build a small Tool in your own space while we build the same one on screen. No prior React required, which is the claim we are testing.',
    startInDays: 14,
    startHour: 15,
    endHour: 17,
    locationLabel: 'Online',
    locationAddress: 'Video call',
    lat: -36.8485,
    lon: 174.7633,
    visibility: 'public',
    capacity: 40,
    views: 302,
    waitlistEnabled: true,
    attendees: [
      { n: 1, name: 'Nikau Paterson', email: 'nikau.paterson@ridgeline-research-park.example.com', company: 'Ridgeline Research Park', role: 'Park Manager', status: 'going', response: 'going' },
      { n: 2, name: 'Hamish Croucher', email: 'hamish.croucher@totara-insurance-ventures.example.com', company: 'Totara Insurance Ventures', role: 'Ventures Manager', status: 'going', response: 'going' },
      { n: 3, name: 'Kelvin Ashby', email: 'kelvin.ashby@fathom-digital.example.com', company: 'Fathom Digital', role: 'Technical Director', status: 'going', response: 'going' },
    ],
  },
  {
    slug: 'support-office-hours',
    name: 'Support Office Hours',
    description: 'Open call, no agenda. Anyone with a space can turn up and get their thing looked at live.',
    startInDays: 7,
    startHour: 9,
    endHour: 10,
    locationLabel: 'Online',
    locationAddress: 'Video call',
    lat: -36.8485,
    lon: 174.7633,
    visibility: 'space',
    capacity: 25,
    views: 58,
    attendees: [
      { n: 1, person: 'person:dev-member', email: 'member@local.dev', status: 'going', response: 'going' },
      { n: 2, name: 'Cora Bellweather', email: 'cora.bellweather@wharfside-works.example.com', company: 'Wharfside Works', role: 'General Manager', status: 'going', response: 'going' },
    ],
  },
  {
    slug: 'ecosystem-mapping-workshop',
    name: 'Ecosystem Mapping Workshop',
    description: 'For agencies and industry bodies: how to map an ecosystem so the map is still true in a year. Run with our public-sector partner.',
    startInDays: 21,
    startHour: 13,
    endHour: 16,
    locationLabel: 'Capital Enterprise Agency',
    locationAddress: 'Lambton Quay, Wellington',
    lat: -41.2807,
    lon: 174.7772,
    visibility: 'public',
    capacity: 45,
    views: 377,
    allowPlusOnes: 1,
    guestListVisible: true,
    attendees: [
      { n: 1, name: 'Isla Ngatai', email: 'isla.ngatai@waikato-regional-growth-agency.example.com', company: 'Waikato Regional Growth Agency', role: 'Ecosystem Lead', status: 'going', response: 'going' },
      { n: 2, name: 'Owen Marsters', email: 'owen.marsters@capital-enterprise-agency.example.com', company: 'Capital Enterprise Agency', role: 'Enterprise Manager', status: 'going', response: 'going' },
      { n: 3, name: 'Fiona Eddington', email: 'fiona.eddington@otago-southland-development.example.com', company: 'Otago Southland Development', role: 'Strategy Manager', status: 'going', response: 'going', plusOnes: 1, plusOneNames: ['Hayden Eddington'] },
      { n: 4, name: 'Bridget Nairn', email: 'bridget.nairn@northlight-consulting.example.com', company: 'Northlight Consulting', role: 'Managing Consultant', status: 'going', response: 'going' },
      { n: 5, name: 'Damien Loch', email: 'damien.loch@greater-sydney-industry-office.example.com', company: 'Greater Sydney Industry Office', role: 'Director of Industry', status: 'waitlisted', response: 'going' },
    ],
  },
  {
    slug: 'visvine-user-summit',
    name: 'Visvine User Summit',
    description: 'One day, every kind of space in one room: accelerators, funds, campuses, chambers, agencies. Half the programme is customers on stage, not us.',
    startInDays: 46,
    startHour: 9,
    endHour: 17,
    locationLabel: 'Shed 10, Queens Wharf',
    locationAddress: 'Queens Wharf, Auckland',
    lat: -36.8433,
    lon: 174.7683,
    visibility: 'public',
    capacity: 250,
    views: 1841,
    waitlistEnabled: true,
    allowPlusOnes: 1,
    guestListVisible: true,
    form: summitForm,
    attendees: [
      {
        n: 1,
        person: 'person:dev-member',
        email: 'member@local.dev',
        status: 'going',
        response: 'going',
        answers: { space: 'Fernmark Founders', role: 'Community manager', talk: true, dietary: '' },
      },
      {
        n: 2,
        name: 'Amiria Nikora',
        email: 'amiria.nikora@kowhai-labs.example.com',
        company: 'Kowhai Labs',
        role: 'Programme Director',
        status: 'going',
        response: 'going',
        answers: { space: 'Kowhai Labs', role: 'Programme director', talk: true, dietary: 'Vegetarian' },
      },
      {
        n: 3,
        name: 'Hana Te Kanawa',
        email: 'hana.tekanawa@karearea-programme.example.com',
        company: 'Karearea Programme',
        role: 'Pouwhakahaere',
        status: 'going',
        response: 'going',
        answers: { space: 'Karearea Programme', role: 'Executive', talk: false, dietary: '' },
      },
      {
        n: 4,
        name: 'Priya Chandran',
        email: 'priya.chandran@longshore-ventures-lab.example.com',
        company: 'Longshore Ventures Lab',
        role: 'Director of Innovation',
        status: 'pending',
        response: 'going',
        answers: { space: 'Longshore Ventures Lab', role: 'Programme director', talk: false, dietary: 'GF' },
      },
      {
        n: 5,
        name: 'Harriet Zhao',
        email: 'harriet.zhao@common-ground-campus.example.com',
        company: 'Common Ground Campus',
        role: 'Precinct Director',
        status: 'waitlisted',
        response: 'going',
        answers: { space: 'Common Ground Campus', role: 'Executive', talk: false, dietary: '' },
      },
      {
        n: 6,
        name: 'Elena Costa',
        email: 'elena.costa@example.com',
        company: 'Startup Daily ANZ',
        role: 'Reporter',
        status: 'invited',
      },
    ],
  },
  // Design Partners owns this one. The room's `flowEvents` dial is on and the
  // event is public and published, so the house's hub shows it badged with the
  // room it came from and nothing is copied (lib/events/rollup.ts).
  {
    space: 'design-partners',
    slug: 'partner-demo-day',
    name: 'Design Partner Demo Day',
    description: 'Every partner shows the one thing they changed in their own space this quarter. Open to anyone curious about the programme.',
    startInDays: 21,
    startHour: 16,
    endHour: 19,
    locationLabel: 'GridAKL, Wynyard Quarter',
    locationAddress: '12 Madden Street, Auckland 1010',
    lat: -36.8447,
    lon: 174.7562,
    visibility: 'public',
    capacity: 80,
    views: 212,
    attendees: [
      { n: 1, name: 'Marama Whitiora', email: 'marama.whitiora@southerly-accelerator.example.com', company: 'Southerly Accelerator', role: 'Head of Programmes', status: 'going', response: 'going' },
      { n: 2, name: 'Tomás Reiter', email: 'tomas.reiter@quarterdeck-partners.example.com', company: 'Quarterdeck Partners', role: 'Operations Lead', status: 'going', response: 'going' },
    ],
  },
]

// ---- channels ---------------------------------------------------------------

/** Icons are OWNED icon names (assets/icons), never emoji — see docs/icons.md. */
export const CHANNEL_SECTIONS = [
  { id: 'section_hq_company', name: 'Company', icon: 'sparkles', position: 0 },
  { id: 'section_hq_gtm', name: 'Go-to-market', icon: 'trending-up', position: 1 },
]

export const CHANNELS = [
  { id: 'chan_hq_general', name: 'general', icon: 'hash', section: 'section_hq_company', description: 'Everything that does not have a better home.' },
  { id: 'chan_hq_product', name: 'product', icon: 'lightbulb', section: 'section_hq_company', description: 'What we are building and why. Decisions get written up as notes.' },
  { id: 'chan_hq_launches', name: 'launches', icon: 'rocket', section: 'section_hq_company', description: 'What shipped, and who asked for it.' },
  { id: 'chan_hq_customers', name: 'customers', icon: 'handshake', section: 'section_hq_gtm', description: 'Account news, renewals and anything a customer said that we should not forget.' },
  { id: 'chan_hq_pipeline', name: 'pipeline', icon: 'target', section: 'section_hq_gtm', description: 'Live deals. Every stage change gets a line here.' },
  { id: 'chan_hq_support', name: 'support', icon: 'bell', section: 'section_hq_gtm', description: 'The inbox, triaged in public.' },
]

export interface SeedMessage {
  id: string
  chan: string
  /** 'admin' | 'member' — resolved to the anchor user ids at write time. */
  from: 'admin' | 'member'
  hoursAgo: number
  text: string
  pinned?: boolean
  replyTo?: string
  reactions?: Array<{ from: 'admin' | 'member'; emoji: string }>
}

export const MESSAGES: SeedMessage[] = [
  {
    id: 'msg_hq_001',
    chan: 'chan_hq_general',
    from: 'admin',
    hoursAgo: 620,
    text: 'Reminder that the monthly investor update goes out on the 5th. If your number is in it, it needs to be right by the 3rd 🙏',
    pinned: true,
  },
  { id: 'msg_hq_002', chan: 'chan_hq_general', from: 'member', hoursAgo: 400, text: 'Is the onboarding checklist in the file library the current one? The copy I sent Ignition Bay has a step that no longer exists.' },
  {
    id: 'msg_hq_003',
    chan: 'chan_hq_general',
    from: 'admin',
    hoursAgo: 398,
    text: 'Library one is current — I rewrote it after the last onboarding clinic. Yours is probably from before the Create panel changed.',
    replyTo: 'msg_hq_002',
    reactions: [{ from: 'member', emoji: '🙏' }],
  },
  { id: 'msg_hq_004', chan: 'chan_hq_general', from: 'member', hoursAgo: 120, text: 'Offsite photos are in the Drive. Nobody looks good in the 7am one.' },
  {
    id: 'msg_hq_010',
    chan: 'chan_hq_product',
    from: 'admin',
    hoursAgo: 540,
    text: 'Decision written up: sub-space context flows UP read-only, never down. Longshore and Coastal Districts both wanted it, for opposite reasons. Note is in product/decisions.',
    pinned: true,
    reactions: [{ from: 'member', emoji: '👀' }],
  },
  { id: 'msg_hq_011', chan: 'chan_hq_product', from: 'member', hoursAgo: 300, text: 'Third Space Co. asked about multi-space admin again. That is the fourth time from them and the second from Coastal Districts.' },
  {
    id: 'msg_hq_012',
    chan: 'chan_hq_product',
    from: 'admin',
    hoursAgo: 296,
    text: 'Noted. It is the roughest edge we have and I do not want to pretend otherwise in the update — it goes on the roadmap as "next", not "someday".',
    replyTo: 'msg_hq_011',
  },
  { id: 'msg_hq_013', chan: 'chan_hq_product', from: 'member', hoursAgo: 90, text: 'Watching Brightwater use the Create panel was humbling. They did not find the Context tile at all. Clip is in the Drive.' },
  {
    id: 'msg_hq_020',
    chan: 'chan_hq_launches',
    from: 'admin',
    hoursAgo: 480,
    text: '🚀 Scheduled agents are live for everyone. Tussock had it in production within the hour, which is either a good sign or a warning.',
    pinned: true,
    reactions: [{ from: 'member', emoji: '🚀' }],
  },
  { id: 'msg_hq_021', chan: 'chan_hq_launches', from: 'member', hoursAgo: 240, text: 'Drive indexing now covers PDFs properly. Kauri Research Trust found that one for us the hard way — 300 files on day one.' },
  { id: 'msg_hq_022', chan: 'chan_hq_launches', from: 'admin', hoursAgo: 48, text: 'Tools marketplace is open to installs. Ridgeline built their room-booking Tool with no help from us, which was the entire point.', reactions: [{ from: 'member', emoji: '🎉' }] },
  {
    id: 'msg_hq_030',
    chan: 'chan_hq_customers',
    from: 'admin',
    hoursAgo: 360,
    text: 'Northbank is amber going on red — Gareth is a great champion but his mandate ends in March and nobody has told him whether it renews. Treat the renewal as at risk.',
    pinned: true,
  },
  { id: 'msg_hq_031', chan: 'chan_hq_customers', from: 'member', hoursAgo: 200, text: 'Te Awa renewed for another year. Alana wants the student roll-over script again in January — worth making that a real feature rather than me running it.' },
  { id: 'msg_hq_032', chan: 'chan_hq_customers', from: 'admin', hoursAgo: 168, text: 'Overland failed us on SSO in their security review. Dmitri was fair about it. It is now the top enterprise blocker and it is in the decisions note.', reactions: [{ from: 'member', emoji: '😕' }] },
  { id: 'msg_hq_033', chan: 'chan_hq_customers', from: 'member', hoursAgo: 72, text: 'Fernmark is quiet. Two logins in three weeks against 41 seats. Reaching out before it becomes a renewal conversation.' },
  { id: 'msg_hq_034', chan: 'chan_hq_customers', from: 'admin', hoursAgo: 20, text: 'Wharfside sorted — the two-sites-one-space argument is settled with sections. They are happy, and it is a pattern worth writing up.' },
  { id: 'msg_hq_040', chan: 'chan_hq_pipeline', from: 'admin', hoursAgo: 300, text: 'Common Ground moved to Contract. Start date is pinned to their November renewal, so revenue lands next quarter, not this one.' },
  { id: 'msg_hq_041', chan: 'chan_hq_pipeline', from: 'member', hoursAgo: 220, text: 'Quarterdeck security questionnaire is back with them. Tim is pushing internally; procurement has not scheduled anything.' },
  { id: 'msg_hq_042', chan: 'chan_hq_pipeline', from: 'admin', hoursAgo: 100, text: 'Boatshed will not sign an invoice for $180/month and I do not blame them. That deal is blocked on self-serve billing, full stop.', reactions: [{ from: 'member', emoji: '💳' }] },
  { id: 'msg_hq_043', chan: 'chan_hq_pipeline', from: 'member', hoursAgo: 36, text: 'Ignition Bay trial ends on the 28th. Their cohort import is the only thing standing between us and a close.' },
  { id: 'msg_hq_050', chan: 'chan_hq_support', from: 'member', hoursAgo: 260, text: 'Three tickets this week about finding the Context tile in Create. Same confusion Brightwater hit. That is a pattern, not bad luck.' },
  { id: 'msg_hq_051', chan: 'chan_hq_support', from: 'admin', hoursAgo: 258, text: 'Agreed — logging it against the Create panel work rather than answering them one at a time.', replyTo: 'msg_hq_050' },
  { id: 'msg_hq_052', chan: 'chan_hq_support', from: 'member', hoursAgo: 60, text: 'Manaaki asked whether one of their twelve charities can be locked out of another one entirely. Answer is yes, via aliases, but it took me twenty minutes to explain. Docs gap.' },
]

// ---- files ------------------------------------------------------------------

export interface SeedFile {
  file: string
  name: string
  fileType: string
  daysAgo: number
  body: string
}

export const FILE_RESOURCES: SeedFile[] = [
  {
    file: 'revenue-roll-up.csv',
    name: 'Revenue roll-up (Q3)',
    fileType: 'csv',
    daysAgo: 12,
    body: [
      'segment,accounts,seats,mrr_nzd,net_retention_pct',
      'Accelerators & Incubators,7,251,6620,104',
      'Venture Capital,5,119,7850,97',
      'Universities & Research,5,228,5660,112',
      'Coworking & Campuses,5,381,3590,91',
      'Industry Bodies,5,225,7390,108',
      'Nonprofits & Foundations,4,88,1860,101',
      'Corporate Innovation,4,151,7760,84',
      'Economic Development,4,83,2470,106',
    ].join('\n'),
  },
  {
    file: 'onboarding-checklist.md',
    name: 'Onboarding checklist',
    fileType: 'md',
    daysAgo: 26,
    body: [
      '# Onboarding a new space',
      '',
      'Ninety minutes, in this order. Anything skipped here comes back as a support ticket.',
      '',
      '## Before the call',
      '- [ ] Their member list, in any format. A spreadsheet is fine.',
      '- [ ] Who administers the space, by name, and who must NOT.',
      '- [ ] One question they cannot answer today about their own community.',
      '',
      '## On the call',
      '- [ ] Create the space; set visibility deliberately, out loud.',
      '- [ ] Import the member list. Do not tidy it first — they need to see it messy.',
      '- [ ] Write one note together, with a `[[mention]]`, and open the graph.',
      '- [ ] Hand over the keyboard. Stop talking.',
      '- [ ] Answer their one question, using their own data.',
      '',
      '## After the call',
      '- [ ] Aliases set so the right people hold the right things.',
      '- [ ] A second admin, always. One-admin spaces strand.',
      '- [ ] Book the two-week check-in before leaving the call.',
      '',
      '## The signal that matters',
      '',
      'Whether someone other than our champion writes a note in the first week.',
      'Nothing else in the first month predicts renewal as well.',
    ].join('\n'),
  },
  {
    file: 'segment-pricing.csv',
    name: 'Segment pricing (working)',
    fileType: 'csv',
    daysAgo: 40,
    body: [
      'plan,seats_included,nzd_per_month,nonprofit_nzd,notes',
      'Starter,25,120,60,self-serve when billing ships',
      'Team,75,340,170,most common for coworking',
      'Growth,200,880,440,accelerators and funds land here',
      'Enterprise,unlimited,2200,1100,audit trail + SSO when it exists',
    ].join('\n'),
  },
  {
    file: 'support-macros.md',
    name: 'Support macros',
    fileType: 'md',
    daysAgo: 8,
    body: [
      '# Support macros',
      '',
      'Short, plain, no apology theatre. Link the note rather than explaining twice.',
      '',
      '## "Who can see this?"',
      '',
      'Private by default. A note is visible to you, to space admins, and to anyone',
      'holding an alias you have granted this folder to — nothing else. The Share',
      'panel on any note lists exactly who that is right now.',
      '',
      '## "Can I lock one group out of another group\'s notes?"',
      '',
      'Yes. Give each group its own alias, grant each alias only its own folder, and',
      'grant nothing at the root. Twelve organisations in one space works this way.',
      '',
      '## "Why can the AI not see my file?"',
      '',
      'Check the file in the Drive: it shows pending, indexed, unsupported or failed.',
      'Only indexed files are searchable. Images are unsupported by design.',
      '',
      '## "Our member list is a mess."',
      '',
      'Import it anyway. Duplicates get collapsed by the identity layer and the',
      'review queue shows you every merge before it happens.',
    ].join('\n'),
  },
]

/** A standalone Resource node so the Resource type appears in the directory. */
export const RESOURCE_NODE = {
  id: 'resource:visvine-space-playbook',
  name: 'The Space Playbook',
  subtitle: 'How to run a community space that people actually open twice',
  url: 'https://docs.visvine.example.com/playbook',
  tags: ['Guide', 'Onboarding', 'Playbook'],
}
