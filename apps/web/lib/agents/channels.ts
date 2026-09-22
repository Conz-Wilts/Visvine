/**
 * Delivering a message from outside to an agent.
 *
 * The I/O half of `shared/channels.ts`: resolve the space and the agent the
 * address names, decide whether the sender may speak to it, and — if they may —
 * put the message in the agent's mailbox, where the ordinary tick picks it up.
 *
 * Every channel ends here, and this is the only place a message becomes a run.
 * That is the discipline worth keeping: one authorization model and one loop,
 * so a bug in an adapter is a delivery bug and never an access bug.
 *
 * **A channel identifies a sender; it never authorizes one.** An email address
 * is matched against the identities the space already knows, and a sender who
 * is not a member is refused. An agent's reach is its own either way — a
 * message cannot borrow the sender's grants — so the question here is only
 * whether this person may make this agent run at all.
 */
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { enqueueAgentEvent } from '@/lib/agents/events'
import { findAgentBrief } from '@/lib/agents/briefs'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import {
  messageDedupeKey,
  messageForRun,
  messageSummary,
  routeToAgent,
  type InboundMessage,
  type RoutableAgent,
} from '@/lib/agents/shared/channels'
import { parseKeywords } from '@/lib/agents/shared/skills'

export type DeliveryResult =
  | { ok: true; agentName: string; eventId: string }
  | { ok: false; reason: 'unknown_space' | 'unknown_agent' | 'inactive' | 'not_a_member' | 'no_route' | 'dropped'; message: string }

/** The agents in a space that are active and may be addressed, with their routing keywords. */
async function routableAgents(spaceId: string): Promise<RoutableAgent[]> {
  const states = await prisma.agentState.findMany({
    where: { spaceId, active: true },
    select: { name: true },
  })
  const agents: RoutableAgent[] = []
  for (const state of states) {
    const brief = await findAgentBrief(spaceId, state.name)
    if (!brief) continue
    agents.push({ name: state.name, keywords: parseKeywords(parseFrontmatter(brief.content).keywords) })
  }
  return agents
}

/**
 * Is this sender someone the space knows?
 *
 * Matched on a claimed email against the space's members. A sender we cannot
 * place is refused rather than run as "somebody": an agent that answers
 * strangers is an agent anybody can spend the space's model key on.
 */
async function senderMember(spaceId: string, from: InboundMessage['from']): Promise<{ userId: string; name: string } | null> {
  // An adapter that already knows the account (the in-app box, a verified
  // phone) names it; the membership check still runs — knowing who someone
  // is never says they belong here.
  const user = from.userId
    ? await prisma.user.findUnique({ where: { id: from.userId }, select: { id: true, name: true, email: true } })
    : from.email
      ? await prisma.user.findFirst({
          where: { email: { equals: from.email.trim().toLowerCase(), mode: 'insensitive' } },
          select: { id: true, name: true, email: true },
        })
      : null
  if (!user) return null
  const member = await prisma.spaceMember.findFirst({
    where: { spaceId, userId: user.id, status: 'active' },
    select: { userId: true },
  })
  return member ? { userId: user.id, name: user.name ?? from.display ?? user.email ?? 'someone' } : null
}

/**
 * Put one message in an agent's mailbox.
 *
 * The event is `kind: 'reply'` — the same kind saying something to an agent
 * from its page produces — because to the run they are the same thing: words
 * from a person that arrived between runs. Deduped on the provider's own id,
 * so a retried delivery is not a second run.
 */
export async function deliverMessage(
  message: InboundMessage,
  opts: {
    /**
     * A person is at a door, asking for a run now — the message may reach an
     * agent that is switched off, because the claim that follows will run it
     * attended, as them (`claimManualRun`'s `allowInactive`). Never set for a
     * channel that only fills the mailbox: mail for an inactive agent waits
     * for nobody.
     */
    allowInactive?: boolean
  } = {},
): Promise<DeliveryResult> {
  const space = await prisma.space.findUnique({ where: { id: message.spaceId }, select: { id: true } })
  if (!space) return { ok: false, reason: 'unknown_space', message: 'No such space.' }

  const sender = await senderMember(message.spaceId, message.from)
  if (!sender) {
    // Worth a warn: it is the app working as designed, and it is also what an
    // attempt to talk to somebody else's agent looks like.
    logger.warn('agents.channel.sender_refused', {
      spaceId: message.spaceId,
      channel: message.channel,
      from: message.from.email ?? message.from.handle ?? null,
    })
    return { ok: false, reason: 'not_a_member', message: 'Only members of this space can message its agents.' }
  }

  let agentName = message.agentName
  if (!agentName) {
    agentName = routeToAgent(message, await routableAgents(message.spaceId))
    if (!agentName) {
      // Nobody answering beats the wrong agent answering, and the sender is told.
      return { ok: false, reason: 'no_route', message: 'No agent in this space matches that message.' }
    }
  }

  const state = await prisma.agentState.findUnique({
    where: { agent_identity: { spaceId: message.spaceId, name: agentName } },
    select: { active: true },
  })
  if (!state) return { ok: false, reason: 'unknown_agent', message: `No agent called ${agentName} here.` }
  if (!state.active && !opts.allowInactive) return { ok: false, reason: 'inactive', message: `${agentName} is switched off.` }

  const enqueued = await enqueueAgentEvent({
    spaceId: message.spaceId,
    agentName,
    kind: 'reply',
    source: `${message.channel}:${sender.name}`,
    summary: messageSummary(message),
    payload: {
      ...(message.payload ?? {}),
      channel: message.channel,
      from: { name: sender.name, userId: sender.userId },
      // Fenced and labelled: this is somebody's words, not the operator's brief.
      message: messageForRun(message),
    },
    dedupeKey: messageDedupeKey(message),
  })

  if (!enqueued.ok) {
    return {
      ok: false,
      reason: 'dropped',
      message:
        'deduped' in enqueued
          ? 'That message is already waiting to be read.'
          : 'That agent has too many unread messages; it will catch up shortly.',
    }
  }
  return { ok: true, agentName, eventId: enqueued.id }
}
