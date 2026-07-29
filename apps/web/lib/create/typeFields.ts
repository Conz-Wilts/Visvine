// The per-type property schema behind the note-first create surface: which rows
// a Person / Group / Resource shows under its title, and where each row's value
// lands on the node (a real column vs a metadata key).
//
// This lives in lib/create/ rather than lib/types/context.ts on purpose. That
// module is the node *domain* — shapes, colours, aliases — and is imported by
// the graph renderer, the dashboard and the tables; a UI field schema carrying
// input kinds and placeholders would ride into all of those bundles for nothing.
//
// The metadata keys are not free choices. `tryResolveIdentity` (see
// app/api/data/nodes/route.ts and lib/identity/attachIdentity.ts) reads exactly
// `email`, `companyName`, `linkedinUrl` and `website` — spelling any of them
// differently here silently disables cross-community identity matching, with no
// error anywhere. Pure: no DOM/Prisma imports, so tests/create-type-fields.test.ts
// covers it directly.

import type { NBNode } from '@/lib/types'

type FieldKind = 'text' | 'email' | 'url' | 'date' | 'number' | 'location' | 'image'

/** A node column a field may write to. Kept narrow — everything else is metadata. */
type FieldColumn = 'subtitle' | 'location' | 'url' | 'image_url'

export interface TypeFieldDef {
  /** Metadata key, or (for `target: 'column'`) a stable id for the row. */
  key: string
  label: string
  kind: FieldKind
  target: 'column' | 'metadata'
  /** Required when `target === 'column'`. */
  column?: FieldColumn
  placeholder?: string
  /**
   * Column-backed fields that ALSO mirror into metadata under this key, because
   * identity resolution reads metadata and not the column (Group's website).
   */
  mirrorMetadataKey?: string
}

// Node types are stored lowercased (both POST and PUT in /api/data/nodes call
// `type.toLowerCase()`), so every lookup here normalizes first. The synonym map
// mirrors `entityKindOf` in lib/notes/entities.ts — 'organization'/'org'/
// 'company' are all the same thing wearing different legacy prefixes.
function canonicalType(type: string | null | undefined): string {
  const t = (type ?? '').trim().toLowerCase()
  if (t === 'people') return 'person'
  if (t.startsWith('org') || t === 'groups' || t === 'company' || t === 'companies') return 'group'
  if (t === 'resources') return 'resource'
  if (t === 'events') return 'event'
  if (t === 'notes') return 'note'
  return t
}

const PERSON_FIELDS: TypeFieldDef[] = [
  { key: 'subtitle', label: 'Role', kind: 'text', target: 'column', column: 'subtitle', placeholder: 'Founder, Halter' },
  { key: 'email', label: 'Email', kind: 'email', target: 'metadata', placeholder: 'name@company.com' },
  { key: 'companyName', label: 'Company', kind: 'text', target: 'metadata', placeholder: 'Halter' },
  { key: 'linkedinUrl', label: 'LinkedIn', kind: 'url', target: 'metadata', placeholder: 'linkedin.com/in/…' },
  { key: 'location', label: 'Location', kind: 'location', target: 'column', column: 'location', placeholder: 'Auckland, NZ' },
  { key: 'image_url', label: 'Photo', kind: 'image', target: 'column', column: 'image_url' },
]

const GROUP_FIELDS: TypeFieldDef[] = [
  { key: 'subtitle', label: 'Tagline', kind: 'text', target: 'column', column: 'subtitle', placeholder: 'What they do' },
  // The column drives the profile link; the metadata mirror is what the
  // organization identity resolver reads (websiteDomain blocking).
  { key: 'url', label: 'Website', kind: 'url', target: 'column', column: 'url', placeholder: 'halter.io', mirrorMetadataKey: 'website' },
  { key: 'location', label: 'HQ', kind: 'location', target: 'column', column: 'location', placeholder: 'Auckland, NZ' },
  { key: 'founded', label: 'Founded', kind: 'number', target: 'metadata', placeholder: '2016' },
  { key: 'memberCount', label: 'Members', kind: 'number', target: 'metadata', placeholder: '120' },
  { key: 'image_url', label: 'Logo', kind: 'image', target: 'column', column: 'image_url' },
]

const RESOURCE_FIELDS: TypeFieldDef[] = [
  { key: 'subtitle', label: 'Description', kind: 'text', target: 'column', column: 'subtitle', placeholder: 'What this is' },
  { key: 'url', label: 'Link', kind: 'url', target: 'column', column: 'url', placeholder: 'https://…' },
]

// Events are not creatable from the note-first surface yet (their detail route
// redirects to /events/<id>, whose tab state isn't in the URL), but the profile
// details section renders from this table too — and eventRepo writes these keys
// in snake_case. Do NOT "fix" them to camelCase; lib/eventRepo.ts is the writer.
const EVENT_FIELDS: TypeFieldDef[] = [
  { key: 'start_at', label: 'Date', kind: 'date', target: 'metadata' },
  { key: 'end_at', label: 'Ends', kind: 'date', target: 'metadata' },
  { key: 'location', label: 'Location', kind: 'location', target: 'column', column: 'location' },
  { key: 'capacity', label: 'Capacity', kind: 'number', target: 'metadata' },
  { key: 'organizerEmail', label: 'Organizer', kind: 'email', target: 'metadata' },
]

const FIELDS_BY_TYPE: Record<string, TypeFieldDef[]> = {
  person: PERSON_FIELDS,
  group: GROUP_FIELDS,
  resource: RESOURCE_FIELDS,
  event: EVENT_FIELDS,
}

/**
 * The property rows for a node type, or `[]` for a type with none (a plain
 * Note, or a community-invented type we know nothing about). Never null, so
 * callers can map straight over the result.
 */
export function fieldsForType(type: string | null | undefined): TypeFieldDef[] {
  return FIELDS_BY_TYPE[canonicalType(type)] ?? []
}

/** One row's definition by key, for targeted updates. */
export function fieldDef(type: string | null | undefined, key: string): TypeFieldDef | null {
  return fieldsForType(type).find((f) => f.key === key) ?? null
}

export interface AppliedFields {
  /** Column values to spread onto the node payload. */
  node: Pick<NBNode, 'subtitle' | 'location' | 'url' | 'image_url'>
  /** Metadata object to send as `node.metadata`. */
  metadata: Record<string, unknown>
}

/**
 * Split a flat `{ fieldKey: value }` form state into the node columns and the
 * metadata blob the create/patch endpoints expect. Empty strings are dropped
 * rather than written as `''` — a blank row means "unset", and storing empties
 * would make `tryResolveIdentity` treat a blank email as a real signal.
 *
 * Unknown keys are ignored: the caller's state may still hold values from a type
 * the user selected and then changed away from, and those must not leak onto the
 * node.
 */
export function applyFields(
  type: string | null | undefined,
  values: Record<string, unknown>,
): AppliedFields {
  const node: AppliedFields['node'] = {}
  const metadata: Record<string, unknown> = {}

  for (const field of fieldsForType(type)) {
    const raw = values[field.key]
    const value = typeof raw === 'string' ? raw.trim() : raw
    if (value === undefined || value === null || value === '') continue

    if (field.target === 'column' && field.column) {
      node[field.column] = String(value)
      if (field.mirrorMetadataKey) metadata[field.mirrorMetadataKey] = String(value)
    } else {
      metadata[field.key] = field.kind === 'number' ? Number(value) : value
    }
  }

  return { node, metadata }
}

/**
 * The inverse, for editing an existing node: read current values out of its
 * columns and metadata into the flat shape the property rows bind to.
 */
export function readFields(
  node: Pick<NBNode, 'type' | 'subtitle' | 'location' | 'url' | 'image_url' | 'metadata'>,
): Record<string, string> {
  const meta = node.metadata ?? {}
  const values: Record<string, string> = {}

  for (const field of fieldsForType(node.type)) {
    const raw =
      field.target === 'column' && field.column ? node[field.column] : (meta as Record<string, unknown>)[field.key]
    if (raw === undefined || raw === null || raw === '') continue
    values[field.key] = String(raw)
  }

  return values
}
