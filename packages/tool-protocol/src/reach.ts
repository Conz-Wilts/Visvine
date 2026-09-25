/**
 * The gates of manifest 2's families of reach — records, resources, actions,
 * AI, the host's downloads — over a BOUND reach (./bindings.ts#resolveReach).
 * Pure. Each answers null when the Tool declared the reach, else the sentence
 * saying it did not; the bridge asks them BEFORE any grant of the viewer's,
 * so a refusal says whether the Tool or the viewer lacks the reach.
 */
import type { ToolReach } from './bindings'
import { globMatch, nameMatch } from './perimeter'

const denied = (what: string) => `tool perimeter denied: ${what}`

/** May the Tool read records of this type? */
export function refuseRecordRead(reach: ToolReach, type: string): string | null {
  if (reach.records.read.some((entry) => nameMatch(entry, type))) return null
  // A type the Tool may write is one it may read back.
  if (reach.records.write.some((entry) => nameMatch(entry.type, type))) return null
  return denied(
    reach.records.read.length || reach.records.write.length
      ? `records of ${type} are not in permissions.records`
      : 'this tool declares no records — add the type to permissions.records.read',
  )
}

/** May the Tool write these fields of a record of this type? */
export function refuseRecordWrite(reach: ToolReach, type: string, fields: readonly string[]): string | null {
  const grants = reach.records.write.filter((entry) => nameMatch(entry.type, type))
  if (grants.length === 0) return denied(`this tool may not edit records of ${type} — permissions.records.write names no such type`)
  const allowed = new Set(grants.flatMap((entry) => entry.fields.map((f) => f.toLowerCase())))
  const outside = fields.filter((field) => !allowed.has(field.toLowerCase()))
  return outside.length ? denied(`this tool may not edit ${outside.join(', ')} on ${type}`) : null
}

/** May the Tool read the resource whose note is at this path? A resource with no note is never in reach. */
export function refuseResourceRead(reach: ToolReach, notePath: string | null): string | null {
  if (reach.resources.read.length === 0) return denied('this tool declares no files — add a folder to permissions.resources.read')
  if (!notePath) return denied('that file has no place under resources/ a permission could name')
  return reach.resources.read.some((glob) => globMatch(glob, notePath)) ? null : denied(`${notePath} is outside permissions.resources.read`)
}

/** May the Tool list resources at all? */
export function refuseResourceList(reach: ToolReach): string | null {
  return reach.resources.read.length ? null : denied('this tool declares no files — add a folder to permissions.resources.read')
}

/**
 * How a Tool may call a connector it declared: `code` (JavaScript in the
 * connector's isolate) or `action` (one of the connector's named actions).
 * A Tool that names actions for a connector calls those and nothing else; a
 * Tool from outside the space — a listed one another space wrote — calls named
 * actions only, because code a reviewer read in the abstract could do anything
 * with this space's credentials.
 */
export function refuseConnectorCall(
  reach: ToolReach,
  name: string,
  call: { code?: string; action?: string },
  opts: { foreign?: boolean } = {},
): string | null {
  const key = Object.keys(reach.connectorActions).find((entry) => nameMatch(entry, name))
  const actions = key === undefined ? null : reach.connectorActions[key]
  if (call.code !== undefined) {
    if (opts.foreign) return denied(`a tool from outside this space calls ${name}'s named actions, never code`)
    return actions ? denied(`this tool calls ${name}'s actions ${actions.join(', ')}, not code`) : null
  }
  if (actions && call.action !== undefined && !actions.includes(call.action)) {
    return denied(`this tool does not declare the action ${call.action} on ${name}`)
  }
  if (opts.foreign && !actions) return denied(`a tool from outside this space must name the actions it calls on ${name}`)
  return null
}

/** May the Tool run this action? (The allowlist is the server's; this is the declaration.) */
export function refuseAction(reach: ToolReach, name: string): string | null {
  return reach.actions.some((entry) => entry.trim().toLowerCase() === name.trim().toLowerCase())
    ? null
    : denied(`this tool does not declare the action ${name} — add it to permissions.actions`)
}

/** May the Tool ask the space's AI? */
export function refuseAi(reach: ToolReach, use: 'complete' | 'decide'): string | null {
  return reach.ai[use] ? null : denied(`this tool does not declare ai.${use} — set permissions.ai.${use}`)
}

/** May the Tool hand the viewer a file to save? */
export function refuseDownload(reach: Pick<ToolReach, 'ui'>): string | null {
  return reach.ui.download ? null : denied('this tool does not declare downloads — set permissions.ui.download')
}

/** Does the Tool use the space's AI at all — what makes its writes AI-assisted? */
export function usesAi(reach: Pick<ToolReach, 'ai'>): boolean {
  return reach.ai.complete || reach.ai.decide
}
