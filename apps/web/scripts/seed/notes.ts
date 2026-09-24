/**
 * The notes Blackbird Ventures runs on — content only; scripts/seed/run.ts
 * writes them.
 *
 * Two contexts:
 *   • the SHARED space context — generated from ./portfolio.ts, ./team.ts and
 *     ./dataset.ts: one entity note per company and per person, sector pages,
 *     the team by group, the published fund table, how Blackbird invests, and
 *     the (codenamed) dealflow.
 *   • a PERSONAL context (the space admin's) — a small self-contained set of
 *     working notes (journal, meetings, diligence, todos) cross-linked to each
 *     other and to nothing shared.
 *
 * Every internal reference is an absolute `/path.md` link, which is what makes
 * the graph light up: an ENTITY note's links to other entity notes become
 * directory edges (relationship 'mentioned', origin 'context') the moment the
 * note is written through the store. So a company's record names its founders
 * and the team members who wrote Blackbird's notes on it, and both become
 * edges. A plain note's links draw no edges — only a note that IS a node can
 * own them (lib/notes/entityLinks.ts).
 *
 * Deliberately writes no `type: Index` on an index note (the shape is the
 * path) and no listing of a folder's own children in its body: the app owns
 * that block (`<!-- index:children -->`) and fills it as children land. The
 * one-liner that would have gone in a parent's list goes in each child's
 * `description:` instead.
 */

import { blackbirdPage, buildModel, teamPage, type ResolvedOrg, type ResolvedPerson } from './model'
import { DEALS, DEAL_STAGES, FUND_TABLE, type SeedDeal } from './dataset'
import type { SeedCompany } from './portfolio'
import type { TeamGroup } from './team'
import { SECTOR_BLURB, SPACE_NAME, slugify, type Sector } from './space'

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
const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name)
const byOrgName = (a: ResolvedOrg, b: ResolvedOrg) => a.org.name.localeCompare(b.org.name)

// ---- paths -------------------------------------------------------------------

const sectorPath = (s: Sector) => `/sectors/${slugify(s)}.md`
/** Only emits a link when the sector page exists — rule 5 of the verifier. */
const sectorLink = (s: Sector) => (model.orgsBySector.has(s) ? link(s, sectorPath(s)) : s)
const orgPath = (org: ResolvedOrg) => `/spaces/${org.slug}/index.md`
const orgLink = (org: ResolvedOrg) => link(org.org.name, orgPath(org))
const personPath = (person: ResolvedPerson) => `/people/${person.slug}/index.md`
const personLink = (person: ResolvedPerson) => link(person.name, personPath(person))
const dealSlug = (d: SeedDeal) => slugify(d.codename)
const dealLink = (d: SeedDeal) => link(d.codename, `/dealflow/${dealSlug(d)}.md`)
/** A team member by name, linked; plain text when the name is not on the team. */
function teamLink(name: string): string {
  const p = model.personByName.get(slugify(name))
  return p?.team ? personLink(p) : name
}

const GROUPS: Array<{ group: TeamGroup; slug: string; blurb: string }> = [
  { group: 'Investments', slug: 'investments', blurb: 'Finding and backing founders, and the programmes that meet them first.' },
  { group: 'Operations', slug: 'operations', blurb: 'Finance, legal, compliance, fund operations and investor relations.' },
  { group: 'Building Blackbird', slug: 'building-blackbird', blurb: 'People, technology, brand, impact, the Foundation and the offices.' },
]

function groupPath(group: TeamGroup): string {
  return `/team/${GROUPS.find((g) => g.group === group)?.slug ?? 'investments'}.md`
}

const STATUS_LABEL: Record<SeedCompany['status'], string> = {
  Active: 'Active',
  Acquired: 'Acquired',
  IPO: 'Listed',
  Closed: 'Closed',
}

// ---- roll-ups ----------------------------------------------------------------

const active = model.orgs.filter((o) => o.org.status === 'Active')
const exited = model.orgs.filter((o) => o.org.status === 'Acquired' || o.org.status === 'IPO')
const closed = model.orgs.filter((o) => o.org.status === 'Closed')
const countries = (list: ResolvedOrg[], code: string) => list.filter((o) => o.org.country === code).length
const years = [...new Set(model.orgs.map((o) => o.org.invested).filter((y): y is number => typeof y === 'number'))].sort()
const withNotes = model.orgs.filter((o) => (o.org.notes ?? []).length > 0)

// ---- shared context ----------------------------------------------------------

export const shared: Note[] = []

note(shared, 'index.md', { title: SPACE_NAME, tags: ['home', 'blackbird'] }, `
Blackbird invests in every type of technology, from software to space, united by
the biggest of ambitions — backing Australian and New Zealand founders right from
the very beginning, and all the way through their journey from idea to beyond IPO.

Since 2012 Blackbird has backed 188 companies. Ten are now worth over $1B and five
over $10B, and the portfolio is worth over $10.28B, including Airwallex, Baseten,
Canva, Gilmour Space, Halter, PsiQuantum and Mitti.

This space holds the ${model.orgs.length} companies on the portfolio page and the
${model.founders.length} founders behind them, the ${model.team.length} people on the team, the
${link('funds', '/funds/index.md')} and the ${link('values', '/values.md')} the firm runs on.

> Every note here is plain Markdown. Link one with its context-root path and the
> connection shows up in the **Graph** tab.
`)

note(shared, 'values.md', { type: 'Note', title: 'Values', description: 'the six things Blackbird holds to', tags: ['blackbird', 'values'] }, `
1. **We wear T-Shirts.** Blackbird is a startup and will always be run as one.
   Our style, our office, our events and our communications relate to the
   founders we back.
2. **We are true believers in founders.** Founders come first; they are our
   reason for being. We work for our founders, they don't work for us.
3. **We believe in love at first sight.** High-conviction decisions after
   careful research and debate — and trust in instincts built up over years of
   pattern matching.
4. **We think in decades, not days.** Building iconic businesses takes the best
   part of a decade or longer. We don't plan for exits.
5. **We are comfortable with the misunderstood.** We don't need to know all the
   answers to make an investment decision; we look to maximise the upside rather
   than minimise the risks.
6. **We will make our kids proud.** Everything we do, we do with integrity.

How they turn into decisions is in ${link('How we invest', '/how-we-invest.md')}.
`)

note(shared, 'how-we-invest.md', { type: 'Note', title: 'How we invest', description: 'founders, not sectors or stages — and companies, not rounds', tags: ['blackbird', 'investing'] }, `
Giant leaps forward are made by a passionate few, so Blackbird invests in founders,
not sectors or stages. The companies are united only by their ambition to tackle
the world's greatest problems, led by founders doing their life's work.

- **Right at the beginning.** It is never too early, and no round is too small,
  to talk to Blackbird. Canva was an idea when Blackbird invested in Mel, Cliff
  and Cam — and it has invested in every round since.
- **Companies, not rounds.** Two funds in each vintage: a Core Fund for the very
  first rounds, before revenue and product, and a Follow-On Fund for Series B
  and beyond in the portfolio's emerging generational companies. See
  ${link('Funds', '/funds/index.md')}.
- **Beyond the cheque.** Giants, Foundry and Sunrise raise the ambition of the
  whole ecosystem, not only the portfolio.

The portfolio is cut by ${link('sector', '/sectors/index.md')} only to browse it.
`)

// ---- portfolio -----------------------------------------------------------------

note(
  shared,
  'spaces/index.md',
  {
    title: 'Portfolio',
    description: `the ${model.orgs.length} companies on Blackbird's portfolio page`,
    tags: ['portfolio'],
  },
  `
${model.orgs.length} companies: ${active.length} active, ${exited.length} exited and ${closed.length} closed.
${countries(model.orgs, 'AU')} are headquartered in Australia, ${countries(model.orgs, 'NZ')} in New Zealand and
${countries(model.orgs, 'US')} in the United States, most of them after starting at home.

Every company is a folder, and the folder's index is the record. Cut another way:
${link('Exits', '/spaces/exits.md')}, ${link('By year invested', '/spaces/by-year.md')}, or
${link('Sectors', '/sectors/index.md')} for Blackbird's own categories.
`,
)

for (const resolved of model.orgs) {
  const org = resolved.org
  const facts: string[] = [
    `- **Sector:** ${sectorLink(org.sector)}${org.field ? `   ·   ${org.field}` : ''}`,
    `- ${joinDot([
      `**Stage:** ${org.stage}`,
      org.invested ? `**Invested:** ${org.invested}` : null,
      org.founded ? `**Founded:** ${org.founded}` : null,
    ])}`,
  ]
  if (org.hq) facts.push(`- **Based in:** ${org.hq}`)
  if (org.lastRound) facts.push(`- **Latest round:** ${org.lastRound}`)
  if (org.status !== 'Active') facts.push(`- **${STATUS_LABEL[org.status]}:** ${org.exit ?? '—'}`)
  else if (org.exit) facts.push(`- **Note:** ${org.exit}`)

  const sections: string[] = [org.description, '', facts.join('\n')]

  if (resolved.people.length) {
    sections.push('', '## Founders')
    for (const p of resolved.people) {
      const aff = p.founded.find((f) => f.orgSlug === resolved.slug)
      sections.push(`- ${personLink(p)} — ${aff?.role ?? p.role}`)
    }
  }

  const stories = org.notes ?? []
  if (stories.length) {
    sections.push('', "## Blackbird's notes")
    for (const s of stories) {
      const by = s.by.map(teamLink).join(', ')
      sections.push(`- ${ext(s.title, s.url)} — ${s.date}${by ? `, by ${by}` : ''}`)
    }
  }

  const links = [ext('Website', org.website), ext('Blackbird', blackbirdPage(org))].filter(Boolean)
  sections.push('', '## Links', `- ${links.join('   ·   ')}`)

  note(
    shared,
    `spaces/${resolved.slug}/index.md`,
    {
      type: 'Company',
      title: org.name,
      description: org.subtitle,
      node: resolved.nodeId,
      tags: [slugify(org.sector), slugify(org.stage), org.status === 'Active' ? 'portfolio' : slugify(STATUS_LABEL[org.status])],
    },
    sections.join('\n'),
  )
}

note(shared, 'spaces/exits.md', { type: 'Note', title: 'Exits', description: 'acquired, listed and closed — what happened to each', tags: ['portfolio', 'exits'] }, `
${exited.length} exits and ${closed.length} closures. Blackbird does not plan for exits; these are
what happened anyway.

| Company | Sector | Invested | Outcome |
| --- | --- | --- | --- |
${[...exited, ...closed]
  .sort(byOrgName)
  .map((o) => `| ${orgLink(o)} | ${o.org.sector} | ${o.org.invested ?? '—'} | ${STATUS_LABEL[o.org.status]} — ${(o.org.exit ?? '').replace(/\|/g, '/')} |`)
  .join('\n')}
`)

note(shared, 'spaces/by-year.md', { type: 'Note', title: 'By year invested', description: `${years[0]} to ${years[years.length - 1]}, one line per year`, tags: ['portfolio'] }, `
The year Blackbird first invested, as each company's page gives it.

${[...years]
  .reverse()
  .map((y) => {
    const list = model.orgs.filter((o) => o.org.invested === y).sort(byOrgName)
    return `## ${y} (${list.length})\n\n${list.map(orgLink).join(' · ')}`
  })
  .join('\n\n')}
`)

// ---- people ------------------------------------------------------------------

note(
  shared,
  'people/index.md',
  { title: 'People', description: `the ${model.people.length} founders and team members`, tags: ['people'] },
  `
${model.people.length} people: ${model.founders.length} founders across the portfolio and ${model.team.length} on the
Blackbird team. Each one is a folder, so what you learn about somebody has a place
to live beside their record.

The team by group is in ${link('Team', '/team/index.md')}; founders are reached through their
company in ${link('Portfolio', '/spaces/index.md')}.
`,
)

for (const person of model.people) {
  const sections: string[] = []
  const t = person.team

  if (t) {
    sections.push(`**${t.role}.** ${t.does ?? ''}`.trim(), '')
    const meta: string[] = [`- **Team:** ${link(t.group, groupPath(t.group))}`, `- **Office:** ${t.location}`]
    sections.push(meta.join('\n'))
    if (t.before) sections.push('', '## Before Blackbird', t.before)
    if (t.quote) sections.push('', `> ${t.quote}`)
  } else if (person.bio) {
    sections.push(person.bio)
  }

  if (person.founded.length) {
    sections.push('', t ? '## Founded' : '## Companies')
    for (const f of person.founded) {
      const org = model.orgBySlug.get(f.orgSlug)
      if (org) sections.push(`- ${orgLink(org)} — ${f.role}`)
    }
    if (!t) {
      const colleagues = person.founded
        .flatMap((f) => model.orgBySlug.get(f.orgSlug)?.people ?? [])
        .filter((p, i, all) => p.slug !== person.slug && all.indexOf(p) === i)
      if (colleagues.length) sections.push('', '## Co-founders', colleagues.map((p) => `- ${personLink(p)}`).join('\n'))
    }
  }

  if (person.wrote.length) {
    sections.push('', '## Wrote about')
    for (const w of [...person.wrote].sort((a, b) => Date.parse(b.story.date) - Date.parse(a.story.date))) {
      const org = model.orgBySlug.get(w.orgSlug)
      if (org) sections.push(`- ${orgLink(org)} — ${ext(w.story.title, w.story.url)}, ${w.story.date}`)
    }
  }

  const links = [t ? ext('Blackbird', teamPage(t)) : null].filter(Boolean)
  if (links.length) sections.push('', '## Links', `- ${links.join('   ·   ')}`)

  const firstOrg = person.founded[0] ? model.orgBySlug.get(person.founded[0].orgSlug) : undefined
  note(
    shared,
    `people/${person.slug}/index.md`,
    {
      type: 'Person',
      title: person.name,
      description: t ? `${t.role}, Blackbird` : firstOrg ? `${person.role}, ${firstOrg.org.name}` : person.role,
      node: person.nodeId,
      tags: ['person', t ? 'team' : 'founder', t ? slugify(t.group) : firstOrg ? slugify(firstOrg.org.sector) : null].filter(
        (x): x is string => Boolean(x),
      ),
    },
    sections.join('\n'),
  )
}

// ---- sectors -----------------------------------------------------------------

note(
  shared,
  'sectors/index.md',
  { title: 'Sectors', description: `Blackbird's ${model.sectorsPresent.length} categories`, tags: ['sectors'] },
  `
The Category on every company page. Blackbird invests in founders, not sectors,
so these are a way to browse the portfolio and nothing more — see
${link('How we invest', '/how-we-invest.md')}.
`,
)

for (const sector of model.sectorsPresent) {
  const list = [...(model.orgsBySector.get(sector) ?? [])].sort(byOrgName)
  const live = list.filter((o) => o.org.status === 'Active')
  note(
    shared,
    `sectors/${slugify(sector)}.md`,
    { type: 'Sector', title: sector, description: SECTOR_BLURB[sector], tags: ['sector', slugify(sector)] },
    `
${SECTOR_BLURB[sector]}

${list.length} companies, ${live.length} of them active.

| Company | What it does | Stage | Invested |
| --- | --- | --- | --- |
${list.map((o) => `| ${orgLink(o)} | ${o.org.subtitle.replace(/\|/g, '/')} | ${o.org.status === 'Active' ? o.org.stage : STATUS_LABEL[o.org.status]} | ${o.org.invested ?? '—'} |`).join('\n')}
`,
  )
}

// ---- team --------------------------------------------------------------------

note(shared, 'team/index.md', { title: 'Team', description: `the ${model.team.length} people on the Blackbird team`, tags: ['team'] }, `
A team of believers, doers and optimists, across Sydney, Melbourne and Auckland.
Everyone's record is in ${link('People', '/people/index.md')}; this folder is the team by group.
`)

for (const g of GROUPS) {
  const members = model.team.filter((p) => p.team?.group === g.group).sort(byName)
  note(shared, `team/${g.slug}.md`, { type: 'Note', title: g.group, description: g.blurb, tags: ['team', g.slug] }, `
${g.blurb}

${members.map((p) => `- ${personLink(p)} — ${p.team?.role}, ${p.team?.location.split(',')[0]}`).join('\n')}
`)
}

const offices = new Map<string, ResolvedPerson[]>()
for (const p of model.team) {
  const city = (p.team?.location ?? '').split(',')[0].replace(/\s*\(.*\)/, '').replace(/^Remote\s*/, '').trim() || 'Remote'
  offices.set(city, [...(offices.get(city) ?? []), p])
}
note(shared, 'team/offices.md', { type: 'Note', title: 'Offices', description: 'who is where', tags: ['team'] }, `
${[...offices.entries()]
  .sort((a, b) => b[1].length - a[1].length)
  .map(([city, people]) => `## ${city} (${people.length})\n\n${people.sort(byName).map(personLink).join(' · ')}`)
  .join('\n\n')}
`)

// ---- funds -------------------------------------------------------------------

note(shared, 'funds/index.md', { title: 'Funds', description: 'the vintages, and what they have returned', tags: ['funds'] }, `
Blackbird raises two funds in each vintage — a Core Fund for the very first
rounds and a Follow-On Fund for Series B and beyond — so it can back a company
from first cheque to global scale.

As of 30 June 2026, the net IRR of every dollar invested in Blackbird funds is
32.24%. The table by vintage is ${link('Performance', '/funds/performance.md')}, the one note the
**LP** alias reaches.
`)

note(shared, 'funds/performance.md', { type: 'Fund', title: 'Performance', description: 'the published fund table — 11 August 2026, AUD', tags: ['funds', 'reporting'] }, `
Published on blackbird.vc and updated annually. Data at 11 August 2026, in AUD,
for the discretionary funds only; the direct co-investment vehicles Blackbird
manages for its investors are not in it.

| Vintage | Committed | Core investments | Called | Net TVPI | Net IRR |
| --- | --- | --- | --- | --- | --- |
${FUND_TABLE.map((f) => `| ${f.vintage} | ${f.committed} | ${f.investments} | ${f.called} | ${f.tvpi} | ${f.irr} |`).join('\n')}

TVPI is total value to paid in, a net multiple of invested capital. IRR is the
internal rate of return.
`)

note(shared, 'funds/core-and-follow-on.md', { type: 'Note', title: 'Core and Follow-On', description: 'two funds per vintage, and what each is for', tags: ['funds'] }, `
- **Core Fund** — the very first rounds of Australia's most ambitious startups:
  right at the beginning, before revenue and product.
- **Follow-On Fund** — the growth stages, Series B and beyond, in the emergent
  generational companies of the portfolio, across Australia and New Zealand.

At the heart of the LP base are successful tech founders — including the founders
of Atlassian, Aconex, Campaign Monitor and Trade Me — alongside institutions
supporting millions of Australians and New Zealanders.
`)

// ---- dealflow ----------------------------------------------------------------

note(
  shared,
  'dealflow/index.md',
  { title: 'Dealflow', description: 'live deals, by codename', tags: ['dealflow'] },
  `
Every live deal goes by a codename until it is announced, so a note, a channel
message or a search result never names a company before the founders do.

This folder is restricted, so what is written here stays with the Team alias.
`,
)

note(shared, 'dealflow/pipeline.md', { type: 'Note', title: 'Pipeline', description: 'every live deal by stage', tags: ['dealflow'] }, `
${DEALS.filter((d) => d.stage !== 'Passed').length} live, reviewed at the Monday meeting.

${DEAL_STAGES.map((stage) => {
  const list = DEALS.filter((d) => d.stage === stage)
  if (!list.length) return null
  return [`## ${stage} (${list.length})`, ...list.map((d) => `- ${dealLink(d)} — ${d.what}, ${d.city}. ${d.next}`), ''].join('\n')
})
  .filter(Boolean)
  .join('\n')}
`)

for (const d of DEALS) {
  note(
    shared,
    `dealflow/${dealSlug(d)}.md`,
    {
      type: 'Deal',
      title: d.codename,
      description: `${d.stage} · ${d.round} · ${d.city}`,
      tags: ['deal', slugify(d.stage), slugify(d.sector)],
    },
    `
${d.what}. ${d.round}, ${d.city}.

- **Stage:** ${d.stage}   ·   **Sector:** ${sectorLink(d.sector)}
- **Owners:** ${d.owners.map(teamLink).join(', ')}
- **Source:** ${d.source}

## Where it stands

${d.thinking}

## Next

${d.next}

On the ${link('pipeline', '/dealflow/pipeline.md')}.
`,
  )
}

// ---- stories -----------------------------------------------------------------

note(shared, 'stories.md', { type: 'Note', title: 'Investment notes', description: `Blackbird's ${withNotes.reduce((a, o) => a + (o.org.notes?.length ?? 0), 0)} write-ups of portfolio companies`, tags: ['blackbird', 'stories'] }, `
When Blackbird leads or joins a round it usually says why, in public. These are
the posts on blackbird.vc that write up a company in this portfolio, newest
first.

| Date | Company | Post | By |
| --- | --- | --- | --- |
${withNotes
  .flatMap((o) => (o.org.notes ?? []).map((s) => ({ o, s })))
  .sort((a, b) => Date.parse(b.s.date) - Date.parse(a.s.date))
  .map(({ o, s }) => `| ${s.date} | ${orgLink(o)} | ${ext(s.title.replace(/\|/g, '/'), s.url)} | ${s.by.map(teamLink).join(', ')} |`)
  .join('\n')}
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

note(personal, 'journal/2026-09-18.md', { type: 'Journal', title: '2026-09-18', tags: ['journal'] }, `
Finished the portfolio research pass: every company on the website checked
against its own site and the news. Six the website still shows at their old stage
had sold — the list is in ${link('todos', '/todos.md')}.

Wattle is further along than I expected; the question is the first customer, not
the chemistry. Notes in ${link('diligence', '/diligence/project-wattle.md')}.
`)

note(personal, 'journal/2026-09-11.md', { type: 'Journal', title: '2026-09-11', tags: ['journal'] }, `
Foundry cohort 7 kicked off. Ten teams, and at least two of them are companies
already, whether or not they have noticed.

Sunrise planning is mostly logistics now — ${link('the planning meeting', '/meetings/sunrise-planning.md')}
settled the run sheet.
`)

note(personal, 'journal/2026-09-04.md', { type: 'Journal', title: '2026-09-04', tags: ['journal'] }, `
Quiet week. Started preparing for the LP annual meeting — ${link('prep', '/meetings/lp-meeting-prep.md')} —
and the fund table is the easy part; choosing which founders tell the story is not.
`)

note(
  personal,
  'meetings/index.md',
  { title: 'Meetings', description: 'the Monday meeting, Sunrise, the LPs', tags: ['meetings'] },
  `
What was actually said, written down before I forget which half I inferred.
`,
)

note(personal, 'meetings/monday-2026-09-21.md', { type: 'Meeting', title: 'Monday meeting — 21 September', description: 'Banksia to committee, Quokka a pass', tags: ['meetings', 'investments'] }, `
- **Banksia** goes to committee next Monday. Memo out Friday.
- **Quokka** is a pass — the market, not the people. Reasons written back.
- **Tūī** partner meeting Thursday in Auckland; see ${link('diligence', '/diligence/project-tui.md')}.

Follow-ups in ${link('todos', '/todos.md')}.
`)

note(personal, 'meetings/sunrise-planning.md', { type: 'Meeting', title: 'Sunrise planning', description: 'run sheet settled, program drops early October', tags: ['meetings', 'sunrise'] }, `
Run sheet settled: registration from 8am, Visions Stage from 9, Sunset afterparty
to close at 8pm. The full program goes out in early October with the last speaker
drops before it.

Student tickets: a limited number, by email from a student address.
`)

note(personal, 'meetings/lp-meeting-prep.md', { type: 'Meeting', title: 'LP meeting prep', description: 'the table, the stories, the questions', tags: ['meetings', 'funds'] }, `
Three things investors will ask, so answer them before they do:

1. **The 2022 vintage.** Early, and still mostly called capital at cost.
2. **Exits this year.** Applied, Ortto, Factor, Eucalyptus, SafeStack and Hall —
   what each returned is for the quarterly report, not the stage.
3. **Pacing.** How much of the newest fund is committed and where.

Open items in ${link('todos', '/todos.md')}.
`)

note(
  personal,
  'diligence/index.md',
  { title: 'Diligence', description: 'working notes on live deals', tags: ['diligence'] },
  `
What I have checked, what is still unknown, and which of the two I am pretending
about. Each note ends with the next thing to find out.
`,
)

note(personal, 'diligence/project-wattle.md', { type: 'Note', title: 'Project Wattle', description: 'the first customer is the question', tags: ['diligence', 'dealflow'] }, `
**What is true:** a chemistry that works at bench scale, and a founder who has
already built a plant once.
**What is blocking:** nobody has signed an offtake, and the first one sets the
price for every one after it.
**What I do not know:** whether the regional networks they are talking to can
sign before the next budget cycle.

**Next:** the independent grid engineer's reference call. Tracked in ${link('todos', '/todos.md')}.
`)

note(personal, 'diligence/project-tui.md', { type: 'Note', title: 'Project Tūī', description: 'crowded category, unusual founders', tags: ['diligence', 'dealflow'] }, `
Everyone is building an AI associate for accountants. These two ran a practice's
month-end close for a decade, and it shows in which steps they chose to automate
first.

**Next:** ask how they sell to firms that hate changing software, at the partner
meeting.
`)

note(personal, 'todos.md', { type: 'Note', title: 'Todos', description: 'open actions', tags: ['todos'] }, `
- [ ] Book the grid engineer for ${link('Wattle', '/diligence/project-wattle.md')}
- [ ] Update the six stale stages on the website (Eucalyptus, Factor, SafeStack, Dgraph, EntryLevel, Sunroom)
- [ ] Pick the founders for the LP meeting (see ${link('prep', '/meetings/lp-meeting-prep.md')})
- [ ] Sunrise: confirm the matchmaking app is live for speakers
- [x] Send Quokka the reasons
- [x] Write up ${link('the Monday meeting', '/meetings/monday-2026-09-21.md')}
- [x] File this week's ${link('journal', '/journal/2026-09-18.md')}
`)
