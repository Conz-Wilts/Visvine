/**
 * `actions.run` — the space's actions a Tool may run, and the four rules that
 * keep one from becoming a way around every other gate (docs/tools.md):
 *
 *   1. **The install's space, and only it.** The bridge sets `space_id` to the
 *      space the Tool runs in and refuses a call naming another; an action that
 *      reads everywhere when `space_id` is left out never runs that way here.
 *   2. **No action whose data a bridge method already gates.** An action runs
 *      with the viewer's full reach and never sees the Tool's permissions, so
 *      an allowlisted `read_context` would quietly cancel `permissions.context`.
 *   3. **Every argument that names a thing is checked** — it must be in this
 *      space, and a file must be inside `permissions.resources` — before the
 *      action runs.
 *   4. **Nothing that creates or changes what runs or governs**: spaces,
 *      agents, tools, installs, connectors, secrets, aliases, machines.
 *
 * So `TOOL_ACTIONS` is small, and grows one audited entry at a time. A Tool
 * also has to DECLARE each one it runs (`permissions.actions`), which is what
 * the install sheet shows the admin who consents to it.
 */

/** What an argument names, for the check before the action runs. */
export type TenantThing = 'event' | 'resource' | 'channel'

interface ToolActionSpec {
  /** Takes `space_id`, which the bridge sets to the install's space. */
  spaced: boolean
  /** The arguments that name a thing in a tenant, and what each names. */
  tenantArgs: Readonly<Record<string, TenantThing>>
}

export const TOOL_ACTIONS: Readonly<Record<string, ToolActionSpec>> = {
  list_events: { spaced: true, tenantArgs: {} },
  update_event: { spaced: true, tenantArgs: { event_id: 'event', cover_resource_id: 'resource' } },
  share_resource: { spaced: false, tenantArgs: { resource_id: 'resource', channel_id: 'channel' } },
}

export type ToolActionPlan =
  | { ok: true; input: Record<string, unknown>; tenantArgs: Array<{ arg: string; thing: TenantThing; value: string }> }
  | { ok: false; code: 'perimeter' | 'forbidden' | 'invalid'; message: string }

/**
 * The input an allowlisted action runs with, or why it may not. Pure: rules
 * 1, 2 and 4 are the allowlist and the space; rule 3's lookups are
 * {@link tenantArgDenial}'s.
 */
export function planToolAction(name: string, input: Record<string, unknown>, spaceId: string): ToolActionPlan {
  const spec = Object.hasOwn(TOOL_ACTIONS, name) ? TOOL_ACTIONS[name] : undefined
  if (!spec) {
    return {
      ok: false,
      code: 'perimeter',
      message: `${name} is not an action a tool may run — tools run ${Object.keys(TOOL_ACTIONS).join(', ')}`,
    }
  }
  if (input.space_id !== undefined && input.space_id !== spaceId) {
    return { ok: false, code: 'forbidden', message: 'A tool acts only in the space it is installed in.' }
  }
  const tenantArgs: Array<{ arg: string; thing: TenantThing; value: string }> = []
  for (const [arg, thing] of Object.entries(spec.tenantArgs)) {
    const value = input[arg]
    if (value === undefined || value === null) continue
    if (typeof value !== 'string' || !value.trim()) return { ok: false, code: 'invalid', message: `${arg} must be an id` }
    tenantArgs.push({ arg, thing, value })
  }
  return { ok: true, input: spec.spaced ? { ...input, space_id: spaceId } : { ...input }, tenantArgs }
}
