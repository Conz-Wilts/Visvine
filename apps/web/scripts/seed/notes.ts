/**
 * The notes Visvine HQ runs on — content only; scripts/seed/run.ts writes them.
 *
 * Two contexts:
 *   • the SHARED space context — the working knowledge base generated from
 *     ./dataset.ts: one entity note per organisation and per person, segment
 *     pages, the team, the product's roadmap and decisions, the pipeline and
 *     the revenue data.
 *   • a PERSONAL context (the space admin's) — a small self-contained set of
 *     working notes (journal, meetings, discovery calls, prospects, todos)
 *     cross-linked to each other and to nothing shared.
 *
 * Every internal reference is an absolute `/path.md` link, which is what makes
 * the graph light up: a `[[Mention]]` is ordinary markdown link sugar, and an
 * ENTITY note's links to other entity notes become directory edges
 * (relationship 'mentioned', origin 'context') the moment the note is written
 * through the store. A plain note's links draw no edges — only a note that IS a
 * node can own them (lib/notes/entityLinks.ts).
 *
 * Deliberately writes no `type: Index` on an index note (the shape is the
 * path) and no listing of a folder's own children in its body: the app owns
 * that block (`<!-- index:children -->`) and fills it as children land. The
 * one-liner that would have gone in a parent's list goes in each child's
 * `description:` instead.
 */

import { buildModel, type ResolvedOrg, type ResolvedPerson } from './model'
import { SEGMENT_BLURB, SPACE_NAME, slugify, type Segment } from './space'
import type { SeedOrg } from './dataset'

const model = buildModel()

// ---- markdown emitters -------------------------------------------------------

export interface Note {
  path: string
  content: string
}

/**
 * Frontmatter as YAML the app's `yaml` parser accepts. Every scalar is emitted
 * via JSON.stringify (a JSON string is a valid YAML double-quoted scalar), so
 * titles and descriptions containing `:` `&` or quotes always parse correctly.
 */
function fm(obj: Record<string, unknown>): string {
  const lines: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === '') continue
    if (Array.isArray(v)) {
      const arr = v.filter((x) => x !== null && x !== undefined && x !== '')
      if (!arr.length) continue
      lines.push(`${k}: [${arr.map((x) => JSON.stringify(String(x))).join(', ')}]`)
    } else {
      lines.push(`${k}: ${JSON.stringify(String(v))}`)
    }
  }
  return lines.join('\n')
}

/**
 * Drop a leading `# Heading` from a body: the note title renders from
 * frontmatter, so a body-level title would duplicate it (and the verifier
 * checks for exactly that).
 */
function stripLeadingHeading(body: string): string {
  const t = body.trim()
  const m = t.match(/^#{1,6}[ \t]+.*(?:\r?\n|$)/)
  return m ? t.slice(m[0].length).replace(/^\s*\r?\n/, '') : t
}

/**
 * A note's full markdown. Matches joinFrontmatter's shape.
 *
 * An INDEX note deliberately carries no list of its own children: that listing
 * is managed by the app (the `<!-- index:children -->` block
 * scripts/rebuild-index-notes.ts maintains), and a hand-written one is folded
 * into it on the next rebuild. What survives — and what makes that block worth
 * reading — is each child's own `description:`, so the one-liner that would
 * have gone in the parent's list goes in the child's frontmatter instead.
 */
function note(into: Note[], path: string, frontmatter: Record<string, unknown>, body: string): void {
  into.push({ path, content: `---\n${fm(frontmatter)}\n---\n\n${stripLeadingHeading(body)}\n` })
}

/** Internal link → graph edge when both ends are entity notes. */
const link = (label: string, absPath: string) => `[${label}](${absPath})`
/** External link → rendered, never a graph edge (http/mailto are dropped). */
const ext = (label: string, url: string | null | undefined) => (url ? `[${label}](${url})` : null)
const joinDot = (parts: Array<string | null | undefined>) => parts.filter(Boolean).join('   ·   ')

const money = (n: number) => `$${n.toLocaleString('en-NZ')}`
const perMonth = (n: number) => `${money(n)}/mo`

// ---- paths -------------------------------------------------------------------

const segmentPath = (label: Segment) => `/segments/${slugify(label)}.md`
/** Only emits a link when the segment page exists — rule 5 of the verifier. */
const segmentLink = (label: Segment) =>
  model.orgsBySegment.has(label) ? link(label, segmentPath(label)) : label
const orgPath = (org: ResolvedOrg) => `/spaces/${org.slug}/index.md`
const orgLink = (org: ResolvedOrg) => link(org.org.name, orgPath(org))
const personPath = (person: ResolvedPerson) => `/people/${person.slug}/index.md`
const personLink = (person: ResolvedPerson) => link(person.name, personPath(person))
/** Reference an organisation by display name; plain text if we don't hold one. */
function orgByName(name: string): string {
  const found = model.orgByName.get(name.trim().toLowerCase())
  return found ? orgLink(found) : name
}

const RELATIONSHIP_LABEL: Record<SeedOrg['relationship'], string> = {
  customer: 'Customer',
  'design-partner': 'Design partner',
  prospect: 'Prospect',
  investor: 'Investor',
  partner: 'Delivery partner',
}

const HEALTH_LABEL: Record<string, string> = { green: 'Green', amber: 'Amber', red: 'Red' }

// ---- roll-ups ----------------------------------------------------------------

const customers = model.orgs.filter((o) => o.org.relationship === 'customer')
const designPartners = model.orgs.filter((o) => o.org.relationship === 'design-partner')
const prospects = model.orgs.filter((o) => o.org.relationship === 'prospect')
const investors = model.orgs.filter((o) => o.org.relationship === 'investor')
const partners = model.orgs.filter((o) => o.org.relationship === 'partner')

const totalMrr = customers.reduce((a, o) => a + (o.org.mrr ?? 0), 0)
const totalSeats = [...customers, ...designPartners].reduce((a, o) => a + (o.org.seats ?? 0), 0)
const pipelineMrr = prospects.reduce((a, o) => a + (o.org.expectedMrr ?? 0), 0)
const raised = investors.reduce((a, o) => a + (o.org.cheque ?? 0), 0)
const atRisk = customers.filter((o) => o.org.health === 'red' || o.org.health === 'amber')

const STAGE_ORDER = ['Contract', 'Proposal', 'Trial', 'Discovery'] as const

// ---- shared context ----------------------------------------------------------

export const shared: Note[] = []

note(shared, 'index.md', { title: SPACE_NAME, tags: ['home', 'company'] }, `
Visvine building Visvine. Every space that runs on us is a record in here, the
people who run them are beside it, and the product decisions that got us here are
written down rather than remembered.

${model.orgs.length} organisations, ${model.people.length} people, ${perMonth(totalMrr)} of recurring revenue and
${prospects.length} live deals. The folders below are the whole of it.

> Every note here is plain Markdown. Link one with its context-root path and the
> connection shows up in the **Graph** tab — that is the whole trick.
`)

note(shared, 'strategy.md', { type: 'Note', title: 'Strategy', description: 'who we build for, and who we do not', tags: ['strategy', 'company'] }, `
We sell to people who are responsible for a community and cannot see it. A
programme director with four cohorts in a spreadsheet, a chamber with 260 member
organisations in a mailing list, an agency paid to grow an ecosystem it cannot
map. They all have the same problem: the knowledge is real, and it is trapped in
somebody's inbox.

## What we believe

- **The notes are the product.** A directory nobody writes into goes stale in a
  month. Everything we build has to make writing the easy option.
- **Private by default, shared on purpose.** Every space we have won cared more
  about who can see a thing than about any feature.
- **The graph earns its place or it goes.** It has to answer a question the list
  cannot.
- **Their data stays theirs.** No cross-space mining, no "insights" they did not
  ask for.

## Where we lean in

${(['Accelerators & Incubators', 'Venture Capital', 'Industry Bodies', 'Universities & Research', 'Economic Development'] as const)
  .map((s) => `- ${segmentLink(s)} — ${SEGMENT_BLURB[s]}`)
  .join('\n')}

The full picture is in ${link('Segments', '/segments/index.md')}; what we are
building next is in ${link('Product', '/product/index.md')}, and the honest state
of the numbers is in ${link('Data', '/data/index.md')}.

## Where we do not play

Single-team workspaces — that is a different product with better-funded
competitors. If a buyer does not have members, we are the wrong tool.
`)

// ---- organisations -----------------------------------------------------------

note(
  shared,
  'spaces/index.md',
  {
    title: 'Organisations',
    description: `all ${model.orgs.length} of them: customers, design partners, pipeline, investors and partners`,
    tags: ['organisations'],
  },
  `
${model.orgs.length} organisations: ${customers.length} paying customers, ${designPartners.length} design partners,
${prospects.length} in the pipeline, ${investors.length} investors and ${partners.length} delivery partners. Every one of
them is a folder here, and the folder's index is the record.

Cut a different way: ${link('Customers', '/spaces/customers.md')} by revenue,
${link('Investors', '/spaces/investors.md')} by cheque, ${link('Partners', '/spaces/partners.md')} by what they
do for us, or ${link('Segments', '/segments/index.md')} for the same list grouped by the kind of
space it is.
`,
)

for (const resolved of model.orgs) {
  const org = resolved.org
  const facts: string[] = [
    `- **Segment:** ${segmentLink(org.segment)}`,
    `- **Relationship:** ${RELATIONSHIP_LABEL[org.relationship]}${org.since ? `   ·   **Since:** ${org.since}` : ''}`,
    `- **Based in:** ${org.location}`,
  ]
  if (org.relationship === 'customer' || org.relationship === 'design-partner') {
    facts.push(
      `- ${joinDot([
        org.plan ? `**Plan:** ${org.plan}` : null,
        org.seats ? `**Seats:** ${org.seats}` : null,
        typeof org.mrr === 'number' ? `**MRR:** ${org.mrr === 0 ? 'nil (design partner)' : perMonth(org.mrr)}` : null,
        org.health ? `**Health:** ${HEALTH_LABEL[org.health]}` : null,
      ])}`,
    )
  }
  if (org.relationship === 'prospect') {
    facts.push(
      `- ${joinDot([
        org.stage ? `**Stage:** ${org.stage}` : null,
        org.expectedMrr ? `**Expected:** ${perMonth(org.expectedMrr)}` : null,
      ])}`,
    )
  }
  if (org.relationship === 'investor') {
    facts.push(
      `- ${joinDot([org.round ? `**Round:** ${org.round}` : null, org.cheque ? `**Cheque:** ${money(org.cheque)}` : null])}`,
    )
  }

  const sections: string[] = [org.description, '', facts.join('\n')]

  if (org.useCase) sections.push('', '## What they use it for', org.useCase)

  if (org.relationship === 'prospect' && org.nextStep) {
    sections.push('', '## Next step', org.nextStep, '', `Tracked on the ${link('pipeline', '/deals/pipeline.md')}.`)
  }

  if (resolved.people.length) {
    sections.push('', '## People')
    for (const p of resolved.people) {
      sections.push(`- ${personLink(p)} — ${p.role}${p.bio ? `. ${p.bio}` : ''}`)
    }
  }

  // Who looks after them, from the team's own account list — this is what puts
  // a team member and their accounts next to each other in the graph.
  const owners = model.team.filter((t) => (t.team?.accounts ?? []).includes(org.name))
  if (owners.length) {
    sections.push('', '## Who looks after them', owners.map((t) => `- ${personLink(t)} — ${t.role}`).join('\n'))
  }

  const links = [ext('Website', `https://${resolved.slug}.example.com`)].filter(Boolean)
  if (links.length) sections.push('', '## Links', `- ${links.join('   ·   ')}`)

  const footer: string[] = [`Part of ${link('Organisations', '/spaces/index.md')}`, segmentLink(org.segment)]
  if (org.relationship === 'customer') footer.push(link('Customers', '/spaces/customers.md'))
  if (org.relationship === 'prospect') footer.push(link('Pipeline', '/deals/pipeline.md'))
  if (org.relationship === 'investor') footer.push(link('Investors', '/spaces/investors.md'))
  if (org.relationship === 'partner') footer.push(link('Partners', '/spaces/partners.md'))
  sections.push('', '---', footer.join(' · '))

  // An organisation is a folder: its record is the folder's index.
  note(
    shared,
    `spaces/${resolved.slug}/index.md`,
    {
      type: 'Company',
      title: org.name,
      description: org.subtitle,
      node: resolved.nodeId,
      tags: [slugify(org.segment), org.relationship, 'organisation'],
    },
    sections.join('\n'),
  )
}

note(shared, 'spaces/customers.md', { type: 'Note', title: 'Customers', description: 'who pays us, what they pay, and who is wobbling', tags: ['customers', 'revenue'] }, `
${customers.length} paying spaces, ${perMonth(totalMrr)} of recurring revenue, ${totalSeats} seats
across them and the design partners.

| Organisation | Segment | Plan | Seats | MRR | Health |
| --- | --- | --- | --- | --- | --- |
${[...customers]
  .sort((a, b) => (b.org.mrr ?? 0) - (a.org.mrr ?? 0))
  .map(
    (o) =>
      `| ${orgLink(o)} | ${o.org.segment} | ${o.org.plan ?? '—'} | ${o.org.seats ?? '—'} | ${perMonth(o.org.mrr ?? 0)} | ${HEALTH_LABEL[o.org.health ?? ''] ?? '—'} |`,
  )
  .join('\n')}

## Design partners

Not paying, and worth more than most who do — they are the ones who tell us what
is broken before a customer finds it.

${[...designPartners].sort((a, b) => a.org.name.localeCompare(b.org.name)).map((o) => `- ${orgLink(o)} — ${o.org.subtitle}`).join('\n')}

## Needs attention

${atRisk.length ? atRisk.map((o) => `- ${orgLink(o)} — ${HEALTH_LABEL[o.org.health ?? '']}`).join('\n') : '- (everything green, which never lasts)'}

The numbers behind this are in ${link('Revenue roll-up', '/data/revenue-roll-up.md')} and ${link('Retention', '/data/retention.md')}.
`)

note(shared, 'spaces/investors.md', { type: 'Note', title: 'Investors', description: 'the cap table, and the one note they reach', tags: ['investors', 'company'] }, `
${money(raised)} raised across ${investors.length} investors. The monthly update goes to all of
them on the 5th; the quarterly call is a calendar item, not a deck.

${[...investors]
  .sort((a, b) => (b.org.cheque ?? 0) - (a.org.cheque ?? 0))
  .map((o) => `- ${orgLink(o)} — ${joinDot([o.org.round, o.org.cheque ? money(o.org.cheque) : null, o.org.since ? String(o.org.since) : null])}`)
  .join('\n')}

The one board seat sits with ${orgByName('Hillcrest Seed Partners')}. What they see
that the wider team does not is the ${link('revenue roll-up', '/data/revenue-roll-up.md')} — the single
note the Board alias grants, and the tightest grant in this space.
`)

note(shared, 'spaces/partners.md', { type: 'Note', title: 'Partners', description: 'who does the work we are bad at', tags: ['partners'] }, `
The people who do the work we are bad at: migrations, change management inside
agencies, and bespoke Tools.

${[...partners].sort((a, b) => a.org.name.localeCompare(b.org.name)).map((o) => `- ${orgLink(o)} — ${o.org.subtitle}`).join('\n')}

Partner-sourced customers are worth tracking separately: they onboard faster and
churn less, because somebody else did the hard part properly.
`)

// ---- people ------------------------------------------------------------------

const contacts = model.people.filter((p) => !p.team)

note(
  shared,
  'people/index.md',
  { title: 'People', description: `the ${model.people.length} humans behind those records`, tags: ['people'] },
  `
${model.people.length} people: ${contacts.length} at the organisations we work with, and ${model.team.length} of us.
Each one is a folder, so what you learn about somebody has a place to live beside
their record rather than in a note nobody finds again.

Just our side is in ${link('Team', '/team/index.md')}. Everybody else reaches us through
whichever organisation they belong to, over in ${link('Organisations', '/spaces/index.md')}.
`,
)

for (const person of model.people) {
  const org = person.orgSlug ? model.orgBySlug.get(person.orgSlug) : null
  const sections: string[] = []

  if (person.team) {
    sections.push(`**${person.role}.** ${person.team.focus}`, '')
    const meta: string[] = [`- **Based in:** ${person.location ?? '—'}`]
    sections.push(meta.join('\n'))
    const segments = person.team.segments ?? []
    if (segments.length) sections.push('', '## Segments', segments.map((s) => `- ${segmentLink(s)}`).join('\n'))
    const accounts = person.team.accounts ?? []
    if (accounts.length) sections.push('', '## Accounts', accounts.map((n) => `- ${orgByName(n)}`).join('\n'))
    if (person.team.data) {
      sections.push(
        '',
        `Keeper of the ${link('revenue roll-up', '/data/revenue-roll-up.md')} and the ${link('dashboards', '/data/dashboards.md')}.`,
      )
    }
    sections.push('', `Part of the ${link('team', '/team/index.md')}.`)
  } else {
    if (person.bio) sections.push(person.bio, '')
    const meta: string[] = [`- **Role:** ${person.role}`]
    if (org) meta.push(`- **At:** ${orgLink(org)} — ${RELATIONSHIP_LABEL[org.org.relationship]}`)
    if (person.location ?? org?.org.location) meta.push(`- **Based in:** ${person.location ?? org?.org.location}`)
    sections.push(meta.join('\n'))

    const colleagues = (org?.people ?? []).filter((p) => p.slug !== person.slug)
    if (colleagues.length) {
      sections.push('', '## Also there', colleagues.map((p) => `- ${personLink(p)} — ${p.role}`).join('\n'))
    }
    const owners = org ? model.team.filter((t) => (t.team?.accounts ?? []).includes(org.org.name)) : []
    if (owners.length) {
      sections.push('', '## Our side', owners.map((t) => `- ${personLink(t)} — ${t.role}`).join('\n'))
    }
  }

  // A person is a folder: the note is its index, sub-notes go beside it.
  note(
    shared,
    `people/${person.slug}/index.md`,
    {
      type: 'Person',
      title: person.name,
      description: person.role,
      node: person.nodeId,
      tags: ['person', person.team ? 'team' : 'contact', org ? slugify(org.org.segment) : null].filter(
        (t): t is string => Boolean(t),
      ),
    },
    sections.join('\n'),
  )
}

// ---- segments ----------------------------------------------------------------

note(
  shared,
  'segments/index.md',
  {
    title: 'Segments',
    description: `the ${model.segmentsPresent.length} kinds of space we sell to`,
    tags: ['segments'],
  },
  `
How we cut the market. Each page holds the organisations in it and what we have
learned selling to them.

Where we lean in is in the ${link('strategy', '/strategy.md')}; what each segment is
worth is in the ${link('revenue roll-up', '/data/revenue-roll-up.md')}.
`,
)

for (const segment of model.segmentsPresent) {
  const list = [...(model.orgsBySegment.get(segment) ?? [])].sort((a, b) => a.org.name.localeCompare(b.org.name))
  const paying = list.filter((o) => o.org.relationship === 'customer')
  const mrr = paying.reduce((a, o) => a + (o.org.mrr ?? 0), 0)
  note(
    shared,
    `segments/${slugify(segment)}.md`,
    { type: 'Segment', title: segment, tags: ['segment', slugify(segment)] },
    `
${SEGMENT_BLURB[segment]}

${paying.length} paying, ${perMonth(mrr)}, ${list.length} organisations tracked in total.

## Organisations (${list.length})

${list.map((o) => `- ${orgLink(o)} — ${joinDot([RELATIONSHIP_LABEL[o.org.relationship], o.org.plan, o.org.stage])}`).join('\n')}

Part of ${link('Segments', '/segments/index.md')} · ${link('Organisations', '/spaces/index.md')}
`,
  )
}

// ---- team --------------------------------------------------------------------

note(shared, 'team/index.md', { title: 'Team', description: 'who does what', tags: ['team'] }, `
${model.team.length} of us. Everyone's record is in ${link('People', '/people/index.md')}; this folder is
how we work rather than who we are.

${[...model.team].sort((a, b) => a.name.localeCompare(b.name)).map((p) => `- ${personLink(p)} — ${p.role}`).join('\n')}
`)

note(shared, 'team/how-we-work.md', { type: 'Note', title: 'How we work', description: 'the rules that make a remote team survivable', tags: ['team', 'handbook'] }, `
Small team, remote across two countries and four cities. The rules that make that
survivable:

- **Write it down.** If a decision only exists in a call, it did not happen. The
  ${link('decisions', '/product/decisions/index.md')} folder is the record.
- **Dogfood first.** Anything we would not run our own company on does not ship.
  This space is the proof, and when it is painful we have found a bug.
- **Talk to the person who has to use it.** Support tickets and
  ${link('office hours', '/team/rituals.md')} beat opinions, including the founders'.
- **One owner per thing.** Everything in ${link('People', '/people/index.md')} has a name against it.

## Timezones

Everyone overlaps between 9am and noon NZT. Nothing that needs a decision gets
scheduled outside it.
`)

note(shared, 'team/rituals.md', { type: 'Note', title: 'Rituals', description: 'the meetings that earn their place', tags: ['team', 'handbook'] }, `
- **Monday pipeline, 9am.** Fifteen minutes on the ${link('pipeline', '/deals/pipeline.md')}. Stage changes
  only; discussion goes to the channel.
- **Design partner office hours, Thursday.** 45 minutes, no slides. The list is in
  ${link('Customers', '/spaces/customers.md')}.
- **Support triage, Friday.** Every ticket becomes a fix, a doc, or a note saying
  why not.
- **Monthly investor update, the 5th.** Numbers from the
  ${link('revenue roll-up', '/data/revenue-roll-up.md')}, written before the month ends so nobody
  has to chase it.
- **Quarterly customer advisory board.** Six customers, half a day, roadmap on the
  wall. They vote, we answer.
`)

note(shared, 'team/hiring.md', { type: 'Note', title: 'Hiring', description: 'open roles, and what we are not hiring for', tags: ['team', 'hiring'] }, `
We hire when a thing has been broken for a month and everybody agrees whose job it
should have been.

## Open

- **Support engineer** — ${personLink(model.team.find((t) => /Support/i.test(t.role)) ?? model.team[0])} cannot hold the
  inbox and the fixes at once.
- **Solutions engineer, Australia** — three of the four slowest deals in the
  ${link('pipeline', '/deals/pipeline.md')} are Australian and need someone in the timezone.

## Not hiring

Sales. Every customer so far came from a community, a partner or a talk, and we
have not run out of those yet.
`)

// ---- product -----------------------------------------------------------------

note(
  shared,
  'product/index.md',
  { title: 'Product', description: 'roadmap, principles and the decisions we have taken', tags: ['product'] },
  `
What we are building, what we believe about it, and what we have already decided.

Nothing enters the roadmap's **Now** column until something leaves it, and no
decision lands here without the reasoning that produced it — a rule with its
argument stripped out is one nobody can revisit.
`,
)

note(shared, 'product/roadmap.md', { type: 'Note', title: 'Roadmap', description: 'now, next, not yet', tags: ['product', 'roadmap'] }, `
Three columns, and the rule that nothing enters **Now** until something leaves.

## Now

- **Multi-space administration.** One operator, five spaces, one admin surface.
  Asked for four times by ${orgByName('Third Space Co.')} and twice by
  ${orgByName('Coastal Districts Economic Board')}. The roughest edge we have.
- **Self-serve billing.** ${orgByName('The Boatshed Collective')} will not sign an invoice for
  ${perMonth(180)} and they are right. Blocks every small deal in the ${link('pipeline', '/deals/pipeline.md')}.

## Next

- **SSO.** ${orgByName('Overland Capital')} failed us on it in their security review and
  ${orgByName('Quarterdeck Partners')} will ask the same question. See
  ${link('the decision', '/product/decisions/sso-before-scim.md')}.
- **Cohort roll-over.** ${orgByName('Te Awa Institute of Technology')} needs it every January and
  currently gets a human running a script.
- **Create panel, second pass.** Three support tickets and one very quiet
  ${orgByName('Brightwater Incubator')} session say people cannot find the Context tile.

## Not yet

- Native mobile beyond the thin client. Nobody has asked twice.
- Cross-space analytics. Several have asked; it is the one thing our
  ${link('principles', '/product/principles.md')} refuse.
`)

note(shared, 'product/principles.md', { type: 'Note', title: 'Principles', description: 'the rules we hold to when it is inconvenient', tags: ['product', 'principles'] }, `
Written at the offsite, and worth something only because we have turned down work
to keep them.

1. **Private by default.** A new space, a new note, a new folder: closed until
   somebody opens it. We have lost a deal to this and kept it anyway.
2. **The customer's data is not our dataset.** No cross-space mining, no
   aggregate "benchmarks", however often it is requested.
3. **Writing beats configuring.** Every feature is judged on whether it makes
   somebody more likely to write the next note.
4. **One surface per job.** When two surfaces do the same job we delete one; the
   graph survives only because it answers what the list cannot.
5. **Explain the permission in a sentence.** If we cannot tell somebody who can
   see a thing in one line, the model is wrong, not their understanding.

The decisions these produced are in ${link('Decisions', '/product/decisions/index.md')}.
`)

const DECISIONS = [
  {
    slug: 'context-flows-up-not-down',
    title: 'Sub-space context flows up, never down',
    status: 'Accepted',
    date: '2026-05-14',
    body: `
A public sub-space's context appears in its parent's tree, read-only. A parent's
context never appears in the child.

## Why

${orgByName('Longshore Ventures Lab')} runs two programmes and wanted each cohort's notes
visible to the firm above. ${orgByName('Coastal Districts Economic Board')} wanted the
opposite guarantee: four district councils in one space, and nothing of the board's
leaking down into a district.

Both are the same rule seen from either end. Flowing up is the parent seeing what
its children chose to make public; flowing down would be a child inheriting
secrets it never agreed to hold.

## Consequences

A sub-space is its own tenant for members, aliases and grants — only its context
is readable above, and only when it is public. A private sub-space shows nothing.
`,
  },
  {
    slug: 'sso-before-scim',
    title: 'SSO before SCIM',
    status: 'Accepted',
    date: '2026-07-02',
    body: `
Ship single sign-on first. Directory provisioning waits, however often the two
are asked for together.

## Why

${orgByName('Overland Capital')} failed our security review on SSO, and their head of IT was
straightforward: no SSO, no renewal at their size. ${orgByName('Quarterdeck Partners')} will
ask the same. Nobody has yet said no to us over provisioning — they say it in the
same breath, but they will live without it.

## Consequences

Seat counts stay manual for another cycle, which keeps
${orgByName('Te Awa Institute of Technology')}'s January roll-over a human job. That is the
cost we are choosing, and it belongs on the ${link('roadmap', '/product/roadmap.md')} in the open.
`,
  },
  {
    slug: 'no-cross-space-analytics',
    title: 'No cross-space analytics, ever',
    status: 'Accepted',
    date: '2026-03-21',
    body: `
We will not aggregate one space's data into a benchmark for another, even
anonymised, even on request.

## Why

It is asked for constantly, usually by the biggest accounts, and it is the single
fastest way to lose the trust the whole product rests on. A funder seeing "spaces
like yours" is a funder whose grantees' data left the room.

## Consequences

We give up an obvious upsell and a genuinely useful feature. We say so plainly in
sales rather than pretending it is on the roadmap. The principle is written at
${link('Principles', '/product/principles.md')} so a future version of us has to argue with it
in writing.
`,
  },
  {
    slug: 'notes-are-the-source-of-truth',
    title: 'The notes decide; the database records',
    status: 'Accepted',
    date: '2026-02-09',
    body: `
A note is the source of truth for what it declares. Tables beside it — links,
agent state, indexes — are projections that can be rebuilt from the notes.

## Why

Two surfaces disagreeing about the same fact is the bug we kept shipping. Making
the note authoritative means there is exactly one place a person edits, and
everything else is derived.

## Consequences

Every derived thing needs a rebuild path, and drift is a repairable bug rather
than a data-loss event. It also means an import can be replayed, which is what
made ${orgByName('Southern Manufacturers Federation')}'s migration conversation possible at all.
`,
  },
  {
    slug: 'one-admin-is-a-bug',
    title: 'A space with one admin is a bug',
    status: 'Accepted',
    date: '2026-06-30',
    body: `
Onboarding is not finished until a space has two admins.

## Why

Three spaces stranded in the first year because the only admin changed jobs. In
each case the members were locked out of their own community and the fix was a
support escalation and an awkward identity check.

## Consequences

The ${link('onboarding checklist', '/team/rituals.md')} makes a second admin a required step, and
${personLink(model.team.find((t) => /Customer Success/i.test(t.role)) ?? model.team[0])} owns it. The product should
eventually nag; today a human does.
`,
  },
]

note(
  shared,
  'product/decisions/index.md',
  { title: 'Decisions', description: 'the record, with the reasoning intact', tags: ['product', 'decisions'] },
  `
What we decided, when, and what it cost. Each one names the customer or the
incident that forced it, so a future version of us has to argue with the
evidence rather than with the conclusion.
`,
)

for (const d of DECISIONS) {
  note(
    shared,
    `product/decisions/${d.slug}.md`,
    { type: 'Decision', title: d.title, description: `${d.status} · ${d.date}`, tags: ['decision', 'product'] },
    d.body,
  )
}

// ---- deals -------------------------------------------------------------------

note(
  shared,
  'deals/index.md',
  { title: 'Deals', description: 'the pipeline and how it moves', tags: ['deals'] },
  `
How a deal moves: a conversation, a trial in their own space with their own data,
a proposal, a contract. Nothing skips the trial — a space that has not had its own
members in it has not been evaluated, whatever the demo looked like.

This folder is restricted, so what is written here stays with the Team alias.
`,
)

note(shared, 'deals/pipeline.md', { type: 'Note', title: 'Pipeline', description: 'what is live right now', tags: ['deals', 'process'] }, `
${prospects.length} live deals, ${perMonth(pipelineMrr)} if every one of them closed, which is not
how pipelines work. Reviewed Monday 9am — stage changes only.

${STAGE_ORDER.map((stage) => {
  const list = prospects.filter((o) => o.org.stage === stage)
  if (!list.length) return null
  return [
    `## ${stage} (${list.length})`,
    ...list
      .sort((a, b) => (b.org.expectedMrr ?? 0) - (a.org.expectedMrr ?? 0))
      .map((o) => `- ${orgLink(o)} — ${perMonth(o.org.expectedMrr ?? 0)}. ${o.org.nextStep ?? ''}`),
    '',
  ].join('\n')
})
  .filter(Boolean)
  .join('\n')}

## What is actually blocking us

- **Self-serve billing** — the smallest deals cannot be closed by hand, and
  ${orgByName('The Boatshed Collective')} is the proof.
- **SSO** — ${orgByName('Quarterdeck Partners')} and every fund above thirty staff.
- **Migrations** — ${orgByName('Southern Manufacturers Federation')} will not trial until their old
  database can come across, which is ${orgByName('Northlight Consulting')}'s work, not ours.

Won deals turn into rows in ${link('Customers', '/spaces/customers.md')}.
`)

for (const o of prospects.filter((p) => p.org.stage === 'Contract' || p.org.stage === 'Proposal')) {
  note(
    shared,
    `deals/${o.slug}.md`,
    {
      type: 'Deal',
      title: `${o.org.name} — ${o.org.stage}`,
      description: `${o.org.stage} · ${perMonth(o.org.expectedMrr ?? 0)}`,
      tags: ['deal', slugify(o.org.stage ?? ''), slugify(o.org.segment)],
    },
    `
${orgLink(o)} — ${o.org.subtitle}, ${o.org.location}.

- **Stage:** ${o.org.stage}   ·   **Expected:** ${perMonth(o.org.expectedMrr ?? 0)}
- **Segment:** ${segmentLink(o.org.segment)}

## Where it stands

${o.org.description}

## Next step

${o.org.nextStep ?? 'Unclear, which is itself the problem.'}

## Who we are talking to

${o.people.length ? o.people.map((p) => `- ${personLink(p)} — ${p.role}`).join('\n') : '- Nobody senior yet, which is the risk.'}

Part of the ${link('pipeline', '/deals/pipeline.md')}.
`,
  )
}

// ---- data --------------------------------------------------------------------

note(
  shared,
  'data/index.md',
  { title: 'Data', description: 'revenue, retention and the dashboards', tags: ['data'] },
  `
The numbers, and who they go to. The roll-up is the one note the **Board** alias
reaches — the tightest grant in this space, and the thing most people do not
believe is possible until they see it.
`,
)

note(shared, 'data/revenue-roll-up.md', { type: 'Note', title: 'Revenue roll-up', description: 'MRR by segment — the note the Board alias reaches', tags: ['data', 'reporting'] }, `
${perMonth(totalMrr)} recurring across ${customers.length} paying spaces, ${totalSeats} seats including the
design partners, and ${perMonth(pipelineMrr)} of pipeline behind it. ${money(raised)} raised to date.

## By segment

| Segment | Paying | Seats | MRR |
| --- | --- | --- | --- |
${model.segmentsPresent
  .map((s) => {
    const list = (model.orgsBySegment.get(s) ?? []).filter((o) => o.org.relationship === 'customer')
    const seats = list.reduce((a, o) => a + (o.org.seats ?? 0), 0)
    const mrr = list.reduce((a, o) => a + (o.org.mrr ?? 0), 0)
    return `| ${s} | ${list.length} | ${seats} | ${perMonth(mrr)} |`
  })
  .join('\n')}

## Biggest accounts

${[...customers]
  .sort((a, b) => (b.org.mrr ?? 0) - (a.org.mrr ?? 0))
  .slice(0, 8)
  .map((o) => `- ${orgLink(o)} — ${perMonth(o.org.mrr ?? 0)} (${o.org.plan})`)
  .join('\n')}

## Concentration

The top three accounts are ${Math.round(
  ([...customers].sort((a, b) => (b.org.mrr ?? 0) - (a.org.mrr ?? 0)).slice(0, 3).reduce((a, o) => a + (o.org.mrr ?? 0), 0) /
    Math.max(totalMrr, 1)) *
    100,
)}% of revenue, and one of them
(${orgByName('Northbank Bank Labs')}) is red. That is the number the board asks about first —
see ${link('Retention', '/data/retention.md')}.
`)

note(shared, 'data/retention.md', { type: 'Note', title: 'Retention', description: 'who is quiet, who is leaving, who came back', tags: ['data', 'reporting'] }, `
Logo retention is fine; the signal we actually watch is whether somebody other
than our champion writes a note in the first week. Nothing else in the first
month predicts renewal as well.

## At risk

${atRisk.map((o) => `- ${orgLink(o)} — ${HEALTH_LABEL[o.org.health ?? '']}. ${o.org.useCase ?? ''}`).join('\n')}

## Why they go quiet

- **A single champion.** When they leave, the space strands — which is why
  ${link('one admin is a bug', '/product/decisions/one-admin-is-a-bug.md')}.
- **A mandate that ends.** ${orgByName('Northbank Bank Labs')} is not unhappy; their lab may
  simply cease to exist in March.
- **Nobody wrote anything.** ${orgByName('Fernmark Founders')}: 41 seats, two logins in three
  weeks. Reaching out before it becomes a renewal conversation.

Roll-up is in ${link('Revenue roll-up', '/data/revenue-roll-up.md')}.
`)

note(shared, 'data/dashboards.md', { type: 'Note', title: 'Dashboards', description: 'the views we check weekly', tags: ['data'] }, `
The views we check weekly, all driven off the same rows as the
${link('revenue roll-up', '/data/revenue-roll-up.md')}:

- **Notes written per space, last 7 days.** The health metric that matters.
- **Seats used against seats sold.** ${orgByName('Fernmark Founders')} is the cautionary tale.
- **Pipeline by stage**, straight off the ${link('pipeline', '/deals/pipeline.md')}.
- **Support volume by theme** — three tickets on one theme is a product bug, not a
  support load.
`)

// ---- personal context --------------------------------------------------------

export const personal: Note[] = []

note(personal, 'index.md', { title: 'My Context', tags: ['home'] }, `
My own notes — nothing here is shared with the space, and nothing here is
written for an audience.
`)

note(
  personal,
  'journal/index.md',
  { title: 'Journal', description: 'weekly, whether or not there is anything to say', tags: ['journal'] },
  `
Weekly notes. Friday afternoon, twenty minutes, no audience. This folder is
locked for AI maintenance — nothing rewrites what I actually thought at the time.
`,
)

note(personal, 'journal/2026-09-11.md', { type: 'Journal', title: '2026-09-11', tags: ['journal'] }, `
Watched Brightwater onboard themselves and it was humbling — they never found the
Context tile, and I said nothing for four minutes to see whether they would. Wrote
it up in ${link('discovery', '/discovery/create-panel.md')}.

Northbank came up again in Monday's pipeline review. Gareth is doing everything
right and it may not matter; his mandate ends in March. Parked the honest version
in ${link('meetings', '/meetings/board-prep.md')} rather than the channel.

Two names onto the ${link('prospects', '/prospects.md')} list from the mapping workshop.
`)

note(personal, 'journal/2026-09-04.md', { type: 'Journal', title: '2026-09-04', tags: ['journal'] }, `
Quiet week, mostly the investor update. The concentration number is going to get a
question and I would rather raise it myself — see ${link('board prep', '/meetings/board-prep.md')}.

Fernmark's usage is the thing I keep thinking about. 41 seats, two logins. Nothing
is wrong, which is what makes it bad. Added the outreach to ${link('todos', '/todos.md')}.
`)

note(personal, 'journal/2026-08-28.md', { type: 'Journal', title: '2026-08-28', tags: ['journal'] }, `
Quarterdeck's security questionnaire went back. Tim is a genuine champion but
procurement has not scheduled anything, and I have stopped forecasting it for this
quarter — notes in ${link('discovery', '/discovery/quarterdeck.md')}.

Good call with the Karearea team about who holds what. Their questions are always
the ones that end up in the product.
`)

note(
  personal,
  'meetings/index.md',
  { title: 'Meetings', description: 'customer calls, the board, the team', tags: ['meetings'] },
  `
What was actually said, written down before I forget which half I inferred.
`,
)

note(personal, 'meetings/board-prep.md', { type: 'Meeting', title: 'Board prep', description: 'the three things they will ask', tags: ['meetings', 'board'] }, `
Three things they will ask, so answer them before they do:

1. **Concentration.** Top three accounts are a third of revenue and one is red.
2. **Northbank.** Mandate, not satisfaction. Forecast it at zero and be pleasantly
   surprised.
3. **Hiring against runway.** Support first, then the Australian solutions role.

Open items in ${link('todos', '/todos.md')}.
`)

note(personal, 'meetings/third-space-call.md', { type: 'Meeting', title: 'Customer call — Third Space Co.', description: 'multi-space admin, asked for the fourth time', tags: ['meetings'] }, `
Fourth time they have asked for multi-space admin. Anton was polite about it,
which is worse than if he had not been.

I committed to it being "next, not someday", and said so in the channel so it is on
the record. If it slips again we should expect to lose them, and we would deserve to.

Follow-ups in ${link('todos', '/todos.md')}.
`)

note(personal, 'meetings/offsite-debrief.md', { type: 'Meeting', title: 'Team offsite debrief', description: 'where the principles came from', tags: ['meetings', 'team'] }, `
The principles came out of the second morning, and the argument worth remembering
was about cross-space analytics: everyone agreed it would sell, and we still said
no. Writing it down was the point — a future version of us has to argue with it.

Second thing: nobody could explain the permission model in one sentence, including
me. That became a principle too.
`)

note(
  personal,
  'discovery/index.md',
  { title: 'Discovery', description: 'working notes on live deals and open questions', tags: ['discovery'] },
  `
What I have checked, what is still unknown, and which of the two I am pretending
about. Each note ends with the next thing to find out.
`,
)

note(personal, 'discovery/quarterdeck.md', { type: 'Note', title: 'Quarterdeck Partners', description: 'stalled in procurement', tags: ['discovery', 'deals'] }, `
Biggest deal in the pipeline, slowest process, and the two facts are related.

**What is true:** strong internal champion, real budget, three teams who want it.
**What is blocking:** procurement has not scheduled the review, and SSO is a hard
requirement at their size.
**What I do not know:** whether the champion can actually move procurement, or is
just the person who answers my emails.

**Next:** ask him directly who owns the decision date. If he does not know, the
deal is not real this quarter. Tracked in ${link('todos', '/todos.md')}.
`)

note(personal, 'discovery/create-panel.md', { type: 'Note', title: 'Create panel', description: 'why nobody finds the Context tile', tags: ['discovery', 'product'] }, `
Three support tickets, one silent onboarding session, same failure: people do not
find the Context tile when they want to write a note.

**Hypothesis:** the tile names the system ("Context") rather than the job ("write
something down"), and everyone we watched was looking for the job.

**Cheap test:** rename it in one design partner's space and count notes written in
the first week. Brightwater would say yes.

Notes from the session that started this are in ${link("this week's journal", '/journal/2026-09-11.md')}.
`)

note(personal, 'prospects.md', { type: 'Note', title: 'Prospects', description: 'what I am tracking, not committed', tags: ['prospects'] }, `
Tracking, not committed:

- **A regional chamber in Tauranga** — heard about us at the mapping workshop.
- **Two university enterprise offices** — both want what Coastline has, neither has
  budget until the new year.
- **An association-management firm in Brisbane** — would be a second partner like
  Cobalt, which is the highest-leverage kind of conversation we have.

Open actions live in ${link('todos', '/todos.md')}.
`)

note(personal, 'todos.md', { type: 'Note', title: 'Todos', description: 'open actions', tags: ['todos'] }, `
- [ ] Ask Tim who owns the Quarterdeck decision date (see ${link('discovery', '/discovery/quarterdeck.md')})
- [ ] Reach out to Fernmark before renewal becomes the reason for the call
- [ ] Get the Ignition Bay cohort import done before the 28th
- [ ] Write the concentration slide myself for ${link('board prep', '/meetings/board-prep.md')}
- [x] Send the investor update
- [x] Write up the ${link('Create panel session', '/discovery/create-panel.md')}
- [x] File this week's ${link('journal', '/journal/2026-09-11.md')}
`)
