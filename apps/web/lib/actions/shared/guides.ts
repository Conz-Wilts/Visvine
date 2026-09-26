/**
 * Guides: the contracts every write action shares, written once.
 *
 * Folders, mentions and lifecycle are the three things a model must know to
 * write a note here well, and they are the same three whichever action writes
 * it. They are one guide that those actions point at (`ActionDef.guides`),
 * that `buildActionDoc` appends to each of their manuals, and that a client
 * can read on its own as `visvine({ action: 'writing_notes' })`. Synced into
 * the Visvine space as `guides/<id>.md` like an action note, so the wording is
 * the maintainer's once it exists.
 *
 * The LEADING SLASH in a mention is load-bearing and the reason every tool
 * hands back a ready-made `mention` string: `resolveOkfLink` resolves a
 * relative href from the folder of the note doing the mentioning, so
 * `people/craig.md` written inside `deals/acme.md` resolves to
 * `deals/people/craig.md`, matches no entity, and silently draws no edge.
 */

import { renderCatalog } from '@/lib/tools/catalog'

export interface Guide {
  id: string
  title: string
  /** The catalogue line. */
  summary: string
  /** Markdown — the guide as a model reads it. */
  body: string
}

const MENTIONS =
  'Links between entities are never created directly — they are a side effect of mentions. ' +
  "A markdown link to an entity's context note inside a SHARED-context note body creates a " +
  '`mentioned` edge between the two entities, e.g. `[Craig Piggott](/people/craig-piggott.md)`. ' +
  'Deleting that link from the text removes the edge on the next write. ' +
  'ALWAYS write the path with a leading slash — it is resolved from the context root, whereas a ' +
  "path without one is resolved from the mentioning note's own folder and will silently link to " +
  'nothing. Every tool that returns an entity also returns a ready-to-paste `mention` string; ' +
  'use it verbatim.'

const LIFECYCLE =
  'MEMORY LIFECYCLE — a note that is no longer true is worse than a missing note, so say so in ' +
  'frontmatter rather than deleting or silently rewriting. `status:` is one of active (default) | ' +
  'proposed | accepted | stale | superseded | deprecated | expired | archived | rejected. When a note ' +
  'REPLACES an earlier one, do not delete the old one: add `supersedes: /old/path.md` to the new note ' +
  'and the next clean pass records the back-pointer and retires the old one, so the history of the ' +
  'decision survives. Add `expires: YYYY-MM-DD` to anything with a known shelf life (a quarterly plan, ' +
  'a temporary workaround) and it retires itself. Add `confidence: certain|likely|speculative` when you ' +
  'are recording something you inferred rather than confirmed. Retired notes still rank in search, below ' +
  'current ones, and their `status` is reported on every hit.'

const FOLDERS =
  'FOLDERS: every folder IS its index.md — created automatically the moment a note lands in the ' +
  "folder, carrying `title:` (the folder's display name) and a machine-maintained child list between " +
  '`<!-- index:children -->` markers. A folder is a PATH, never a type: NEVER write `type: Index` on ' +
  'anything. An index note\'s `type:` says what the folder is ABOUT — `type: Person` on a person\'s ' +
  'folder, no type at all on a folder that just groups notes. When you add notes to a folder, ENRICH ' +
  "its existing index (prose ABOVE the markers — a description of what the folder holds is what makes " +
  'it findable in search) rather than creating or replacing one. Never hand-write the child list; the ' +
  'markers are refreshed for you on every change in the folder, and a write that drops them is ' +
  'restored. ' +
  'INDEX LAYOUT (fixed, and the store holds every index to it): frontmatter with `title:` (plus ' +
  "`description:` — one line, shown beside the folder wherever it is listed — and `tags:`), then one or " +
  'two short paragraphs saying what the folder holds and who it is for, then the child list, last. ' +
  "The child list is the Open Knowledge Format's index (OKF v0.2 §8): a `## Section` heading per group " +
  '— `Subdirectories` first, then a section per child `type:`, then `Notes` — and one row per child, ' +
  '`* [Title](relative-path.md) - description`. It is machine-written; never type it yourself. ' +
  'No `# <Title>` line (the title renders from frontmatter; one you write is removed). Do NOT re-list ' +
  "the folder's own notes in the prose: the child list already names every direct child with its " +
  "`description:`, sub-folders first — give a note a `description:` and that is what the folder shows " +
  'for it. NO tables, no columns, no HTML, no nested headings deeper than `##` — a flat list of links ' +
  'reads best in search and costs models the fewest tokens. Every index in a space looks the same. ' +
  'MAKING A FOLDER: write a note INSIDE it. `a/b.md` becomes `a/b/index.md` — the folder\'s home page — ' +
  'the moment you add `a/b/<anything>.md`. That is the only gesture; there is no retype and no ' +
  'separate convert step. ' +
  "ENTITY FOLDERS: the same move on an entity. An entity's note (people/<slug>.md) becomes a folder the " +
  'moment a second note about that entity is needed — write the extra note at people/<slug>/<anything>.md ' +
  'and the entity note moves to people/<slug>/index.md by itself, keeping its entity type and `node:`. ' +
  'Both paths keep resolving to the entity; read_context reports the current one as `note_path` and lists ' +
  "the folder's other notes as `sub_notes`. A sub-note's mentions count as the entity's mentions. " +
  'Never file a note under an entity namespace (people/, spaces/, resources/, events/) unless it is ' +
  'about that entity — the write is refused when no entity of that slug exists. ' +
  "A RESOURCE's note (resources/<slug>/index.md) is prose about the file or link — what it is, what it " +
  'shows, why it matters. Its kind, size, address and where it was shared are the resource\'s own record, ' +
  'read with read_resource; never copy them into the note.'

const WRITING_NOTES: Guide = {
  id: 'writing_notes',
  title: 'Writing notes',
  summary: 'How a note is written here: folders and their index, mentions that draw links, and the lifecycle frontmatter.',
  body: ['## Folders', '', FOLDERS, '', '## Mentions', '', MENTIONS, '', '## Lifecycle', '', LIFECYCLE].join('\n'),
}

/**
 * The Tool kit's components and hooks, and the rules that make a Tool look like
 * the app — what an AI building a Tool is handed without being asked. The
 * catalog itself is lib/tools/catalog.ts, held to the kit by a test.
 */
const TOOL_DESIGN: Guide = {
  id: 'tool_design',
  title: 'Tool design',
  summary: "The Tool kit's components and hooks, and the rules that make a Tool look like the rest of the app.",
  body: [
    'Build with these, and a Tool looks like the app it runs in. Everything below is importable from `@visvine/tool-kit`. ' +
      'A person who wants a different look can ask for one; these are the default, not a wall.',
    '',
    renderCatalog(),
  ].join('\n'),
}

/**
 * How a Tool draws a number — which chart answers which question, and the
 * rules that keep one legible. The library is the kit's; nothing else charts.
 */
const TOOL_CHARTS: Guide = {
  id: 'tool_charts',
  title: 'Tool charts',
  summary: 'Which chart answers which question in a Tool, the one library to draw it with, and the rules that keep it legible.',
  body: [
    'THE LIBRARY: `LineChart`, `BarChart`, `AreaChart` and `PieChart` from `@visvine/tool-kit` — the app\'s chart palette, themed, no setup. ' +
      'For anything they do not draw, `Recharts` (the whole recharts namespace, from the kit) coloured with `useChartColors()`. No other chart library can be imported.',
    '',
    '## Question → chart',
    '',
    '- **A share of a whole, five slices or fewer** (votes by answer, deals by stage): `PieChart donut`, with the counts listed beside it — a pie alone hides the numbers.',
    '- **Comparing categories** (raise by company, notes by owner): `BarChart`, sorted largest first; horizontal when the labels are long.',
    '- **Change over time** (signups per week): `LineChart`, time on x, one line per series, at most four.',
    '- **Parts of a total over time**: `AreaChart stacked`.',
    '- **Answers on a scale** (hell no → hell yes, 1–5 ratings): a `BarChart stacked` of one row, or a donut with the scale\'s colours in order — bad to good.',
    '- **One number** (total raised, votes cast): a stat — `text-3xl font-semibold tabular-nums` over a muted label — never a chart.',
    '- **A list with a value each**: a table (`DataTable`) with the value right-aligned, not a chart.',
    '',
    '## Rules',
    '',
    '- Give every chart a `height` and a parent with a width — a chart in a flex row with no width draws nothing (`w-28 shrink-0` for a small donut, `w-full` for a trend).',
    '- Colour means something or comes from the palette: a scale runs danger → warning → info → accent (`var(--vv-color-danger)` …), a set of categories takes `useChartColors()`. Never a hex.',
    '- Show the numbers: a legend with counts, a label on each bar, or a stat beside the chart. A chart without its numbers is decoration.',
    '- Hide a chart with no data rather than drawing an empty one; say "No votes" in a muted line if the absence matters.',
    '- No 3D, no dual axes, no more than one chart per row below `md:`. Turn `legend` off when you draw your own list.',
  ].join('\n'),
}

/**
 * Where a Tool's data should live — the decision `plan_tool` fills in for a
 * space, written once so every authoring action carries the same rule.
 */
const TOOL_DATA: Guide = {
  id: 'tool_data',
  title: 'Tool data',
  summary: "Where a Tool's data lives — the space's records, a note type of its own, or the Tool's own collection — and how images and icons are handled.",
  body: [
    'Decide where each kind of thing lives BEFORE writing code. `plan_tool` lists what the space already has.',
    '',
    '## Three homes',
    '',
    '- **Records the space already keeps** — people (`people/`), organisations (`spaces/`, type `space`), events. Use them when the Tool is ABOUT things the space tracks: a person\'s photo or an organisation\'s logo is `set_image`, their fields are tracked fields. Bind the type (`bindings: { org: { kind: type, suggest: space } }`) and read with `records.query`.',
    '- **A note type of its own, in a folder** — `add_type` with `fields`, then a folder binding (`suggest: deals`). Use it when agents and search should see the data: a pipeline, a register, a set of memos. The Tool writes notes with `context.write` (frontmatter = the fields) and reads with `records.query`.',
    '- **The Tool\'s own collection** — declared under `collections` with a JSON Schema. Use it for what only this Tool cares about: votes, predictions, check-ins, reactions. Rows are written as the viewer and never say who, only `mine`.',
    '',
    'Mix them: a board of organisation records (the space\'s) with votes in a collection (the Tool\'s), keyed by the record\'s path or node id.',
    '',
    '## Traps',
    '',
    '- `company`, `companies` and `organisation` are the built-in `space` type — `add_type Company` is refused. Use the organisation records, or name the type for what it is here (`Portfolio company`, `Applicant`).',
    '- Every field with a known set of values gets an `enum` (a collection) or `kind: select` with `options` (a type) — that is what the Select draws from.',
    '',
    '## Images',
    '',
    '- A picture a person adds inside the Tool (a logo on a company row): declare `permissions.resources.write` on a folder binding, draw `ImageUpload`, store the returned id in a field declared `{ type: string, format: resource }`, and show it with `ResourceImage` (it falls back to initials).',
    '- A picture you already have (the person attached it, or it is at a URL): `upload_file` it, then `set_image` for a record, or store the `resource_id` in the row.',
    '',
    '## The icon',
    '',
    '- A built-in rail icon (grid, kanban, list, table, calendar, chart, note, folder, people, sparkle) with `set_tool_icon { icon }`, or your own with `set_tool_icon { svg }` / `{ resource_id }`.',
    '- Draw one on a 24×24 viewBox in strokes only — `path`, `circle`, `rect`, `line` — 2px, round caps, one idea. Colour, text, images and gradients are stripped: the rail paints it in the theme.',
  ].join('\n'),
}

export const GUIDES: readonly Guide[] = [WRITING_NOTES, TOOL_DESIGN, TOOL_CHARTS, TOOL_DATA]

export function guideById(id: string): Guide | null {
  return GUIDES.find((g) => g.id === id) ?? null
}
