// Pure helpers mapping directory entities (person/community Nodes) to their
// canonical per-entity note path, and back. A `[[Craig Piggott]]` mention is
// stored as an ordinary OKF link to this path, so the note that records context
// about the entity is a real note — context, backlinks, and search all work with
// no special-casing. No fs/DOM access, so this is unit-testable like lib/notes/shared/*.

import { splitFrontmatter, extractMarkdownLinks, resolveOkfLink } from './shared/markdown'
import { isIndexPath } from './shared/indexNote'

export type EntityKind =
  | 'person'
  | 'resource'
  | 'event'
  | 'space'
  | 'section'
  | 'channel'
  | 'connector'

// `space` is the org kind (a group, organisation or community recorded in the
// directory — formerly the Community type); there is no separate `company`
// kind, so a company, group or org note lives in communities/ beside the note
// for the space it sits in. Only section/channel are pure structure, hidden by
// default in the context view and the directory grid (see
// STRUCTURAL_NODE_TYPES in lib/types/context.ts).
//
// connector is the one kind whose note comes FIRST: an admin authors
// connectors/<name>.md (frontmatter = machine config, body = agent docs) and the
// node follows it, rather than the other way round. It's listed here so a
// connector gets the entity treatment — its own node id, backlinks, and
// [[mentions]] resolving to it — see lib/notes/entityLinks.ts. Creating one from
// the directory is deliberately NOT possible: CREATABLE_TYPES in
// lib/directory/createEntity.ts stays person/space/resource, so the
// admin-only write gate on connectors/ in brainService.writeDenial remains the
// only door.

// The minimal shape we need off a directory node (NBNode-compatible).
export interface EntityNodeLike {
  id: string
  type: string
  name?: string | null
  subtitle?: string | null
}

const PEOPLE_DIR = 'people'
const RESOURCES_DIR = 'resources'
const EVENTS_DIR = 'events'
const COMMUNITIES_DIR = 'communities'
const SPACES_DIR = 'spaces'
const CHANNELS_DIR = 'channels'
const CONNECTORS_DIR = 'connectors'

// The dirs kept their pre-rename names on purpose: a note path is storage AND
// link identity (every inbound [[mention]] resolves against it), so renaming
// the folders would mean bulk-moving every entity note and rewriting every
// link. The kind→dir map absorbs the vocabulary rename instead — org spaces
// live in communities/, channel sections in spaces/.
const ENTITY_DIRS: Record<EntityKind, string> = {
  person: PEOPLE_DIR,
  resource: RESOURCES_DIR,
  event: EVENTS_DIR,
  space: COMMUNITIES_DIR,
  section: SPACES_DIR,
  channel: CHANNELS_DIR,
  connector: CONNECTORS_DIR,
}

// Map a node `type` to an entity kind (null for non-entity types). Liberal so it
// copes with 'person'/'people' and with every spelling organisations have worn:
// 'organization'/'org'/'group'/'company'/'community' all mean 'space' now, and
// all land in communities/. Mirrors TYPE_SYNONYMS in lib/types/context.ts.
// NOTE: the string 'space' resolves to the ORG kind — structural rows that
// carried type 'space' pre-rename are migrated to 'section' by
// scripts/rename-community-to-space.ts, so no ambiguity remains in data.
export function entityKindOf(type: string | null | undefined): EntityKind | null {
  const t = (type ?? '').trim().toLowerCase()
  if (t === 'person' || t === 'people') return 'person'
  if (
    t === 'space' || t === 'spaces' ||
    t === 'community' || t === 'communities' ||
    t.startsWith('org') || t === 'group' || t === 'groups' ||
    t === 'company' || t === 'companies'
  ) return 'space'
  if (t === 'section' || t === 'sections') return 'section'
  if (t === 'channel' || t === 'channels') return 'channel'
  if (t === 'connector' || t === 'connectors') return 'connector'
  if (t === 'resource' || t === 'resources') return 'resource'
  if (t === 'event' || t === 'events') return 'event'
  return null
}

/** The note directory a node type's entity notes live in ('person' → 'people'),
 *  or null for a type that has no entity namespace. */
export function entityDirOf(type: string | null | undefined): string | null {
  const kind = entityKindOf(type)
  return kind ? ENTITY_DIRS[kind] : null
}

// Strip the `<type>:` prefix from a node id to get its slug (`person:craig` → `craig`).
function idSlug(id: string): string {
  const i = id.indexOf(':')
  return (i === -1 ? id : id.slice(i + 1)).trim()
}

// The canonical note path for a directory entity, or null if the node isn't an
// entity kind. person → people/<slug>.md, space → communities/<slug>.md,
// resource → resources/<slug>.md.
export function entityNotePath(node: EntityNodeLike): string | null {
  const kind = entityKindOf(node.type)
  const slug = idSlug(node.id)
  if (!kind || !slug) return null
  return `${ENTITY_DIRS[kind]}/${slug}.md`
}

// Normalize a link href to a canonical entity-note path, or null if it isn't one.
// Tolerant of a leading slash; requires an entity namespace + .md.
// A folder's index.md lives in the same namespace but is NOT an entity note —
// it must stay an ordinary note link (see lib/notes/shared/indexNote.ts).
export function parseEntityHref(href: string): string | null {
  if (!href) return null
  const raw = href.startsWith('/') ? href.slice(1) : href
  if (!/^(people|resources|events|communities|spaces|channels|connectors)\/.+\.md$/.test(raw)) return null
  return isIndexPath(raw) ? null : raw
}

// The app route rendering a non-entity note (folder indexes, sectors, deals…):
// each path segment is encoded so slugs with reserved characters survive the URL.
export function noteHref(path: string): string {
  return `/directory/note/${path.split('/').map(encodeURIComponent).join('/')}`
}

// The app route previewing an uploaded Context Source (csv/xlsx/docx/md/txt…).
// Sources live in the same brain-path namespace as notes but are never .md, so
// they get their own viewer — same encoding rule as noteHref.
export function sourceHref(path: string): string {
  return `/directory/source/${path.split('/').map(encodeURIComponent).join('/')}`
}

// The entity kind implied by a note path (people/…, communities/…, resources/…), or null.
export function entityKindOfPath(path: string): EntityKind | null {
  if (path.startsWith(`${PEOPLE_DIR}/`)) return 'person'
  if (path.startsWith(`${RESOURCES_DIR}/`)) return 'resource'
  if (path.startsWith(`${EVENTS_DIR}/`)) return 'event'
  if (path.startsWith(`${COMMUNITIES_DIR}/`)) return 'space'
  if (path.startsWith(`${SPACES_DIR}/`)) return 'section'
  if (path.startsWith(`${CHANNELS_DIR}/`)) return 'channel'
  if (path.startsWith(`${CONNECTORS_DIR}/`)) return 'connector'
  return null
}

// Resolve an entity-note path back to its directory node id via the loaded node
// map. Node ids are NOT reconstructible from paths by string surgery — legacy
// data still carries retired prefixes ('org:halter', 'group:halter') alongside
// today's 'community:halter' and idSlug is lossy — so the map, built by
// entityNotePath over real
// nodes, is the only sound reverse direction. Null for non-entity paths and for
// entity paths whose node isn't in the map (deleted node, other community,
// directory still loading) — callers fall back to opening the note in place.
export function resolveEntityNode(
  path: string,
  entityByPath: ReadonlyMap<string, { id: string }> | null | undefined,
): string | null {
  if (!entityKindOfPath(path)) return null
  return entityByPath?.get(path)?.id ?? null
}

// The entity-note paths a note's body links to (people/… & communities/…),
// excluding the note itself. Frontmatter is ignored; each `[[Mention]]` is an
// ordinary OKF markdown link, so this is just link extraction + the entity
// namespace filter. Pure — feeds the context-link sync (lib/notes/entityLinks.ts).
export function entityMentionPaths(notePath: string, content: string): string[] {
  const { body } = splitFrontmatter(content)
  const out = new Set<string>()
  for (const href of extractMarkdownLinks(body)) {
    const resolved = resolveOkfLink(href, notePath)
    const entity = resolved ? parseEntityHref(resolved) : null
    if (entity && entity !== notePath) out.add(entity)
  }
  return [...out]
}

const ENTITY_TYPE_LABEL: Record<EntityKind, string> = {
  person: 'Person',
  resource: 'Resource',
  event: 'Event',
  space: 'Space',
  section: 'Section',
  channel: 'Channel',
  // Lower-case, unlike its siblings: `type: connector` is machine config that
  // lib/connectors/service.ts matches on, not just a display label.
  connector: 'connector',
}
const ENTITY_TAG: Record<EntityKind, string> = {
  person: 'person',
  resource: 'resource',
  event: 'event',
  space: 'space',
  section: 'section',
  channel: 'channel',
  connector: 'connector',
}

// Default markdown for an auto-created entity context note. Carries the directory
// `node:` id in frontmatter so the note view can link back to the directory profile.
export function entityStub(node: EntityNodeLike): string {
  return entityDraftContent(node, {})
}

/**
 * The markdown for an entity note created from the note-first surface: the same
 * frontmatter `entityStub` writes, with the user's own tags folded in beside the
 * kind tag, followed by whatever they had already typed into the editor before
 * they picked a type.
 *
 * Text typed pre-commit is the whole point of the draft surface, so an empty
 * body falls back to the stub's starter line rather than leaving a blank note.
 * Pure — the commit endpoint and the client both call it.
 */
export function entityDraftContent(
  node: EntityNodeLike,
  opts: { tags?: string[]; body?: string },
): string {
  const kind = entityKindOf(node.type) ?? 'person'
  const title = (node.name ?? idSlug(node.id)).trim()
  const kindTag = ENTITY_TAG[kind]

  // The kind tag always leads; user tags follow, de-duped case-insensitively so
  // someone typing "Person" doesn't produce `tags: [person, Person]`.
  const seen = new Set([kindTag.toLowerCase()])
  const tags = [kindTag]
  for (const raw of opts.tags ?? []) {
    const tag = raw.trim()
    if (!tag || seen.has(tag.toLowerCase())) continue
    seen.add(tag.toLowerCase())
    tags.push(tag)
  }

  // The title renders as the note heading from frontmatter (see NoteEditor), so the
  // body carries no `# Title` line — just the optional subtitle and the content.
  const subtitle = node.subtitle ? `> ${node.subtitle}\n\n` : ''
  const body = (opts.body ?? '').trim()
  return (
    `---\n` +
    `type: ${ENTITY_TYPE_LABEL[kind]}\n` +
    `title: ${JSON.stringify(title)}\n` +
    `node: ${JSON.stringify(node.id)}\n` +
    `tags: [${tags.join(', ')}]\n` +
    `---\n\n` +
    `${subtitle}` +
    (body ? `${body}\n` : `Context and notes about this ${kindTag}.\n`)
  )
}
