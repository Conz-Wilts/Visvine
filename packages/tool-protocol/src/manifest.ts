/**
 * A Tool's manifest, version 2: the structured facts about a Tool that a
 * machine enforces or places — its reach, its bindings, its settings, where it
 * runs, what it depends on — as opposed to the prose (title, description,
 * docs) its index note keeps. Pure.
 *
 * Stored as a row per Tool (the app's `app_tool_configs`), snapshotted into
 * every version, and read everywhere through one parser here, so a rule has
 * one definition. A v1 Tool — reach in its index note's `perimeter:` — reads
 * as v2 with no bindings (`factsFromV1`), so every Tool built before this runs
 * unchanged.
 *
 * `$name` in a permission names a BINDING: a slot the installing space fills
 * with its own folder, type, connector or agent (./bindings.ts). Review reads
 * the abstract form; the bridge enforces the bound one.
 */
import { isValidGlobEntry, parseToolPerimeter, type ToolPerimeter } from './perimeter'

export const MANIFEST_VERSION = 2

/** Where a Tool may run. Never the phone apps — the server refuses them regardless. */
export const TOOL_PLATFORMS = ['web', 'desktop'] as const
export type ToolPlatform = (typeof TOOL_PLATFORMS)[number]

/** The kit majors this server speaks; a version outside fails compatibility. */
export const SUPPORTED_SDK_MAJORS = [1, 2] as const

export type BindingKind = 'folder' | 'type' | 'connector' | 'agent'
export const BINDING_KINDS: readonly BindingKind[] = ['folder', 'type', 'connector', 'agent']

/** A named slot the installing space fills with a thing of its own. */
export interface BindingSlot {
  kind: BindingKind
  label: string
  /** What the source space binds it to, and what an install offers first. */
  suggest?: string
  /** A folder slot's required root, e.g. `resources/`. */
  within?: string
  /** A type slot's fields the Tool reads or writes; the bound type must have them. */
  fields?: string[]
  /** A connector slot's catalogue recipe, which filters the picker. */
  recipe?: string
  /** An unbound optional slot runs degraded, as a missing connector does. */
  optional?: boolean
}

export type SettingType = 'string' | 'number' | 'boolean' | 'string[]'

/** One install-time setting an admin fills on the install sheet. Never a secret. */
export interface SettingSpec {
  type: SettingType
  label: string
  enum?: string[]
  default?: unknown
  required?: boolean
}

/** A connector a Tool may call, and (for a global Tool) which of its actions. */
export interface ConnectorUse {
  use: string
  actions?: string[]
}

export interface ToolPermissions {
  context: { read: string[]; write: string[] }
  records: { read: string[]; write: Array<{ type: string; fields: string[] }> }
  resources: { read: string[] }
  connectors: ConnectorUse[]
  agents: string[]
  /** Node types the Tool works with (v1's `perimeter.types`). */
  types: string[]
  actions: string[]
  ai: { complete: boolean; decide: boolean }
  ui: { download: boolean }
}

/** A per-install ledger a Tool writes one row per event into (M10's collections). */
export interface CollectionSpec {
  schema: Record<string, unknown>
  read: 'all' | 'own' | 'admin'
  write: 'all' | 'own' | 'admin'
  maxRows: number
}

/** Everything the row holds. Title, description, tags and docs stay the note's. */
export interface ToolManifestFacts {
  manifestVersion: 2
  release: string | null
  license: string | null
  sdk: string
  platforms: ToolPlatform[]
  dependencies: Record<string, string>
  settings: Record<string, SettingSpec>
  bindings: Record<string, BindingSlot>
  permissions: ToolPermissions
  collections: Record<string, CollectionSpec>
}

export const EMPTY_PERMISSIONS: ToolPermissions = {
  context: { read: [], write: [] },
  records: { read: [], write: [] },
  resources: { read: [] },
  connectors: [],
  agents: [],
  types: [],
  actions: [],
  ai: { complete: false, decide: false },
  ui: { download: false },
}

/** The keys of a manifest that are facts (the row's), not prose (the note's). */
export const MANIFEST_FACT_KEYS = [
  'manifestVersion',
  'release',
  'license',
  'sdk',
  'platforms',
  'dependencies',
  'settings',
  'bindings',
  'permissions',
  'collections',
] as const

/** v1's word for the same facts, which an index note written before v2 carries. */
export const V1_FACT_KEYS = ['perimeter'] as const

const SLOT_RE = /^[a-z][a-z0-9_]{0,31}$/
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const SPDX_RE = /^(?:proprietary|[A-Za-z0-9.+-]{2,64}(?: (?:OR|AND|WITH) [A-Za-z0-9.+-]{2,64})*)$/
const DEP_NAME_RE = /^(?:@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/
/** One range or several joined by ||: `^4`, `~4.1`, `>=4.0.0`, `4.1.0`, `4.x`, `*`. */
const ONE_RANGE = String.raw`(?:\*|x|(?:\^|~|>=)?v?\d+(?:\.(?:\d+|x|\*)){0,2})`
const DEP_RANGE_RE = new RegExp(`^${ONE_RANGE}(?:\\s*\\|\\|\\s*${ONE_RANGE})*$`)
const REF_RE = /^\$([a-z][a-z0-9_]{0,31})(.*)$/

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function strings(raw: unknown, where: string): ParseResult<string[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] }
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string')) return { ok: false, error: `${where} must be a list of strings` }
  return { ok: true, value: [...new Set((raw as string[]).map((v) => v.trim()).filter(Boolean))] }
}

/** The binding a `$name…` reference names, and the rest of it — or null for a literal. */
export function bindingRef(entry: string): { slot: string; rest: string } | null {
  const match = REF_RE.exec(entry)
  return match ? { slot: match[1], rest: match[2] } : null
}

function checkRefs(entries: readonly string[], bindings: Record<string, BindingSlot>, kinds: BindingKind[], where: string): string | null {
  for (const entry of entries) {
    const ref = bindingRef(entry)
    if (!ref) continue
    const slot = bindings[ref.slot]
    if (!slot) return `${where} names $${ref.slot}, which is not a binding`
    if (!kinds.includes(slot.kind)) return `${where} names $${ref.slot}, a ${slot.kind} binding, where a ${kinds.join(' or ')} goes`
  }
  return null
}

function parseBindings(raw: unknown): ParseResult<Record<string, BindingSlot>> {
  if (raw === undefined || raw === null) return { ok: true, value: {} }
  if (!isRecord(raw)) return { ok: false, error: '`bindings` must be a map of slot → { kind, label }' }
  const out: Record<string, BindingSlot> = {}
  for (const [name, value] of Object.entries(raw)) {
    if (!SLOT_RE.test(name)) return { ok: false, error: `Binding "${name}": a slot name is lower-case letters, digits and underscores` }
    if (!isRecord(value)) return { ok: false, error: `Binding "${name}" must be { kind, label }` }
    const kind = value.kind
    if (typeof kind !== 'string' || !(BINDING_KINDS as readonly string[]).includes(kind)) {
      return { ok: false, error: `Binding "${name}": kind is one of ${BINDING_KINDS.join(', ')}` }
    }
    const label = typeof value.label === 'string' ? value.label.trim() : ''
    if (!label) return { ok: false, error: `Binding "${name}" needs a label` }
    const fields = strings(value.fields, `Binding "${name}" fields`)
    if (!fields.ok) return fields
    if (fields.value.length && kind !== 'type') return { ok: false, error: `Binding "${name}": only a type binding lists fields` }
    const slot: BindingSlot = { kind: kind as BindingKind, label }
    if (typeof value.suggest === 'string' && value.suggest.trim()) slot.suggest = value.suggest.trim()
    if (typeof value.within === 'string' && value.within.trim()) {
      if (kind !== 'folder') return { ok: false, error: `Binding "${name}": only a folder binding takes within` }
      slot.within = value.within.trim().replace(/\/?$/, '/')
    }
    if (fields.value.length) slot.fields = fields.value
    if (typeof value.recipe === 'string' && value.recipe.trim()) {
      if (kind !== 'connector') return { ok: false, error: `Binding "${name}": only a connector binding takes recipe` }
      slot.recipe = value.recipe.trim()
    }
    if (value.optional === true) slot.optional = true
    out[name] = slot
  }
  return { ok: true, value: out }
}

function parseSettings(raw: unknown): ParseResult<Record<string, SettingSpec>> {
  if (raw === undefined || raw === null) return { ok: true, value: {} }
  if (!isRecord(raw)) return { ok: false, error: '`settings` must be a map of key → { type, label }' }
  const out: Record<string, SettingSpec> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!SLOT_RE.test(key)) return { ok: false, error: `Setting "${key}": a key is lower-case letters, digits and underscores` }
    if (!isRecord(value)) return { ok: false, error: `Setting "${key}" must be { type, label }` }
    const type = value.type
    if (type !== 'string' && type !== 'number' && type !== 'boolean' && type !== 'string[]') {
      return { ok: false, error: `Setting "${key}": type is string, number, boolean or string[]` }
    }
    const label = typeof value.label === 'string' ? value.label.trim() : ''
    if (!label) return { ok: false, error: `Setting "${key}" needs a label` }
    const spec: SettingSpec = { type, label }
    if (value.enum !== undefined) {
      const choices = strings(value.enum, `Setting "${key}" enum`)
      if (!choices.ok) return choices
      if (type !== 'string') return { ok: false, error: `Setting "${key}": only a string setting takes enum` }
      spec.enum = choices.value
    }
    if (value.default !== undefined) {
      const check = settingValue(spec, value.default)
      if (!check.ok) return { ok: false, error: `Setting "${key}" default: ${check.error}` }
      spec.default = check.value
    }
    if (value.required === true) spec.required = true
    out[key] = spec
  }
  return { ok: true, value: out }
}

/** A value for one setting, checked against its spec. */
export function settingValue(spec: SettingSpec, raw: unknown): ParseResult<unknown> {
  switch (spec.type) {
    case 'string':
      if (typeof raw !== 'string') return { ok: false, error: 'must be text' }
      if (raw.length > 500) return { ok: false, error: 'is too long' }
      if (spec.enum && !spec.enum.includes(raw)) return { ok: false, error: `must be one of ${spec.enum.join(', ')}` }
      return { ok: true, value: raw }
    case 'number':
      return typeof raw === 'number' && Number.isFinite(raw) ? { ok: true, value: raw } : { ok: false, error: 'must be a number' }
    case 'boolean':
      return typeof raw === 'boolean' ? { ok: true, value: raw } : { ok: false, error: 'must be true or false' }
    case 'string[]':
      return Array.isArray(raw) && raw.every((v) => typeof v === 'string') && raw.length <= 100
        ? { ok: true, value: raw }
        : { ok: false, error: 'must be a list of text' }
  }
}

function parsePermissions(raw: unknown, bindings: Record<string, BindingSlot>): ParseResult<ToolPermissions> {
  if (raw === undefined || raw === null) return { ok: true, value: structuredClone(EMPTY_PERMISSIONS) }
  if (!isRecord(raw)) return { ok: false, error: '`permissions` must be a map of families' }
  const known = ['context', 'records', 'resources', 'connectors', 'agents', 'types', 'actions', 'ai', 'ui']
  const stray = Object.keys(raw).find((k) => !known.includes(k))
  if (stray) return { ok: false, error: `Unknown permission family "${stray}" — the families are ${known.join(', ')}` }
  const out = structuredClone(EMPTY_PERMISSIONS)

  const context = isRecord(raw.context) ? raw.context : raw.context === undefined ? {} : null
  if (!context) return { ok: false, error: '`permissions.context` must be { read, write }' }
  for (const side of ['read', 'write'] as const) {
    const list = strings(context[side], `permissions.context.${side}`)
    if (!list.ok) return list
    for (const glob of list.value) {
      const ref = bindingRef(glob)
      if (ref ? !isValidGlobEntry(`x${ref.rest}`) && ref.rest !== '' : !isValidGlobEntry(glob)) {
        return { ok: false, error: `permissions.context.${side}: "${glob}" is not a valid glob` }
      }
    }
    const refs = checkRefs(list.value, bindings, ['folder'], `permissions.context.${side}`)
    if (refs) return { ok: false, error: refs }
    out.context[side] = list.value
  }

  const records = isRecord(raw.records) ? raw.records : raw.records === undefined ? {} : null
  if (!records) return { ok: false, error: '`permissions.records` must be { read, write }' }
  const recordRead = strings(records.read, 'permissions.records.read')
  if (!recordRead.ok) return recordRead
  const readRefs = checkRefs(recordRead.value, bindings, ['type'], 'permissions.records.read')
  if (readRefs) return { ok: false, error: readRefs }
  out.records.read = recordRead.value
  if (records.write !== undefined) {
    if (!Array.isArray(records.write)) return { ok: false, error: 'permissions.records.write must be a list of { type, fields }' }
    for (const entry of records.write) {
      if (!isRecord(entry) || typeof entry.type !== 'string') return { ok: false, error: 'permissions.records.write entries are { type, fields }' }
      const fields = strings(entry.fields, 'permissions.records.write fields')
      if (!fields.ok) return fields
      if (fields.value.length === 0) return { ok: false, error: `permissions.records.write on ${entry.type} names no fields` }
      const refs = checkRefs([entry.type], bindings, ['type'], 'permissions.records.write')
      if (refs) return { ok: false, error: refs }
      out.records.write.push({ type: entry.type.trim(), fields: fields.value })
    }
  }

  const resources = isRecord(raw.resources) ? raw.resources : raw.resources === undefined ? {} : null
  if (!resources) return { ok: false, error: '`permissions.resources` must be { read }' }
  const resourceRead = strings(resources.read, 'permissions.resources.read')
  if (!resourceRead.ok) return resourceRead
  const resourceRefs = checkRefs(resourceRead.value, bindings, ['folder'], 'permissions.resources.read')
  if (resourceRefs) return { ok: false, error: resourceRefs }
  out.resources.read = resourceRead.value

  if (raw.connectors !== undefined) {
    if (!Array.isArray(raw.connectors)) return { ok: false, error: 'permissions.connectors must be a list' }
    for (const entry of raw.connectors) {
      if (typeof entry === 'string') {
        const refs = checkRefs([entry], bindings, ['connector'], 'permissions.connectors')
        if (refs) return { ok: false, error: refs }
        out.connectors.push({ use: entry.trim() })
        continue
      }
      if (!isRecord(entry) || typeof entry.use !== 'string') return { ok: false, error: 'permissions.connectors entries are a name or { use, actions }' }
      const actions = strings(entry.actions, 'permissions.connectors actions')
      if (!actions.ok) return actions
      const refs = checkRefs([entry.use], bindings, ['connector'], 'permissions.connectors')
      if (refs) return { ok: false, error: refs }
      out.connectors.push({ use: entry.use.trim(), ...(actions.value.length ? { actions: actions.value } : {}) })
    }
  }

  for (const family of ['agents', 'types', 'actions'] as const) {
    const list = strings(raw[family], `permissions.${family}`)
    if (!list.ok) return list
    if (family !== 'actions') {
      const refs = checkRefs(list.value, bindings, [family === 'agents' ? 'agent' : 'type'], `permissions.${family}`)
      if (refs) return { ok: false, error: refs }
    }
    out[family] = list.value
  }

  if (raw.ai !== undefined) {
    if (!isRecord(raw.ai)) return { ok: false, error: 'permissions.ai must be { complete, decide }' }
    out.ai = { complete: raw.ai.complete === true, decide: raw.ai.decide === true }
  }
  if (raw.ui !== undefined) {
    if (!isRecord(raw.ui)) return { ok: false, error: 'permissions.ui must be { download }' }
    out.ui = { download: raw.ui.download === true }
  }
  return { ok: true, value: out }
}

function parseCollections(raw: unknown): ParseResult<Record<string, CollectionSpec>> {
  if (raw === undefined || raw === null) return { ok: true, value: {} }
  if (!isRecord(raw)) return { ok: false, error: '`collections` must be a map of name → { schema, read, write }' }
  const out: Record<string, CollectionSpec> = {}
  const rules = ['all', 'own', 'admin']
  for (const [name, value] of Object.entries(raw)) {
    if (!SLOT_RE.test(name)) return { ok: false, error: `Collection "${name}": a name is lower-case letters, digits and underscores` }
    if (!isRecord(value) || !isRecord(value.schema)) return { ok: false, error: `Collection "${name}" needs a JSON Schema` }
    const read = typeof value.read === 'string' ? value.read : 'all'
    const write = typeof value.write === 'string' ? value.write : 'own'
    if (!rules.includes(read) || !rules.includes(write)) return { ok: false, error: `Collection "${name}": read and write are all, own or admin` }
    const maxRows = typeof value.maxRows === 'number' && value.maxRows > 0 ? Math.min(Math.floor(value.maxRows), 100_000) : 10_000
    out[name] = { schema: value.schema, read: read as CollectionSpec['read'], write: write as CollectionSpec['write'], maxRows }
  }
  return { ok: true, value: out }
}

/** The newest kit major a range admits — what a Tool was written against. */
export function sdkMajorOf(range: string): number {
  const majors = range
    .split('||')
    .map((part) => /(\d+)/.exec(part.trim())?.[1])
    .filter((m): m is string => !!m)
    .map(Number)
  return majors.length ? Math.max(...majors) : 1
}

/** Is this range one the server speaks? A caret, tilde or exact major 1 or 2. */
export function sdkSupported(range: string): boolean {
  const majors = range
    .split('||')
    .map((part) => /(\d+)/.exec(part.trim())?.[1])
    .filter((m): m is string => !!m)
    .map(Number)
  return majors.length > 0 && majors.every((m) => (SUPPORTED_SDK_MAJORS as readonly number[]).includes(m))
}

/**
 * The facts of a manifest — from a v2 index note's frontmatter, a `.vvtool`'s
 * manifest, or a `configure_tool` call — checked field by field. Missing
 * optional fields take their defaults; anything malformed is refused with a
 * sentence naming the field.
 */
export function parseManifestFacts(raw: Record<string, unknown>): ParseResult<ToolManifestFacts> {
  if (raw.publisher !== undefined) return { ok: false, error: '`publisher` is assigned by the registry, never declared' }
  if (raw.manifestVersion !== undefined && raw.manifestVersion !== 2) return { ok: false, error: 'manifestVersion is 2' }

  const release = raw.release === undefined || raw.release === null ? null : typeof raw.release === 'string' ? raw.release.trim() : ''
  if (release !== null && !SEMVER_RE.test(release)) return { ok: false, error: '`release` is semver, e.g. 1.3.0' }
  const license = raw.license === undefined || raw.license === null ? null : typeof raw.license === 'string' ? raw.license.trim() : ''
  if (license !== null && !SPDX_RE.test(license)) return { ok: false, error: '`license` is an SPDX id or proprietary' }
  const sdk = raw.sdk === undefined ? '^2.0.0' : typeof raw.sdk === 'string' || typeof raw.sdk === 'number' ? String(raw.sdk).trim() : ''
  if (!sdkSupported(sdk)) return { ok: false, error: `\`sdk\` ${JSON.stringify(raw.sdk)} is not a kit version this server speaks (${SUPPORTED_SDK_MAJORS.map((m) => `^${m}`).join(', ')})` }

  const platforms = raw.platforms === undefined ? { ok: true as const, value: [...TOOL_PLATFORMS] as string[] } : strings(raw.platforms, '`platforms`')
  if (!platforms.ok) return platforms
  if (platforms.value.length === 0) return { ok: false, error: '`platforms` names at least one of web, desktop' }
  const stray = platforms.value.find((p) => !(TOOL_PLATFORMS as readonly string[]).includes(p))
  if (stray) return { ok: false, error: `\`platforms\`: ${stray} is not a platform Tools run on — web and desktop only` }

  let dependencies: Record<string, string> = {}
  if (raw.dependencies !== undefined && raw.dependencies !== null) {
    if (!isRecord(raw.dependencies)) return { ok: false, error: '`dependencies` must be a map of package → version range' }
    const declared: Record<string, string> = {}
    for (const [name, raw_version] of Object.entries(raw.dependencies)) {
      if (!DEP_NAME_RE.test(name)) return { ok: false, error: `Dependency "${name}" is not a package name` }
      const version = typeof raw_version === 'number' ? String(raw_version) : raw_version
      if (typeof version !== 'string' || !DEP_RANGE_RE.test(version.trim())) {
        return { ok: false, error: `Dependency "${name}" needs a version or range, e.g. ^4 or 4.1.0` }
      }
      declared[name] = version.trim()
    }
    dependencies = declared
  }

  const bindings = parseBindings(raw.bindings)
  if (!bindings.ok) return bindings
  const settings = parseSettings(raw.settings)
  if (!settings.ok) return settings
  const permissions = parsePermissions(raw.permissions, bindings.value)
  if (!permissions.ok) return permissions
  const collections = parseCollections(raw.collections)
  if (!collections.ok) return collections

  return {
    ok: true,
    value: {
      manifestVersion: 2,
      release,
      license,
      sdk,
      platforms: platforms.value as ToolPlatform[],
      dependencies,
      settings: settings.value,
      bindings: bindings.value,
      permissions: permissions.value,
      collections: collections.value,
    },
  }
}

/** A v1 Tool's `perimeter:`, read as v2 facts with no bindings. */
export function factsFromV1(rawPerimeter: unknown): ParseResult<ToolManifestFacts> {
  const perimeter = parseToolPerimeter(rawPerimeter)
  if (!perimeter.ok) return { ok: false, error: perimeter.error }
  return { ok: true, value: factsFromPerimeter(perimeter.perimeter) }
}

export function factsFromPerimeter(perimeter: ToolPerimeter): ToolManifestFacts {
  return {
    manifestVersion: 2,
    release: null,
    license: null,
    sdk: '^1.0.0',
    platforms: [...TOOL_PLATFORMS],
    dependencies: {},
    settings: {},
    bindings: {},
    permissions: {
      ...structuredClone(EMPTY_PERMISSIONS),
      context: { read: [...perimeter.read], write: [...perimeter.write] },
      connectors: perimeter.connectors.map((use) => ({ use })),
      agents: [...perimeter.agents],
      types: [...perimeter.types],
    },
    collections: {},
  }
}

/**
 * The v1 perimeter a manifest's permissions amount to — the five lists every
 * existing gate reads (context globs, types, connector names, agents). With
 * `$bindings` still in it for the abstract form; `bindings.ts` resolves them.
 */
export function perimeterOfFacts(facts: ToolManifestFacts): ToolPerimeter {
  return {
    read: [...facts.permissions.context.read],
    write: [...facts.permissions.context.write],
    types: [...facts.permissions.types],
    connectors: facts.permissions.connectors.map((c) => c.use),
    agents: [...facts.permissions.agents],
  }
}
