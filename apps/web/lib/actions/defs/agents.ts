/**
 * Agents as a surface: sending one a message, and handing work between them.
 *
 * Delegation is an ACTION rather than a private arrangement between agents,
 * because that is what makes it reviewable: it goes through the registry, needs
 * a scope, appears on both timelines, and is depth-capped like every other
 * chain. An agent handing to another is a thing that happened to the space, not
 * a thing that happened inside one run.
 *
 * What moves is the TASK and the WORKSPACE — never credentials and never a
 * session. Agent B runs as itself, with its own brief, its own grants and its
 * own machine; it inherits the files in the space's workspace and the sentence
 * it was handed, and nothing else. That is the whole difference between "hand
 * off" here and "share one computer" elsewhere.
 */
import { z } from 'zod'
import { defineAction, ActionError } from '@/lib/actions/types'
import { resolveTarget } from '@/lib/actions/resolve'
import prisma from '@/lib/prisma'
import { deliverMessage } from '@/lib/agents/channels'
import { clean, MAX_BODY, MAX_SUBJECT } from '@/lib/agents/shared/channels'
import { enqueueAgentEvent, MAX_EVENT_CHAIN_DEPTH } from '@/lib/agents/events'

const spaceArg = z
  .string()
  .describe('The space to act in — list_spaces returns the ids you can act in')

/** Two hops from a person. Deeper than this is a loop wearing a delegation's clothes. */
const MAX_DELEGATION_DEPTH = 2

export const AGENT_ACTIONS = [
  defineAction({
    name: 'send_to_agent',
    scope: 'agents:run',
    summary: 'Say something to an agent — it reads it on its next run and answers in its own space.',
    description:
      'Send a message to an agent in this space. It lands in that agent\'s mailbox and is read on its next run, ' +
      'exactly as an email or an in-app message would be — there is one path for all of them. The agent runs as ' +
      'itself with its own brief and grants, so a message asks it to do something; it never lends it your access. ' +
      'The reply arrives as the agent\'s ordinary work: its timeline and the notes it writes.',
    input: {
      space_id: spaceArg,
      agent: z.string().min(1).describe("The agent to message, e.g. 'weekly-digest'"),
      message: z.string().min(1).max(MAX_BODY).describe('What to say to it, in plain words'),
    },
    run: async (ctx, args) => {
      const target = await resolveTarget(ctx, args.space_id, 'shared')
      const result = await deliverMessage({
        channel: 'in_app',
        spaceId: target.context.spaceId,
        agentName: args.agent,
        from: { email: ctx.email, display: ctx.name },
        subject: clean(args.message, MAX_SUBJECT),
        body: clean(args.message, MAX_BODY),
        externalId: `${ctx.userId}:${args.agent}:${clean(args.message, 80)}`,
      })
      if (!result.ok) {
        throw new ActionError(result.reason === 'not_a_member' ? 403 : 404, result.message)
      }
      return { delivered_to: result.agentName, reads_it: 'on its next run' }
    },
  }),

  defineAction({
    name: 'delegate',
    scope: 'agents:run',
    summary:
      'Hand a task to another agent in this space, with the files it needs — it does the work as itself, on its own machine.',
    description:
      'Hand a task to another agent. What moves is the task and the workspace path holding whatever it needs; what does ' +
      'NOT move is credentials, sessions or your access — the other agent runs as itself, with its own brief, its own ' +
      'grants and its own machine. Use this when a request turns into something another agent is set up for, rather ' +
      'than doing it yourself with reach you were not given. The handoff appears on both agents\' timelines, and an ' +
      'agent that was itself delegated to may not delegate again.',
    input: {
      space_id: spaceArg,
      agent: z.string().min(1).describe('The agent to hand the task to'),
      task: z.string().min(1).max(4_000).describe('What you need it to do, in one or two sentences'),
      workspace_path: z
        .string()
        .max(400)
        .optional()
        .describe("Where the files it needs are, under the space's shared workspace, e.g. '/workspace/expenses'"),
      depth: z
        .number()
        .int()
        .min(0)
        .max(MAX_EVENT_CHAIN_DEPTH)
        .optional()
        .describe('How many hands this has already passed through. Leave unset unless you were delegated to.'),
    },
    run: async (ctx, args) => {
      const target = await resolveTarget(ctx, args.space_id, 'shared')
      const spaceId = target.context.spaceId
      const depth = (args.depth ?? 0) + 1
      if (depth > MAX_DELEGATION_DEPTH) {
        throw new ActionError(
          400,
          `A task may pass through ${MAX_DELEGATION_DEPTH} pairs of hands. Do this one yourself, or ask a person.`,
        )
      }

      const state = await prisma.agentState.findUnique({
        where: { agent_identity: { spaceId, name: args.agent } },
        select: { active: true },
      })
      if (!state) throw new ActionError(404, `No agent called ${args.agent} here.`)
      if (!state.active) throw new ActionError(409, `${args.agent} is switched off.`)

      const enqueued = await enqueueAgentEvent({
        spaceId,
        agentName: args.agent,
        kind: 'reply',
        source: `delegate:${ctx.name}`,
        summary: clean(`${ctx.name} handed over: ${args.task}`, MAX_SUBJECT),
        payload: {
          delegated_by: ctx.name,
          task: clean(args.task, MAX_BODY),
          workspace_path: args.workspace_path ?? null,
          depth,
        },
        // The chain the mailbox already enforces, so a delegation loop is
        // refused by the same counter that stops a note-trigger loop.
        chain: { depth, via: `delegate:${args.agent}` },
      })

      if (!enqueued.ok) {
        if ('looped' in enqueued) throw new ActionError(400, 'That handoff would loop; it was refused.')
        if ('deduped' in enqueued) return { handed_to: args.agent, note: 'an identical handoff is already waiting' }
        throw new ActionError(429, `${args.agent} has too much waiting; try again shortly.`)
      }

      return {
        handed_to: args.agent,
        depth,
        workspace_path: args.workspace_path ?? null,
        starts: 'on its next tick',
      }
    },
  }),
] as const
