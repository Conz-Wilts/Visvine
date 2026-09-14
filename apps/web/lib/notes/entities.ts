// Pure helpers mapping directory entities (person/space Nodes) to their
// canonical per-entity note path, and back. A `[[Craig Piggott]]` mention is
// stored as an ordinary OKF link to this path, so the note that records context
// about the entity is a real note — context, backlinks, and search all work with
// no special-casing. No fs/DOM access, so this is unit-testable like lib/notes/shared/*.

import { splitFrontmatter, extractMarkdownLinks, resolveOkfLink } from './shared/markdown'
import { INDEX_BASENAME, isIndexPath } from './shared/indexNote'
import { isFeatureEnabled } from '../featureAccess'
import type { SpaceFeatureConfig } from '../types'

export type EntityKind =
  | 'person'
  | 'resource'
  | 'event'
  | 'space'
  | 'section'
  | 'channel'
  | 'connector'
  | 'agent'
  | 'tool'
  | 'model'

// `space` is the org kind (a group, organisation or space recorded in the
// directory); there is no separate `company`
// kind, so a company, group or org note lives in spaces/ beside the note
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
// agent is note-first in the same way, and a FOLDER from birth: an agent is
// agents/<name>/ (lib/agents). Its index is the whole agent — the brief any
// member may write, carrying in the same frontmatter whether and when it runs —
// and everything else in the folder is the agent's own: the notes its runs
// write, the memory it keeps between them. A pre-merge agents/<name>/activation.md
// is still read (never written); it is a sub-note like any other (it opens on
// the agent's Context tab) but never an entity note, so it syncs no node and
// resolves no [[mention]].
//
// model is the fourth config kind, and the flattest: models/<name>.md names
// the provider a space's agents run on and the model id they run (lib/models).
// It is read by sweeping the folder (lib/agents/spaceModels.ts), never written
// under, so it keeps the lazy one-note shape a connector has. It gets the
// entity treatment for one reason a connector does not need: its node page is
// where the bill is read — what the model cost, and who ran on it.
//
// tool is note-first too, and folder-only in the strictest sense: a Tool is
// several notes by construction — tools/<name>/index.md (frontmatter = config,
// body = docs) beside tools/<name>/ui.md and tools/<name>/data.md, which hold
// its source (lib/tools). The flat form tools/<name>.md is NOT an entity path
// at all; the source files are ordinary sub-notes owned by the tool node,
// exactly like any entity sub-note. See FOLDER_ONLY_ENTITY_KINDS below.

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
const SPACES_DIR = 'spaces'
const SECTIONS_DIR = 'sections'
const CHANNELS_DIR = 'channels'
const CONNECTORS_DIR = 'connectors'
const AGENTS_DIR = 'agents'
const TOOLS_DIR = 'tools'
const MODELS_DIR = 'models'

// A note path is storage AND link identity (every inbound [[mention]] resolves
// against it), so a dir is renamed only by moving every note under it and
// rewriting every link — scripts/rename-community-to-space.ts does both. Org
// spaces live in spaces/, channel sections in sections/, and a sub-space's
// grafted context is subspaces/ (lib/spaces/subspaces.ts), which is not an
// entity namespace at all.
const ENTITY_DIRS: Record<EntityKind, string> = {
  person: PEOPLE_DIR,
  resource: RESOURCES_DIR,
  event: EVENTS_DIR,
  space: SPACES_DIR,
  section: SECTIONS_DIR,
  channel: CHANNELS_DIR,
  connector: CONNECTORS_DIR,
  agent: AGENTS_DIR,
  tool: TOOLS_DIR,
  model: MODELS_DIR,
}

/**
 * Kinds whose entity note is ALWAYS the folder index (`<dir>/<slug>/index.md`):
 * the things a space writes context ABOUT. A person, an organisation, an
 * event, a resource or a channel is a folder from its first write — the index
 * is the entity note (`type: Person`, `node:`) and everything else in the
 * folder is a sub-note about it — so the tree shows one folder per thing and
 * nothing ever converts underneath a link.
 *
 * An agent is folder-only for the opposite reason: its folder is WRITTEN
 * under — the activation beside the brief, the notes its runs produce, the
 * state it carries between runs — so the folder is the agent, not a
 * conversion waiting to happen. The remaining config kinds (connector,
 * section) are read by name by the runtime and never written under, so they
 * keep the lazy shape — one note until a sub-note turns it into a folder (see
 * "entity folders" below).
 */
const FOLDER_ONLY_ENTITY_KINDS: ReadonlySet<EntityKind> = new Set([
  'person',
  'space',
  'event',
  'resource',
  'channel',
  'agent',
  'tool',
])

/**
 * Folder-only kinds whose FLAT form (`people/<slug>.md`) still names the
 * entity: an alias that a link written before the folder era, or a client
 * holding the old path, resolves through — never where the note lives. A
 * Tool is the one folder-only kind with no alias: `tools/<name>.md` is an
 * ordinary note path that must never resolve to the tool.
 */
const FLAT_ALIAS_ENTITY_KINDS: ReadonlySet<EntityKind> = new Set([
  'person',
  'space',
  'event',
  'resource',
  'channel',
  'agent',
])

/** Is this kind's entity note ALWAYS the folder index? */
export function isFolderOnlyEntityKind(kind: EntityKind | null | undefined): boolean {
  return kind != null && FOLDER_ONLY_ENTITY_KINDS.has(kind)
}

// Map a node `type` to an entity kind (null for non-entity types). Liberal so it
// copes with 'person'/'people' and with every spelling organisations have worn:
// 'organization'/'org'/'group'/'company'/'community' all mean 'space' now, and
// all land in spaces/. Mirrors TYPE_SYNONYMS in lib/types/context.ts.
// NOTE: the string 'space' resolves to the ORG kind — structural rows that
// carried type 'space' pre-rename are migrated to 'section' by
// scripts/rename-community-to-space.ts, so no ambiguity remains in data.
// 'community'/'communities' stay accepted for the same reason TYPE_SYNONYMS
// keeps them: a row written before the rename still renders as what it is.
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
  if (t === 'tool' || t === 'tools') return 'tool'
  if (t === 'model' || t === 'models') return 'model'
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
// A node's context is a FOLDER: people/connor/index.md is Connor's note and
// people/connor/ is where everything else about Connor goes — "Sam's comms
// with Connor" beside "Phoebe's comms with Connor" as sub-notes
// (people/connor/<anything>.md). The index keeps its entity type
// (`type: Person`, `node:`) — index-ness comes from the path, exactly as the
// store treats every index — so the one note is both the person and the folder.
// That is the shape from the first write for every FOLDER_ONLY_ENTITY_KINDS
// kind (store.ensureEntityFolder builds it); the config kinds keep the lazy
// shape, one flat note until a sub-note converts it.
//
// For the lazy kinds, which form a node currently uses is recorded on the node
// as `metadata.notePath` (the pointer connectors and agents already carry),
// set by the store the moment the note converts. Both forms are entity paths
// as far as links are concerned (parseEntityHref accepts either; reverse maps
// register both, so a link written to people/connor.md before the folder era
// still resolves); a sub-note is NOT an entity path — it belongs to the
// folder's node (entityOwnerPathOf / resolveEntityOwner).

// adopted entity notes
//
// A note is an entity because of what it DECLARES, not because of where it was
// filed. `Team/Alex Apoifis.md` carrying `type: Person` is a person, and gets
// the same node, profile page, backlinks and [[mentions]] as one written at
// people/alex-apoifis/index.md — a space organises its context the way it
// wants to, and the namespaces are where the app PUTS things, never the only
// place it will recognise them (lib/notes/entityLinks.ts#syncAdoptedNode makes
// the node on write).
//
// Such a node records where its note lives in `metadata.notePath` — the same
// pointer connectors and agents already carry — and that path is then the one
// and only path that names it: the derived people/<slug>.md is NOT registered
// as an alias, because some other note may legitimately live there.
//
// Only the record kinds adopt. The config kinds (connector, model, agent,
// tool, section, channel) are machine configuration read out of fixed folders
// under an admin-only write gate, and a note anywhere that could mint one is a
// way around that gate, not a convenience.
const ADOPTABLE_ENTITY_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'person',
  'space',
  'resource',
  'event',
])

/** Can a note declaring this type be adopted from wherever it sits? */
export function isAdoptableEntityType(type: string | null | undefined): boolean {
  const kind = entityKindOf(type)
  return kind !== null && ADOPTABLE_ENTITY_KINDS.has(kind)
}

/**
 * The note an adopted node was made from — a path OUTSIDE every entity
 * namespace, recorded as `metadata.notePath`. Null for a node whose note lives
 * where its kind says it should, which is every node the Directory created.
 * Pure, and the one place the pointer is read as an adoption.
 */
export function adoptedNotePath(node: EntityNodeLike): string | null {
  if (!isAdoptableEntityType(node.type)) return null
  const pointer = node.metadata?.notePath
  if (typeof pointer !== 'string' || !pointer) return null
  const raw = pointer.startsWith('/') ? pointer.slice(1) : pointer
  // A pointer that names a path in an entity namespace is the lazy-kind
  // pointer, not an adoption — entityNotePath reads it as before.
  return parseEntityHref(raw) ? null : raw
}

// The flat form: person → people/<slug>.md, space → spaces/<slug>.md,
// resource → resources/<slug>.md. Null if the node isn't an entity kind.
//
// For a FOLDER-ONLY kind this path is the derivation base the folder and index
// paths are cut from, and (for every such kind but tool) the alias a stale link
// or client reaches the note through — never where the note lives.
export function entityFlatPath(node: EntityNodeLike): string | null {
  const kind = entityKindOf(node.type)
  const slug = idSlug(node.id)
  if (!kind || !slug) return null
  return `${ENTITY_DIRS[kind]}/${slug}.md`
}

/** The context folder an entity note stands at the head of, read off the path
 *  rather than derived from the node: 'people/craig/index.md' and
 *  'Team/Alex.md' both name the folder beside them ('people/craig',
 *  'Team/Alex'). The one form that works for an adopted note too. */
export function entityFolderOfNotePath(notePath: string): string {
  const raw = notePath.startsWith('/') ? notePath.slice(1) : notePath
  return isIndexPath(raw) ? raw.slice(0, -(INDEX_BASENAME.length + 1)) : raw.replace(/\.md$/i, '')
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
// entity kind: always the folder index for a folder-only kind; for a lazy kind,
// the folder form when the node's `metadata.notePath` says its note has become
// an entity folder, else the flat form. The pointer is only honoured when it
// names this node's own index — a stray value can't redirect a connector's
// context to some other note.
export function entityNotePath(node: EntityNodeLike): string | null {
  const kind = entityKindOf(node.type)
  const flat = entityFlatPath(node)
  if (!kind || !flat) return null
  // An adopted note is where the node's note IS — the derived namespace path
  // names nothing.
  const adopted = adoptedNotePath(node)
  if (adopted) return adopted
  const index = entityIndexPathOf(node)
  if (isFolderOnlyEntityKind(kind)) return index
  const pointer = node.metadata?.notePath
  return typeof pointer === 'string' && index && pointer === index ? index : flat
}

/** Every path that names this node's note — the folder form and, where the
 *  flat form is an alias or a lazy kind's live shape, that too. Reverse maps
 *  register all of them, so a link written to people/connor.md and one written
 *  to people/connor/index.md both resolve to the node. A tool registers the
 *  index alone: its flat path is an ordinary note path that must never resolve
 *  to the tool. Empty for a non-entity node. */
export function entityNotePaths(node: EntityNodeLike): string[] {
  const kind = entityKindOf(node.type)
  const flat = entityFlatPath(node)
  const index = entityIndexPathOf(node)
  if (!kind || !flat || !index) return []
  // An adopted node answers to its own note and nothing else: registering the
  // derived people/<slug>.md would claim a path another note may hold.
  const adopted = adoptedNotePath(node)
  if (adopted) return [adopted]
  if (!isFolderOnlyEntityKind(kind) || FLAT_ALIAS_ENTITY_KINDS.has(kind)) return [flat, index]
  return [index]
}

/**
 * Where a write or read addressed at an entity path really lands: the folder
 * index when the path is a folder-only kind's flat alias (`people/connor.md` →
 * `people/connor/index.md`), else the path as given. Pure — a lazy kind's
 * current shape is the store's to know (store.canonicalEntityWritePath).
 */
export function canonicalEntityPath(path: string): string {
  const raw = path.startsWith('/') ? path.slice(1) : path
  if (isIndexPath(raw) || !parseEntityHref(raw)) return raw
  const kind = entityKindOfDir(raw)
  if (!isFolderOnlyEntityKind(kind) || !kind || !FLAT_ALIAS_ENTITY_KINDS.has(kind)) return raw
  return `${raw.replace(/\.md$/i, '')}/${INDEX_BASENAME}`
}

// Namespaces where EITHER form names the entity — '<ns>/<slug>/index.md', the
// folder, or '<ns>/<slug>.md': the flat alias of a folder-only kind, or a lazy
// kind's note before it converts (see FOLDER_ONLY_ENTITY_KINDS).
const FLAT_ENTITY_NS_RE = 'people|resources|events|spaces|sections|channels|connectors|agents|models'
// Namespaces where only '<ns>/<slug>/index.md' names the entity: a tool's flat
// path is an ordinary note.
const FOLDER_ENTITY_NS_RE = 'tools'
// Every namespace whose '<ns>/<slug>/' folder holds an entity's sub-notes,
// whichever form the entity note itself takes.
const ENTITY_NS_RE = `${FLAT_ENTITY_NS_RE}|${FOLDER_ENTITY_NS_RE}`

// 'people/connor/sams-comms.md' → 'people/connor': the entity folder a sub-note
// sits in (at any depth below it), or null for anything that isn't a sub-note —
// a flat entity note, an entity folder's own index, a namespace root, a note
// outside the entity namespaces. Pure path shape; whether 'people/connor' really
// belongs to a node is the reverse map's question (resolveEntityOwner).
const ENTITY_OWNER_PATH_RE = new RegExp(`^(${ENTITY_NS_RE})/([^/]+)/(.+\\.md)$`)
const FLAT_ENTITY_HREF_RE = new RegExp(`^(${FLAT_ENTITY_NS_RE})/[^/]+(\\.md|/index\\.md)$`)
const FOLDER_ENTITY_HREF_RE = new RegExp(`^(${FOLDER_ENTITY_NS_RE})/[^/]+/index\\.md$`)

export function entityOwnerPathOf(path: string): string | null {
  const raw = path.startsWith('/') ? path.slice(1) : path
  const m = ENTITY_OWNER_PATH_RE.exec(raw)
  if (!m || m[2] === INDEX_BASENAME) return null
  if (m[3] === INDEX_BASENAME) return null
  return `${m[1]}/${m[2]}`
}

// True for the folder form of an entity note ('people/connor/index.md').
export function isEntityFolderIndex(path: string): boolean {
  return isIndexPath(path) && parseEntityHref(path) !== null
}

// Normalize a link href to an entity-note path, or null if it isn't one.
// Tolerant of a leading slash; requires an entity namespace + a slug, in either
// form: '<dir>/<slug>.md' or '<dir>/<slug>/index.md' (an entity folder) — the
// folder form only under tools/. The href is returned as written, alias or
// not: canonicalEntityPath is the one that says where the note lives. The namespace's own
// index ('people/index.md') has no slug and stays an ordinary note link (see
// lib/notes/shared/indexNote.ts); a sub-note ('people/connor/notes.md',
// 'tools/kanban/ui.md') is not an entity either — see entityOwnerPathOf.
export function parseEntityHref(href: string): string | null {
  if (!href) return null
  const raw = href.startsWith('/') ? href.slice(1) : href
  if (!FLAT_ENTITY_HREF_RE.test(raw) && !FOLDER_ENTITY_HREF_RE.test(raw)) return null
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

// The app route showing a trashed note read-only: it is soft-deleted, so there
// is no live path to link to — the trash entry's id is the whole address.
export function trashHref(id: string): string {
  return `/directory/trash/${encodeURIComponent(id)}`
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
  return parseEntityHref(path) ? entityKindOfDir(path) : null
}

// The entity kind of the namespace a path sits under, whatever the path's role
// in it (entity note, sub-note, or the namespace's own index).
export function entityKindOfDir(path: string): EntityKind | null {
  if (path.startsWith(`${PEOPLE_DIR}/`)) return 'person'
  if (path.startsWith(`${RESOURCES_DIR}/`)) return 'resource'
  if (path.startsWith(`${EVENTS_DIR}/`)) return 'event'
  if (path.startsWith(`${SPACES_DIR}/`)) return 'space'
  if (path.startsWith(`${SECTIONS_DIR}/`)) return 'section'
  if (path.startsWith(`${CHANNELS_DIR}/`)) return 'channel'
  if (path.startsWith(`${CONNECTORS_DIR}/`)) return 'connector'
  if (path.startsWith(`${AGENTS_DIR}/`)) return 'agent'
  if (path.startsWith(`${TOOLS_DIR}/`)) return 'tool'
  if (path.startsWith(`${MODELS_DIR}/`)) return 'model'
  return null
}

// Whether a path is specifically a Tool's own index note, and which Tool a
// path belongs to, are answered by lib/tools/config.ts's toolFileKindOfPath /
// toolNameOfPath — those validate the folder segment against TOOL_NAME_RE,
// which this module must not duplicate (it would only drift again). This
// module still answers the generic entity-shape questions (entityKindOfPath,
// isEntityFolderIndex, parseEntityHref) that every entity kind shares.

/**
 * An agent is the folder `agents/<name>/`, and the path alone says what a note
 * in it is:
 *
 *   agents/<name>/index.md        the BRIEF — the entity note, member-written,
 *                                 carrying the activation in its frontmatter
 *   agents/<name>/activation.md   the pre-merge ACTIVATION — still read for an
 *                                 agent written before the two notes became one
 *   agents/<name>/<anything>.md   the agent's OWN notes — what its runs write
 *
 * The name is the folder segment, unique across the space; `agents/index.md`
 * is the namespace's own home page and names no agent.
 */
const AGENT_FOLDER_RE = /^agents\/([^/]+)\/([^/]+\.md)$/
const AGENT_ACTIVATION_BASENAME = 'activation.md'

/** True for a brief — an agent's folder index. */
export function isAgentBriefPath(path: string): boolean {
  const m = AGENT_FOLDER_RE.exec(path)
  return m !== null && m[2] === INDEX_BASENAME
}

/** True for `agents/<name>/activation.md` — an activation note. */
export function isAgentActivationPath(path: string): boolean {
  const m = AGENT_FOLDER_RE.exec(path)
  return m !== null && m[2] === AGENT_ACTIVATION_BASENAME
}

/**
 * True for a note an agent's runs may write: anything in its folder that is
 * neither the brief nor the activation. Only the top level — a sub-folder
 * under the agent is fine to READ but its index would be a folder the agent
 * made, and folders are a person's to make.
 */
export function isAgentOwnNotePath(path: string, name: string): boolean {
  const m = AGENT_FOLDER_RE.exec(path)
  return m !== null && m[1] === name && m[2] !== INDEX_BASENAME && m[2] !== AGENT_ACTIVATION_BASENAME
}

/** The agent name a brief or activation path names, or null. */
export function agentNameOfPath(path: string): string | null {
  const m = AGENT_FOLDER_RE.exec(path)
  if (!m || (m[2] !== INDEX_BASENAME && m[2] !== AGENT_ACTIVATION_BASENAME)) return null
  return m[1]
}

/** The agent whose folder a path sits in — brief, activation or own note — or null. */
export function agentOfPath(path: string): string | null {
  const m = AGENT_FOLDER_RE.exec(path)
  return m ? m[1] : null
}

/**
 * The agent whose run made a write, from the revision stamps: origin `agent`
 * and model `agent:<name>`. Every note an agent's run touches carries both
 * (lib/agents/tools.ts), so this is how the store knows a write is the
 * agent's own — for the one folder it may write, and for the trigger it must
 * never wake.
 */
export function agentOfRevisionStamp(origin: string | undefined, model: string | undefined): string | null {
  if (origin !== 'agent' || !model || !model.startsWith('agent:')) return null
  return model.slice('agent:'.length) || null
}

// True when `path` IS one of the entity namespaces itself ('people',
// 'spaces', …). Those folders are identity rather than organisation: every
// entity note's path is derived from its node (entityNotePath) and every
// inbound [[mention]] resolves against it, so the namespace can't be moved or
// nested, and the only folders it holds are entity folders (an entity's own
// note turned index — see the "entity folders" note above).
export function isEntityNamespaceDir(path: string): boolean {
  return Object.values(ENTITY_DIRS).includes(path)
}

/**
 * Why a namespace folder can't be renamed, moved or deleted — the sentence the
 * server throws and the client greys the menu item out with — or null when
 * `path` is an ordinary folder.
 *
 * A namespace is structure, not filing. `agents/`, `connectors/` and `tools/`
 * are where the runtime LOOKS: the scheduler reads `agents/`, an agent's
 * `connectors:` line resolves against `connectors/`, a Tool is `tools/<name>/`.
 * `people/`, `events/` and the rest are the same bargain one step removed —
 * every entity note's path is derived from its node and every inbound
 * [[mention]] resolves against it. Deleting one wouldn't remove a folder, it
 * would trash every note inside and leave a space whose agents and connectors
 * had silently stopped existing.
 *
 * So the folder itself is fixed and its CONTENTS are not: delete an agent,
 * a connector, a Tool, a person freely — that is one note (or one entity
 * folder), and the namespace it sat in is still there, empty, ready for the
 * next one. There is no "delete anyway": nothing about a space wants these
 * gone, and an empty namespace costs a row.
 */
export function namespaceFolderDenial(path: string): string | null {
  if (!isEntityNamespaceDir(path)) return null
  return `"${path}" is one of the space's built-in folders — what it holds can be deleted, but the folder itself stays`
}

/**
 * The folders a space HAS whether or not anything is in them yet, keyed by the
 * tool that brings each one, the same way an empty Inbox is still a folder.
 * Every key here is a core feature (lib/featureAccess CORE_FEATURE_KEYS) and so
 * is never off — which is exactly the rule we want, with no special case to
 * state. `agents/` is keyed to `notes` because that is what an agent IS: a
 * brief in the Context, watched on its own node page rather than on a surface
 * of its own. The folder is there before the first brief is written.
 *
 * The entity namespaces (`people/`, `events/`, …) are deliberately NOT here:
 * they're derived from the directory rather than switched on, so an empty one
 * is noise. This is about the four folders a person goes LOOKING for —
 * `models/` beside `agents/` for the same reason: what the agents run on is
 * one decision a space makes, and the folder is where it is written.
 */
const STRUCTURAL_FOLDER_FEATURES: Record<string, string> = {
  agents: 'notes',
  models: 'notes',
  connectors: 'connectors',
  tools: 'tools',
}

export function structuralFolders(config: SpaceFeatureConfig | null | undefined): string[] {
  return Object.entries(STRUCTURAL_FOLDER_FEATURES)
    .filter(([, feature]) => isFeatureEnabled(config, feature))
    .map(([dir]) => dir)
}

// Resolve an entity-note path back to its directory node id via the loaded node
// map. Node ids are NOT reconstructible from paths by string surgery — legacy
// data still carries retired prefixes ('org:halter', 'group:halter') alongside
// today's 'space:halter' and idSlug is lossy — so the map, built by
// entityNotePath over real
// nodes, is the only sound reverse direction. Null for non-entity paths and for
// entity paths whose node isn't in the map (deleted node, other space,
// directory still loading) — callers fall back to opening the note in place.
export function resolveEntityNode(
  path: string,
  entityByPath: ReadonlyMap<string, { id: string }> | null | undefined,
): string | null {
  // The map is asked first and its answer is final: it holds exactly the paths
  // real nodes claim, adopted notes (which live outside every namespace)
  // included, so a namespace test in front of it would hide them.
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
  if (owner) {
    const id =
      entityByPath?.get(`${owner}/${INDEX_BASENAME}`)?.id ?? entityByPath?.get(`${owner}.md`)?.id
    if (id) return { id, subPath: path.slice(owner.length + 1) }
  }
  // Outside the namespaces the same rule holds, just without a shape to match
  // on: an adopted entity's folder is whichever ancestor's index the map
  // claims, so walk up from the note. Nearest ancestor wins, the way the
  // namespace form takes the entity folder and not the namespace above it.
  const segments = (path.startsWith('/') ? path.slice(1) : path).split('/')
  for (let depth = segments.length - 1; depth > 0; depth--) {
    const folder = segments.slice(0, depth).join('/')
    const id = entityByPath?.get(`${folder}/${INDEX_BASENAME}`)?.id
    if (id) return { id, subPath: path.slice(folder.length + 1) }
  }
  return null
}

/** Percent-decode a link target, leaving it alone when it isn't valid encoding. */
function decodeNotePath(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

/**
 * Every note this note's body links to, self excluded — the candidates for a
 * `mentioned` edge, before anything decides which of them name entities.
 *
 * Wider than entityMentionPaths on purpose: an adopted entity's note lives
 * outside the namespaces (see "adopted entity notes"), so a namespace filter
 * here would silently drop every mention of one. The reverse map is the filter
 * instead — it holds exactly the paths real nodes claim — which is the same
 * answer for a namespace note and the right one for an adopted note.
 * Frontmatter is ignored; each `[[Mention]]` is an ordinary markdown link.
 */
export function linkedNotePaths(notePath: string, content: string): string[] {
  const { body } = splitFrontmatter(content)
  const out = new Set<string>()
  for (const href of extractMarkdownLinks(body)) {
    const resolved = resolveOkfLink(href, notePath)
    if (!resolved || resolved === notePath) continue
    if (!/\.md$/i.test(resolved)) continue
    // Percent-decoded, unlike the namespace-only reader above: an adopted
    // note's path is the words a person filed it under, so `Alex Apoifis.md`
    // arrives from an editor-written href as `Alex%20Apoifis.md` and must come
    // back out as the path the store holds.
    out.add(decodeNotePath(resolved.startsWith('/') ? resolved.slice(1) : resolved))
  }
  return [...out]
}

// The entity-note paths a note's body links to (people/… & spaces/…),
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
  // Same reason again: `type: tool` is what lib/tools matches on.
  tool: 'tool',
  // And `type: model` is what lib/models matches on.
  model: 'model',
}
/** The frontmatter `type:` an entity note of this node type carries, or null
 *  for a non-entity type. */
export function entityTypeLabelOf(type: string | null | undefined): string | null {
  const kind = entityKindOf(type)
  return kind ? ENTITY_TYPE_LABEL[kind] : null
}

/**
 * The kinds whose note may carry any spelling of the kind as its `type:` — a
 * `Company` record is an organisation and keeps the word the space chose for
 * it. The config kinds are excluded: `type: connector` / `agent` / `tool` are
 * what their runtimes match on, exactly.
 */
const KIND_SPELLING_IS_FREE: ReadonlySet<EntityKind> = new Set([
  'person',
  'space',
  'event',
  'resource',
  'channel',
  'section',
])

/**
 * Does a note's declared `type:` name the same entity as this node? True for
 * the kind's own label and, for the directory kinds, any spelling that folds
 * onto the kind (`Company`, `Organisation` → space).
 */
export function entityTypeNamesKind(declared: string, nodeType: string): boolean {
  const kind = entityKindOf(nodeType)
  if (!kind) return false
  if (declared.trim().toLowerCase() === ENTITY_TYPE_LABEL[kind].toLowerCase()) return true
  return KIND_SPELLING_IS_FREE.has(kind) && entityKindOf(declared) === kind
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
  tool: 'tool',
  model: 'model',
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
  opts: { tags?: string[]; body?: string; spaceRef?: string | null },
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
    // A space node that stands for a space running here names it, so the note
    // is self-describing without the node row.
    (opts.spaceRef ? `space: ${JSON.stringify(opts.spaceRef)}\n` : '') +
    `tags: [${tags.join(', ')}]\n` +
    `---\n\n` +
    `${subtitle}` +
    (body ? `${body}\n` : `Context and notes about this ${kindTag}.\n`)
  )
}
