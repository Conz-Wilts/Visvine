/**
 * The MCP tools: one router, and one tool per action.
 *
 * `visvine` is the router. The surface behind it is a catalogue in the Visvine
 * space's Context, which a client fetches when it has a reason to
 * (lib/actions/guide.ts), and a registry of endpoints it dispatches through
 * (lib/actions/run.ts). It is the door a client with no idea what exists walks
 * through: the plan for an ask, the manual for an action, and a way to run any
 * of them from a single schema.
 *
 * `visvine_<action>` is every action as its own tool, generated from the same
 * registry (`registerActionTools`). Same `runAction`, same scope, same Zod —
 * the two doors cannot drift. What a named tool adds is what a single schema
 * cannot carry: a client can allow or deny each one by name, its log says
 * which action ran, the arguments arrive typed rather than as a bag the model
 * recalled from a manual, and the MCP annotations say whether it reads or
 * writes. The scope challenge (lib/mcp/challenge.ts) reads the action out of
 * the tool name for these, out of the arguments for the router.
 *
 * THE ROUTER'S THREE MODES, and why they are shaped this way:
 *
 *   no `action`            the plan. Free, read-only, and the thing to call first.
 *   `action`, no `input`   that action's manual.
 *   `action` + `input`     run it.
 *
 * Supplying `input` is what runs something. That is the safety property worth
 * having on a single-tool surface: a client that names an action to find out
 * what it does cannot accidentally do it, and there is no mode flag to get
 * wrong. An action taking no arguments is still run with `input: {}`, which is
 * a deliberate keystroke rather than a default.
 *
 * `explain` exists for the one case the rule above cannot serve: reading the
 * manual for an action you already have the arguments for.
 */
import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { withCaller, type ToolExtra } from '@/lib/mcp/auth'
import { buildGuide, buildActionDoc } from '@/lib/actions/guide'
import { runAction } from '@/lib/actions/run'
import { actionByName, actionsOn, isOnSurface, schemaOf, type McpSurface } from '@/lib/actions/registry'
import { mcpResourceUrl } from '@/lib/mcp/config'
import { ActionError, type ActionDef } from '@/lib/actions/types'

export const TOOL_NAME = 'visvine'

/** The prefix every per-action tool carries, so a client's log reads `visvine_search_context`. */
const ACTION_TOOL_PREFIX = `${TOOL_NAME}_`

export function actionToolName(action: string): string {
  return `${ACTION_TOOL_PREFIX}${action}`
}

/** The action a per-action tool name stands for, or null for any other tool. */
export function actionFromToolName(toolName: string): string | null {
  if (!toolName.startsWith(ACTION_TOOL_PREFIX)) return null
  const action = toolName.slice(ACTION_TOOL_PREFIX.length)
  return action.length > 0 ? action : null
}

/**
 * What the hints say about an action. A read scope is read-only unless the
 * definition says otherwise; everything else may write, and is marked
 * destructive unless the definition says it is not, because a client that
 * gates on the hint must be told about `edit_context` overwriting a note.
 * Connectors and machines reach outside the platform, which is `openWorldHint`.
 */
export function actionAnnotations(def: ActionDef): {
  title: string
  readOnlyHint: boolean
  destructiveHint: boolean
  openWorldHint: boolean
} {
  const readOnly = def.annotations?.readOnlyHint ?? def.scope === 'context:read'
  return {
    title: def.name,
    readOnlyHint: readOnly,
    destructiveHint: readOnly ? false : (def.annotations?.destructiveHint ?? true),
    openWorldHint: def.scope === 'connectors:use' || def.scope === 'vm:run',
  }
}

/**
 * The tool's description. The only text about this surface a client reads
 * before it has called anything, so it teaches the protocol and nothing else —
 * no catalogue, no recipes. Those change; this string is cached for the life of
 * a connection.
 */
function describeTool(surface: McpSurface): string {
  const count = actionsOn(surface).length
  const covering =
    surface === 'tools'
      ? 'covering building, checking, previewing, publishing and installing Tools'
      : 'covering context, files, events, connectors and agents'
  return (
    'The router into Visvine — a relationship-context platform where context notes are how you direct ' +
    `agents. ${count} actions sit behind it, ${covering}, and this tool is how you find them, read them and run them. ` +
    'Each action is also ' +
    'its own tool, `visvine_<action>`, with the same arguments — prefer that once you know which one ' +
    'you need, so the call is typed and named.\n\n' +
    "CALL IT FIRST, with no `action` and `request` set to the user's message VERBATIM. You get back the plan " +
    'for that ask, the space you are working in, and the full list of actions — read from Visvine itself, so ' +
    'it is current. Then call again with `action` to read one, and again with `action` + `input` to run it.\n\n' +
    'Do NOT guess an action name and run it blind. Reading an action costs one cheap call and tells you every ' +
    'argument, the refusals to expect and the traps; guessing costs a rejected write. Equally, do not conclude ' +
    'that Visvine cannot do something because no action is named for it — most things here are notes at ' +
    'deterministic paths, written with `edit_context`, and the plan will say so.'
  )
}

const inputSchema = {
  request: z
    .string()
    .optional()
    .describe(
      "What the user asked for, VERBATIM — do not summarise or rewrite it, the routing reads its wording. " +
        'Returns the plan. Ignored when `action` is set.',
    ),
  action: z
    .string()
    .optional()
    .describe(
      'The action to read or run. Omit to get the plan and the catalogue of every action that exists.',
    ),
  input: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "The action's arguments. SUPPLYING THIS IS WHAT RUNS IT — omit it and you get the manual instead. " +
        'An action that takes no arguments is run with `{}`.',
    ),
  space_id: z
    .string()
    .optional()
    .describe(
      'The space the work targets, when known. Only used for the plan — an action that needs a space takes ' +
        'its own `space_id` inside `input`.',
    ),
  explain: z
    .boolean()
    .optional()
    .describe('Return the manual even though `input` was supplied, instead of running anything.'),
}

/** Where an action this server does not offer lives — said instead of running it. */
function offSurfaceRefusal(action: string, surface: McpSurface): ActionError {
  const other: McpSurface = surface === 'tools' ? 'visvine' : 'tools'
  const name = other === 'tools' ? 'Visvine Tools' : 'Visvine'
  return new ActionError(
    404,
    `'${action}' is on the ${name} MCP server, not this one — connect ${mcpResourceUrl(other)} to use it.`,
  )
}

export function registerGateway(server: McpServer, surface: McpSurface = 'visvine'): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: describeTool(surface),
      inputSchema,
      // Not read-only: this is the door to the write actions too. A client that
      // trusts the hint would be wrong, so there is no hint.
      annotations: {},
    },
    (args, extra: ToolExtra) =>
      withCaller(extra, async (caller) => {
        if (!args.action) {
          return buildGuide({ caller, request: args.request, spaceId: args.space_id, surface })
        }
        // A guide is read on either server; an action only on its own.
        if (actionByName(args.action) && !isOnSurface(args.action, surface)) throw offSurfaceRefusal(args.action, surface)

        if (!args.input || args.explain) {
          const doc = await buildActionDoc(args.action)
          if (!doc) {
            throw new ActionError(
              404,
              `No action named '${args.action}'. Call this tool with no arguments for the catalogue.`,
            )
          }
          return doc
        }

        const { result } = await runAction(caller, args.action, args.input)
        return result
      }),
  )
}

/**
 * One tool per action, from the registry. The description is the catalogue
 * line plus where the manual is; the schema is the action's own Zod shape, so
 * the client sees every argument and its description without a round trip.
 */
export function registerActionTools(server: McpServer, surface: McpSurface = 'visvine'): void {
  for (const def of actionsOn(surface)) {
    server.registerTool(
      actionToolName(def.name),
      {
        description:
          `${def.summary}\n\nRequires the \`${def.scope}\` scope. ` +
          `For the full manual — refusals to expect, worked examples — call \`${TOOL_NAME}\` with ` +
          `\`action: "${def.name}"\` and no \`input\`.`,
        inputSchema: schemaOf(def),
        annotations: actionAnnotations(def),
        ...(def.mcpMeta ? { _meta: def.mcpMeta } : {}),
      },
      (args: unknown, extra: ToolExtra) =>
        withCaller(extra, async (caller) => {
          const { result } = await runAction(caller, def.name, args ?? {})
          return result
        }),
    )
  }
}
