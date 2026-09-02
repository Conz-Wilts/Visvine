/**
 * Tool permissions — which of an MCP server's tools this connector may call,
 * and when.
 *
 * A connector's frontmatter is the perimeter: deterministic, machine-enforced,
 * and never widened by prose. `hosts:` says which servers a run may reach and
 * `allow:` which paths; for an MCP server both of those are one host and one
 * path, so neither says anything useful. What a caller actually picks is a
 * TOOL, by name, and this is the gate on that name — the same kind of rule,
 * written the same way, read by the host and not by the model.
 *
 * Three verdicts, because "may an agent do this" has three honest answers:
 *
 *   allow  anything may call it, including a 3am scheduled run.
 *   ask    only a run a person is driving — they pressed Run, or called the
 *          action themselves from their client. A scheduled or event-fired run
 *          is refused, with a denial saying so. Visvine has no channel to
 *          interrupt an unattended run and ask, so "ask" means "be there",
 *          which is the strongest promise the runtime can actually keep.
 *   deny   never, by anything.
 *
 * `ask` is therefore about presence, not a prompt. It is the setting for a tool
 * you are happy to use yourself and not happy to leave running overnight —
 * sending mail, deleting a record, spending money.
 *
 * The note's shape is verdict lists beside a default, which is what an admin
 * already writes for `hosts:` and `allow:` and what survives a YAML round trip
 * with no reserved names to collide with a tool actually called `default`:
 *
 *     tools:
 *       default: allow
 *       ask: [send_message, create_invoice]
 *       deny: [delete_workspace]
 *
 * Absent means `{ default: 'allow' }` — every tool the server advertises. That
 * is deliberate: a connector is signed in to by a person who wants it to work,
 * and a default of `deny` would leave every existing connection mute after a
 * deploy with nothing on screen saying why.
 */

/** What one tool is allowed. */
export type ToolPermission = 'allow' | 'ask' | 'deny'

export const TOOL_PERMISSIONS: readonly ToolPermission[] = ['allow', 'ask', 'deny']

export interface ToolPolicy {
  /** The verdict for a tool named in none of the lists. */
  default: ToolPermission
  /** Per-tool verdicts, by the server's exact tool name. Overrides the default. */
  rules: Readonly<Record<string, ToolPermission>>
}

/** Everything allowed — what a note with no `tools:` block means. */
export const OPEN_TOOL_POLICY: ToolPolicy = { default: 'allow', rules: {} }

function isPermission(value: unknown): value is ToolPermission {
  return typeof value === 'string' && (TOOL_PERMISSIONS as readonly string[]).includes(value)
}

export type ParseToolPolicyResult =
  | { ok: true; policy: ToolPolicy }
  | { ok: false; error: string }

/**
 * Frontmatter `tools:` → a policy. Never throws; the error is admin-readable
 * and is what the connector's save is refused with.
 *
 * A name listed under two verdicts is an error rather than a silent
 * last-wins: the whole point of the block is that a reader can tell what a
 * tool is allowed by looking, and two answers on one page is not that.
 */
export function parseToolPolicy(raw: unknown): ParseToolPolicyResult {
  if (raw === undefined || raw === null) return { ok: true, policy: OPEN_TOOL_POLICY }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '`tools:` must be a block with `default:` and optional allow/ask/deny lists' }
  }
  const block = raw as Record<string, unknown>

  const dflt = block.default === undefined ? 'allow' : block.default
  if (!isPermission(dflt)) {
    return { ok: false, error: `\`tools.default\` must be one of ${TOOL_PERMISSIONS.join(', ')}` }
  }

  const rules: Record<string, ToolPermission> = {}
  for (const verdict of TOOL_PERMISSIONS) {
    const list = block[verdict]
    if (list === undefined || list === null) continue
    if (!Array.isArray(list)) return { ok: false, error: `\`tools.${verdict}\` must be a list of tool names` }
    for (const entry of list) {
      if (typeof entry !== 'string' || entry.trim().length === 0) {
        return { ok: false, error: `\`tools.${verdict}\` holds ${JSON.stringify(entry)} — every entry must be a tool name` }
      }
      const name = entry.trim()
      const already = rules[name]
      if (already && already !== verdict) {
        return { ok: false, error: `Tool "${name}" is listed under both ${already} and ${verdict} — it can only be one` }
      }
      rules[name] = verdict
    }
  }

  return { ok: true, policy: { default: dflt, rules } }
}

/**
 * A policy → the `tools:` block to write back, or null when there is nothing
 * to say (everything allowed). Returning null is what lets the console clear
 * the key rather than stamping the default into every note.
 */
export function toolPolicyFrontmatter(policy: ToolPolicy): Record<string, unknown> | null {
  const lists: Record<string, string[]> = {}
  for (const [name, verdict] of Object.entries(policy.rules)) {
    // A rule agreeing with the default is not a rule; dropping it keeps the
    // note short and keeps "listed" meaning "decided against the grain".
    if (verdict === policy.default) continue
    ;(lists[verdict] ??= []).push(name)
  }
  const named = Object.keys(lists).length > 0
  if (!named && policy.default === 'allow') return null

  const block: Record<string, unknown> = { default: policy.default }
  for (const verdict of TOOL_PERMISSIONS) {
    const names = lists[verdict]
    if (names && names.length > 0) block[verdict] = [...names].sort()
  }
  return block
}

/** What this policy says about one tool. */
export function toolPermission(policy: ToolPolicy, tool: string): ToolPermission {
  return policy.rules[tool] ?? policy.default
}

/**
 * The gate. Returns null when the call may proceed, and the refusal text
 * otherwise — phrased for the model that asked, because it is the only party
 * that can do anything about it (drop the call, or tell the person to run it
 * themselves).
 *
 * `attended` is the run's, not the tool's: whether a person is present for
 * this run. It is false by default everywhere, so a caller that forgets to
 * plumb it gets the cautious answer.
 */
export function refuseTool(policy: ToolPolicy, tool: string, attended: boolean): string | null {
  const verdict = toolPermission(policy, tool)
  if (verdict === 'allow') return null
  if (verdict === 'deny') return `tool denied: ${tool} is set to never on this connector`
  if (attended) return null
  return `tool denied: ${tool} is set to run only when someone is here, and this run is unattended — start it yourself to use it`
}

/** Tools this policy would refuse right now, so a listing never advertises them. */
export function callableTools<T extends { name: string }>(
  policy: ToolPolicy,
  tools: readonly T[],
  attended: boolean,
): T[] {
  return tools.filter((t) => refuseTool(policy, t.name, attended) === null)
}

/**
 * Which half of the permissions screen a tool belongs on.
 *
 * The MCP `readOnlyHint` annotation is the server's own word for "this changes
 * nothing", and it is the only split worth drawing: the tools someone might
 * reasonably leave on forever, and the ones that write to their account. A
 * server that annotates nothing lands everything under `writes`, which is the
 * safe way to be wrong — it puts the decision in front of the person rather
 * than filing it away as harmless.
 */
export type ToolGroup = 'read' | 'writes'

export function toolGroup(annotations: unknown): ToolGroup {
  if (typeof annotations !== 'object' || annotations === null) return 'writes'
  return (annotations as { readOnlyHint?: unknown }).readOnlyHint === true ? 'read' : 'writes'
}

/** The one verdict a whole group is on, or null when its tools disagree. */
export function groupPermission(
  policy: ToolPolicy,
  tools: readonly { name: string }[],
): ToolPermission | null {
  if (tools.length === 0) return null
  const first = toolPermission(policy, tools[0].name)
  return tools.every((t) => toolPermission(policy, t.name) === first) ? first : null
}

/** Set every named tool to one verdict, dropping rules that match the default. */
export function withPermissions(
  policy: ToolPolicy,
  names: readonly string[],
  verdict: ToolPermission,
): ToolPolicy {
  const rules = { ...policy.rules }
  for (const name of names) {
    if (verdict === policy.default) delete rules[name]
    else rules[name] = verdict
  }
  return { default: policy.default, rules }
}
