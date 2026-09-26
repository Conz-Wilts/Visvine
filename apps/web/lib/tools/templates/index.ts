/**
 * The starting Tools — hand-built, polished Tools a build begins from, so a
 * vague request ("a crm", "track stuff for my team") lands on something that
 * already looks designed and works, and the model's job shrinks to saying what
 * THIS one is about: a spec of nouns, fields, options and sample rows.
 *
 * Each template is one `ui.tsx` (./sources, compiled in by
 * scripts/build-tool-templates.ts) whose `SPEC` constant, between `// @spec`
 * and `// @end-spec`, is the only thing a build replaces, plus the facts a
 * Tool built on it declares — its collections, band buttons and sections —
 * derived from the same spec. Pure.
 *
 * `matchTemplate` picks one by keyword overlap (lib/actions/shared/match.ts's
 * way: deterministic, free, never a pattern from content); a model may
 * overrule it with a reason.
 */
import { z } from 'zod'
import { rowDenial } from '@visvine/tool-protocol/schema'
import { TEMPLATE_SOURCES } from './sources.generated'

// ── the spec vocabulary ──

const HUE = z.enum(['gray', 'red', 'orange', 'amber', 'yellow', 'green', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'pink'])
const FIELD_KIND = z.enum(['text', 'longtext', 'number', 'money', 'percent', 'date', 'select', 'tags', 'person', 'email', 'url', 'boolean', 'rating'])

const fieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/, 'a key is camelCase letters and digits'),
  label: z.string().min(1).max(40),
  kind: FIELD_KIND,
  options: z.array(z.object({ value: z.string().min(1).max(40), label: z.string().max(40).optional(), hue: HUE.optional() })).max(12).optional(),
  required: z.boolean().optional(),
  currency: z.string().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
  placeholder: z.string().max(60).optional(),
  hideInTable: z.boolean().optional(),
})
type TemplateField = z.infer<typeof fieldSchema>

const row = z.record(z.string(), z.unknown())
const noun = z.string().min(1).max(30)

/** A sample date is a day offset from today (`+12`, `-4`) so a fresh install is always current. */
const DATE_OFFSET_NOTE = 'Dates in `sample` are day offsets from today as strings: "+12", "-4", "0".'

// ── the templates ──

export interface ToolTemplate {
  id: string
  title: string
  /** What it is, for the plan and the person. */
  summary: string
  /** Words a request uses when this is the right start. */
  keywords: string[]
  /** What the model writes, validated. */
  spec: z.ZodType<Record<string, unknown>>
  /** How to write the spec, for the model. */
  specGuide: string
  /** The Tool's facts, from its spec. */
  facts(spec: Record<string, unknown>): TemplateFacts
  /** Cross-field checks zod cannot say: groupBy names a select field, … */
  specProblems(spec: Record<string, unknown>): string[]
  railIcon: string
}

interface TemplateFacts {
  surfaces: {
    nav: { style: 'tabs'; sections: Array<{ id: string; label: string }> } | null
    actions: Array<{ id: string; label: string }>
  }
  collections: Record<string, { schema: Record<string, unknown>; read: 'all' | 'own' | 'admin'; write: 'all' | 'own' | 'admin'; maxRows?: number }>
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** A collection's JSON Schema from a template's fields — loose enough that a blank is always storable. */
function schemaForFields(fields: TemplateField[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  for (const f of fields) {
    switch (f.kind) {
      case 'number':
      case 'money':
      case 'percent':
      case 'rating':
        properties[f.key] = { type: ['number', 'null'] }
        break
      case 'boolean':
        properties[f.key] = { type: ['boolean', 'null'] }
        break
      case 'tags':
        properties[f.key] = { type: ['array', 'null'], items: { type: 'string', maxLength: 40 }, maxItems: 12 }
        break
      case 'longtext':
        properties[f.key] = { type: ['string', 'null'], maxLength: 8000 }
        break
      default:
        properties[f.key] = { type: ['string', 'null'], maxLength: 400 }
    }
  }
  return { type: 'object', properties: { ...properties, ...extra }, additionalProperties: false }
}

function fieldProblems(fields: TemplateField[]): string[] {
  const problems: string[] = []
  const keys = new Set<string>()
  for (const f of fields) {
    if (keys.has(f.key)) problems.push(`field key "${f.key}" is used twice`)
    keys.add(f.key)
    if ((f.kind === 'select' || f.kind === 'tags') && !(f.options && f.options.length >= 2)) problems.push(`${f.key} is a ${f.kind} and needs at least two options`)
    if (f.kind === 'number' && /%|percent|progress|completion/i.test(f.label)) problems.push(`${f.key} ("${f.label}") is a share — make it kind "percent" (0–100), which draws a bar`)
  }
  if (fields[0] && fields[0].kind !== 'text') problems.push('the first field is the title, so its kind is text')
  return problems
}

function sampleProblems(fields: TemplateField[], sample: Record<string, unknown>[]): string[] {
  const problems: string[] = []
  const byKey = new Map(fields.map((f) => [f.key, f]))
  const schema = schemaForFields(fields)
  sample.forEach((r, i) => {
    const invalid = rowDenial(schema, r)
    if (invalid) problems.push(`sample[${i}]: ${invalid}`)
    for (const f of fields.filter((field) => field.required)) {
      if (r[f.key] === null || r[f.key] === undefined || r[f.key] === '') problems.push(`sample[${i}].${f.key} is required`)
    }
    for (const [key, value] of Object.entries(r)) {
      const f = byKey.get(key)
      if (!f) {
        problems.push(`sample[${i}] has "${key}", which is not a field`)
        continue
      }
      if (f.kind === 'select' && value !== null && value !== '' && !f.options?.some((o) => o.value === value)) {
        problems.push(`sample[${i}].${key} is "${String(value)}", not one of its options`)
      }
    }
  })
  return problems
}

const recordsSpec = z.object({
  noun,
  plural: noun,
  fields: z.array(fieldSchema).min(2).max(12),
  groupBy: z.string().optional(),
  sumField: z.string().optional(),
  dateField: z.string().optional(),
  doneValues: z.array(z.string()).optional(),
  sample: z.array(row).min(4).max(20),
})

const tracker: ToolTemplate = {
  id: 'tracker',
  title: 'Tracker',
  summary: 'Records that move through stages: a board by status, a sortable table, a calendar by date, numbers across the top, add and edit in a dialog.',
  keywords: [
    'crm', 'pipeline', 'deal', 'deals', 'sales', 'lead', 'leads', 'track', 'tracker', 'tracking', 'task', 'tasks', 'todo', 'project', 'projects',
    'bug', 'bugs', 'issue', 'issues', 'hiring', 'candidate', 'candidates', 'applicant', 'recruiting', 'inventory', 'stock', 'content', 'calendar',
    'editorial', 'reading', 'books', 'status', 'kanban', 'board', 'roadmap', 'feature', 'requests', 'orders', 'tickets', 'support', 'okr', 'goals',
    'fundraising', 'investors', 'grants', 'applications', 'stuff', 'things', 'list', 'manage', 'manager',
  ],
  spec: recordsSpec as unknown as z.ZodType<Record<string, unknown>>,
  specGuide: [
    'noun / plural: what one record is ("deal" / "deals").',
    'fields: 4–8 FieldDefs; the FIRST is the title (kind text, required). Pick kinds that fit: a known set is select (with 3–6 options in flow order, each a hue), money for amounts, date for deadlines, person for an owner, rating for 1–5.',
    'groupBy: the key of the select field the board has a column per option of (the status or stage). Omit only when nothing has stages.',
    'sumField: a money/number field summed per column and in the stats. dateField: the date that matters (due, close, publish) — gives a calendar and an Overdue count.',
    'doneValues: the options of groupBy that mean finished (["Won", "Lost"], ["Done"]); the first is counted in the stats.',
    `sample: 8–12 realistic rows with real-sounding names, plausible numbers, spread across every option. ${DATE_OFFSET_NOTE}`,
  ].join('\n'),
  railIcon: 'kanban',
  facts: (spec) => {
    const s = spec as z.infer<typeof recordsSpec>
    const kind = (key?: string) => s.fields.find((f) => f.key === key)?.kind
    // Each way of looking at the rows is a section on the band, as every page in the app has its tabs there.
    const sections = [
      ...(kind(s.groupBy) === 'select' ? [{ id: 'board', label: 'Board' }] : []),
      { id: 'table', label: 'Table' },
      ...(kind(s.dateField) === 'date' ? [{ id: 'calendar', label: 'Calendar' }] : []),
    ]
    return {
      surfaces: { nav: sections.length > 1 ? { style: 'tabs', sections } : null, actions: [{ id: 'new', label: `New ${s.noun}` }] },
      collections: { items: { schema: schemaForFields(s.fields), read: 'all', write: 'all', maxRows: 5000 } },
    }
  },
  specProblems: (spec) => {
    const s = spec as z.infer<typeof recordsSpec>
    const problems = [...fieldProblems(s.fields), ...sampleProblems(s.fields, s.sample)]
    const kind = (key?: string) => s.fields.find((f) => f.key === key)?.kind
    if (s.groupBy && kind(s.groupBy) !== 'select') problems.push('groupBy must name a select field')
    if (s.sumField && !['money', 'number', 'percent'].includes(kind(s.sumField) ?? '')) problems.push('sumField must name a money or number field')
    if (s.dateField && kind(s.dateField) !== 'date') problems.push('dateField must name a date field')
    const group = s.fields.find((f) => f.key === s.groupBy)
    for (const v of s.doneValues ?? []) if (group && !group.options?.some((o) => o.value === v)) problems.push(`doneValues "${v}" is not an option of ${s.groupBy}`)
    return problems
  },
}

const dashboardSpec = z.object({
  noun,
  plural: noun,
  fields: z.array(fieldSchema).min(3).max(10),
  valueField: z.string(),
  dateField: z.string(),
  categoryField: z.string(),
  monthlyTarget: z.number().positive().optional(),
  lowerIsBetter: z.boolean().optional(),
  sample: z.array(row).min(8).max(24),
})

const dashboard: ToolTemplate = {
  id: 'dashboard',
  title: 'Dashboard',
  summary: 'Entries with an amount, a date and a category, shown as this month against last, a weekly trend, a breakdown and the latest entries.',
  keywords: [
    'dashboard', 'metrics', 'kpi', 'kpis', 'analytics', 'report', 'reporting', 'budget', 'budgets', 'expense', 'expenses', 'spend', 'spending',
    'revenue', 'sales', 'finance', 'costs', 'money', 'invoices', 'hours', 'timesheet', 'time', 'log', 'logging', 'donations', 'fitness', 'workouts',
    'chart', 'charts', 'numbers', 'stats', 'overview', 'usage', 'incidents',
  ],
  spec: dashboardSpec as unknown as z.ZodType<Record<string, unknown>>,
  specGuide: [
    'noun / plural: one entry ("expense" / "expenses").',
    'fields: the FIRST is the title (kind text). Include valueField (money or number), dateField (date) and categoryField (select, 3–6 options with hues), plus 0–2 others (person, text).',
    'monthlyTarget: a sensible monthly goal or budget for the value, when one makes sense. lowerIsBetter: true for spend, incidents, hours lost.',
    `sample: 12–16 entries spread over the last ~70 days and every category, with realistic amounts. ${DATE_OFFSET_NOTE}`,
  ].join('\n'),
  railIcon: 'chart',
  facts: (spec) => {
    const s = spec as z.infer<typeof dashboardSpec>
    return {
      surfaces: {
        nav: { style: 'tabs', sections: [{ id: 'overview', label: 'Overview' }, { id: 'entries', label: cap(s.plural) }] },
        actions: [{ id: 'new', label: `New ${s.noun}` }],
      },
      collections: { items: { schema: schemaForFields(s.fields), read: 'all', write: 'all', maxRows: 20000 } },
    }
  },
  specProblems: (spec) => {
    const s = spec as z.infer<typeof dashboardSpec>
    const problems = [...fieldProblems(s.fields), ...sampleProblems(s.fields, s.sample)]
    const kind = (key: string) => s.fields.find((f) => f.key === key)?.kind
    if (!['money', 'number', 'percent'].includes(kind(s.valueField) ?? '')) problems.push('valueField must name a money or number field')
    if (kind(s.dateField) !== 'date') problems.push('dateField must name a date field')
    if (kind(s.categoryField) !== 'select') problems.push('categoryField must name a select field')
    return problems
  },
}

const pollSpec = z.object({
  noun,
  sample: z
    .array(
      z.object({
        question: z.string().min(3).max(200),
        options: z.array(z.string().min(1).max(60)).min(2).max(8),
        tally: z.array(z.number().int().min(0).max(500)).max(8).optional(),
      }),
    )
    .min(1)
    .max(6),
})

const poll: ToolTemplate = {
  id: 'poll',
  title: 'Polls',
  summary: 'Questions people vote on: one vote each, changeable, results shown once you have voted, polls closed when decided.',
  keywords: ['poll', 'polls', 'vote', 'votes', 'voting', 'survey', 'surveys', 'decide', 'decision', 'decisions', 'question', 'questions', 'ballot', 'opinion', 'preference', 'choose', 'lunch', 'offsite'],
  spec: pollSpec as unknown as z.ZodType<Record<string, unknown>>,
  specGuide: [
    'noun: what one is called ("poll", "question", "decision").',
    'sample: 2–4 questions this team would actually ask, each with 2–5 short answers, fitting the request, and `tally`: how many of a team of ~12 have voted for each answer so far (one count per answer, not all equal) — so the first look shows results.',
  ].join('\n'),
  railIcon: 'list',
  facts: (spec) => {
    const s = spec as z.infer<typeof pollSpec>
    return {
      surfaces: { nav: null, actions: [{ id: 'new', label: `New ${s.noun}` }] },
      collections: {
        polls: {
          schema: {
            type: 'object',
            properties: {
              question: { type: 'string', maxLength: 200 },
              options: { type: 'array', items: { type: 'string', maxLength: 60 }, maxItems: 8 },
              tally: { type: 'array', items: { type: 'number' }, maxItems: 8 },
              closed: { type: 'boolean' },
            },
            required: ['question', 'options'],
            additionalProperties: false,
          },
          read: 'all',
          write: 'all',
          maxRows: 1000,
        },
        votes: {
          schema: { type: 'object', properties: { poll: { type: 'string', maxLength: 80 }, choice: { type: 'string', maxLength: 60 } }, required: ['poll', 'choice'], additionalProperties: false },
          read: 'all',
          write: 'own',
          maxRows: 100000,
        },
      },
    }
  },
  specProblems: (spec) => {
    const s = spec as z.infer<typeof pollSpec>
    return s.sample.filter((p) => p.tally && p.tally.length !== p.options.length).map((p) => `"${p.question}" has ${p.options.length} answers but ${p.tally!.length} tally counts`)
  },
}

const checkinSpec = z.object({
  noun,
  fields: z.array(fieldSchema).min(1).max(6),
  flagField: z.string().optional(),
  sample: z.array(row).min(3).max(28),
})

const checkin: ToolTemplate = {
  id: 'checkin',
  title: 'Check-ins',
  summary: "A short form each person fills in each day — standup, mood, habit — with today's posts, who has not posted, and the history by day (a person × day grid when the answers are habits).",
  keywords: ['standup', 'standups', 'checkin', 'check-in', 'check-ins', 'daily', 'update', 'updates', 'status', 'mood', 'habit', 'habits', 'journal', 'retro', 'retrospective', 'reflection', 'weekly', 'pulse', 'wellbeing', 'async', 'progress', 'diary'],
  spec: checkinSpec as unknown as z.ZodType<Record<string, unknown>>,
  specGuide: [
    'noun: one post ("check-in", "update", "entry").',
    'fields: what each person answers, 2–5 of them — longtext for prose answers, rating for a 1–5 score, select for a fixed set, boolean for a did-you (a habit is a boolean: "Exercised", "Read 20 min"). Labels are short names, never instructions. No name or date fields: those are added.',
    'flagField: a field whose being filled deserves attention (blockers), if one exists.',
    'sample: 8–12 posts by 3–4 different people over the last three days (habits: 16–24 posts over the last seven days, so the grid fills). Each row has `name` (a person), `daysAgo` (0–6) and a value per field; three of the people post today.',
  ].join('\n'),
  railIcon: 'note',
  facts: (spec) => {
    const s = spec as z.infer<typeof checkinSpec>
    return {
      surfaces: { nav: { style: 'tabs', sections: [{ id: 'today', label: 'Today' }, { id: 'history', label: 'History' }] }, actions: [{ id: 'post', label: `Post ${s.noun}` }] },
      collections: {
        entries: {
          schema: schemaForFields(s.fields, { name: { type: 'string', maxLength: 120 }, date: { type: 'string', maxLength: 10 } }),
          read: 'all',
          write: 'own',
          maxRows: 50000,
        },
      },
    }
  },
  specProblems: (spec) => {
    const s = spec as z.infer<typeof checkinSpec>
    const problems = fieldProblems(s.fields).filter((p) => !p.startsWith('the first field'))
    if (s.fields.some((f) => f.key === 'name' || f.key === 'date')) problems.push('`name` and `date` are added by the Tool — do not declare them')
    if (s.flagField && !s.fields.some((f) => f.key === s.flagField)) problems.push('flagField must name a field')
    s.sample.forEach(({ name, daysAgo, ...values }, i) => {
      if (typeof name !== 'string' || !name.trim()) problems.push(`sample[${i}].name must name a person`)
      if (typeof daysAgo !== 'number' || !Number.isInteger(daysAgo) || daysAgo < 0) problems.push(`sample[${i}].daysAgo must be a non-negative integer`)
      problems.push(...sampleProblems(s.fields, [values]).map((p) => p.replace('sample[0]', `sample[${i}]`)))
    })
    return problems
  },
}

const directorySpec = z.object({
  noun,
  plural: noun,
  fields: z.array(fieldSchema).min(2).max(12),
  groupBy: z.string().optional(),
  subtitleField: z.string().optional(),
  avatar: z.boolean().optional(),
  sample: z.array(row).min(4).max(20),
})

const directory: ToolTemplate = {
  id: 'directory',
  title: 'Directory',
  summary: 'A searchable list beside the chosen entry\'s page — contacts, vendors, recipes, a knowledge base — filtered by a category.',
  keywords: [
    'directory', 'contacts', 'contact', 'vendors', 'vendor', 'suppliers', 'people', 'team', 'members', 'clients', 'customers', 'partners', 'alumni',
    'recipes', 'recipe', 'wiki', 'knowledge', 'kb', 'faq', 'library', 'catalog', 'catalogue', 'database', 'address', 'rolodex', 'resources', 'tools',
    'places', 'restaurants', 'companies', 'portfolio', 'glossary', 'links', 'bookmarks',
  ],
  spec: directorySpec as unknown as z.ZodType<Record<string, unknown>>,
  specGuide: [
    'noun / plural: one entry ("vendor" / "vendors").',
    'fields: 5–9; the FIRST is the name (kind text, required). Use email, url, person, date, rating and select where they fit, and one or two longtext fields for the body a person opens an entry to read (ingredients and method, notes, what they do) — the detail page is built from them.',
    'groupBy: a select field to filter by (category, team, cuisine). subtitleField: what shows under the name in the list. avatar: true for people and organisations.',
    `sample: 8–12 realistic entries across every group, EVERY field filled — each longtext real content, never a stub: a list (ingredients, steps, what they offer) one item per line, prose two to four sentences. ${DATE_OFFSET_NOTE}`,
  ].join('\n'),
  railIcon: 'people',
  facts: (spec) => {
    const s = spec as z.infer<typeof directorySpec>
    return {
      surfaces: { nav: null, actions: [{ id: 'new', label: `New ${s.noun}` }] },
      collections: { items: { schema: schemaForFields(s.fields), read: 'all', write: 'all', maxRows: 10000 } },
    }
  },
  specProblems: (spec) => {
    const s = spec as z.infer<typeof directorySpec>
    const problems = [...fieldProblems(s.fields), ...sampleProblems(s.fields, s.sample)]
    if (s.groupBy && s.fields.find((f) => f.key === s.groupBy)?.kind !== 'select') problems.push('groupBy must name a select field')
    if (s.subtitleField && !s.fields.some((f) => f.key === s.subtitleField)) problems.push('subtitleField must name a field')
    return problems
  },
}

const leaderboardSpec = z.object({
  unit: z.string().min(1).max(20),
  unitOne: z.string().min(1).max(20).optional(),
  actionLabel: z.string().min(1).max(24),
  amounts: z.array(z.number()).min(1).max(5),
  reasons: z.array(z.string().max(40)).max(8).optional(),
  people: z.array(z.string().min(1).max(60)).min(3).max(30),
  sample: z.array(z.object({ person: z.string(), amount: z.number(), reason: z.string().optional(), note: z.string().max(200).optional(), daysAgo: z.number().int().min(0).max(90), from: z.string().min(1).max(60).optional() })).min(4).max(20),
})

const leaderboard: ToolTemplate = {
  id: 'leaderboard',
  title: 'Leaderboard',
  summary: 'People ranked by what they have been given or logged — kudos, points, kilometres — by week, month or all time, with the activity behind it.',
  keywords: ['leaderboard', 'kudos', 'points', 'score', 'scores', 'ranking', 'rank', 'competition', 'challenge', 'gamification', 'shoutout', 'shoutouts', 'recognition', 'thanks', 'appreciation', 'steps', 'miles', 'km', 'streak', 'contest'],
  spec: leaderboardSpec as unknown as z.ZodType<Record<string, unknown>>,
  specGuide: [
    'unit: what is counted, plural ("kudos", "points", "km"); unitOne: the singular when it differs ("point"). actionLabel: the button ("Give kudos", "Log a run").',
    'amounts: 1–4 quick amounts. reasons: optional kinds of entry.',
    'people: 4–8 realistic names who start on the board.',
    'sample: 8–12 entries for those people with amounts, reasons, a short note on most, `from` (who gave it — another of the people) and daysAgo 0–20.',
  ].join('\n'),
  railIcon: 'sparkle',
  facts: (spec) => {
    const s = spec as z.infer<typeof leaderboardSpec>
    return {
      surfaces: { nav: { style: 'tabs', sections: [{ id: 'leaderboard', label: 'Leaderboard' }, { id: 'activity', label: 'Activity' }] }, actions: [{ id: 'give', label: s.actionLabel }] },
      collections: {
        entries: {
          schema: {
            type: 'object',
            properties: {
              person: { type: 'string', maxLength: 120 },
              amount: { type: 'number' },
              reason: { type: 'string', maxLength: 60 },
              note: { type: 'string', maxLength: 400 },
              date: { type: 'string', maxLength: 10 },
              from: { type: 'string', maxLength: 120 },
            },
            required: ['person', 'amount'],
            additionalProperties: false,
          },
          read: 'all',
          write: 'all',
          maxRows: 50000,
        },
      },
    }
  },
  specProblems: (spec) => {
    const s = spec as z.infer<typeof leaderboardSpec>
    return s.sample.filter((r) => !s.people.includes(r.person)).map((r) => `sample person "${r.person}" is not in people`)
  },
}

export const TOOL_TEMPLATES: readonly ToolTemplate[] = [tracker, dashboard, poll, checkin, directory, leaderboard]

export function templateById(id: string): ToolTemplate | null {
  return TOOL_TEMPLATES.find((t) => t.id === id) ?? null
}

// ── source ──

const SPEC_BLOCK = /\/\/ @spec\n[\s\S]*?\n\/\/ @end-spec/

/** A template's ui.tsx as shipped. */
function templateSource(id: string): string {
  const source = TEMPLATE_SOURCES[id]
  if (!source) throw new Error(`No template source for ${id}`)
  return source
}

/** The template's own example spec, read back out of its source. */
export function defaultSpecText(id: string): string {
  const block = SPEC_BLOCK.exec(templateSource(id))
  return block ? block[0].replace(/^\/\/ @spec\nconst SPEC: Spec = /, '').replace(/\n\/\/ @end-spec$/, '') : ''
}

/** The template's ui.tsx with this Tool's spec in place of the example. */
export function applySpec(id: string, spec: Record<string, unknown>): string {
  const source = templateSource(id)
  if (!SPEC_BLOCK.test(source)) throw new Error(`Template ${id} has no // @spec block`)
  return source.replace(SPEC_BLOCK, () => `// @spec\nconst SPEC: Spec = ${JSON.stringify(spec, null, 2)}\n// @end-spec`)
}

/** Parse and check a spec a model wrote for a template: the value, or what is wrong with it. */
export function checkSpec(template: ToolTemplate, raw: unknown): { ok: true; spec: Record<string, unknown> } | { ok: false; problems: string[] } {
  const parsed = template.spec.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.slice(0, 12).map((i) => `${i.path.join('.') || 'spec'}: ${i.message}`) }
  }
  const problems = template.specProblems(parsed.data)
  return problems.length ? { ok: false, problems } : { ok: true, spec: parsed.data }
}

// ── choosing ──

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** Words that say a Tool keeps things without saying what — worth half a subject word. */
const GENERIC = new Set(['track', 'tracker', 'tracking', 'stuff', 'things', 'list', 'manage', 'manager', 'log', 'logging', 'board', 'status', 'time', 'daily', 'weekly'])

export interface TemplateMatch {
  id: string
  score: number
}

/**
 * Templates ranked for a request by keyword overlap. Tracker wins a tie and
 * answers a request that names nothing: most things a team keeps are records
 * that move through stages.
 */
export function matchTemplates(request: string): TemplateMatch[] {
  const said = words(request)
  const joined = ` ${said.join(' ')} `
  return TOOL_TEMPLATES.map((t, order) => {
    let score = 0
    for (const k of t.keywords) {
      if (k.includes(' ') || k.includes('-')) {
        if (joined.includes(` ${k} `)) score += 2
      } else if (said.includes(k)) score += GENERIC.has(k) ? 0.5 : 1
    }
    return { id: t.id, score: score - order * 0.001 }
  }).sort((a, b) => b.score - a.score)
}

export function matchTemplate(request: string): ToolTemplate {
  const best = matchTemplates(request)[0]
  return templateById(best && best.score > 0 ? best.id : 'tracker')!
}
