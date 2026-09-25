/**
 * The Tool builder: a chat on the space's model whose tools are the authoring
 * actions, for a person with no AI client of their own (docs/tools.md §
 * Building in the app).
 *
 * It keeps the platform's rule — a thing is created by asking an AI — and runs
 * AS THE PERSON: every call is `runAction` under their own principal, with
 * `context:read` and `tools:author` and nothing else, so a draft lands only in
 * a folder they can write, and nothing is published or installed: those stay
 * the person's own presses in the Workbench beside the chat. The space id is
 * the builder's, never the model's to choose.
 *
 * The turn itself is agent chat's (`lib/agents/chat.ts#runThreadTurn`): one
 * thread per person per space under a reserved name no agent can take, the
 * same claim, replay, loop, stored answer and metering. Spend is the space's,
 * on its model's key, like any chat.
 */
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { takeToken } from '@/lib/rateLimit'
import { allActions } from '@/lib/actions/registry'
import { runAction } from '@/lib/actions/run'
import { ActionError, type ActionCaller } from '@/lib/actions/types'
import { renderIntake } from '@/lib/actions/shared/intake'
import { preRunStop, type BudgetState } from '@/lib/agents/budget'
import { runThreadTurn, type SendChatOptions, type SendChatResult } from '@/lib/agents/chat'
import { effectiveTimezone } from '@/lib/agents/hooks'
import { resolveAgentChatConfig } from '@/lib/agents/providers'
import { ledgerSpendForMonth } from '@/lib/agents/runs'
import { CHAT_TEXT_MAX } from '@/lib/agents/shared/chat'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import type { Context } from '@/lib/notes/store'
import type { ToolHandler } from '@/lib/notes/toolLoop'
import { renderCatalog } from './catalog'
import { TOOL_NAME_RE } from './config'
import { TOOL_AUTHOR_GUIDE } from './sdkDocs'

/** The builder's thread name: a `:` is never an agent's name, so no agent's chat can collide with it. */
export const BUILDER_THREAD = ':tool-builder'

/** Writing a whole file is a long answer; a build takes more calls than a question. */
const BUILDER_TURN_MS = 180_000
const BUILDER_MAX_TURNS = 16
const SEND_LIMIT = { capacity: 6, refillPerSec: 0.2 }

/** What the builder may do: look, and author. Never publish, install or write outside a Tool. */
const BUILDER_ACTIONS = ['list_tools', 'read_tool', 'create_tool', 'write_tool', 'check_tool', 'list_context', 'read_context'] as const
const BUILDER_SCOPES: ActionCaller['scopes'] = ['context:read', 'tools:author']

/** Calls that change a Tool, and so the Workbench beside the chat. */
const WRITES = new Set(['create_tool', 'write_tool'])

export type BuilderStreamEvent = Parameters<NonNullable<SendChatOptions['onEvent']>>[0] | { type: 'workbench'; tool: string }

export interface BuilderOptions extends Omit<SendChatOptions, 'onEvent'> {
  /** The Tool the Workbench has open, when there is one. */
  tool?: string | null
  onEvent?: (event: BuilderStreamEvent) => void
}

/** One authoring action as a tool the model calls, with the space filled in. */
function actionTool(name: (typeof BUILDER_ACTIONS)[number], caller: ActionCaller, spaceId: string, onWrite: (tool: string) => void): ToolHandler {
  const def = allActions().find((action) => action.name === name)
  if (!def) throw new Error(`The builder names ${name}, which is not an action`)
  const shape = Object.fromEntries(Object.entries(def.input).filter(([key]) => key !== 'space_id'))
  const parameters = z.toJSONSchema(z.object(shape)) as Record<string, unknown>
  delete parameters.$schema
  return {
    spec: { name, description: def.summary, parameters },
    describe: (args) => {
      const target = typeof args.name === 'string' ? args.name : typeof args.path === 'string' ? args.path : ''
      const file = typeof args.file === 'string' ? ` ${args.file}` : ''
      return `${target}${file}`.trim()
    },
    async run(args) {
      try {
        const { result } = await runAction(caller, name, { ...args, space_id: spaceId })
        if (WRITES.has(name) && typeof args.name === 'string' && TOOL_NAME_RE.test(args.name)) onWrite(args.name)
        return JSON.stringify(result)
      } catch (err) {
        if (err instanceof ActionError) return JSON.stringify({ error: err.message })
        throw err
      }
    },
  }
}

export function builderTools(caller: ActionCaller, spaceId: string, onWrite: (tool: string) => void = () => {}): ToolHandler[] {
  return BUILDER_ACTIONS.map((name) => actionTool(name, caller, spaceId, onWrite))
}

/** The builder's standing instructions, then the author's guide and the catalog. */
export function builderSystemPrompt(input: { spaceName: string; tool: string | null }): string {
  return [
    `You build Tools for the space "${input.spaceName}" — small apps its members open from the rail. ` +
      'You work beside the person in the Workbench: every file you write compiles at once and the preview beside this chat reloads, so they watch it take shape.',
    '',
    '## How you work',
    '',
    '- Look before you ask: list_tools (extend a tool rather than duplicate one) and list_context (the space\'s folders decide what the tool reads and writes).',
    '- Then the intake below — unless the request already answered it. One message, at most four questions; "you decide" means pick the safe default and say which.',
    '- Build: create_tool, then write_tool for index.md (the perimeter and the surfaces), ui.tsx, and data.js only when it needs server-side work. Read every build\'s diagnostics and fix them before moving on.',
    '- Run check_tool before you say it is done, and fix anything under `blocking`. Mention a flag the person should know about.',
    '- Never publish or install: the person does that from the Workbench when they are happy with it.',
    '- Build from the kit and the design rules below, so it looks like the rest of the app — unless the person asks for a look of its own.',
    '- Finish with two or three lines: what it shows, what it reads and writes, and what to try in the preview.',
    ...(input.tool
      ? ['', `The Workbench is open on the tool \`${input.tool}\`. Work on it unless the person asks for another.`]
      : []),
    '',
    '## Intake',
    '',
    renderIntake('tool'),
    '',
    '---',
    '',
    TOOL_AUTHOR_GUIDE,
    '',
    '---',
    '',
    '# Tool design',
    '',
    renderCatalog(),
  ].join('\n')
}

export type BuilderReadiness = { ok: true; model: string } | { ok: false; message: string }

/** Whether the builder can answer in this space — the same model a chat would use. */
export async function builderReadiness(spaceId: string): Promise<BuilderReadiness> {
  const resolved = await resolveAgentChatConfig(spaceId, null)
  if (!resolved.ok) return { ok: false, message: resolved.message }
  return { ok: true, model: `${resolved.ref.provider.label} · ${resolved.ref.modelId}` }
}

export async function sendBuilderMessage(
  p: ContextPrincipal,
  context: Context,
  rawText: string,
  opts: BuilderOptions = {},
): Promise<SendChatResult> {
  const { spaceId } = context
  const text = rawText.replace(/\r\n/g, '\n').trim().slice(0, CHAT_TEXT_MAX)
  if (!text) return { ok: false, status: 400, reason: 'empty', message: 'Say something.' }
  const tool = opts.tool && TOOL_NAME_RE.test(opts.tool) ? opts.tool : null

  const pace = await takeToken(`tool-builder:${p.userId}`, SEND_LIMIT)
  if (!pace.ok) return { ok: false, status: 429, reason: 'rate', message: 'Too fast — give it a moment.' }

  const resolved = await resolveAgentChatConfig(spaceId, null)
  if (!resolved.ok) return { ok: false, status: 409, reason: 'no_model', message: resolved.message }
  const { config, ref } = resolved

  // The key's own cap binds; the builder has no cap of its own to spend against.
  const now = new Date()
  const keySpent = resolved.keyBudgetCents === null ? null : await ledgerSpendForMonth(spaceId, ref.provider.id, now)
  const budget: BudgetState = {
    spentThisMonthMicros: null,
    monthlyCapCents: null,
    pricing: ref.pricing,
    keySpentThisMonthMicros: keySpent,
    keyCapCents: resolved.keyBudgetCents,
  }
  const capHit = preRunStop(budget)
  if (capHit) {
    return { ok: false, status: 409, reason: 'budget', message: `The monthly budget on the ${ref.provider.label} model is reached.` }
  }

  const caller: ActionCaller = {
    userId: p.userId,
    name: p.name,
    email: p.email,
    scopes: BUILDER_SCOPES,
    via: 'api',
    client: opts.client ?? 'app',
  }
  const [space, timezone] = await Promise.all([
    prisma.space.findUnique({ where: { id: spaceId }, select: { name: true } }),
    effectiveTimezone(spaceId, null),
  ])
  const onEvent = opts.onEvent
  return runThreadTurn({
    p,
    spaceId,
    threadName: BUILDER_THREAD,
    meterName: BUILDER_THREAD,
    text,
    system: builderSystemPrompt({ spaceName: space?.name ?? spaceId, tool }),
    memoryMessage: null,
    tools: builderTools(caller, spaceId, (name) => onEvent?.({ type: 'workbench', tool: name })),
    config,
    modelUsed: `${ref.provider.id}/${ref.modelId}`,
    pricing: ref.pricing,
    budget,
    maxTurns: BUILDER_MAX_TURNS,
    turnMs: BUILDER_TURN_MS,
    timezone,
    opts: { signal: opts.signal, chatFn: opts.chatFn, onEvent: onEvent ? (event) => onEvent(event) : undefined },
  })
}
