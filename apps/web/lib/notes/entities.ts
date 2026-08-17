// Pure helpers mapping directory entities (person/community Nodes) to their
// canonical per-entity note path, and back. A `[[Craig Piggott]]` mention is
// stored as an ordinary OKF link to this path, so the note that records context
// about the entity is a real note — context, backlinks, and search all work with
// no special-casing. No fs/DOM access, so this is unit-testable like lib/notes/shared/*.

import { splitFrontmatter, extractMarkdownLinks, resolveOkfLink } from './shared/markdown'
import { INDEX_BASENAME, isIndexPath } from './shared/indexNote'

export type EntityKind =
  | 'person'
  | 'resource'
  | 'event'
  | 'space'
  | 'section'
  | 'channel'
  | 'connector'
  | 'agent'

// `space` is the org kind (a group, organisation or community recorded in the
// directory); there is no separate `company`
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
// the directory is deliberately NOT possible: connector is absent from
// CREATABLE_TYPES in lib/directory/createEntity.ts, so the admin-only write
// gate on connectors/ in contextService.writeDenial remains the only door.
//
// agent is note-first in the same way: agents/<name>.md is the brief any
// member may write (lib/agents). Its activation lives beside it in
// agents/live/<name>.md, which is admin-only config and deliberately NOT an
// entity note — entityKindOfPath / parseEntityHref match only the top level
// of agents/, so activation notes never sync nodes or resolve [[mentions]].

// The minimal shape we need off a directory node (NBNode-compatible).
export interface EntityNodeLike {
  id: string
  type: string
  name?: string | null
  subtitle?: string | null
  /** The node's stored metadata; `metadata.notePath` records where its note
   *  lives once it has become an entity folder (see entityNotePath). */
  metadata?: Record<string, unknown> | null
}

const PEOPLE_DIR = 'people'
const RESOURCES_DIR = 'resources'
const EVENTS_DIR = 'events'
const COMMUNITIES_DIR = 'communities'
const SPACES_DIR = 'spaces'
const CHANNELS_DIR = 'channels'
const CONNECTORS_DIR = 'connectors'
const AGENTS_DIR = 'agents'

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
  agent: AGENTS_DIR,
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
  if (t === 'agent' || t === 'agents') return 'agent'
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

// entity folders
//
// A node's context is ONE note until somebody needs more than one — "Sam's
// comms with Connor" beside "Phoebe's comms with Connor". Then the entity note
// becomes an index: people/connor.md moves to people/connor/index.md,
// people/connor/ becomes the node's context folder, and the extra notes are its
// sub-notes (people/connor/<anything>.md). The index keeps its entity type
// (`type: Person`, `node:`) — index-ness comes from the path, exactly as the
// store treats every index — so the one note is both the person and the folder.
//
// Which form a node currently uses is recorded on the node as
// `metadata.notePath` (the pointer connectors and agents already carry), set by
// the store the moment the note converts (store.ensureEntityFolder). Both forms
// are canonical entity paths as far as links are concerned (parseEntityHref
// accepts either; reverse maps register both); a sub-note is NOT an entity path
// — it belongs to the folder's node (entityOwnerPathOf / resolveEntityOwner).

// The flat form: person → people/<slug>.md, space → communities/<slug>.md,
// resource → resources/<slug>.md. Null if the node isn't an entity kind.
export function entityFlatPath(node: EntityNodeLike): string | null {
  const kind = entityKindOf(node.type)
  const slug = idSlug(node.id)
  if (!kind || !slug) return null
  return `${ENTITY_DIRS[kind]}/${slug}.md`
}

// The node's context folder ('people/<slug>') — a real folder only once the
// note has converted; the path is derivable regardless.
export function entityFolderPathOf(node: EntityNodeLike): string | null {
  const flat = entityFlatPath(node)
  return flat ? flat.replace(/\.md$/i, '') : null
}

// The folder form of the entity note: 'people/<slug>/index.md'.
export function entityIndexPathOf(node: EntityNodeLike): string | null {
  const folder = entityFolderPathOf(node)
  return folder ? `${folder}/${INDEX_BASENAME}` : null
}

// The canonical note path for a directory entity, or null if the node isn't an
// entity kind: the folder form when the node's `metadata.notePath` says its
// note has become an entity folder, else the flat form. The pointer is only
// honoured when it names this node's own index — a stray value can't redirect
// a person's context to some other note.
export function entityNotePath(node: EntityNodeLike): string | null {
  const flat = entityFlatPath(node)
  if (!flat) return null
  const pointer = node.metadata?.notePath
  const index = entityIndexPathOf(node)
  return typeof pointer === 'string' && index && pointer === index ? index : flat
}

/** Every path that names this node's note — the flat form and the folder form.
 *  Reverse maps register both, so a link written before a conversion and one
 *  written after both resolve to the node. Empty for a non-entity node. */
export function entityNotePaths(node: EntityNodeLike): string[] {
  const flat = entityFlatPath(node)
  const index = entityIndexPathOf(node)
  return flat && index ? [flat, index] : []
}

const ENTITY_NS_RE = 'people|resources|events|communities|spaces|channels|connectors'

// 'people/connor/sams-comms.md' → 'people/connor': the entity folder a sub-note
// sits in (at any depth below it), or null for anything that isn't a sub-note —
// a flat entity note, an entity folder's own index, a namespace root, a note
// outside the entity namespaces. Pure path shape; whether 'people/connor' really
// belongs to a node is the reverse map's question (resolveEntityOwner).
export function entityOwnerPathOf(path: string): string | null {
  const raw = path.startsWith('/') ? path.slice(1) : path
  const m = new RegExp(`^(${ENTITY_NS_RE})/([^/]+)/(.+\\.md)$`).exec(raw)
  if (!m || m[2] === INDEX_BASENAME) return null
  if (m[3] === INDEX_BASENAME) return null
  return `${m[1]}/${m[2]}`
}

// True for the folder form of an entity note ('people/connor/index.md').
export function isEntityFolderIndex(path: string): boolean {
  return isIndexPath(path) && parseEntityHref(path) !== null
}

// Normalize a link href to a canonical entity-note path, or null if it isn't one.
// Tolerant of a leading slash; requires an entity namespace + a slug, in either
// form: '<dir>/<slug>.md' or '<dir>/<slug>/index.md' (an entity folder). The
// namespace's own index ('people/index.md') has no slug and stays an ordinary
// note link (see lib/notes/shared/indexNote.ts); a sub-note
// ('people/connor/notes.md') is not an entity either — see entityOwnerPathOf.
export function parseEntityHref(href: string): string | null {
  if (!href) return null
  const raw = href.startsWith('/') ? href.slice(1) : href
  if (
    !new RegExp(`^(${ENTITY_NS_RE})/[^/]+(\\.md|/index\\.md)$`).test(raw) &&
    !/^agents\/[^/]+\.md$/.test(raw) // agents/live/… is config, not an entity
  ) {
    return null
  }
  // 'people/index.md' matches with slug 'index' — that is the namespace root's
  // own index, never an entity.
  if (isIndexPath(raw) && raw.split('/').length === 2) return null
  return raw
}

// The app route rendering a non-entity note (folder indexes, sectors, deals…):
// each path segment is encoded so slugs with reserved characters survive the URL.
export function noteHref(path: string): string {
  return `/directory/note/${path.split('/').map(encodeURIComponent).join('/')}`
}

// The app route for a node's Context tab — its own note, or (with `subPath`,
// relative to the entity folder) one of its sub-notes: `?tab=context&note=…`.
// The profile page reads `note` back into the note path it hands the panel.
export function entityContextHref(nodeId: string, subPath: string | null = null): string {
  const note = subPath ? `&note=${encodeURIComponent(subPath)}` : ''
  return `/directory/${encodeURIComponent(nodeId)}?tab=context${note}`
}

/**
 * Where a note path opens in the app: an entity note or a sub-note → the owning
 * node's Context tab (profile chrome), anything else → the standalone note view.
 * Same map contract as resolveEntityOwner.
 */
export function hrefForNotePath(
  path: string,
  entityByPath: ReadonlyMap<string, { id: string }> | null | undefined,
): string {
  const owner = resolveEntityOwner(path, entityByPath)
  return owner ? entityContextHref(owner.id, owner.subPath) : noteHref(path)
}

// The app route previewing an uploaded Context Source (csv/xlsx/docx/md/txt…).
// Sources live in the same context-path namespace as notes but are never .md, so
// they get their own viewer — same encoding rule as noteHref.
export function sourceHref(path: string): string {
  return `/directory/source/${path.split('/').map(encodeURIComponent).join('/')}`
}

// The entity kind implied by an ENTITY note path — either form — or null. A
// namespace's own index and a sub-note inside an entity folder are not entity
// paths (entityKindOfDir / entityOwnerPathOf answer for those).
export function entityKindOfPath(path: string): EntityKind | null {
  if (isAgentBriefPath(path)) return 'agent'
  return parseEntityHref(path) ? entityKindOfDir(path) : null
}

// The entity kind of the namespace a path sits under, whatever the path's role
// in it (entity note, sub-note, or the namespace's own index).
export function entityKindOfDir(path: string): EntityKind | null {
  if (path.startsWith(`${PEOPLE_DIR}/`)) return 'person'
  if (path.startsWith(`${RESOURCES_DIR}/`)) return 'resource'
  if (path.startsWith(`${EVENTS_DIR}/`)) return 'event'
  if (path.startsWith(`${COMMUNITIES_DIR}/`)) return 'space'
  if (path.startsWith(`${SPACES_DIR}/`)) return 'section'
  if (path.startsWith(`${CHANNELS_DIR}/`)) return 'channel'
  if (path.startsWith(`${CONNECTORS_DIR}/`)) return 'connector'
  if (path.startsWith(`${AGENTS_DIR}/`)) return 'agent'
  return null
}

/** True for `agents/<name>.md` — the brief; false for `agents/live/…` and indexes. */
export function isAgentBriefPath(path: string): boolean {
  return /^agents\/[^/]+\.md$/.test(path) && !isIndexPath(path)
}

/** True for `agents/live/<name>.md` — an activation note. */
export function isAgentActivationPath(path: string): boolean {
  return /^agents\/live\/[^/]+\.md$/.test(path) && !isIndexPath(path)
}

/** The agent name a brief or activation path names, or null. */
export function agentNameOfPath(path: string): string | null {
  const m = /^agents\/(?:live\/)?([^/]+)\.md$/.exec(path)
  if (!m || isIndexPath(path)) return null
  return m[1]
}

// True when `path` IS one of the entity namespaces itself ('people',
// 'communities', …). Those folders are identity rather than organisation: every
// entity note's path is derived from its node (entityNotePath) and every
// inbound [[mention]] resolves against it, so the namespace can't be moved or
// nested, and the only folders it holds are entity folders (an entity's own
// note turned index — see the "entity folders" note above).
export function isEntityNamespaceDir(path: string): boolean {
  return Object.values(ENTITY_DIRS).includes(path)
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

/**
 * The node a path belongs to, and where inside that node's context it sits: an
 * entity note (either form) → `{ id, subPath: null }`; a sub-note inside an
 * entity folder → `{ id, subPath: 'sams-comms.md' }` (relative to the folder);
 * anything else, or an unmapped entity, → null. Same map contract as
 * resolveEntityNode — the map holds BOTH forms of every entity path
 * (entityNotePaths), as useDirectoryEntities and loadEntityMaps build it.
 */
export function resolveEntityOwner(
  path: string,
  entityByPath: ReadonlyMap<string, { id: string }> | null | undefined,
): { id: string; subPath: string | null } | null {
  const direct = resolveEntityNode(path, entityByPath)
  if (direct) return { id: direct, subPath: null }
  const owner = entityOwnerPathOf(path)
  if (!owner) return null
  const id =
    entityByPath?.get(`${owner}/${INDEX_BASENAME}`)?.id ?? entityByPath?.get(`${owner}.md`)?.id
  return id ? { id, subPath: path.slice(owner.length + 1) } : null
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
  // Same reason as connector: `type: agent` is what lib/agents matches on.
  agent: 'agent',
}
/** The frontmatter `type:` an entity note of this node type carries, or null
 *  for a non-entity type. */
export function entityTypeLabelOf(type: string | null | undefined): string | null {
  const kind = entityKindOf(type)
  return kind ? ENTITY_TYPE_LABEL[kind] : null
}

const ENTITY_TAG: Record<EntityKind, string> = {
  person: 'person',
  resource: 'resource',
  event: 'event',
  space: 'space',
  section: 'section',
  channel: 'channel',
  connector: 'connector',
  agent: 'agent',
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
