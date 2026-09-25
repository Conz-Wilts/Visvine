/**
 * Bindings: a Tool declares the KIND of thing it needs — a folder, a type, a
 * connector, an agent — and each installing space answers with its own. Pure.
 *
 * Review reads a manifest's permissions in the abstract (`$notes/**`); the
 * bridge enforces them bound (`sales/pipeline/**`). `resolveReach` is the one
 * substitution, used by the bridge's target resolution and by the install
 * sheet's plain-words preview, so the reach a person consents to is the reach
 * that is enforced.
 */
import { bindingRef, settingValue, type BindingSlot, type ToolManifestFacts } from './manifest'
import type { ToolPerimeter } from './perimeter'

/** What an install bound each slot to: a folder path, a type, connector or agent name. */
export type BindingValues = Record<string, string>

/** Every family of reach, concrete: the v1 perimeter plus v2's new families. */
export interface ToolReach extends ToolPerimeter {
  records: { read: string[]; write: Array<{ type: string; fields: string[] }> }
  resources: { read: string[] }
  /** Per connector name, the actions a global Tool may call on it (null = any). */
  connectorActions: Record<string, string[] | null>
  actions: string[]
  ai: { complete: boolean; decide: boolean }
  ui: { download: boolean }
}

export interface ResolvedReach {
  reach: ToolReach
  /** Slots with no value: their permissions are dropped, and the Tool runs degraded. */
  unbound: string[]
}

/** A folder path as a binding value: no leading or trailing slash. */
export function normalizeFolder(value: string): string {
  return value.trim().replace(/^\/+/, '').replace(/\/+$/, '')
}

/**
 * One entry with its `$slot` replaced by the bound value — or null when the
 * slot is unbound. A folder binding carries its rest (`$notes/**` →
 * `sales/pipeline/**`; `$notes` alone → `sales/pipeline/`).
 */
function substitute(entry: string, slots: Record<string, BindingSlot>, values: BindingValues, unbound: Set<string>): string | null {
  const ref = bindingRef(entry)
  if (!ref) return entry
  const slot = slots[ref.slot]
  const value = values[ref.slot]?.trim()
  if (!slot || !value) {
    unbound.add(ref.slot)
    return null
  }
  if (slot.kind === 'folder') {
    const folder = normalizeFolder(value)
    return ref.rest ? `${folder}${ref.rest}` : `${folder}/`
  }
  return value
}

export function resolveReach(facts: ToolManifestFacts, values: BindingValues): ResolvedReach {
  const unbound = new Set<string>()
  const sub = (list: readonly string[]) =>
    list.map((entry) => substitute(entry, facts.bindings, values, unbound)).filter((e): e is string => e !== null)
  const p = facts.permissions
  const connectorActions: Record<string, string[] | null> = {}
  const connectors: string[] = []
  for (const use of p.connectors) {
    const name = substitute(use.use, facts.bindings, values, unbound)
    if (!name) continue
    connectors.push(name)
    connectorActions[name.toLowerCase()] = use.actions ?? null
  }
  const recordWrites: ToolReach['records']['write'] = []
  for (const write of p.records.write) {
    const type = substitute(write.type, facts.bindings, values, unbound)
    if (type) recordWrites.push({ type, fields: [...write.fields] })
  }
  // A slot nothing references is still unbound when it has no value: a Tool
  // may read `install.bindings` itself. Optional or not, an empty slot is a
  // part of the Tool that does not work here, and the Tool is told so.
  for (const name of Object.keys(facts.bindings)) {
    if (!values[name]?.trim()) unbound.add(name)
  }
  return {
    reach: {
      read: sub(p.context.read),
      write: sub(p.context.write),
      types: sub(p.types),
      connectors,
      agents: sub(p.agents),
      records: { read: sub(p.records.read), write: recordWrites },
      resources: { read: sub(p.resources.read) },
      connectorActions,
      actions: [...p.actions],
      ai: { ...p.ai },
      ui: { ...p.ui },
    },
    unbound: [...unbound].sort(),
  }
}

/** In the space that wrote a Tool, every slot is bound to its own suggestion. */
export function sourceBindings(facts: ToolManifestFacts): BindingValues {
  const out: BindingValues = {}
  for (const [name, slot] of Object.entries(facts.bindings)) if (slot.suggest) out[name] = slot.suggest
  return out
}

/** What a space has, for checking a binding value against. */
export interface BindableSpace {
  folders: readonly string[]
  /** Type name → the field keys it has (tracked and type fields). */
  types: Readonly<Record<string, readonly string[]>>
  connectors: ReadonlyArray<{ name: string; recipe: string | null }>
  agents: readonly string[]
}

/** Folders a binding may never point into: configuration that runs, and addresses that are not the space's own. */
const SEALED_ROOTS = ['tools', 'agents', 'connectors', 'models', 'settings', 'subspaces', 'parent']

/**
 * Why this value cannot fill this slot here, or null when it can. A folder
 * need not exist yet — a Tool's first write may be what makes it — but it
 * must be the space's own; a type, connector or agent must be one the space has.
 */
export function bindingDenial(slot: BindingSlot, value: string | undefined, space: BindableSpace): string | null {
  const v = value?.trim() ?? ''
  if (!v) return slot.optional ? null : `${slot.label} cannot be left unbound`
  switch (slot.kind) {
    case 'folder': {
      const folder = normalizeFolder(v)
      if (!folder || folder.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith(':'))) {
        return `${slot.label}: not a folder path`
      }
      if (SEALED_ROOTS.includes(folder.split('/')[0].toLowerCase())) return `${slot.label} cannot be ${folder}/ — that folder holds what runs`
      if (slot.within && !`${folder}/`.startsWith(normalizeFolder(slot.within) + '/')) return `${slot.label} must be inside ${slot.within}`
      return null
    }
    case 'type': {
      const type = Object.keys(space.types).find((t) => t.toLowerCase() === v.toLowerCase())
      if (!type) return `${slot.label}: this space has no type ${v}`
      const missing = (slot.fields ?? []).filter((f) => !space.types[type].includes(f))
      return missing.length ? `${slot.label}: ${type} has no ${missing.join(', ')} field${missing.length === 1 ? '' : 's'}` : null
    }
    case 'connector': {
      const found = space.connectors.find((c) => c.name.toLowerCase() === v.toLowerCase())
      if (!found) return `${slot.label}: this space has no connector ${v}`
      if (slot.recipe && found.recipe !== slot.recipe) return `${slot.label} must be a ${slot.recipe} connector`
      return null
    }
    case 'agent':
      return space.agents.some((a) => a.toLowerCase() === v.toLowerCase()) ? null : `${slot.label}: this space has no agent ${v}`
  }
}

/** What this space could bind a slot to: the install sheet's picker, and bind_tool's answer. */
export function bindingChoices(slot: BindingSlot, space: BindableSpace): string[] {
  const fits = (value: string) => bindingDenial(slot, value, space) === null
  switch (slot.kind) {
    case 'folder':
      return [...new Set(space.folders.map(normalizeFolder))].filter((f) => f && fits(f)).sort()
    case 'type':
      return Object.keys(space.types).filter(fits).sort((a, b) => a.localeCompare(b))
    case 'connector':
      return space.connectors.map((c) => c.name).filter(fits).sort()
    case 'agent':
      return [...space.agents].sort()
  }
}

export type Plan<T> = { ok: true; value: T } | { ok: false; error: string }

/** A value this slot accepts, as stored: a folder normalised, a name spelled as the space spells it. */
function canonicalValue(slot: BindingSlot, value: string, space: BindableSpace): string {
  const v = value.trim()
  const same = (name: string) => name.toLowerCase() === v.toLowerCase()
  switch (slot.kind) {
    case 'folder':
      return normalizeFolder(v)
    case 'type':
      return Object.keys(space.types).find(same) ?? v
    case 'connector':
      return space.connectors.find((c) => same(c.name))?.name ?? v
    case 'agent':
      return space.agents.find(same) ?? v
  }
}

/**
 * The binding values an install stores. Each value asked for is checked
 * against what the space has and refused when it does not fit; each slot not
 * asked about keeps its current value, or takes its suggestion when the space
 * has that thing (`defaultBindings`). A slot still empty runs degraded — an
 * install never waits on one — and an empty value clears an optional slot.
 */
export function planBindings(
  facts: ToolManifestFacts,
  requested: BindingValues,
  space: BindableSpace,
  current: BindingValues = {},
): Plan<BindingValues> {
  const stray = Object.keys(requested).find((name) => !(name in facts.bindings))
  if (stray) return { ok: false, error: `"${stray}" is not one of this tool's bindings` }
  const out = defaultBindings(facts, space, current)
  for (const [name, raw] of Object.entries(requested)) {
    const slot = facts.bindings[name]
    const value = typeof raw === 'string' ? raw.trim() : ''
    const denial = bindingDenial(slot, value, space)
    if (denial) return { ok: false, error: denial }
    if (value) out[name] = canonicalValue(slot, value, space)
    else delete out[name]
  }
  return { ok: true, value: out }
}

/**
 * The values a space takes with nobody choosing: what it already has bound,
 * else the slot's suggestion — each only when this space has that thing. The
 * rest stay unbound, and the Tool runs degraded until an admin binds them.
 * A shared-down install and an upgrade that adds a slot both land here.
 */
export function defaultBindings(facts: ToolManifestFacts, space: BindableSpace, current: BindingValues = {}): BindingValues {
  const out: BindingValues = {}
  for (const [name, slot] of Object.entries(facts.bindings)) {
    const value = [current[name], slot.suggest].find((v) => v?.trim() && bindingDenial(slot, v, space) === null)
    if (value) out[name] = canonicalValue(slot, value, space)
  }
  return out
}

/** The settings an install stores: each declared one checked, defaults left to runtime, a required one without a value refused. */
export function planSettings(facts: ToolManifestFacts, requested: Record<string, unknown>): Plan<Record<string, unknown>> {
  const stray = Object.keys(requested).find((key) => !(key in facts.settings))
  if (stray) return { ok: false, error: `"${stray}" is not one of this tool's settings` }
  const out: Record<string, unknown> = {}
  for (const [key, spec] of Object.entries(facts.settings)) {
    const raw = requested[key]
    if (raw === undefined || raw === null || raw === '') {
      if (spec.required && spec.default === undefined) return { ok: false, error: `${spec.label} needs a value` }
      continue
    }
    const checked = settingValue(spec, raw)
    if (!checked.ok) return { ok: false, error: `${spec.label} ${checked.error}` }
    out[key] = checked.value
  }
  return { ok: true, value: out }
}

/** A type claim's `$slot` bound to the type this install chose; a claim on an unbound slot is dropped. */
export function boundTypeClaims<T extends { type: string }>(claims: readonly T[], facts: ToolManifestFacts, values: BindingValues): T[] {
  return claims.flatMap((claim) => {
    const ref = bindingRef(claim.type)
    if (!ref) return [claim]
    const value = values[ref.slot]?.trim()
    return facts.bindings[ref.slot]?.kind === 'type' && value ? [{ ...claim, type: value }] : []
  })
}
