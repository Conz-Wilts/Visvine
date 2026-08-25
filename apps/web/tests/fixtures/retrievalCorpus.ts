/**
 * The fixed corpus and graded query set the retrieval harness runs against.
 *
 * This file IS the specification of what our search is supposed to do. Every
 * case names the behaviour it protects, so a failure reads as "we broke title
 * weighting" rather than "case 7 went red" — and so that a case nobody can
 * justify any more can be deleted deliberately instead of quietly relaxed.
 *
 * Ground rules for adding cases:
 *
 * - Grade what a PERSON would call a good answer, not what the current code
 *   returns. A harness written by running the code and recording the output
 *   measures nothing except that the code has not changed.
 * - Prefer cases that encode a DECISION we argued about — the lifecycle
 *   multipliers, the 0.4 weight on link-neighbourhood, the title boost. Those
 *   are the numbers that will be re-litigated, and this is the evidence.
 * - Keep the corpus small enough to read in one sitting. It is a fixture, not a
 *   sample of production, and a case that needs 200 notes to demonstrate is
 *   usually a case about something else.
 */
import { buildNoteIndex } from '../../lib/notes/shared/context'
import { splitFrontmatter } from '../../lib/notes/shared/markdown'
import type { RetrievalNote } from '../../lib/notes/shared/retrieval'
import type { RawNote } from '../../lib/notes/shared/types'
import type { EvalQuery } from '../../lib/notes/shared/evalRetrieval'

/** Every query is asked on this day (a Tuesday), so relative dates are fixed. */
const EVAL_NOW = Date.UTC(2026, 7, 25, 12)
const at = (iso: string): number => Date.parse(`${iso}T09:00:00Z`)

const md = (frontmatter: Record<string, string>, body: string): string => {
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
  return `---\n${fm}\n---\n\n${body}`
}

/**
 * A small company context: pricing decisions that supersede each other, a couple
 * of customers, an onboarding runbook, and some noise that shares vocabulary
 * with the real answers without being one.
 */
const CORPUS: RawNote[] = [
  {
    path: 'decisions/pricing-v2.md',
    mtime: at('2026-08-20'),
    content: md(
      { title: 'Pricing model v2', type: 'decision', status: 'accepted', supersedes: '/decisions/pricing-v1.md' },
      `We charge per seat at $18 per month, billed annually.

The trial is 14 days and requires no card. See
[Onboarding runbook](/runbooks/onboarding.md) for how this is explained to a new
customer.`,
    ),
  },
  {
    path: 'decisions/pricing-v1.md',
    mtime: at('2026-02-01'),
    content: md(
      { title: 'Pricing model v1', type: 'decision', status: 'superseded', superseded_by: '/decisions/pricing-v2.md' },
      `We charge a flat $200 per month per company, billed monthly.

The trial is 30 days and requires a card up front.`,
    ),
  },
  {
    path: 'runbooks/onboarding.md',
    mtime: at('2026-08-10'),
    content: md(
      { title: 'Onboarding runbook', type: 'runbook' },
      `How a new customer gets set up in their first week.

Day one is the kickoff call. Day three we import their existing spreadsheet.
Day five they invite their own team.`,
    ),
  },
  {
    path: 'customers/northwind.md',
    mtime: at('2026-04-10'),
    content: md(
      { title: 'Northwind Traders', type: 'customer', tags: '[logistics, enterprise]' },
      `Signed in March on the annual plan. Their main contact is in Auckland.

They asked repeatedly for a shared inbox before they signed.`,
    ),
  },
  {
    path: 'customers/contoso.md',
    mtime: at('2026-06-15'),
    content: md(
      { title: 'Contoso Freight', type: 'customer', tags: '[logistics, smb]' },
      `Trialling since June. Two seats. Evaluating us against a spreadsheet.`,
    ),
  },
  {
    path: 'notes/shared-inbox-research.md',
    mtime: at('2026-07-01'),
    content: md(
      { title: 'Shared inbox research', type: 'note' },
      `Three of our logistics customers have asked for a shared inbox.

The ask is really about not losing a reply when someone is away.`,
    ),
  },
  {
    path: 'notes/standup-2026-02-11.md',
    mtime: at('2026-02-11'),
    content: md(
      { title: 'Standup 11 Feb', type: 'note' },
      `Talked about pricing briefly. Nothing decided. Someone mentioned a trial.`,
    ),
  },
  {
    path: 'notes/expired-promo.md',
    mtime: at('2026-03-01'),
    content: md(
      { title: 'Launch promo', type: 'note', status: 'expired' },
      `Fifty percent off the first year for anyone who signs up before launch day.`,
    ),
  },
]

export const QUERIES: EvalQuery[] = [
  {
    id: 'title-boost',
    query: 'onboarding runbook',
    relevant: ['runbooks/onboarding.md'],
    intent: 'A title match outranks notes that merely use the words in a body.',
  },
  {
    id: 'supersession-order',
    query: 'pricing model',
    relevant: ['decisions/pricing-v2.md', 'decisions/pricing-v1.md'],
    order: ['decisions/pricing-v2.md', 'decisions/pricing-v1.md'],
    intent:
      'The replaced decision is equally RELEVANT and still returned, but the current one ranks above it — this is the whole point of the lifecycle multipliers.',
  },
  {
    id: 'retired-still-found',
    query: 'flat monthly billing per company',
    relevant: ['decisions/pricing-v1.md'],
    intent:
      'A superseded note is down-ranked, never hidden: asking what we used to do must still find the note that says so.',
  },
  {
    id: 'expired-downranked',
    query: 'trial',
    relevant: ['decisions/pricing-v2.md', 'decisions/pricing-v1.md', 'notes/standup-2026-02-11.md'],
    order: ['decisions/pricing-v2.md', 'decisions/pricing-v1.md'],
    intent: 'Current answers beat retired ones on a term they all share.',
  },
  {
    id: 'link-neighbourhood',
    query: 'seat pricing annually',
    relevant: ['decisions/pricing-v2.md', 'runbooks/onboarding.md'],
    order: ['decisions/pricing-v2.md', 'runbooks/onboarding.md'],
    intent:
      'The neighbourhood stage pulls in a linked note that never matched the query — and its 0.4 weight keeps it BELOW the direct hit, which is the bug that weight exists to fix.',
  },
  {
    id: 'type-filter',
    query: 'logistics',
    filters: { type: 'customer' },
    relevant: ['customers/northwind.md', 'customers/contoso.md'],
    intent: 'The frontmatter filter runs before ranking; the research note that also says "logistics" is excluded by type, not by score.',
  },
  {
    id: 'tag-filter',
    query: 'logistics',
    filters: { tags: ['enterprise'] },
    relevant: ['customers/northwind.md'],
    intent: 'Tag filters are AND semantics over the note index.',
  },
  {
    id: 'multi-term-and',
    query: 'shared inbox',
    relevant: ['notes/shared-inbox-research.md', 'customers/northwind.md'],
    order: ['notes/shared-inbox-research.md'],
    intent: 'Both terms present outranks a passing mention of the same phrase.',
  },
  {
    id: 'stemming',
    query: 'companies flat billing',
    relevant: ['decisions/pricing-v1.md'],
    intent:
      'Plural stemming matches both ways — the note says "per company", the query says "companies". Verb inflection (signed/signing) is deliberately NOT claimed here: the stemmer handles plurals only, so grading it would be grading a feature we have not built.',
  },
  {
    id: 'or-fallback',
    query: 'kickoff zeppelin',
    relevant: ['runbooks/onboarding.md'],
    intent:
      'When no document contains every term, the AND relaxes to OR rather than returning nothing — an unanswerable term must not erase an answerable one.',
  },
  {
    id: 'temporal-only',
    query: 'what happened last week',
    now: EVAL_NOW,
    relevant: ['decisions/pricing-v2.md'],
    intent:
      'A question that is only about a time has no words worth ranking on ("happened" is in nothing). It is answered by the date range — the previous calendar week, Mon 17 – Sun 23 Aug — newest first. Asked on Tue 25 Aug, that is the pricing decision of the 20th and nothing else.',
  },
  {
    id: 'temporal-filter-with-topic',
    query: 'seats in June',
    now: EVAL_NOW,
    relevant: ['customers/contoso.md'],
    intent:
      'Time words become a filter and the rest of the query still ranks: "in June" cuts to that month (Contoso, 15 June), and "seats" then finds it. The v2 pricing note also says "seat" but is from August — excluded by the date, not by score.',
  },
  {
    id: 'history-intent',
    query: 'why did we stop charging per company',
    relevant: ['decisions/pricing-v1.md', 'decisions/pricing-v2.md'],
    order: ['decisions/pricing-v1.md', 'decisions/pricing-v2.md'],
    intent:
      'A history question wants the retired note. The lifecycle multiplier would otherwise drop the superseded decision below its replacement even though the query is uniquely about the OLD policy — the plan reads the intent and ranks it at full weight.',
  },
]

/** The corpus run through the real index pipeline, exactly as search does. */
export function corpusNotes(): RetrievalNote[] {
  const metas = buildNoteIndex(CORPUS)
  const bodyByPath = new Map(CORPUS.map((r) => [r.path, splitFrontmatter(r.content).body]))
  return metas.map((meta) => ({ meta, body: bodyByPath.get(meta.path) ?? '' }))
}
