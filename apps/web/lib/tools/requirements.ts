/**
 * What an installed Tool declared that its space hasn't got — pure, no I/O.
 *
 * A Tool's perimeter names connectors, node types and agents by name. Those
 * names travel with the Tool through the marketplace, so a Tool written over a
 * `hubspot` connector lands in a space that may have no such thing. The brief's
 * rule is that this never blocks an install: the Tool installs, runs DEGRADED
 * behind a banner, and unsatisfied reads come back empty. This module is the
 * decision behind that banner and behind the install checklist an admin reads
 * before pressing the button.
 *
 * A requirement is a declared entry with NO match in the space. Three
 * consequences worth stating, because each one is a decision:
 *
 *   • `*` alone is never a requirement. "Every connector you have" is satisfied
 *     by a space with none — the Tool asked for a capability, not for a thing.
 *   • `deal-*` is satisfied by ONE match. A prefix is a family, and a Tool that
 *     works over whichever members of it exist has what it asked for.
 *   • Matching goes through the perimeter's own gates (refuseConnector and
 *     friends), never a second copy of the rule. A checklist that said
 *     "satisfied" while the bridge refused at run time would be worse than no
 *     checklist, and the only way to be sure is to ask the gate.
 *
 * Requirements are a snapshot: `AppToolInstall.requirements` records what was
 * missing at the last check, so the banner is readable without re-walking the
 * space on every render. Adding the connector doesn't clear it — a re-check does
 * (lib/tools/installs.ts#refreshRequirements).
 */
import { resolveReach, sourceBindings, type BindingValues } from '@visvine/tool-protocol/bindings'
import type { ToolManifestFacts } from '@visvine/tool-protocol/manifest'
import {
  EMPTY_PERIMETER,
  refuseAgent,
  refuseConnector,
  refuseType,
  type ToolPerimeter,
} from './perimeter'

/** Declared names with nothing in the space to match them. Empty = satisfied. */
export interface ToolRequirements {
  connectors: string[]
  types: string[]
  agents: string[]
  /** Binding slots with nothing bound here, by label. */
  bindings?: string[]
}

/** What the space actually has, in the three dimensions a Tool can miss. */
export interface SpaceAvailability {
  /** Connector note names. */
  connectors: string[]
  /** Node type names, lower-cased so they line up with a declared `types:` list. */
  types: string[]
  /** Agent brief names. */
  agents: string[]
}

/** The wildcard that stands for "whatever this space has" — never a requirement. */
const ANY = '*'

/**
 * Which declared entries nothing available matches.
 *
 * `allows` is the perimeter gate for this dimension, asked one declared entry at
 * a time: a single-entry perimeter that permits a name the space really has is
 * exactly what "the space satisfies this declaration" means.
 */
function unmet(
  declared: readonly string[],
  available: readonly string[],
  allows: (entry: string, name: string) => boolean,
): string[] {
  return declared.filter(
    (entry) => entry !== ANY && !available.some((name) => allows(entry, name)),
  )
}

const allowsConnector = (entry: string, name: string): boolean =>
  refuseConnector({ ...EMPTY_PERIMETER, connectors: [entry] }, name) === null

const allowsType = (entry: string, name: string): boolean =>
  refuseType({ ...EMPTY_PERIMETER, types: [entry] }, name) === null

const allowsAgent = (entry: string, name: string): boolean =>
  refuseAgent({ ...EMPTY_PERIMETER, agents: [entry] }, name) === null

/**
 * The Tool's declared reach minus what this space can satisfy. Note globs are
 * deliberately not checked: a read glob is a shape rather than a dependency, and
 * `deals/**` matching nothing today is an empty folder, not a missing feature.
 */
export function computeRequirements(
  perimeter: ToolPerimeter,
  available: SpaceAvailability,
): ToolRequirements {
  return {
    connectors: unmet(perimeter.connectors, available.connectors, allowsConnector),
    types: unmet(perimeter.types, available.types, allowsType),
    agents: unmet(perimeter.agents, available.agents, allowsAgent),
  }
}

/** Unbound slots by label, as the banner and the checklist name them. */
export function unboundLabels(facts: ToolManifestFacts, unbound: readonly string[]): string[] {
  return unbound.map((slot) => facts.bindings[slot]?.label ?? slot)
}

/**
 * A manifest's requirements as one install runs it: its reach BOUND to the
 * install's values and checked against the space, plus each slot left
 * unbound. A `$slot` is never itself a requirement — what it names is.
 */
export function boundRequirements(
  facts: ToolManifestFacts,
  values: BindingValues,
  available: SpaceAvailability,
): ToolRequirements {
  const { reach, unbound } = resolveReach(facts, values)
  const out = computeRequirements(
    { read: reach.read, write: reach.write, types: reach.types, connectors: reach.connectors, agents: reach.agents },
    available,
  )
  const labels = unboundLabels(facts, unbound)
  return labels.length ? { ...out, bindings: labels } : out
}

/**
 * A working copy's requirements in the space that wrote it, where every slot
 * is bound to its own suggestion — the author's checklist and check_tool's.
 */
export function sourceRequirements(config: { perimeter: ToolPerimeter; manifest?: ToolManifestFacts }, available: SpaceAvailability): ToolRequirements {
  const facts = config.manifest
  if (!facts) return computeRequirements(config.perimeter, available)
  return boundRequirements(facts, sourceBindings(facts), available)
}

/** True when something the Tool declared is missing — the banner's condition. */
export function isDegraded(requirements: ToolRequirements): boolean {
  return (
    requirements.connectors.length > 0 ||
    requirements.types.length > 0 ||
    requirements.agents.length > 0 ||
    (requirements.bindings?.length ?? 0) > 0
  )
}

/**
 * One checklist line per missing thing, in the order an admin can act on them.
 *
 * Per item rather than per dimension: the install surface is a checklist, and
 * "No connector here matches hubspot" is a sentence somebody can go and fix.
 * Empty when nothing is missing, so a caller can render the list unconditionally.
 */
export function describeRequirements(requirements: ToolRequirements): string[] {
  return [
    ...requirements.connectors.map((name) => `No connector in this space matches ${name}`),
    ...requirements.types.map((name) => `No node type in this space matches ${name}`),
    ...requirements.agents.map((name) => `No agent in this space matches ${name}`),
    ...(requirements.bindings ?? []).map((label) => `${label} is not bound`),
  ]
}

/** Same set, whichever order the two snapshots happen to list them in. */
function sameNames(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const seen = new Set(a)
  return b.every((name) => seen.has(name))
}

/** Whether a fresh check found anything new — lets a re-check skip the write. */
export function requirementsEqual(a: ToolRequirements, b: ToolRequirements): boolean {
  return (
    sameNames(a.connectors, b.connectors) &&
    sameNames(a.types, b.types) &&
    sameNames(a.agents, b.agents) &&
    sameNames(a.bindings ?? [], b.bindings ?? [])
  )
}

/** A string list out of a JSON column, dropping anything that isn't a name. */
function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
}

/**
 * Decode the stored `requirements` JSON. Defensive rather than trusting: the
 * column is written by this app but read by the degraded banner, and a row
 * written before a dimension existed must read as "nothing missing there"
 * instead of throwing inside a page render.
 */
export function parseRequirements(raw: unknown): ToolRequirements {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const bindings = stringList(value.bindings)
  return {
    connectors: stringList(value.connectors),
    types: stringList(value.types),
    agents: stringList(value.agents),
    ...(bindings.length ? { bindings } : {}),
  }
}
