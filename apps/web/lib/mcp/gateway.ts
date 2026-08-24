/**
 * The one MCP tool.
 *
 * Both servers register exactly this and nothing else. The surface behind it is
 * a catalogue in the Visvine space's Context, which a client fetches when it has a reason
 * to (lib/actions/guide.ts), and a registry of endpoints it dispatches through
 * (lib/actions/run.ts) — so connecting costs one tool schema, whatever the
 * catalogue grows to.
 *
 * THE THREE MODES, and why they are shaped this way:
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
import { allActions } from '@/lib/actions/registry'
import { ActionError } from '@/lib/actions/types'

export const TOOL_NAME = 'visvine'

/**
 * The tool's description. The only text about this surface a client reads
 * before it has called anything, so it teaches the protocol and nothing else —
 * no catalogue, no recipes. Those change; this string is cached for the life of
 * a connection.
 */
function describeTool(): string {
  const count = allActions().length
  return (
    'The single door to Visvine — a relationship-context platform where context notes are how you direct ' +
    `agents. ${count} actions sit behind it, covering context, files, events, connectors, agents and ` +
    'building Tools, and this tool is how you find them, read them and run them.\n\n' +
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

export function registerGateway(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: describeTool(),
      inputSchema,
      // Not read-only: this is the door to the write actions too. A client that
      // trusts the hint would be wrong, so there is no hint.
      annotations: {},
    },
    (args, extra: ToolExtra) =>
      withCaller(extra, async (caller) => {
        if (!args.action) {
          return buildGuide({ caller, request: args.request, spaceId: args.space_id })
        }

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
