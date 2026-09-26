/**
 * The design brief `plan_tool` hands a Tool author before any code: what the
 * space already holds, where each kind of thing the Tool needs should live,
 * and the plan to fill in and show the person. Pure — the space's facts in,
 * the brief out — so what it recommends is testable without a database.
 *
 * The point is the order. A model that writes `ui.tsx` first decides the data
 * model by accident (a text box where the space already has organisation
 * records, a collection where agents needed notes). One that reads this first
 * decides it on purpose, says so, and builds once.
 */

export interface SpaceTypeFact {
  type: string
  usage_count: number
  fields: Array<{ key: string; label: string; kind: string }>
  note_dir: string | null
  enabled: boolean
}

export interface PlanFacts {
  spaceId: string
  admin: boolean
  types: SpaceTypeFact[]
  /** Every note path the caller can read. */
  notePaths: string[]
  tools: Array<{ name: string; title: string; description: string | null }>
  request?: string
}

/** The platform's own folders — where a Tool's own things never go. */
const SYSTEM_FOLDERS = new Set(['agents', 'tools', 'connectors', 'models', 'channels', 'sections', 'subspaces', 'parent', 'settings'])

/** Record kinds a Tool may build on — each with where it lives and how its picture is set. */
const RECORD_KINDS: Record<string, { what: string; image: string | null }> = {
  person: { what: 'people the space tracks (`people/`)', image: 'a photo — `set_image`, or `image_resource_id` on add_context' },
  space: { what: 'organisations and companies the space tracks (`spaces/`, type `space`)', image: 'a logo — `set_image`, or `image_resource_id` on add_context' },
  event: { what: 'events (`events/`)', image: 'a cover — `update_event { cover_resource_id }`' },
  resource: { what: 'files and links (`resources/`)', image: null },
}

/** How a built-in type's records are said in a sentence. */
const RECORD_NOUN: Record<string, string> = { space: 'organisation', person: 'person', event: 'event', resource: 'file' }

/** Words that name a built-in type, so `add_type` would refuse them. */
const TAKEN_NAMES: Record<string, string> = {
  company: 'space',
  companies: 'space',
  organisation: 'space',
  organization: 'space',
  startup: 'space',
  person: 'person',
  people: 'person',
  contact: 'person',
  event: 'event',
  file: 'resource',
  link: 'resource',
}

export interface PlanBrief {
  space_id: string
  you_are_admin: boolean
  /** Folders of the space's own, by note count — where a note type of the Tool's may live. */
  folders: Array<{ path: string; notes: number }>
  /** What the space already keeps that a Tool can build on. */
  records: Array<{ type: string; count: number; what: string; fields: string[]; image: string | null }>
  /** Types the space made itself (note-scope), with their fields. */
  custom_types: Array<{ type: string; count: number; fields: string[] }>
  /** Tools already here — extend one rather than build a second. */
  existing_tools: Array<{ name: string; title: string; description: string | null }>
  /** Traps the request walks into, said before they cost a refusal. */
  warnings: string[]
  /** The decision, then the plan to show the person. */
  decide: string[]
  plan_template: string
  next: string[]
}

function foldersOf(paths: string[]): Array<{ path: string; notes: number }> {
  const counts = new Map<string, number>()
  for (const path of paths) {
    const top = path.split('/')[0]
    if (!top || !path.includes('/') || SYSTEM_FOLDERS.has(top)) continue
    counts.set(top, (counts.get(top) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([path, notes]) => ({ path: `${path}/`, notes }))
    .sort((a, b) => b.notes - a.notes)
    .slice(0, 25)
}

/** The request's words that name a built-in type, with the type they fold onto. */
export function takenTypeWords(request: string | undefined): Array<{ word: string; type: string }> {
  if (!request) return []
  const found = new Map<string, string>()
  for (const raw of request.toLowerCase().match(/[a-z]+/g) ?? []) {
    const type = TAKEN_NAMES[raw]
    if (type && !found.has(raw)) found.set(raw, type)
  }
  return [...found.entries()].map(([word, type]) => ({ word, type }))
}

export const PLAN_TEMPLATE = [
  '## Design',
  '',
  '**Does:** <one sentence — what the person gets>',
  '',
  '**Views** (surfaces.nav — two or more, or none): <id: Label — what it shows>',
  '',
  '**Band actions** (surfaces.actions, at most two): <id: Label — what it opens>',
  '',
  '**Data** — one line per kind of thing:',
  '- <Thing> → <space records of type X | note type Y in folder z/ | collection c> · fields: <key (kind, enum: a|b|c)>',
  '',
  '**Controls:** <field → Select / Segmented / DatePicker / Toggle / Input>',
  '',
  '**Charts:** <question → chart, per the tool_charts guide — or none>',
  '',
  '**Images:** <which thing carries one, how it is added (ImageUpload in the Tool, or set_image) — or none>',
  '',
  '**Icon:** <built-in name, or a custom 24×24 stroke SVG of …>',
  '',
  '**Reach:** <bindings and permissions — the narrowest that do the job>',
].join('\n')

export function buildPlanBrief(facts: PlanFacts): PlanBrief {
  const byType = new Map(facts.types.map((t) => [t.type, t]))
  const records = Object.entries(RECORD_KINDS)
    .map(([type, kind]) => {
      const t = byType.get(type)
      return t && t.enabled
        ? { type, count: t.usage_count, what: kind.what, fields: t.fields.map((f) => f.key), image: kind.image }
        : null
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  const builtIn = new Set([...Object.keys(RECORD_KINDS), 'section', 'channel', 'connector', 'agent', 'tool', 'model', 'note', 'file'])
  const custom_types = facts.types
    .filter((t) => t.enabled && !builtIn.has(t.type))
    .map((t) => ({ type: t.type, count: t.usage_count, fields: t.fields.map((f) => f.key) }))

  const warnings: string[] = []
  for (const { word, type } of takenTypeWords(facts.request)) {
    const count = byType.get(type)?.usage_count ?? 0
    const noun = RECORD_NOUN[type] ?? type
    warnings.push(
      `"${word}" is the built-in \`${type}\` type — add_type ${word} is refused. ` +
        (count > 0 ? `The space already has ${count} ${noun} record${count === 1 ? '' : 's'}; build on them` : `Build on ${noun} records`) +
        `, or name a type for what these are here (e.g. "Portfolio company") if they are not those records.`,
    )
  }
  if (facts.tools.length > 0) warnings.push(`This space already has ${facts.tools.length} Tool${facts.tools.length === 1 ? '' : 's'} — extend one if it is the same job.`)

  return {
    space_id: facts.spaceId,
    you_are_admin: facts.admin,
    folders: foldersOf(facts.notePaths),
    records,
    custom_types,
    existing_tools: facts.tools,
    warnings,
    decide: [
      'For each kind of thing the Tool shows, pick ONE home (the tool_data guide): the space\'s records when it is about things the space already tracks (records above); a note type of its own in a folder when agents and search should see it (add_type with fields, then a folder binding); the Tool\'s own collection when only this Tool cares (votes, predictions, check-ins).',
      'Give every field with a known set of values an enum — that is what its Select draws.',
      'Pick each chart from the tool_charts guide, and put the numbers beside it.',
      'Decide the icon and any images now: set_tool_icon, and ImageUpload + a `format: resource` field for a picture people add in the Tool.',
    ],
    plan_template: PLAN_TEMPLATE,
    next: [
      'Fill in plan_template and show it to the person in ONE message; build on their yes, or on "you decide".',
      'Model the data first: add_type (with fields) for a note type; the collection schema goes in configure_tool.',
      'create_tool with `plan` set to the filled-in template, then configure_tool (surfaces, collections, bindings, permissions), set_tool_icon, and write_tool.',
      'End with the review loop: check_tool { render: true }, preview_tool { screenshot: true } per section and per band action, then try_tool through the main act.',
    ],
  }
}
