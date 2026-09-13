// The Create panel's list and what picking a row does, in one pure module.
//
// The panel beside the rail shows every kind of thing a person can make in
// the space they are in — the built-in types the space's tools own, the
// types the space invented for its notes, and a "New type" row while the
// search names something that is neither. Picking a row does one of three
// things (`flowFor`): a short form in the same panel, the type's own surface
// (an event's composer, the connector catalogue), or the context-note draft
// for the things that ARE prose. The table is here rather than in the panel
// so the rail's entry point, the tree's "+" and the channel list's buttons
// cannot disagree about where a type is made.

import type { CreateableType } from '@/features/shared/contexts/CreateModalContext'
import { canCreateType, type CreatePermissions } from '@/lib/create/creatable'
import { suggestedCreateType } from '@/lib/create/suggestedType'
import { isNodeTypeEnabled } from '@/lib/featureAccess'
import { scoreName } from '@/lib/rankName'
import { findNodeTypeConfig, type NodeTypeConfig } from '@/lib/types/context'
import { isReservedTypeName, mergeNodeType } from '@/lib/types/nodeTypeRegistry'

/** A built-in kind the panel lists. `model` is admin-only and not a node type. */
export type CreateKind = CreateableType | 'model'

export type CreateRow =
  /** A built-in kind, coloured by the space's config for its node type. */
  | { kind: 'type'; id: CreateKind; label: string; color: string }
  /** A type the space invented for its notes (`scope: 'note'`). */
  | { kind: 'custom'; name: string; color: string }
  /**
   * A type the space does not have. `name` is what the search named it; the
   * standing row at the top of the unsearched list carries none, and the form
   * asks for it.
   */
  | { kind: 'new-type'; name: string }

export type CreateFlow =
  /** A short form in the panel itself. */
  | { kind: 'inline' }
  /** The kind's own surface; the panel closes. */
  | { kind: 'route'; href: string }
  /** The context-note draft, with the type preset. */
  | { kind: 'draft'; href: string }

/** The colour the draft surface paints a plain note. */
const NOTE_COLOR = '#64748b'

interface BuiltIn {
  id: CreateKind
  label: string
  /** The node type whose config colours the row, and whose feature gates it. */
  configName: string | null
  /** For a kind with no node type (a note, a folder, a file). */
  color: string
}

// Display order when nothing is searched: the things a directory is made of,
// then context, then the tools' containers, then what admins wire up.
const BUILT_INS: readonly BuiltIn[] = [
  { id: 'person', label: 'Person', configName: 'Person', color: '#2563eb' },
  { id: 'space', label: 'Space', configName: 'Space', color: '#78d870' },
  { id: 'event', label: 'Event', configName: 'Event', color: '#ef4444' },
  { id: 'resource', label: 'Resource', configName: 'Resource', color: '#f59e0b' },
  { id: 'context', label: 'Note', configName: null, color: NOTE_COLOR },
  { id: 'folder', label: 'Folder', configName: null, color: '#6b7280' },
  { id: 'file', label: 'File', configName: null, color: '#0ea5e9' },
  { id: 'channel', label: 'Channel', configName: 'Channel', color: '#e0685f' },
  { id: 'section', label: 'Section', configName: 'Section', color: '#0ea5e9' },
  { id: 'agent', label: 'Agent', configName: 'Agent', color: '#0d9488' },
  { id: 'tool', label: 'Tool', configName: 'Tool', color: '#8b5cf6' },
  { id: 'connector', label: 'Connector', configName: 'Connector', color: '#6366f1' },
  { id: 'model', label: 'Model', configName: null, color: '#64748b' },
]

export interface CreateRowsInput extends CreatePermissions {
  /** The space's stored vocabulary (`currentSpace.nodeTypes`). */
  spaceNodeTypes: NodeTypeConfig[] | null | undefined
  /** The page the panel was opened from; ranks that page's kinds first. */
  pathname: string | null | undefined
  /** What is typed in the search, raw. */
  query: string
}

export interface CreateRowList {
  rows: CreateRow[]
  /** Index of the first row below the hairline (the space's own types), or null. */
  dividerAt: number | null
}

function typeRow(b: BuiltIn, spaceNodeTypes: NodeTypeConfig[] | null | undefined): CreateRow {
  const color = (b.configName && findNodeTypeConfig(b.configName, spaceNodeTypes ?? undefined)?.color) || b.color
  return { kind: 'type', id: b.id, label: b.label, color }
}

/** Every built-in kind this person may make here, in display order. */
function builtInRows(input: CreateRowsInput): CreateRow[] {
  const perms: CreatePermissions = { featureConfig: input.featureConfig, isAdmin: input.isAdmin }
  return BUILT_INS.filter((b) => {
    if (b.configName && !isNodeTypeEnabled(input.featureConfig, b.configName)) return false
    if (b.id === 'model') return input.isAdmin
    return canCreateType(b.id, perms)
  }).map((b) => typeRow(b, input.spaceNodeTypes))
}

/**
 * The space's own note types, alphabetical: anything stored with
 * `scope: 'note'` that is neither reserved nor a spelling of a built-in.
 */
function customRows(spaceNodeTypes: NodeTypeConfig[] | null | undefined): CreateRow[] {
  const seen = new Set<string>()
  const out: CreateRow[] = []
  for (const t of spaceNodeTypes ?? []) {
    if (t.scope !== 'note') continue
    const key = t.name.trim().toLowerCase()
    if (!key || seen.has(key) || isReservedTypeName(key) || findNodeTypeConfig(key)) continue
    seen.add(key)
    out.push({ kind: 'custom', name: t.name, color: t.color })
  }
  return out.sort((a, b) => rowLabel(a).localeCompare(rowLabel(b)))
}

export function rowLabel(row: CreateRow): string {
  return row.kind === 'type' ? row.label : row.name
}

/** A stable key for a row, for lists and for finding a row by kind. */
export function rowKey(row: CreateRow): string {
  return row.kind === 'type' ? row.id : `${row.kind}:${row.name.toLowerCase()}`
}

/**
 * The name the built-in's node type is stored under, for resolving a typed
 * synonym ("company" → Space) onto its row.
 */
function configNameOf(row: CreateRow): string | null {
  if (row.kind === 'custom') return row.name
  if (row.kind !== 'type') return null
  return BUILT_INS.find((b) => b.id === row.id)?.configName ?? null
}

/**
 * The rows in display order. With no query: **New type** first — making one is
 * a thing you do here, so it is offered rather than discovered by typing a name
 * nothing answers to — then the current page's kinds, the rest of the built-ins
 * in their own order, a hairline, then the space's types. With a query: one
 * flat ranked list, and the "New type" row last, named, when the query is a
 * legal name nobody has used — the ranked matches keep the top, so Enter still
 * picks what was searched for.
 */
export function createRows(input: CreateRowsInput): CreateRowList {
  const builtIns = builtInRows(input)
  const customs = customRows(input.spaceNodeTypes)
  const q = input.query.trim().toLowerCase()

  if (!q) {
    const suggested = suggestedCreateType(input.pathname)?.types ?? []
    const first = suggested
      .map((id) => builtIns.find((r) => r.kind === 'type' && r.id === id))
      .filter((r): r is CreateRow => Boolean(r))
    const rest = builtIns.filter((r) => !first.includes(r))
    const starter = canCreateType('context', { featureConfig: input.featureConfig, isAdmin: input.isAdmin })
      ? ([{ kind: 'new-type', name: '' }] as CreateRow[])
      : []
    const rows = [...starter, ...first, ...rest, ...customs]
    return { rows, dividerAt: customs.length ? rows.length - customs.length : null }
  }

  // A synonym resolves to the type it names, so "company" finds Space even
  // though the label shares no letters with it.
  const resolved = findNodeTypeConfig(q, input.spaceNodeTypes ?? undefined)?.name.toLowerCase() ?? null
  const scored = [...builtIns, ...customs]
    .map((row) => {
      const byName = scoreName(rowLabel(row), q)
      const bySynonym = resolved && configNameOf(row)?.toLowerCase() === resolved ? 100000 : -Infinity
      return { row, score: Math.max(byName, bySynonym) }
    })
    .filter(({ score }) => score > -Infinity)
    .sort((a, b) => b.score - a.score)
    .map(({ row }) => row)

  const newType = newTypeRow(input, scored)
  return { rows: newType ? [...scored, newType] : scored, dividerAt: null }
}

/**
 * The "New type" row: offered when what was typed is a legal type name that
 * no built-in, synonym or space type already answers to — and this person
 * may write a note here, since that is what a type made this way labels.
 */
function newTypeRow(input: CreateRowsInput, matches: CreateRow[]): CreateRow | null {
  const perms: CreatePermissions = { featureConfig: input.featureConfig, isAdmin: input.isAdmin }
  if (!canCreateType('context', perms)) return null
  const merged = mergeNodeType(input.spaceNodeTypes, { name: input.query })
  if (!merged.ok || !merged.created) return null
  const name = merged.type.name
  if (matches.some((r) => rowLabel(r).toLowerCase() === name.toLowerCase())) return null
  return { kind: 'new-type', name }
}

/**
 * The row the keyboard starts on: the first real kind, never the standing
 * "New type" row — Enter on an untouched panel must not start inventing a type.
 */
export function firstPickIndex(list: CreateRowList): number {
  const i = list.rows.findIndex((row) => row.kind !== 'new-type')
  return i === -1 ? 0 : i
}

/** The draft surface with a type preset, and a folder when one was in hand. */
export function draftHref(type: string | null, folder?: string | null): string {
  const params = new URLSearchParams()
  if (type) params.set('type', type)
  if (folder) params.set('folder', folder)
  const query = params.toString()
  return `/directory/new${query ? `?${query}` : ''}`
}

export interface FlowContext {
  /** A folder the caller was standing in, for the kinds that land in one. */
  folder?: string | null
}

/**
 * What picking a row does. An agent is `inline` although its brief is prose:
 * the panel's step is the starter list, and picking one goes to the draft.
 */
export function flowFor(row: CreateRow, ctx: FlowContext): CreateFlow {
  if (row.kind === 'custom') return { kind: 'draft', href: draftHref(row.name, ctx.folder) }
  if (row.kind === 'new-type') return { kind: 'inline' }
  switch (row.id) {
    // The composer is the create UI: poster, date, place, RSVP.
    case 'event':
      return { kind: 'route', href: '/events/new' }
    // The catalogue is the create UI: one press, a sign-in, or the form.
    case 'connector':
      return { kind: 'route', href: '/admin?section=connectors' }
    // Models is a section of Settings.
    case 'model':
      return { kind: 'route', href: '/settings?section=models' }
    // A note is prose; the draft is where prose is written.
    case 'context':
      return { kind: 'draft', href: draftHref('note', ctx.folder) }
    default:
      return { kind: 'inline' }
  }
}

/** The row for a built-in kind, when this person may make it here. */
export function rowForKind(kind: CreateKind, input: Omit<CreateRowsInput, 'query'>): CreateRow | null {
  return builtInRows({ ...input, query: '' }).find((r) => r.kind === 'type' && r.id === kind) ?? null
}
