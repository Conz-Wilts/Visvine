/**
 * Blackbird's rooms — the teams inside the house, plus the committee that is
 * not a team (docs/sub-spaces.md).
 *
 * A room is named after the work done in it, so the switcher, the context tree
 * and the console read the way the firm is organised: Investments, Programs,
 * Fund Operations, then the Investment Committee. Between them every dial is on
 * screen from the first seed:
 *
 *   • Investments is a Department — the house walks in, its context, events
 *     and people all flow up, and the house's admins manage it.
 *   • Programs is the room the WORLD can find: Giants, Foundry and Sunrise are
 *     public, so it is listed, strangers ask at the door, and its events
 *     (Sunrise Aotearoa among them) roll up into the house's calendar.
 *   • Fund Operations is a Council: the house's members see the door and ask
 *     through it, its events flow up and its notes do not.
 *   • The Investment Committee is a Committee: secret, named nowhere outside
 *     its own members, flowing nothing.
 *
 * A room's people are its own records. The programme leads recorded in
 * Programs are the same people as the team records in the house, and the
 * seed's identity pass joins each pair into one identity
 * (lib/identity/family.ts) — so their node ids here take the `-2` suffix the
 * app would give them, node ids being global.
 *
 * All four are provisioned the way the New sub-space dialog does it, so `id` is
 * what provisionSpace derives from the name (the seed asserts it). Dev Admin
 * administers all four (they created them); Dev Member is in Investments and
 * Programs, and waiting at Fund Operations' door — so signing in as them shows
 * exactly what a parent's member sees: rooms they are in, a room they have
 * asked to join, and no sign at all that the fourth one exists.
 *
 * Links are absolute (`/path.md`) and point only at notes written here — an
 * index body's links are checked by `db:notes:verify`, and a person note's
 * links become directory edges the moment the note lands.
 */

import { ADMIN_USER, MEMBER_USER } from './space'

export interface SeedSubspace {
  /** What provisionSpace derives from the name — asserted, never trusted. */
  id: string
  name: string
  description: string
  /** The preset whose dials it starts from (lib/spaces/subspaces.ts#PRESETS). */
  preset: string
  flowContext?: boolean
  flowEvents?: boolean
  parentAdmins?: boolean
  /**
   * People who belong to the ROOM — directory records of its own, reached in
   * the room and, for the same identity, from the person's page in the house.
   * Written as nodes first, then as the notes that name them.
   */
  people?: ReadonlyArray<{
    /** The note's folder: people/<slug>/index.md. */
    slug: string
    nodeId: string
    name: string
    role: string
    org: string
    location: string
    /** The one tag their card wears in the room's directory. */
    tag: string
  }>
  /** Active members. The creator (Dev Admin) is one by provisioning. */
  members: readonly string[]
  /** People waiting at an `ask` door. */
  pending?: readonly string[]
  notes: ReadonlyArray<{ path: string; content: string }>
}

/** A note's markdown, from frontmatter lines and a body. */
function note(frontmatter: string, body: string): string {
  return `---\n${frontmatter.trim()}\n---\n\n${body.trim()}\n`
}

// ---- Investments -------------------------------------------------------------

const INVESTMENTS_NOTES: SeedSubspace['notes'] = [
  {
    path: 'index.md',
    content: note(
      `title: "Investments"
description: "How the investment team finds, decides and backs: rivers of inquiry, the process, and the memo."
tags: ["investments"]`,
      `The investment team's room. Blackbird invests in founders, not sectors or
stages, and most of what is written here is about how to recognise one early.

[Rivers of inquiry](/rivers/index.md) are the questions the team is following
right now. [Process](/process/index.md) is how a first meeting becomes a
decision, and what a memo has to say.

Context flows up to the house read-only, so anyone at Blackbird can read how
the team thinks, and only this room can change it.`,
    ),
  },
  {
    path: 'rivers/index.md',
    content: note(
      `title: "Rivers of inquiry"
description: "The questions the team is following, each one a place to look for founders rather than a thesis to fill."
tags: ["investments", "rivers"]`,
      `A river of inquiry is a question worth following for a few years: what has
changed, who is early, and which founders are already standing in the water.
It is a way of looking, never a box a company has to fit.

Current: [SaaS to SaiS](/rivers/saas-to-sais.md) and
[frontier science](/rivers/frontier-science.md).`,
    ),
  },
  {
    path: 'rivers/saas-to-sais.md',
    content: note(
      `type: Note
title: "SaaS to SaiS"
description: "Software that does the work, not software that helps with it — and why the best vertical companies saw it coming."
tags: ["investments", "rivers", "ai"]`,
      `Tom Humphrey's river, written up on the blog as "From SaaS to SaiS" (2024)
and "Goodbye, SaaS. Welcome, SaiS." (2026).

The shift: vertical software used to sell a seat to the person doing the work.
Now it can sell the work. The companies that win knew the job before they knew
the model — founders who ran a practice, a clinic or a back office.

What we look for: a founder who can say which hour of a professional's week
disappears, and a customer who pays for the outcome rather than the licence.`,
    ),
  },
  {
    path: 'rivers/frontier-science.md',
    content: note(
      `type: Note
title: "Frontier science"
description: "Researchers who choose ambition — the river Foundry was built to fish."
tags: ["investments", "rivers", "deep-tech"]`,
      `The bet behind Foundry: the next wave of world-changing companies will come
from researchers who choose ambition and have the courage to take the first
leap.

What we look for: a secret about the world the team learned in the lab, a
path to a first customer that does not wait for the science to be finished,
and people who are not fazed by long timelines. We do not care about IP.

Foundry teams have gone on to raise from venture investors; the pipeline
between the programme and a seed round is what [process](/process/index.md) is
for.`,
    ),
  },
  {
    path: 'process/index.md',
    content: note(
      `title: "Process"
description: "From first meeting to a cheque: who decides, and what they read first."
tags: ["investments", "process"]`,
      `High-conviction decisions after careful research and debate — and a trust in
instinct built up over years of pattern matching.

[How we decide](/process/how-we-decide.md) is the path a company takes.
[The memo](/process/memo.md) is what the committee reads.`,
    ),
  },
  {
    path: 'process/how-we-decide.md',
    content: note(
      `type: Note
title: "How we decide"
description: "First meeting, partner meeting, diligence, committee. Nothing skips a partner meeting."
tags: ["investments", "process"]`,
      `1. **First meeting.** Anyone on the investment team. The only question: do we
   want a second one?
2. **Partner meeting.** A partner and the founders, with the deal owner. The
   founders are the subject; the deck is optional.
3. **Diligence.** Only what could change the answer. References first.
4. **Committee.** The memo goes out the working day before. The least
   convinced person writes the case against.

It is never too early, and no round is too small, to talk to Blackbird — so
most companies are met long before there is a round to decide on. A pass is
written back with the reasons, and the door stays open. The memo's shape is in
[the memo](/process/memo.md).`,
    ),
  },
  {
    path: 'process/memo.md',
    content: note(
      `type: Note
title: "The memo"
description: "Founders first, then why now, then what we would have to believe."
tags: ["investments", "process", "memo"]`,
      `The template lives in the Drive. The order is deliberate: the founders come
first because they are the reason we invest, and "why now" comes before the
market because a market without a reason it is changing is just a size.

Every memo ends with **why we might be wrong**, written by whoever argued
hardest against it in the [process](/process/how-we-decide.md).`,
    ),
  },
]

// ---- Programs ----------------------------------------------------------------

const PROGRAMS_NOTES: SeedSubspace['notes'] = [
  {
    path: 'index.md',
    content: note(
      `title: "Programs"
description: "Giants, Foundry, Sunrise and the Foundation — how Blackbird raises the ambition of the whole ecosystem."
tags: ["programs"]`,
      `The programs Blackbird runs for everyone, not only the portfolio. Each is
free, and none takes equity.

[Giants](/giants/index.md) for founders at the idea stage,
[Foundry](/foundry/index.md) for researchers, [Sunrise](/sunrise/index.md) for
the whole community, and [the Foundation](/foundation.md) for young creatives.
[People](/people/index.md) are the leads who run them.

This is the room anyone can find: the programs are public, so the room is
listed and anyone can ask at the door.`,
    ),
  },
  {
    path: 'giants/index.md',
    content: note(
      `type: Program
title: "Giants"
description: "Free mentoring for early-stage founders: 1:1 sessions, weekly in-person nights, no equity."
tags: ["programs", "giants"]`,
      `Blackbird's flagship mentoring program: 6,311 mentoring sessions with 420
mentors, and 1,967 founders since 2021.

Founders book 30-minute 1:1 sessions with portfolio founders, operators, the
investment team and ecosystem experts, and meet in person every Tuesday, 5pm
to 8pm. The 2026 cohorts ran in Sydney (30 March – 1 May) and Melbourne (4 –
29 May).

**Who it is for.** Anyone working on a startup idea for less than two years,
with at least one founder connected to Australia or New Zealand. Not for
agencies, services businesses or lifestyle businesses.

Run by [Josephine Tay](/people/josephine-tay/index.md).`,
    ),
  },
  {
    path: 'foundry/index.md',
    content: note(
      `type: Program
title: "Foundry"
description: "Eight weeks for researchers testing a science-led startup idea. A$1k per team, no equity, A$5k to the winning pitch."
tags: ["programs", "foundry"]`,
      `Blackbird's launchpad for ambitious researchers. Ten teams per cohort, eight
weeks, at least four hours a week, hybrid across Australia.

- **Funding:** A$1k non-dilutive per team; a A$5k prize for the winning pitch.
- **Eligibility:** someone on the team enrolled or employed at a university,
  someone with a strong link to Australia or New Zealand.
- **Alumni** have raised more than $72M — Iceberg Quantum among them.

Cohort 7 runs September to November 2026, after applications closed in
August. Run by [Saron Berhane](/people/saron-berhane/index.md).`,
    ),
  },
  {
    path: 'sunrise/index.md',
    content: note(
      `type: Program
title: "Sunrise"
description: "Blackbird's love letter to founders — a festival for the Australian and New Zealand startup community."
tags: ["programs", "sunrise"]`,
      `Not a business conference and not exactly a tech event: a cultural
celebration, first held in 2015.

**Sunrise Aotearoa 2026** is on Thursday 29 October at the ASB Waterfront
Theatre, Auckland — registration from 8am, the program from 9am to 8pm, then
the Sunset afterparty. Keynotes on the Visions Stage, hands-on workshops and
1:1 matchmaking through the festival app.

Produced by [Katie Tholo](/people/katie-tholo/index.md).`,
    ),
  },
  {
    path: 'foundation.md',
    content: note(
      `type: Program
title: "Blackbird Foundation"
description: "Grant making and storytelling to unleash creativity in young people."
tags: ["programs", "foundation"]`,
      `The Foundation's two grant programs are Protostars and Believers. It is led
by Joel Connolly, with Theia Gabatan leading grant programs and impact.`,
    ),
  },
  {
    path: 'people/index.md',
    content: note(
      `title: "People"
description: "The leads who run the programs. Records of this room, joined to the same people in the house."
tags: ["programs", "people"]`,
      `[Josephine Tay](/people/josephine-tay/index.md) runs Giants,
[Saron Berhane](/people/saron-berhane/index.md) runs Foundry,
[Katie Tholo](/people/katie-tholo/index.md) produces Sunrise and
[Sofia Echesortu](/people/sofia-echesortu/index.md) leads the portfolio
program.`,
    ),
  },
  {
    path: 'people/josephine-tay/index.md',
    content: note(
      `type: Person
title: "Josephine Tay"
description: "Giants Program Manager, Blackbird"
node: person:josephine-tay-2
tags: ["person", "programs", "giants"]`,
      `Runs [Giants](/giants/index.md): the mentoring, the weekly content and the
in-person nights.`,
    ),
  },
  {
    path: 'people/saron-berhane/index.md',
    content: note(
      `type: Person
title: "Saron Berhane"
description: "Foundry Lead, Blackbird"
node: person:saron-berhane-2
tags: ["person", "programs", "foundry"]`,
      `Leads [Foundry](/foundry/index.md), reviews applications weekly and gives
every team feedback.`,
    ),
  },
  {
    path: 'people/katie-tholo/index.md',
    content: note(
      `type: Person
title: "Katie Tholo"
description: "Partnerships & Program Producer, Blackbird"
node: person:katie-tholo-2
tags: ["person", "programs", "sunrise"]`,
      `Produces [Sunrise](/sunrise/index.md) and looks after its partners.`,
    ),
  },
  {
    path: 'people/sofia-echesortu/index.md',
    content: note(
      `type: Person
title: "Sofia Echesortu"
description: "Portfolio Program Lead, Blackbird"
node: person:sofia-echesortu-2
tags: ["person", "programs"]`,
      `Creates the experiences and moments that hold the portfolio community
together, alongside [Katie Tholo](/people/katie-tholo/index.md) on
[Sunrise](/sunrise/index.md).`,
    ),
  },
]

// ---- Fund Operations ---------------------------------------------------------

const FUND_OPERATIONS_NOTES: SeedSubspace['notes'] = [
  {
    path: 'index.md',
    content: note(
      `title: "Fund Operations"
description: "LP reporting, capital calls, valuation and compliance — the work that lets the investment team invest."
tags: ["fund-operations"]`,
      `Finance, legal, compliance, investor relations and fundraising, under the
COO.

[Reporting](/reporting/index.md) is what goes to investors and when.
[Valuation](/valuation.md) is how the marks are set.

Nothing here flows up: the house's members can see this room's door and ask
to come in, and until they do they read none of it. Its events do flow up, so
the LP annual meeting still shows on the firm's calendar.`,
    ),
  },
  {
    path: 'reporting/index.md',
    content: note(
      `title: "Reporting"
description: "What investors receive, on what cadence, from which numbers."
tags: ["fund-operations", "reporting"]`,
      `One source of numbers, several audiences. [The cadence](/reporting/cadence.md)
says who gets what, and when.`,
    ),
  },
  {
    path: 'reporting/cadence.md',
    content: note(
      `type: Note
title: "Reporting cadence"
description: "Quarterly to investors, annually in public, and the portal in between."
tags: ["fund-operations", "reporting"]`,
      `- **Quarterly** — fund reports and capital account statements, through the
  investor portal.
- **Annually** — the public fund table on the website, discretionary funds
  only; co-investment vehicles are reported to their own investors.
- **The LP annual meeting** — founders on stage rather than slides.

Every number traces to the same close, and marks follow
[the valuation policy](/valuation.md).`,
    ),
  },
  {
    path: 'valuation.md',
    content: note(
      `type: Note
title: "Valuation policy"
description: "How the portfolio is marked, strengthened in 2022 and reviewed in public four years on."
tags: ["fund-operations", "valuation"]`,
      `Blackbird strengthened its valuation policy in 2022 (Rick Baker, "Strengthening
our Valuation Policy") and wrote up how it had held up in 2026 (Alex Apoifis,
"Four years on: How our valuation policy has held up").

The principle is the one investors ask for: a mark should be one a reasonable
buyer would recognise, and a change to it should be explainable in a sentence
in the [quarterly report](/reporting/cadence.md).`,
    ),
  },
  {
    path: 'people/index.md',
    content: note(
      `title: "People"
description: "Investor relations. Records of this room, joined to the same people in the house."
tags: ["fund-operations", "people"]`,
      `[Jasmin Jenkins](/people/jasmin-jenkins/index.md) and
[Tom Harvey](/people/tom-harvey/index.md) look after Blackbird's investors.`,
    ),
  },
  {
    path: 'people/jasmin-jenkins/index.md',
    content: note(
      `type: Person
title: "Jasmin Jenkins"
description: "Head of Investor Relations, Blackbird"
node: person:jasmin-jenkins-2
tags: ["person", "fund-operations"]`,
      `Connects LPs with all things Blackbird. Owns the
[reporting cadence](/reporting/cadence.md).`,
    ),
  },
  {
    path: 'people/tom-harvey/index.md',
    content: note(
      `type: Person
title: "Tom Harvey"
description: "Investor Relations Associate, Blackbird"
node: person:tom-harvey-2
tags: ["person", "fund-operations"]`,
      `Fundraising, LP communications and reporting, with
[Jasmin Jenkins](/people/jasmin-jenkins/index.md).`,
    ),
  },
]

// ---- Investment Committee ----------------------------------------------------

const COMMITTEE_NOTES: SeedSubspace['notes'] = [
  {
    path: 'index.md',
    content: note(
      `title: "Investment Committee"
description: "Where a memo becomes a yes or a no. A secret room: it is named nowhere outside itself."
tags: ["committee"]`,
      `The committee, not a team: the partners who say yes or no, and the
[minutes](/minutes/index.md) that record why.

Nothing here flows anywhere. A secret room keeps its context, its events and
its people, and the house's members are not told it exists — a decision under
discussion is not a thing to leak by drawing a locked row.`,
    ),
  },
  {
    path: 'minutes/index.md',
    content: note(
      `title: "Minutes"
description: "One note per meeting: the decision, the vote, and the strongest argument against."
tags: ["committee", "minutes"]`,
      `Deals are recorded by codename until they are announced. Next up:
[Project Banksia](/minutes/project-banksia.md).`,
    ),
  },
  {
    path: 'minutes/project-banksia.md',
    content: note(
      `type: Deal
title: "Project Banksia — committee"
description: "Seed, allied health documentation. Memo circulated; meeting Monday."
tags: ["committee", "deal"]`,
      `**For.** Founders who built it for their own clinic, now in forty; a clear
hour of every clinician's day that disappears.

**Against.** The general scribes may reach allied health before a specialist
reaches scale. Written by the least convinced, as always.

**To decide.** Whether the wedge is a market or a feature — and whether we
lead.`,
    ),
  },
]

// ---- the rooms ---------------------------------------------------------------

export const SUBSPACES: readonly SeedSubspace[] = [
  {
    id: 'investments',
    name: 'Investments',
    description: 'How the investment team finds, decides and backs founders: rivers of inquiry, process and the memo.',
    // A Department: the house's members walk in, everything flows up, and the
    // house's admins manage it.
    preset: 'department',
    members: [ADMIN_USER, MEMBER_USER],
    notes: INVESTMENTS_NOTES,
  },
  {
    id: 'programs',
    name: 'Programs',
    description: 'Giants, Foundry, Sunrise and the Foundation — free, no equity, open to the whole ecosystem.',
    // The one room the WORLD can find: listed, the house's members walk in,
    // strangers ask at the door.
    preset: 'programme',
    people: [
      { slug: 'josephine-tay', nodeId: 'person:josephine-tay-2', name: 'Josephine Tay', role: 'Giants Program Manager', org: 'Blackbird', location: 'Sydney, Australia', tag: 'giants' },
      { slug: 'saron-berhane', nodeId: 'person:saron-berhane-2', name: 'Saron Berhane', role: 'Foundry Lead', org: 'Blackbird', location: 'Sydney, Australia', tag: 'foundry' },
      { slug: 'katie-tholo', nodeId: 'person:katie-tholo-2', name: 'Katie Tholo', role: 'Partnerships & Program Producer', org: 'Blackbird', location: 'Sydney, Australia', tag: 'sunrise' },
      { slug: 'sofia-echesortu', nodeId: 'person:sofia-echesortu-2', name: 'Sofia Echesortu', role: 'Portfolio Program Lead', org: 'Blackbird', location: 'Sydney, Australia', tag: 'programs' },
    ],
    members: [ADMIN_USER, MEMBER_USER],
    notes: PROGRAMS_NOTES,
  },
  {
    id: 'fund-operations',
    name: 'Fund Operations',
    description: 'LP reporting, capital calls, valuation and compliance.',
    // A Council with its notes kept to itself: the house's members see the door
    // and ask; nothing of its context flows up, its events do.
    preset: 'council',
    flowContext: false,
    people: [
      { slug: 'jasmin-jenkins', nodeId: 'person:jasmin-jenkins-2', name: 'Jasmin Jenkins', role: 'Head of Investor Relations', org: 'Blackbird', location: 'Sydney, Australia', tag: 'investor-relations' },
      { slug: 'tom-harvey', nodeId: 'person:tom-harvey-2', name: 'Tom Harvey', role: 'Investor Relations Associate', org: 'Blackbird', location: 'Sydney, Australia', tag: 'investor-relations' },
    ],
    members: [ADMIN_USER],
    // Dev Member pressed Join on a door set to `ask` — Members → Wants to join.
    pending: [MEMBER_USER],
    notes: FUND_OPERATIONS_NOTES,
  },
  {
    id: 'investment-committee',
    name: 'Investment Committee',
    description: 'Where a memo becomes a yes or a no. A secret room: it is named nowhere outside itself.',
    // A Committee: listing `secret`, so the switcher, the tree and the console
    // say nothing about it to anyone who is not in it.
    preset: 'committee',
    members: [ADMIN_USER],
    notes: COMMITTEE_NOTES,
  },
]
