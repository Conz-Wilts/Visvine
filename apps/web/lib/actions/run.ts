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
 *
 * A Tool's deploy key is narrower still: it may ask only that Tool's own
 * actions, in its own space (lib/tools/shared/deployKeys.ts).
 */
import { actionByName, schemaOf } from '@/lib/actions/registry'
import { listMySpaces } from '@/lib/actions/resolve'
import { ActionError, type ActionCaller, type ActionDef } from '@/lib/actions/types'
import { deployKeyDenial } from '@/lib/tools/shared/deployKeys'

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

/**
 * The refusal for a call that named no space. It carries the candidates by
 * name so the caller can ask the person a precise question — "Visvine or
 * Acme?" — rather than guess. A write landing in the wrong space is read by
 * the wrong people, which is why nothing here picks one.
 */
async function whichSpace(caller: ActionCaller, name: string): Promise<string> {
  const mine = await listMySpaces(caller).catch(() => [])
  const named = mine.map((s) => `${s.name} (\`${s.id}\`)`).join(', ')
  return (
    `'${name}' needs a space_id. ` +
    (mine.length
      ? `You can act in: ${named}. If the request does not say which, ask the person which space before going on.`
      : 'You are in no space yet; create or join one first.')
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
  if (caller.deployKey) {
    const denial = deployKeyDenial(caller.deployKey, def.name, input)
    if (denial) throw new ActionError(403, denial)
  }

  const parsed = schemaOf(def).safeParse(input ?? {})
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    if (issue && issue.path.length === 1 && issue.path[0] === 'space_id' && issue.code === 'invalid_type') {
      throw new ActionError(400, await whichSpace(caller, name))
    }
    const where = issue?.path?.length ? `${issue.path.join('.')}: ` : ''
    throw new ActionError(400, `${where}${issue?.message ?? 'Invalid input'}`)
  }

  return { action: def, result: await def.run(caller, parsed.data) }
}
