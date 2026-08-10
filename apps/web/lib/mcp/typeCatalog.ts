// The node-type catalog list_context exposes so an agent picks the right
// EXISTING type before creating anything. The vocabulary is closed
// (DEFAULT_NODE_TYPES) — spaces toggle types on and off in blocks via
// their owning feature (lib/featureAccess.ts), and neither users nor agents
// create new types; when nothing fits, the agent's move is to use the closest
// type and suggest a new one in prose.
//
// Pure — no Prisma/DOM imports. CREATABLE_TYPES is passed in by the caller
// because its home module (lib/directory/createEntity.ts) imports Prisma.
import type { CommunityFeatureConfig } from '@/lib/types'
import { DEFAULT_NODE_TYPES, canonicalNodeType } from '@/lib/types/context'
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
  /** How this type is meant to be used and created. */
  guidance: string
}

// How each type is created and what it's for — the load-bearing knowledge an
// agent needs to avoid the wrong door (connector/event/space are not creatable
// via add_context, an index note is not a node at all).
const GUIDANCE: Record<string, string> = {
  person: 'A human in the directory. Create with add_context; fill email/companyName/linkedinUrl when known — they match the person to their identity across spaces.',
  space: 'A group, organisation or community recorded in the directory — a card in the space you are working in, never a new workspace. Create with add_context; fill url (website) when known — it drives identity matching.',
  event: 'Created through the events surface, not add_context. Reference one by mentioning its note.',
  resource: 'A link or document worth keeping. Create with add_context with url set.',
  section: 'Structural container grouping channels — created from the space\'s admin surfaces, never via add_context.',
  channel: 'A conversation channel — created from the space\'s admin surfaces, never via add_context.',
  connector: 'A gateway to an external API or database, note-first and admin-only: an admin authors connectors/<name>.md (frontmatter declares alias/hosts/limits). Never creatable via add_context; execute one with run_connector.',
  index: 'An index note IS a folder. Write <folder>/index.md with edit_context rather than creating a node.',
}

export function buildTypeCatalog(opts: {
  featureConfig: CommunityFeatureConfig | null | undefined
  isAdmin: boolean
  /** canonical type → live node count, computed by the caller from rows it already fetched. */
  usageByType: Record<string, number>
  /** CREATABLE_TYPES from lib/directory/createEntity.ts. */
  creatableTypes: readonly string[]
}): TypeCatalogEntry[] {
  return DEFAULT_NODE_TYPES.map((config) => {
    const type = canonicalNodeType(config.name)
    const feature = nodeTypeFeatureKey(config.name)
    const enabled = isNodeTypeEnabled(opts.featureConfig, config.name)
    let guidance = GUIDANCE[type] ?? ''
    if (type === 'connector' && !opts.isAdmin) guidance += ' (You are not an admin here.)'
    return {
      type,
      enabled,
      disabled_reason: enabled ? null : `the '${feature}' feature is switched off in this community`,
      feature,
      creatable_via_add_context: enabled && opts.creatableTypes.includes(type),
      fields: fieldsForType(type).map((f) => ({ key: f.key, label: f.label, kind: f.kind })),
      note_dir: entityDirOf(type),
      usage_count: opts.usageByType[type] ?? 0,
      guidance,
    }
  })
}
