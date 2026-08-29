/**
 * Every action the platform offers, by name.
 *
 * This is the perimeter. A name that is not a key here does not exist — no
 * note, no prompt and no client can conjure one — and the scope an action
 * requires is read from its definition and never from anything a caller or a
 * note supplies. Everything else about an action (when to use it, what its
 * arguments mean, worked examples) lives in the Visvine space's Context, where it can be
 * improved without a deploy, precisely because none of it can widen reach.
 */
import { z } from 'zod'
import { CONTEXT_ACTIONS } from '@/lib/actions/defs/context'
import { APP_ACTIONS } from '@/lib/actions/defs/apps'
import { AGENT_ACTIONS } from '@/lib/actions/defs/agents'
import { VM_ACTIONS } from '@/lib/actions/defs/vm'
import type { ActionDef } from '@/lib/actions/types'
import type { McpScope } from '@/lib/mcp/scopes'

const ALL: readonly ActionDef[] = [...CONTEXT_ACTIONS, ...APP_ACTIONS, ...AGENT_ACTIONS, ...VM_ACTIONS]

const BY_NAME: ReadonlyMap<string, ActionDef> = new Map(ALL.map((a) => [a.name, a]))

if (BY_NAME.size !== ALL.length) {
  const seen = new Set<string>()
  const dupe = ALL.map((a) => a.name).find((n) => (seen.has(n) ? true : (seen.add(n), false)))
  throw new Error(`Duplicate action name: ${dupe}`)
}

/** Every action, in catalogue order. */
export function allActions(): readonly ActionDef[] {
  return ALL
}

export function actionByName(name: string): ActionDef | null {
  return BY_NAME.get(name) ?? null
}

/**
 * The scope an action requires, or null when no such action exists. Read by
 * the transport's scope challenge before dispatch and by `runAction` after —
 * one source, so the challenge and the refusal can never disagree.
 */
export function scopeForAction(name: string): McpScope | null {
  return BY_NAME.get(name)?.scope ?? null
}

/** The action's arguments as a validating schema. Built on demand, not cached
 *  as state — a Zod object over the same shape is cheap and stays pure. */
export function schemaOf(def: ActionDef): z.ZodObject<z.ZodRawShape> {
  return z.object(def.input)
}
