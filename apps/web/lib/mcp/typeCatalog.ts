// The node-type catalog list_context exposes so an agent picks the right
// EXISTING type before creating anything. The vocabulary is closed
// (DEFAULT_NODE_TYPES) — spaces toggle types on and off in blocks via
// their owning feature (lib/featureAccess.ts), and neither users nor agents
// create new types; when nothing fits, the agent's move is to use the closest
// type and suggest a new one in prose.
//
// Pure — no Prisma/DOM imports. CREATABLE_TYPES is passed in by the caller
// because its home module (lib/directory/createEntity.ts) imports Prisma.
import type { SpaceFeatureConfig } from '@/lib/types'
import {
  DEFAULT_NODE_TYPES,
  aliasesForType,
  canonicalNodeType,
  personAliases,
  type SpaceAlias,
} from '@/lib/types/context'
import { isNodeTypeEnabled, nodeTypeFeatureKey } from '@/lib/featureAccess'
import { fieldsForType } from '@/lib/create/typeFields'
import { entityDirOf } from '@/lib/notes/entities'

export interface TypeCatalogEntry {
  /** Canonical lowercase type: 'person', 'connector', … */
  type: string
  enabled: boolean
  /** Why a disabled type is off — names the feature toggle. */
  disabled_reason: string | null
  /** The feature slug that owns this type; null = always on. */
  feature: string | null
  creatable_via_add_context: boolean
  fields: Array<{ key: string; label: string; kind: string }>
  /** The folder its entity notes live in ('people'), or null. */
  note_dir: string | null
  /** Live count of directory nodes of this type. */
  usage_count: number
  /**
   * The alias vocabulary of this type — the only values `add_context`'s
   * `alias` accepts. Managed with `manage_alias`, which also assigns one to an
   * entity that already exists (action 'assign').
   */
  aliases: Array<{ name: string; color: string; admin?: boolean }>
  /** How this type is meant to be used and created. */
  guidance: string
}

// How each type is created and what it's for — the load-bearing knowledge an
// agent needs to avoid the wrong door (connector/event/space are not creatable
// via add_context).
const GUIDANCE: Record<string, string> = {
  person: 'A human in the directory. Create with add_context; fill email/companyName/linkedinUrl when known — they match the person to their identity across spaces.',
  space: 'A group, organisation or space recorded in the directory — a card in the space you are working in, never a new workspace. Create with add_context; fill url (website) when known — it drives identity matching.',
  event: 'Created through the events surface, not add_context. Reference one by mentioning its note.',
  resource: 'A link or document worth keeping. Create with add_context with url set.',
  section: 'Structural container grouping channels — created from the space\'s admin surfaces, never via add_context.',
  channel: 'A conversation channel — created from the space\'s admin surfaces, never via add_context.',
  connector: 'A gateway to an external API or database, note-first and admin-only: an admin authors connectors/<name>.md (frontmatter declares alias/hosts/limits). Never creatable via add_context; execute one with run_connector. A `kind: model` connector is the LLM provider agents run on (its key is the space\'s) — listed, never runnable.',
  agent: 'A scheduled agent, note-first: a brief at agents/<name>.md (frontmatter: model, connectors, tools; body = the instructions) plus an admin activation at agents/live/<name>.md. Not creatable via add_context — use create_agent, then activate_agent to turn it on (admins only; creating one does not start it). List with list_agents, trigger with run_agent.',
  tool: 'A Tool — an app a member builds, note-first and folder-only: the member authors tools/<name>/index.md (frontmatter declares its surfaces and the perimeter of context it may touch; body = docs) beside tools/<name>/ui.tsx and tools/<name>/data.js, which hold its source. Never creatable via add_context (tools/ is frozen for AI — a human authors tools); admins install and publish one from the Tools marketplace.',
}

export function buildTypeCatalog(opts: {
  featureConfig: SpaceFeatureConfig | null | undefined
  isAdmin: boolean
  /** canonical type → live node count, computed by the caller from rows it already fetched. */
  usageByType: Record<string, number>
  /** CREATABLE_TYPES from lib/directory/createEntity.ts. */
  creatableTypes: readonly string[]
  /** The space's whole alias list (`Space.aliases`), scoped per type here. */
  aliases?: SpaceAlias[]
}): TypeCatalogEntry[] {
  return DEFAULT_NODE_TYPES.map((config) => {
    const type = canonicalNodeType(config.name)
    // Person's list is grafted with the built-in Admin alias, which is stored
    // implicitly — omitting it would tell an agent it can create one.
    const aliases = (
      type === 'person' ? personAliases(opts.aliases) : aliasesForType(opts.aliases, config.name)
    ).map((a) => ({
      name: a.name,
      color: a.color,
      ...(type === 'person' ? { admin: a.admin === true || a.system === true } : {}),
    }))
    const feature = nodeTypeFeatureKey(config.name)
    const enabled = isNodeTypeEnabled(opts.featureConfig, config.name)
    let guidance = GUIDANCE[type] ?? ''
    if (type === 'connector' && !opts.isAdmin) guidance += ' (You are not an admin here.)'
    return {
      type,
      enabled,
      disabled_reason: enabled ? null : `the '${feature}' feature is switched off in this space`,
      feature,
      creatable_via_add_context: enabled && opts.creatableTypes.includes(type),
      fields: fieldsForType(type).map((f) => ({ key: f.key, label: f.label, kind: f.kind })),
      note_dir: entityDirOf(type),
      usage_count: opts.usageByType[type] ?? 0,
      aliases,
      guidance,
    }
  })
}
