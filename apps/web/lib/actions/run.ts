/**
 * The one path an action takes, whichever door it came through.
 *
 * `POST /api/actions/<name>` and the `visvine` MCP tool both land here, so the
 * two can never drift: same lookup, same scope gate, same validation, same
 * body. What differs is only how each door renders the result and the failure.
 *
 * Scope is checked here as well as at the transport, deliberately. The
 * transport check exists so a client gets an RFC 6750 `insufficient_scope` it
 * can step up from; this one exists so nothing reaches an action body without
 * one. Both read `scopeForAction`.
 *
 * A scope is necessary and never sufficient: every action body re-derives the
 * caller's membership and grants live, through the same `resolveContext` /
 * `principalOf` the web routes use. Removing someone bites on their next call
 * regardless of what their token says.
 */
import { actionByName, schemaOf } from '@/lib/actions/registry'
import { ActionError, type ActionCaller, type ActionDef } from '@/lib/actions/types'

export interface ActionOutcome {
  action: ActionDef
  result: unknown
}

/** Look an action up, or throw the 404 that names what to do instead. */
function requireAction(name: string): ActionDef {
  const def = actionByName(name)
  if (def) return def
  throw new ActionError(
    404,
    `No action named '${name}'. Call the visvine tool with no arguments for the catalogue of what exists.`,
  )
}

export async function runAction(
  caller: ActionCaller,
  name: string,
  input: unknown,
): Promise<ActionOutcome> {
  const def = requireAction(name)

  if (!caller.scopes.includes(def.scope)) {
    throw new ActionError(403, `The '${name}' action requires the '${def.scope}' scope`)
  }

  const parsed = schemaOf(def).safeParse(input ?? {})
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path?.length ? `${issue.path.join('.')}: ` : ''
    throw new ActionError(400, `${where}${issue?.message ?? 'Invalid input'}`)
  }

  return { action: def, result: await def.run(caller, parsed.data) }
}
