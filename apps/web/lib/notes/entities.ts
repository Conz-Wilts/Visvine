// Pure helpers mapping directory entities (person/organization Nodes) to their
// canonical per-entity note path, and back. A `[[Craig Piggott]]` mention is
// stored as an ordinary OKF link to this path, so the note that records context
// about the entity is a real note — graph, backlinks, and search all work with
// no special-casing. No fs/DOM access, so this is unit-testable like lib/notes/shared/*.

import { splitFrontmatter, extractMarkdownLinks, resolveOkfLink } from './shared/markdown'
import { isIndexPath } from './shared/indexNote'

export type EntityKind = 'person' | 'company' | 'resource' | 'event'

// The minimal shape we need off a directory node (NBNode-compatible).
export interface EntityNodeLike {
  id: string
  type: string
  name?: string | null
  subtitle?: string | null
}

const PEOPLE_DIR = 'people'
const COMPANIES_DIR = 'companies'
const RESOURCES_DIR = 'resources'
const EVENTS_DIR = 'events'

const ENTITY_DIRS: Record<EntityKind, string> = {
  person: PEOPLE_DIR,
  company: COMPANIES_DIR,
  resource: RESOURCES_DIR,
  event: EVENTS_DIR,
}

// Map a node `type` to an entity kind (null for non-entity types). Liberal so it
// copes with 'person'/'people' and 'organization'/'org'/'company'.
export function entityKindOf(type: string | null | undefined): EntityKind | null {
  const t = (type ?? '').trim().toLowerCase()
  if (t === 'person' || t === 'people') return 'person'
  if (t.startsWith('org') || t === 'group' || t === 'groups' || t === 'company' || t === 'companies') return 'company'
  if (t === 'resource' || t === 'resources') return 'resource'
  if (t === 'event' || t === 'events') return 'event'
  return null
}

// Strip the `<type>:` prefix from a node id to get its slug (`person:craig` → `craig`).
function idSlug(id: string): string {
  const i = id.indexOf(':')
  return (i === -1 ? id : id.slice(i + 1)).trim()
}

// The canonical note path for a directory entity, or null if the node isn't an
// entity kind. person → people/<slug>.md, organization → companies/<slug>.md,
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
  if (!/^(people|companies|resources|events)\/.+\.md$/.test(raw)) return null
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

// The entity kind implied by a note path (people/…, companies/…, resources/…), or null.
export function entityKindOfPath(path: string): EntityKind | null {
  if (path.startsWith(`${PEOPLE_DIR}/`)) return 'person'
  if (path.startsWith(`${COMPANIES_DIR}/`)) return 'company'
  if (path.startsWith(`${RESOURCES_DIR}/`)) return 'resource'
  if (path.startsWith(`${EVENTS_DIR}/`)) return 'event'
  return null
}

// Resolve an entity-note path back to its directory node id via the loaded node
// map. Node ids are NOT reconstructible from paths by string surgery — the org
// prefix varies ('org:halter' in seeds vs 'organization:<slug>' from the create
// modal) and idSlug is lossy — so the map, built by entityNotePath over real
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

// The entity-note paths a note's body links to (people/… & companies/…),
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

// Default markdown for an auto-created entity context note. Carries the directory
// `node:` id in frontmatter so the note view can link back to the directory profile.
export function entityStub(node: EntityNodeLike): string {
  const kind = entityKindOf(node.type) ?? 'person'
  const title = (node.name ?? idSlug(node.id)).trim()
  const typeLabel: Record<EntityKind, string> = { person: 'Person', company: 'Company', resource: 'Resource', event: 'Event' }
  const tag: Record<EntityKind, string> = { person: 'person', company: 'company', resource: 'resource', event: 'event' }
  // The title renders as the note heading from frontmatter (see NoteEditor), so the
  // body carries no `# Title` line — just the optional subtitle and a starter prompt.
  const subtitle = node.subtitle ? `> ${node.subtitle}\n\n` : ''
  return (
    `---\n` +
    `type: ${typeLabel[kind]}\n` +
    `title: ${JSON.stringify(title)}\n` +
    `node: ${JSON.stringify(node.id)}\n` +
    `tags: [${tag[kind]}]\n` +
    `---\n\n` +
    `${subtitle}` +
    `Context and notes about this ${tag[kind]}.\n`
  )
}
