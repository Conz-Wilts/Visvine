/**
 * An Action is the unit of everything Visvine can be asked to do.
 *
 * One definition, two doors:
 *
 *   HTTP   POST /api/actions/<name>      — a session-authenticated endpoint
 *   MCP    the `visvine` router, or `visvine_<name>`   — lib/mcp/gateway.ts
 *
 * Both go through `runAction` (lib/actions/run.ts), so neither can drift and
 * neither re-implements authorization: an action body resolves the caller's
 * context through the same `resolveContext` / `principalOf` the web routes use.
 *
 * WHY THIS SHAPE. The definition is the one source: the router's catalogue,
 * the per-action tool's schema and the HTTP endpoint are all rendered from it.
 * The guidance — when to use an action, its refusals, worked examples — lives
 * where guidance belongs in this app: in context notes, in the Visvine space's
 * shared Context, fetched when there is a reason to (lib/actions/notes.ts).
 *
 * The perimeter is STRUCTURAL, not declared. A note can describe an action; it
 * can never invent one. `runAction` resolves a name against this registry or
 * fails, the required scope is read from the definition and never from the
 * note, and the note's parameter contract is regenerated from the Zod schema
 * rather than written by hand. Prose in that Context is therefore free to be
 * wrong, or hostile, without widening what a caller can reach — the same split
 * connectors make between frontmatter and body.
 */
import type { z } from 'zod'
import type { McpScope } from '@/lib/mcp/scopes'

/** The identity an action runs as, and what its credential was granted. */
export interface ActionCaller {
  userId: string
  name: string
  email: string
  /** OAuth scopes on the presented token; a web session carries them all. */
  scopes: string[]
  /**
   * Which door asked — an MCP client, an agent's run, the HTTP route — for
   * the records that say who used what (lib/resources/accessLog.ts). Absent
   * reads as `api`.
   */
  via?: 'mcp' | 'agent' | 'api' | 'tool'
  /** The agent whose run is acting, and that run, when `via` is `agent`; the Tool, when `via` is `tool`. */
  agentName?: string | null
  runId?: string | null
  /**
   * `mobile` when the person behind the call is in a phone app — its own
   * session, or an agent chat they are having from one. Nothing renders or
   * runs a Tool for them (lib/tools/clientClass.ts).
   */
  client?: 'app' | 'mobile'
  /**
   * Set when the call came with a Tool's deploy key (lib/tools/deployKeys.ts):
   * the person who minted it, held to that one Tool's actions.
   */
  deployKey?: { id: string; label: string; spaceId: string; tool: string }
}

/** The caller as the reader a resource's gate and record of use take. */
export function readerOf(ctx: ActionCaller) {
  return {
    userId: ctx.userId,
    email: ctx.email,
    via: ctx.via ?? ('api' as const),
    agentName: ctx.agentName ?? null,
    runId: ctx.runId ?? null,
  }
}

/**
 * An expected failure with an HTTP status. Thrown by action bodies and mapped
 * once per door: to a status by the route, to a readable tool error by the
 * gateway. Never use it for a genuine fault — an unhandled throw is a 500 and
 * reaches Error Reporting, which is where a fault belongs.
 */
export class ActionError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ActionError'
    this.status = status
  }
}

export interface ActionDef<Shape extends z.ZodRawShape = z.ZodRawShape> {
  /** The wire name. Also the URL segment and the note's basename. */
  name: string
  /** The scope a token must carry. Read from here, never from the note. */
  scope: McpScope
  /**
   * One line for the catalog — the only thing about this action a caller sees
   * before choosing it, so it must say what it does, not what it is called.
   */
  summary: string
  /** The full guidance. Becomes the prose of `actions/<name>.md` in that Context. */
  description: string
  /** The Zod shape. The single definition of what a valid call looks like. */
  input: Shape
  /** MCP tool-annotation hints, carried into the action's rendered contract. */
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
  /**
   * Guides (lib/actions/shared/guides.ts) appended to this action's manual —
   * the contract it shares with other actions, written once and read with it.
   */
  guides?: readonly string[]
  /**
   * `_meta` for the action's named MCP tool — what a client reads beside the
   * schema. Today only `openai/fileParams`, which tells ChatGPT to hand a file
   * the person attached to the chat to this argument as a download link.
   */
  mcpMeta?: Record<string, unknown>
  run: (caller: ActionCaller, args: z.infer<z.ZodObject<Shape>>) => Promise<unknown>
}

/** Identity function that type-checks a definition against its own input shape. */
export function defineAction<Shape extends z.ZodRawShape>(def: ActionDef<Shape>): ActionDef {
  return def as unknown as ActionDef
}

