/**
 * Visvine HQ's rooms — the teams inside the house, plus the one committee that
 * is not a team (docs/sub-spaces.md).
 *
 * A room is named after the team that works in it, so the switcher, the context
 * tree and the console read the way an org chart does: Engineering, Marketing,
 * Finance, then Compensation. Between them every dial is on screen from the
 * first seed:
 *
 *   • Engineering is a Department — the house walks in, its context, events and
 *     people all flow up, and the house's admins manage it.
 *   • Marketing is the room the WORLD can find: it runs the public programme,
 *     so it is listed, strangers ask at the door, and the agency and press
 *     contacts it keeps flow up into the house's directory as read-only rows.
 *   • Finance is a Council: the house's members see the door and ask through
 *     it, its events flow up and its numbers do not.
 *   • Compensation is a Committee: secret, named nowhere outside its own
 *     members, flowing nothing.
 *
 * All four are provisioned the way the New sub-space dialog does it, so `id` is
 * what provisionSpace derives from the name (the seed asserts it). Dev Admin
 * administers all four (they created them); Dev Member is in Engineering and
 * Marketing, and waiting at Finance's door — so signing in as them shows
 * exactly what a parent's member sees: rooms they are in, a room they have
 * asked to join, and no sign at all that the fourth one exists.
 *
 * Every room gets its own context, not a token note: a curated root index, the
 * folders a team of that kind actually keeps, and notes that link to each
 * other. Links are absolute (`/path.md`) and point only at notes written here —
 * an index body's links are checked by `db:notes:verify`, and a person note's
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
   * People who belong to the ROOM and not to the house — directory records of
   * its own, reached in the room and, for the same identity, from the
   * person's page in the house. Written as nodes first, then as the notes
   * that name them.
   */
  people?: ReadonlyArray<{
    slug: string
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

// ---- Engineering -------------------------------------------------------------

const ENGINEERING_NOTES: SeedSubspace['notes'] = [
  {
    path: 'index.md',
    content: note(
      `title: "Engineering"
description: "How the platform is built, run and decided: runbooks, the services behind them, and the calls we do not want to make twice."
tags: ["engineering"]`,
      `The team that builds Visvine. Everything written here is meant to be read at
3am by whoever is on call, not admired in a planning session.

Three things live in this room: the [runbooks](/runbooks/index.md) for anything
that has to be done under pressure, one note per [service](/services/index.md)
we run, and the [decisions](/decisions/index.md) we would otherwise re-argue
every quarter.

Context flows up to Visvine HQ read-only, so anyone in the house can read a
runbook, and only this room can change one.`,
    ),
  },
  {
    path: 'runbooks/index.md',
    content: note(
      `title: "Runbooks"
description: "One page per thing that has to be done under pressure. Steps, not theory."
tags: ["engineering", "runbook"]`,
      `A runbook is a page you can follow while something is on fire. Numbered steps,
the command spelled out, and the one thing that will go wrong written down.

Start with [deploys](/runbooks/deploys.md). When something is already broken,
[incidents](/runbooks/incidents.md) says who does what, and
[on-call](/runbooks/on-call.md) says who that currently is.`,
    ),
  },
  {
    path: 'runbooks/deploys.md',
    content: note(
      `type: Note
title: "Deploying"
description: "main is the deployed branch. What a push actually does, and how to get back."
tags: ["engineering", "runbook", "deploy"]`,
      `\`main\` is the deployed branch: a merge builds the image, runs the migrations
and rolls the revision. Nothing else deploys.

1. Check the migration. A rename the generator guessed as drop-and-create is a
   wipe — read the SQL before it ships.
2. Push. The build replays migrations; it never diffs a schema.
3. Watch the new revision take traffic. Errors surface as grouped events, so a
   spike is one line, not a log trawl.
4. If it is wrong, roll the revision back first and fix forward second. A
   migration does not roll back with it — that is the whole reason step 1 is
   step 1.

Related: [incidents](/runbooks/incidents.md), and the services this touches in
[the web app](/services/web.md).`,
    ),
  },
  {
    path: 'runbooks/incidents.md',
    content: note(
      `type: Note
title: "Incidents"
description: "Who does what while it is broken, and what gets written down afterwards."
tags: ["engineering", "runbook", "incident"]`,
      `One person runs the incident and does not also debug it. Everyone else reports
to them, in one place, in writing.

- **Declare** it in the house's \`#support\` channel with one sentence: what is
  broken, for whom, since when.
- **Mitigate** before diagnosing. A rollback that costs a feature beats an hour
  of correct reasoning while customers are down — see
  [deploys](/runbooks/deploys.md).
- **Write it up** the same week, as a decision or a runbook change. An incident
  that changes nothing will happen again.

The rotation is in [on-call](/runbooks/on-call.md).`,
    ),
  },
  {
    path: 'runbooks/on-call.md',
    content: note(
      `type: Note
title: "On-call"
description: "The rotation, what it covers, and what it is fair to be woken for."
tags: ["engineering", "runbook", "on-call"]`,
      `A week at a time, handed over on Monday morning with a short note on anything
still warm.

On-call covers the two things a customer notices: the app not answering, and
agent runs not firing. Everything else waits for the working day, including a
failing nightly clean — it is designed to skip a night, not to replay one.

Being woken for an alert that needed no action is a bug in the alert. Turn it
into a warning and say so in the handover.`,
    ),
  },
  {
    path: 'decisions/index.md',
    content: note(
      `title: "Decisions"
description: "The calls that shaped the platform, with the reasoning that made them, so they are not re-argued every quarter."
tags: ["engineering", "decision"]`,
      `One note per decision: what we chose, what we gave up, and what would have to
change for it to be wrong.

- [Context flows up, never down](/decisions/0012-context-flows-up.md)
- [The connector isolate is never asyncified](/decisions/0013-quickjs-not-asyncify.md)`,
    ),
  },
  {
    path: 'decisions/0012-context-flows-up.md',
    content: note(
      `type: Note
title: "0012 — Context flows up, never down"
description: "A room's notes can be read by the house; the house's notes are not pushed into rooms."
tags: ["engineering", "decision", "sub-spaces"]`,
      `**Decided.** A sub-space's context flows UP into its parent as a read-only
folder. The house's own context is never copied down; a house note reaches a
room only when it is explicitly shared, and then it is read-only there too.

**Why.** Two customers asked for the opposite thing in the same week. One wanted
the parent to see everything its programmes wrote; the other wanted the parent's
handbook pushed into every room. Flowing up satisfies the first exactly, and the
second turns out to be a sharing flag on one note rather than a copy of a whole
context.

**Given up.** A room cannot inherit the house's folder structure. It starts
empty, which feels bare for the first week.

**Wrong if.** Rooms start duplicating the same handbook note by hand. That is the
signal that share-down should cover more than connectors, agents and tools.`,
    ),
  },
  {
    path: 'decisions/0013-quickjs-not-asyncify.md',
    content: note(
      `type: Note
title: "0013 — The connector isolate is never asyncified"
description: "Host capabilities are sync functions returning a promise the host settles. The asyncify transform corrupts after a call or two."
tags: ["engineering", "decision", "connectors"]`,
      `**Decided.** Connector code runs in one QuickJS-WASM isolate whose host
capabilities — fetch, sql, mcp — are synchronous functions that return a promise
the host settles later. We do not use the asyncify build.

**Why.** Asyncify corrupts state after the first or second suspended call. An
OAuth exchange is two calls before it has done anything useful, so the failure
mode is "works in the demo, breaks in production".

**Given up.** Every new capability has to be written in the settle-a-promise
shape by hand. Non-HTTP protocols need a new host function rather than a
library.

**Wrong if.** The upstream transform ships a fix and a 25-call regression test
passes against it.`,
    ),
  },
  {
    path: 'services/index.md',
    content: note(
      `title: "Services"
description: "What we run, what each part owns, and where it fails first."
tags: ["engineering", "service"]`,
      `One note per thing that can be paged about: [the web app](/services/web.md)
and [the agent runner](/services/agent-runner.md). Each says what it owns, what
it depends on, and the failure it has actually had.`,
    ),
  },
  {
    path: 'services/web.md',
    content: note(
      `type: Note
title: "Web app"
description: "The Next.js app and its API. Scales to zero, runs as N processes — both of which constrain what code may assume."
tags: ["engineering", "service"]`,
      `Everything a browser, the mobile clients and the MCP server touch.

Two properties decide most of its design. It **scales to zero**, so no in-process
timer ever fires — background work is a scheduled job hitting an internal route.
And it runs as **N processes**, so no counter, cache or rate limit may live in a
Map; those are rows.

Fails first at: a long-held request. Anything that streams, polls or awaits
carries its own deadline well short of the platform timeout, because instance
time is billed until the client hangs up.`,
    ),
  },
  {
    path: 'services/agent-runner.md',
    content: note(
      `type: Note
title: "Agent runner"
description: "The minute tick that claims due work, dispatches runs, and is the one thing on-call is woken for at night."
tags: ["engineering", "service", "agents"]`,
      `A tick claims due rows with a conditional update that advances the next run
itself, so ten instances racing produce one run and a night the deployment was
down is skipped rather than replayed.

A run is identity-per-run: the brief's author, then once per subscriber, each
under their own principal — which is why a connector a person has not signed in
to fails for them and nobody else.

Fails first at: a model provider key. A space with no key has agents that parse,
schedule and refuse at dispatch; the readiness check exists so that is found at
5pm rather than 3am. See [on-call](/runbooks/on-call.md).`,
    ),
  },
]

// ---- Marketing ---------------------------------------------------------------

const MARKETING_NOTES: SeedSubspace['notes'] = [
  {
    path: 'index.md',
    content: note(
      `title: "Marketing"
description: "Campaigns, the brand they are said in, and the outside people who help say it."
tags: ["marketing"]`,
      `The room where anything the public sees is planned before it is public.

[Campaigns](/campaigns/index.md) is the work in flight. [Brand](/brand/index.md)
is how it is allowed to sound. [People](/people/index.md) is the agency and press
contacts we work with — they are this room's records, and the house's directory
shows them read-only.

This is the one room strangers can find: the programme it runs is public, so the
room is listed and anyone can ask at the door.`,
    ),
  },
  {
    path: 'campaigns/index.md',
    content: note(
      `title: "Campaigns"
description: "One note per campaign: the claim, the audience, the date, and what it was worth afterwards."
tags: ["marketing", "campaign"]`,
      `A campaign note is written before the work starts and finished after it lands.
No note, no spend.

In flight: [the Q4 launch](/campaigns/2026-q4-launch.md) and
[demo day](/campaigns/demo-day.md).`,
    ),
  },
  {
    path: 'campaigns/2026-q4-launch.md',
    content: note(
      `type: Note
title: "Q4 launch — rooms for teams"
description: "Launching sub-spaces to the people who already asked for them, not to a general audience."
tags: ["marketing", "campaign"]`,
      `**Claim.** A space can hold rooms: one per team, each with its own members and
its own notes, and what the house should see flows up by itself.

**Audience.** The spaces already running more than one programme out of one
context. They asked for this; they do not need convincing, they need to know it
shipped.

**Shape.** A written changelog post, one walkthrough at
[demo day](/campaigns/demo-day.md), and a note to each design partner from the
person who already talks to them. No paid anything.

**Worth it if.** Half the spaces that asked have a room a fortnight later. If
they read it and do nothing, the feature is not the problem — the first five
minutes of it are.

Said in the voice described in [brand voice](/brand/voice.md).`,
    ),
  },
  {
    path: 'campaigns/demo-day.md',
    content: note(
      `type: Note
title: "Demo day"
description: "Every partner shows the one thing they changed in their own space this quarter."
tags: ["marketing", "campaign", "event"]`,
      `Quarterly, public, and deliberately not a product pitch: partners demo their own
space, and we say nothing for the first hour.

Run sheet lives with the event. Press is invited, not briefed — the
[editor we work with](/people/joss-linden/index.md) comes to the same session
everyone else does, which has never once cost us a fair write-up.

The run-of-show slides are built with [the studio](/people/tui-ranapia/index.md),
against [the naming rules](/brand/naming.md).`,
    ),
  },
  {
    path: 'brand/index.md',
    content: note(
      `title: "Brand"
description: "How Visvine sounds and what it calls things. Two rules, both enforceable."
tags: ["marketing", "brand"]`,
      `Everything here is meant to settle an argument in a draft, not to inspire
anyone: [voice](/brand/voice.md) and [naming](/brand/naming.md).`,
    ),
  },
  {
    path: 'brand/voice.md',
    content: note(
      `type: Note
title: "Voice"
description: "Plain sentences, concrete nouns, no adjectives about growth."
tags: ["marketing", "brand"]`,
      `Write the way the product's own notes are written.

- Say what a thing does before saying why it matters.
- Numbers or nothing. "Faster" is not a claim; "one read instead of four" is.
- No adjectives about growth, no "excited to announce", no exclamation marks in
  a headline.
- If a sentence would embarrass an engineer who read the code, cut it.

The test: could the person who built it post this unchanged?`,
    ),
  },
  {
    path: 'brand/naming.md',
    content: note(
      `type: Note
title: "Naming"
description: "The product's words, used exactly as the product uses them."
tags: ["marketing", "brand"]`,
      `A feature is called what it is called in the app. Synonyms in marketing copy
cost support tickets, every time.

- The notes surface is **Context**. Never "docs", never "wiki".
- A tenant is a **space**; a space inside a space is a **sub-space**, and in
  conversation, a **room**.
- A **connector** is the note that reaches a service; the service is not "an
  integration".
- An **agent** is one brief in one folder. It is not a "bot".

New words get agreed here before they appear anywhere public.`,
    ),
  },
  {
    path: 'people/index.md',
    content: note(
      `title: "People"
description: "The outside people this room works with: the studio and the press. Read-only in the house's directory."
tags: ["marketing", "people"]`,
      `Records this room keeps, because marketing is the team that actually talks to
them: [Tui Ranapia](/people/tui-ranapia/index.md) at the studio and
[Joss Linden](/people/joss-linden/index.md) at the trade weekly.

They flow up into Visvine HQ's directory as read-only cards, so nobody in the
house has to ask who our agency is.`,
    ),
  },
  {
    path: 'people/tui-ranapia/index.md',
    content: note(
      `type: Person
title: "Tui Ranapia"
description: "Brand Partner, Kāhu Studio"
node: person:tui-ranapia
tags: ["person", "marketing", "agency"]`,
      `Runs everything visual we ship: the launch pages, the deck skeletons and the
one-pager partners leave [demo day](/campaigns/demo-day.md) holding.

Keeps us honest about [naming](/brand/naming.md) — the first person to point out
that we called the same feature three things in one launch.`,
    ),
  },
  {
    path: 'people/joss-linden/index.md',
    content: note(
      `type: Person
title: "Joss Linden"
description: "Editor, Southern Grid Weekly"
node: person:joss-linden
tags: ["person", "marketing", "press"]`,
      `Covers the regional innovation beat and has been to three
[demo days](/campaigns/demo-day.md).

Wants the number, the customer's own words and a straight answer about what does
not work yet. Briefing them in the [voice](/brand/voice.md) we write in has
always gone better than a press release.`,
    ),
  },
]

// ---- Finance -----------------------------------------------------------------

const FINANCE_NOTES: SeedSubspace['notes'] = [
  {
    path: 'index.md',
    content: note(
      `title: "Finance"
description: "The board pack, the plan behind it, and the policies that keep the two agreeing."
tags: ["finance"]`,
      `The numbers and what they are being used to argue.

[Board](/board/index.md) is what leaves the building.
[Planning](/planning/index.md) is what it was built from, and
[policies](/policies/index.md) is the small set of rules that keep everyone
else out of a spreadsheet.

Nothing here flows up: the house's members can see this room's door and ask to
come in, and until they do they read none of it. Its events do flow up, so a
month-end close still shows on the company calendar.`,
    ),
  },
  {
    path: 'board/index.md',
    content: note(
      `title: "Board"
description: "Packs, in the order they were sent. What the board asked for is the table of contents."
tags: ["finance", "board"]`,
      `One note per pack, written the week before, not the night before. Current:
[Q3 2026](/board/2026-q3-pack.md).`,
    ),
  },
  {
    path: 'board/2026-q3-pack.md',
    content: note(
      `type: Note
title: "Q3 2026 board pack"
description: "Retention by segment, the hiring plan against runway, and a straight answer on enterprise pipeline."
tags: ["finance", "board"]`,
      `Three things the board asked for, in their words:

1. **Net revenue retention by segment.** Accelerators expand, universities
   renew flat, and one coworking account is the whole of the churn line.
2. **The hiring plan against runway.** Two engineering roles and nothing else
   until the plan in [FY27](/planning/fy27-budget.md) is signed;
   [runway](/planning/runway.md) says what that costs in months.
3. **Enterprise pipeline, honestly.** Four conversations, one of them real. The
   other three have no budget holder in the room yet.

Not for the wider team until it has been presented.`,
    ),
  },
  {
    path: 'planning/index.md',
    content: note(
      `title: "Planning"
description: "The plan the packs are cut from: next year's budget and the runway it implies."
tags: ["finance", "planning"]`,
      `Two live notes: [the FY27 budget](/planning/fy27-budget.md) and
[runway](/planning/runway.md). Everything in a
[board pack](/board/2026-q3-pack.md) is derived from them, never re-typed.`,
    ),
  },
  {
    path: 'planning/fy27-budget.md',
    content: note(
      `type: Note
title: "FY27 budget"
description: "Draft: headcount first, infrastructure second, everything else held flat."
tags: ["finance", "planning", "budget"]`,
      `Built bottom-up from headcount, because nothing else moves the number much.

- **People.** Two engineers, both in the first half. No marketing hire until the
  Q4 launch has a result to argue from.
- **Infrastructure.** Scales with agent runs, not with seats. Model spend is
  capped per space, so the ceiling is knowable rather than discovered.
- **Everything else** is held at this year's number, and anything above it is a
  request with a sentence attached.

Still a draft: it does not go in a [pack](/board/2026-q3-pack.md) until the
hiring dates are real.`,
    ),
  },
  {
    path: 'planning/runway.md',
    content: note(
      `type: Note
title: "Runway"
description: "Months left at current burn, and what each hire costs in months."
tags: ["finance", "planning"]`,
      `One number, re-cut monthly at close, and one sentence per thing that changed
it.

The useful framing for an argument is not "can we afford this" but "this hire
costs four months, this one costs three" — every proposal in
[FY27](/planning/fy27-budget.md) is priced that way before it is discussed.`,
    ),
  },
  {
    path: 'policies/index.md',
    content: note(
      `title: "Policies"
description: "The short rules that keep everyone else out of a spreadsheet."
tags: ["finance", "policy"]`,
      `Kept deliberately short: [expenses](/policies/expenses.md) and
[approvals](/policies/approvals.md). If a policy needs a second page, the process
is wrong.`,
    ),
  },
  {
    path: 'policies/expenses.md',
    content: note(
      `type: Note
title: "Expenses"
description: "Spend it like it is yours, receipt it like it is not."
tags: ["finance", "policy"]`,
      `Anything under the monthly threshold needs a receipt and a reason, and no
approval. Above it, ask first — see [approvals](/policies/approvals.md).

Travel is booked for the cheapest option that still gets you there able to work.
Software you can expense is software the team can also see: a tool bought
quietly is a tool nobody else finds.`,
    ),
  },
  {
    path: 'policies/approvals.md',
    content: note(
      `type: Note
title: "Approvals"
description: "Who says yes to what, and the one thing that always needs two people."
tags: ["finance", "policy"]`,
      `A manager approves inside their own budget line. Anything that creates a new
recurring cost goes to this room, whatever the amount — the monthly number is
what [runway](/planning/runway.md) is made of.

Two people, always, for anything that moves money out: one to raise it, one to
release it. No exceptions for speed.`,
    ),
  },
]

// ---- Compensation ------------------------------------------------------------

const COMPENSATION_NOTES: SeedSubspace['notes'] = [
  {
    path: 'index.md',
    content: note(
      `title: "Compensation"
description: "Bands, offers and the review cycle. A secret room: it is named nowhere outside itself."
tags: ["compensation"]`,
      `The committee, not a team: three people who set [bands](/bands/index.md) and
answer for them.

Nothing here flows anywhere. A secret room keeps its context, its events and its
people, and the house's members are not told it exists — which is the point: an
offer under discussion is not a thing to leak by drawing a locked row.`,
    ),
  },
  {
    path: 'bands/index.md',
    content: note(
      `title: "Bands"
description: "What each level pays, how an offer is built from it, and when it is all re-cut."
tags: ["compensation"]`,
      `[The 2026 review cycle](/bands/2026-review.md) is the current cut;
[offers](/bands/offer-guidelines.md) is how one becomes a number in a letter.`,
    ),
  },
  {
    path: 'bands/2026-review.md',
    content: note(
      `type: Note
title: "2026 review cycle"
description: "Bands re-cut in March, benchmarked against them since."
tags: ["compensation"]`,
      `Re-cut in March against market data for the same stage and the same city, then
held for the year so an offer made in November is the same offer made in April.

Two rules that have saved arguments: a band is a range and most people sit in the
middle of it, and a raise inside a band is a manager's call while a move between
bands is this room's.`,
    ),
  },
  {
    path: 'bands/offer-guidelines.md',
    content: note(
      `type: Note
title: "Offer guidelines"
description: "How a band becomes a number, and what is never negotiated."
tags: ["compensation"]`,
      `Offer at the band's midpoint unless there is a written reason not to, and say
the band out loud in the conversation — see
[the 2026 cycle](/bands/2026-review.md).

Never negotiated: the same role at the same level pays the same regardless of
who asked. A candidate who negotiates well is not a candidate who is worth more,
and the cost of pretending otherwise arrives two years later.`,
    ),
  },
]

// ---- the rooms ---------------------------------------------------------------

export const SUBSPACES: readonly SeedSubspace[] = [
  {
    id: 'engineering',
    name: 'Engineering',
    description: 'How the platform is built and run: runbooks, services and the decisions behind them.',
    // A Department: the house's members walk in, everything flows up, and the
    // house's admins manage it.
    preset: 'department',
    people: [
      {
        slug: 'rangi-corbett',
        name: 'Rangi Corbett',
        role: 'Platform Contractor',
        org: 'Independent',
        location: 'Ōtepoti Dunedin',
        tag: 'engineering',
      },
    ],
    members: [ADMIN_USER, MEMBER_USER],
    notes: ENGINEERING_NOTES,
  },
  {
    id: 'marketing',
    name: 'Marketing',
    description: 'Campaigns, the brand they are said in, and the public programme the world is invited to.',
    // The one room the WORLD can find: listed, the house's members walk in,
    // strangers ask at the door.
    preset: 'programme',
    people: [
      {
        slug: 'tui-ranapia',
        name: 'Tui Ranapia',
        role: 'Brand Partner',
        org: 'Kāhu Studio',
        location: 'Tāmaki Makaurau Auckland',
        tag: 'agency',
      },
      {
        slug: 'joss-linden',
        name: 'Joss Linden',
        role: 'Editor',
        org: 'Southern Grid Weekly',
        location: 'Te Whanganui-a-Tara Wellington',
        tag: 'press',
      },
    ],
    members: [ADMIN_USER, MEMBER_USER],
    notes: MARKETING_NOTES,
  },
  {
    id: 'finance',
    name: 'Finance',
    description: 'Board packs, the plan behind them, and the policies that keep the two agreeing.',
    // A Council with its notes kept to itself: the house's members see the door
    // and ask; nothing of its context flows up, its events do.
    preset: 'council',
    flowContext: false,
    members: [ADMIN_USER],
    // Dev Member pressed Join on a door set to `ask` — Members → Wants to join.
    pending: [MEMBER_USER],
    notes: FINANCE_NOTES,
  },
  {
    id: 'compensation',
    name: 'Compensation',
    description: 'Bands, offers and the review cycle. A secret room: it is named nowhere outside itself.',
    // A Committee: listing `secret`, so the switcher, the tree and the console
    // say nothing about it to anyone who is not in it.
    preset: 'committee',
    members: [ADMIN_USER],
    notes: COMPENSATION_NOTES,
  },
]
