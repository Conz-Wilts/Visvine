/**
 * A bound reach as the rows an admin reads before pressing Install: the five
 * v1 families for PerimeterSummary, and manifest 2's others beside them. Pure.
 */
import type { ToolReach } from '@visvine/tool-protocol/bindings'
import type { ToolPerimeter } from '@/lib/tools/perimeter'

export function reachRows(reach: ToolReach): {
  perimeter: ToolPerimeter
  extra: Array<{ key: string; label: string; entries: string[] }>
} {
  const connectorLine = (name: string) => {
    const actions = reach.connectorActions[name.toLowerCase()]
    return actions && actions.length ? `${name} (${actions.join(', ')})` : name
  }
  return {
    perimeter: {
      read: reach.read,
      write: reach.write,
      types: reach.types,
      connectors: reach.connectors.map(connectorLine),
      agents: reach.agents,
    },
    extra: [
      { key: 'records-read', label: 'Records', entries: reach.records.read },
      {
        key: 'records-write',
        label: 'Edits',
        entries: reach.records.write.map((w) => (w.fields.length ? `${w.type}: ${w.fields.join(', ')}` : w.type)),
      },
      { key: 'resources', label: 'Files', entries: reach.resources.read },
      { key: 'actions', label: 'Actions', entries: reach.actions },
      {
        key: 'ai',
        label: 'AI',
        entries: [...(reach.ai.complete ? ['complete'] : []), ...(reach.ai.decide ? ['decide'] : [])],
      },
      { key: 'ui', label: 'Browser', entries: reach.ui.download ? ['download'] : [] },
    ],
  }
}
