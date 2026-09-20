// The Create panel's list and what picking a row does, in one pure module.
//
// The panel beside the rail shows every kind of thing a person can make in
// the space they are in — the built-in types the space's tools own, the
// types the space invented for its notes, and a "New type" row while the
// search names something that is neither. The panel is a PICKER and nothing
// else: picking a row does one of two things (`flowFor`), and both of them
// happen on the page rather than in the rail. Either the kind has a surface
// of its own that already is its create UI (an event's composer, the
// connector catalogue, the models section), or it goes to the draft — the
// note-first create surface at /directory/new, where the thing's own context
// note is what you fill in and the kind's extra fields sit under the title.
// The table is here rather than in the panel so the rail's entry point, the
// tree's "+" and the channel list's buttons cannot disagree about where a
// type is made.

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
  /** The kind's own surface; the panel closes. */
  | { kind: 'route'; href: string }
  /** The draft surface, with the type preset. */
  | { kind: 'draft'; href: string }

/**
 * The kinds the draft surface commits. Every one of them is a row of this
 * table whose flow is a draft, spelled the way `?type=` spells it — which is
 * the row's id except for a note, whose create-type id is `context` and whose
 * draft spelling is `note`.
 */
export type DraftKind =
  | 'note'
  | 'folder'
  | 'agent'
  | 'person'
  | 'space'
  | 'resource'
  | 'channel'
  | 'section'
  | 'tool'
  | 'file'

/** The draft spelling of every built-in kind the draft makes. */
const DRAFT_KIND_OF: Partial<Record<CreateKind, DraftKind>> = {
  context: 'note',
  folder: 'folder',
  agent: 'agent',
  person: 'person',
  space: 'space',
  resource: 'resource',
  channel: 'channel',
  section: 'section',
  tool: 'tool',
  file: 'file',
}

const DRAFT_KIND_NAMES: ReadonlySet<string> = new Set(Object.values(DRAFT_KIND_OF))

/** Whether `?type=` names a built-in shape rather than one of the space's own. */
export function isDraftKind(value: string | null | undefined): value is DraftKind {
  return !!value && DRAFT_KIND_NAMES.has(value)
}

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
  { id: 'person', label: 'Person', configName: 'Person', color: '#60a5fa' },
  { id: 'space', label: 'Space', configName: 'Space', color: '#4ade80' },
  { id: 'event', label: 'Event', configName: 'Event', color: '#f87171' },
  { id: 'resource', label: 'Resource', configName: 'Resource', color: '#fb923c' },
  { id: 'context', label: 'Note', configName: null, color: NOTE_COLOR },
  { id: 'folder', label: 'Folder', configName: null, color: '#facc15' },
  { id: 'file', label: 'File', configName: null, color: '#38bdf8' },
  { id: 'channel', label: 'Channel', configName: 'Channel', color: '#f472b6' },
  { id: 'section', label: 'Section', configName: 'Section', color: '#38bdf8' },
  { id: 'agent', label: 'Agent', configName: 'Agent', color: '#2dd4bf' },
  { id: 'tool', label: 'Tool', configName: 'Tool', color: '#c084fc' },
  { id: 'connector', label: 'Connector', configName: 'Connector', color: '#818cf8' },
  { id: 'model', label: 'Model', configName: 'Model', color: '#a78bfa' },
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
 * The space's own note vocabulary, alphabetical: anything stored with
 * `scope: 'note'` that is neither reserved nor a spelling of a built-in. The
 * Create panel lists these as rows; the draft surface's type menu lists the
 * configs themselves.
 */
export function spaceNoteTypes(spaceNodeTypes: NodeTypeConfig[] | null | undefined): NodeTypeConfig[] {
  const seen = new Set<string>()
  const out: NodeTypeConfig[] = []
  for (const t of spaceNodeTypes ?? []) {
    if (t.scope !== 'note') continue
    const key = t.name.trim().toLowerCase()
    if (!key || seen.has(key) || isReservedTypeName(key) || findNodeTypeConfig(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** Those types as rows of the Create panel's list. */
function customRows(spaceNodeTypes: NodeTypeConfig[] | null | undefined): CreateRow[] {
  return spaceNoteTypes(spaceNodeTypes).map((t) => ({ kind: 'custom', name: t.name, color: t.color }))
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

/** What a draft link may carry beyond the type and the folder. */
export interface DraftHrefOptions {
  /** An alias picked off the kind's tree, worn by the thing being made. */
  alias?: string | null
  /** A starter brief, for an agent. */
  template?: string | null
  /**
   * The type named by `type=` does not exist yet — the draft registers it on
   * the space before it commits. Only the "New type" row sets this.
   */
  newType?: boolean
}

/** The draft surface with a type preset, and a folder when one was in hand. */
export function draftHref(type: string | null, folder?: string | null, opts: DraftHrefOptions = {}): string {
  const params = new URLSearchParams()
  if (type) params.set('type', type)
  if (folder) params.set('folder', folder)
  if (opts.alias) params.set('alias', opts.alias)
  if (opts.template) params.set('template', opts.template)
  if (opts.newType) params.set('new', '1')
  const query = params.toString()
  return `/directory/new${query ? `?${query}` : ''}`
}

export interface FlowContext extends DraftHrefOptions {
  /** A folder the caller was standing in, for the kinds that land in one. */
  folder?: string | null
}

/**
 * What picking a row does. Everything a person can make either has a surface
 * of its own — the event composer, the connector catalogue, the models
 * section, each of which already IS a create UI — or it goes to the draft.
 * Nothing is filled in beside the rail: the Create panel picks the kind and
 * the page makes the thing.
 */
export function flowFor(row: CreateRow, ctx: FlowContext): CreateFlow {
  if (row.kind === 'custom') return { kind: 'draft', href: draftHref(row.name, ctx.folder, ctx) }
  // A type nobody has used yet. Named, it goes to the draft wearing that name
  // and the draft registers it; unnamed (the standing row at the top of the
  // list), it goes to a bare draft, where the type menu is where you name one.
  if (row.kind === 'new-type') {
    return row.name
      ? { kind: 'draft', href: draftHref(row.name, ctx.folder, { ...ctx, newType: true }) }
      : { kind: 'draft', href: draftHref(null, ctx.folder) }
  }
  switch (row.id) {
    // The composer is the create UI: poster, date, place, RSVP.
    case 'event':
      return { kind: 'route', href: '/events/new' }
    // The catalogue is the create UI: one press, a sign-in, or the form.
    case 'connector':
      return { kind: 'route', href: '/admin?section=connectors' }
    // Models is a section of the Space Console.
    case 'model':
      return { kind: 'route', href: '/admin?section=models' }
    default: {
      const kind = DRAFT_KIND_OF[row.id]
      // Every remaining row is a draft kind; the fallback keeps a kind added
      // to BUILT_INS without a draft spelling from landing nowhere.
      return { kind: 'draft', href: draftHref(kind ?? null, ctx.folder, ctx) }
    }
  }
}

/** The row for a built-in kind, when this person may make it here. */
export function rowForKind(kind: CreateKind, input: Omit<CreateRowsInput, 'query'>): CreateRow | null {
  return builtInRows({ ...input, query: '' }).find((r) => r.kind === 'type' && r.id === kind) ?? null
}

// ── The draft surface's own view of this table ───────────────────────────────

/**
 * Whether a kind has prose in front of it — a note to write while you are
 * making it. The three that do not (a group of channels, a Tool's scaffold, an
 * upload) get no editor on the draft and no Raw tab over it.
 */
export function draftHasProse(kind: DraftKind | null): boolean {
  return kind !== 'section' && kind !== 'tool' && kind !== 'file'
}

/**
 * Whether a kind carries tags. Tags label a note, so the kinds that write one
 * take them; a channel, a section, a Tool scaffold and an upload do not, and
 * the draft withholds the row rather than offering one that goes nowhere.
 */
export function draftUsesTags(kind: DraftKind | null): boolean {
  return kind === null || (kind !== 'channel' && kind !== 'section' && kind !== 'tool' && kind !== 'file')
}

/** One shape the draft surface offers in its type menu. */
export interface DraftTypeOption {
  id: DraftKind
  label: string
  /** The colour the space paints the kind, resolved the same way a row is. */
  color: string
}

/**
 * The shapes the draft may commit here, in the same order the Create panel
 * lists them. Derived from the one table above rather than restated, so the
 * panel and the surface it hands off to can never offer different kinds — or
 * gate them differently, since this runs the same permission filter.
 */
export function draftTypeOptions(input: Omit<CreateRowsInput, 'query' | 'pathname'>): DraftTypeOption[] {
  const out: DraftTypeOption[] = []
  for (const row of builtInRows({ ...input, pathname: null, query: '' })) {
    if (row.kind !== 'type') continue
    const id = DRAFT_KIND_OF[row.id]
    if (!id) continue
    out.push({ id, label: row.label, color: row.color })
  }
  return out
}
