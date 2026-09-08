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
  'use it verbatim. Mentions in your personal space do not create edges.'

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
  'Never file a note under an entity namespace (people/, communities/, resources/, events/) unless it is ' +
  'about that entity — the write is refused when no entity of that slug exists.'

const WRITING_NOTES: Guide = {
  id: 'writing_notes',
  title: 'Writing notes',
  summary: 'How a note is written here: folders and their index, mentions that draw links, and the lifecycle frontmatter.',
  body: ['## Folders', '', FOLDERS, '', '## Mentions', '', MENTIONS, '', '## Lifecycle', '', LIFECYCLE].join('\n'),
}

export const GUIDES: readonly Guide[] = [WRITING_NOTES]

export function guideById(id: string): Guide | null {
  return GUIDES.find((g) => g.id === id) ?? null
}
