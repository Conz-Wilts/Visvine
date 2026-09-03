/**
 * An Action is the unit of everything Visvine can be asked to do.
 *
 * One definition, two doors:
 *
 *   HTTP   POST /api/actions/<name>      — a session-authenticated endpoint
 *   MCP    the single `visvine` tool     — lib/mcp/gateway.ts
 *
 * Both go through `runAction` (lib/actions/run.ts), so neither can drift and
 * neither re-implements authorization: an action body resolves the caller's
 * context through the same `resolveContext` / `principalOf` the web routes use.
 *
 * WHY THIS SHAPE. A protocol that carries one tool costs a client nothing on
 * connect, however large the surface behind it grows. The guidance that would
 * otherwise be thirty-odd tool schemas in every context window lives where
 * guidance belongs in this app — in context notes, in the Visvine space's shared Context,
 * fetched when there is a reason to (lib/actions/notes.ts).
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
  run: (caller: ActionCaller, args: z.infer<z.ZodObject<Shape>>) => Promise<unknown>
}

/** Identity function that type-checks a definition against its own input shape. */
export function defineAction<Shape extends z.ZodRawShape>(def: ActionDef<Shape>): ActionDef {
  return def as unknown as ActionDef
}

