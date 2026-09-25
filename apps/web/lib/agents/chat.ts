/**
 * Talking to an agent (docs/agents.md § Chat).
 *
 * A thread is a person's standing conversation with one agent in one space —
 * the mobile Messages → Agents screen. A message is ONE turn on the space's
 * model: the chat preamble and the brief as system prompt, the memory note
 * read-only, the last few messages replayed, the person's words, and the
 * agent's tools running AS THE PERSON (their principal, their grants). It is
 * not a run: no mailbox, no `agent_runs` row, no schedule, no `Last run` in
 * the memory note. What it spends is metered under the agent's name like a
 * run, so the agent's cap and the key's cap both bind.
 *
 * The gate is "can read the brief": the same set of people the roster shows
 * an agent to. A member chatting with the space's agent does not need edit
 * rights on it — the page's Run gate (`canTriggerRun`) is about starting an
 * unattended run, and this is neither unattended nor a run.
 *
 * One turn per thread at a time, across N instances: the assistant row is
 * written `pending` and its id claimed on the thread by a conditional UPDATE;
 * a claim older than CHAT_CLAIM_MS is a turn that died and is taken over.
 * The turn runs to completion whether or not the request that started it is
 * still listening, so a disconnected phone finds the answer on its next read.
 */
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { takeToken } from '@/lib/rateLimit'
import { ModelError } from '@/lib/notes/ai'
import { connectorReachFor } from '@/lib/connectors/service'
import { readVisible } from '@/lib/notes/contextService'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import type { Context } from '@/lib/notes/store'
import type { ChatFn } from '@/lib/notes/toolLoop'
import { costMicros, preRunStop, type BudgetState } from './budget'
import { agentConfigOf, composeAgent, findAgentBrief } from './briefs'
import { runChatTurn } from './chatTurn'
import { AGENT_NAME_RE, type AgentBrief } from './config'
import { effectiveTimezone } from './hooks'
import { resolveAgentChatConfig } from './providers'
import { ledgerSpendForAgent, ledgerSpendForMonth, meterModelUsage } from './runs'
import { listAgents } from './service'
import {
  CHAT_ANSWER_MAX,
  CHAT_CLAIM_MS,
  CHAT_MAX_MESSAGES_KEPT,
  CHAT_MAX_TURNS,
  CHAT_PAGE_MAX,
  CHAT_PAGE_SIZE,
  CHAT_TEXT_MAX,
  CHAT_TURN_MS,
  chatPreview,
  chatToolFilter,
  chatUserTurn,
  decodeChatCursor,
  encodeChatCursor,
  failureText,
  historyMessages,
  type ChatMessageDto,
  type ChatRole,
  type ChatStatus,
  type ChatStreamEvent,
  type ChatTrace,
} from './shared/chat'
import { memoryForPrompt, memoryPath } from './shared/memory'
import { agentChatPreamble } from './shared/prompt'
import { agentFolderOfBrief, agentHomeFolder } from './shared/folder'
import { agentTools } from './tools'
import { applyInputs, inputsMessage, inputValuesFor } from './shared/inputs'

/** A person sends a message every few seconds at most; a loop does not. */
const SEND_LIMIT = { capacity: 6, refillPerSec: 0.2 }

type MessageRow = {
  id: string
  role: string
  text: string
  status: string
  reason: string | null
  trace: unknown
  createdAt: Date
}

function toDto(row: MessageRow): ChatMessageDto {
  return {
    id: row.id,
    role: row.role as ChatRole,
    text: row.text,
    status: row.status as ChatStatus,
    reason: row.reason,
    trace: Array.isArray(row.trace) ? (row.trace as ChatTrace[]) : [],
    createdAt: row.createdAt.toISOString(),
  }
}

function nowIso(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(d)
  } catch {
    return d.toISOString()
  }
}

// ── The list ────────────────────────────────────────────────────────────────

/** One row of Messages → Agents: the agent, whether it can answer, and the caller's thread with it. */
export interface ChatAgentRow {
  name: string
  title: string
  description: string | null
  /** A model can run it and the brief parses. */
  ready: boolean
  /** Why not, in one sentence, when `ready` is false. */
  problem: string | null
  /** A turn is being answered right now (the caller's own thread). */
  answering: boolean
  thread: { lastMessageAt: string | null; lastPreview: string | null; unread: boolean } | null
}

export async function listChatAgents(p: ContextPrincipal, context: Context): Promise<ChatAgentRow[]> {
  const [roster, threads] = await Promise.all([
    listAgents(p, context),
    prisma.agentChatThread.findMany({
      where: { spaceId: context.spaceId, userId: p.userId },
      select: { agentName: true, lastMessageAt: true, lastPreview: true, lastReadAt: true, pendingSince: true },
    }),
  ])
  const byName = new Map(threads.map((t) => [t.agentName, t]))
  const now = Date.now()
  return roster.agents.map((a) => {
    const t = byName.get(a.name)
    const problem = a.invalid ?? a.modelProblem
    return {
      name: a.name,
      title: a.title,
      description: a.description,
      ready: problem === null,
      problem,
      answering: !!t?.pendingSince && now - t.pendingSince.getTime() < CHAT_CLAIM_MS,
      thread: t
        ? {
            lastMessageAt: t.lastMessageAt?.toISOString() ?? null,
            lastPreview: t.lastPreview,
            unread: !!t.lastMessageAt && (!t.lastReadAt || t.lastMessageAt > t.lastReadAt),
          }
        : null,
    }
  })
}

// ── The thread ──────────────────────────────────────────────────────────────

export interface ChatPage {
  messages: ChatMessageDto[]
  nextCursor: string | null
}

/** A page of the caller's thread, newest first. The first page marks the thread read. */
export async function listChatMessages(
  userId: string,
  spaceId: string,
  agentName: string,
  opts: { cursor?: string | null; limit?: number } = {},
): Promise<ChatPage> {
  const thread = await prisma.agentChatThread.findUnique({
    where: { chat_identity: { spaceId, agentName, userId } },
    select: { id: true },
  })
  if (!thread) return { messages: [], nextCursor: null }
  const cursor = decodeChatCursor(opts.cursor)
  const limit = Math.min(Math.max(opts.limit ?? CHAT_PAGE_SIZE, 1), CHAT_PAGE_MAX)
  const rows = await prisma.agentChatMessage.findMany({
    where: {
      threadId: thread.id,
      ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: { id: true, role: true, text: true, status: true, reason: true, trace: true, createdAt: true },
  })
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  if (!cursor) await prisma.agentChatThread.update({ where: { id: thread.id }, data: { lastReadAt: new Date() } }).catch(() => undefined)
  return { messages: page.map(toDto), nextCursor: rows.length > limit && last ? encodeChatCursor(last) : null }
}

/** Forget the caller's thread with this agent. Their own rows only. */
export async function clearChat(userId: string, spaceId: string, agentName: string): Promise<boolean> {
  const r = await prisma.agentChatThread.deleteMany({ where: { spaceId, agentName, userId } })
  return r.count > 0
}

// ── The turn ────────────────────────────────────────────────────────────────

export type SendChatResult =
  | { ok: true; userMessage: ChatMessageDto; message: ChatMessageDto }
  | { ok: false; status: number; reason: 'unknown_agent' | 'invalid_brief' | 'no_model' | 'budget' | 'busy' | 'rate' | 'empty'; message: string }

export interface SendChatOptions {
  signal?: AbortSignal
  onEvent?: (event: ChatStreamEvent) => void
  /** A scripted model, for tests. */
  chatFn?: ChatFn
}

export async function sendChatMessage(
  p: ContextPrincipal,
  context: Context,
  agentName: string,
  rawText: string,
  opts: SendChatOptions = {},
): Promise<SendChatResult> {
  const { spaceId } = context
  const text = rawText.replace(/\r\n/g, '\n').trim().slice(0, CHAT_TEXT_MAX)
  if (!text) return { ok: false, status: 400, reason: 'empty', message: 'Say something.' }
  if (!AGENT_NAME_RE.test(agentName)) return { ok: false, status: 404, reason: 'unknown_agent', message: 'No such agent.' }

  const pace = await takeToken(`agent-chat:${p.userId}`, SEND_LIMIT)
  if (!pace.ok) return { ok: false, status: 429, reason: 'rate', message: 'Too fast — give it a moment.' }

  // The gate: a brief the person can read. A run-in copy reads the house's.
  const row = await findAgentBrief(spaceId, agentName)
  const content = row ? await readVisible(p, context, row.path) : null
  if (!row || content === null) return { ok: false, status: 404, reason: 'unknown_agent', message: 'No such agent here.' }
  const parsed = composeAgent(content, await agentConfigOf(spaceId, agentName)).brief
  if (!parsed.ok) return { ok: false, status: 422, reason: 'invalid_brief', message: `This agent's brief is not valid: ${parsed.error}` }
  const brief: AgentBrief = parsed.brief
  const folder = row.spaceId === spaceId ? agentFolderOfBrief(row.path, agentName) : agentHomeFolder(agentName)

  const resolved = await resolveAgentChatConfig(spaceId, brief.model)
  if (!resolved.ok) return { ok: false, status: 409, reason: 'no_model', message: resolved.message }
  const { config, ref } = resolved
  const modelUsed = `${ref.provider.id}/${ref.modelId}`

  // Budget before a token is spent: the agent's cap and the key's.
  const now = new Date()
  const state = await prisma.agentState.findUnique({ where: { agent_identity: { spaceId, name: agentName } }, select: { budgetMonthlyCents: true, runAsUserId: true } })
  const [spent, keySpent] = await Promise.all([
    ledgerSpendForAgent(spaceId, agentName, now),
    resolved.keyBudgetCents === null ? Promise.resolve(null) : ledgerSpendForMonth(spaceId, ref.provider.id, now),
  ])
  const budget: BudgetState = {
    spentThisMonthMicros: spent,
    monthlyCapCents: state?.budgetMonthlyCents ?? null,
    pricing: ref.pricing,
    keySpentThisMonthMicros: keySpent,
    keyCapCents: resolved.keyBudgetCents,
  }
  const capHit = preRunStop(budget)
  if (capHit) {
    return {
      ok: false,
      status: 409,
      reason: 'budget',
      message: capHit.cap === 'key' ? `The monthly budget on the ${ref.provider.label} model is reached.` : "This agent's monthly budget is reached.",
    }
  }

  // The claim and the two rows, in one transaction.
  const claimed = await prisma.$transaction(async (tx) => {
    const thread = await tx.agentChatThread.upsert({
      where: { chat_identity: { spaceId, agentName, userId: p.userId } },
      create: { spaceId, agentName, userId: p.userId },
      update: {},
      select: { id: true },
    })
    const stale = new Date(now.getTime() - CHAT_CLAIM_MS)
    const pending = await tx.agentChatMessage.create({
      data: { threadId: thread.id, role: 'assistant', text: '', status: 'pending' },
      select: { id: true },
    })
    const took = await tx.agentChatThread.updateMany({
      where: { id: thread.id, OR: [{ pendingMessageId: null }, { pendingSince: { lt: stale } }] },
      data: { pendingMessageId: pending.id, pendingSince: now },
    })
    if (took.count === 0) {
      await tx.agentChatMessage.delete({ where: { id: pending.id } })
      return null
    }
    const user = await tx.agentChatMessage.create({
      data: { threadId: thread.id, role: 'user', text, status: 'done' },
      select: { id: true, role: true, text: true, status: true, reason: true, trace: true, createdAt: true },
    })
    // The answer is ordered after the question by its stamp, not its insert.
    await tx.agentChatMessage.update({ where: { id: pending.id }, data: { createdAt: new Date(user.createdAt.getTime() + 1) } })
    await tx.agentChatThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: user.createdAt, lastPreview: chatPreview(text), lastReadAt: user.createdAt },
    })
    return { threadId: thread.id, pendingId: pending.id, user }
  })
  if (!claimed) return { ok: false, status: 409, reason: 'busy', message: 'Still answering your last message.' }
  const userMessage = toDto(claimed.user)
  opts.onEvent?.({ type: 'user', message: userMessage })

  // The prompt: preamble + brief, the memory read-only, the history, the words.
  const [tz, memoryNote, history, reach, actionCatalogue] = await Promise.all([
    effectiveTimezone(spaceId, null),
    readVisible(p, context, memoryPath(folder)).catch(() => null),
    prisma.agentChatMessage.findMany({
      where: { threadId: claimed.threadId, id: { notIn: [claimed.pendingId, claimed.user.id] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 60,
      select: { role: true, text: true, status: true },
    }),
    connectorReachFor(p, context, brief.connectors),
    brief.tools.includes('actions')
      ? (await import('@/lib/actions/registry'))
          .allActions()
          .map((a) => `- ${a.name} (${a.scope}): ${a.summary}`)
          .join('\n')
      : Promise.resolve(undefined),
  ])
  const memoryText = memoryForPrompt(memoryNote)
  const chatInputs = inputValuesFor(brief, p.userId, state?.runAsUserId ?? null)
  const tools = chatToolFilter(
    agentTools({
      principal: p,
      agentFolder: folder,
      context,
      spaceId,
      agentName,
      brief,
      connectorActions: reach.actions,
      machineAllow: reach.hosts,
      attended: true,
      actionCatalogue,
    }),
  )

  const signals = [AbortSignal.timeout(CHAT_TURN_MS), ...(opts.signal ? [opts.signal] : [])]
  const startedAt = new Date()
  let finalText: string | null = null
  let status: ChatStatus = 'failed'
  let reason: string | null = null
  let errorMessage: string | null = null
  let trace: ChatTrace[] = []
  let usage = { promptTokens: 0, completionTokens: 0 }
  let turns = 0
  try {
    const result = await runChatTurn({
      // The person chatting is who the tools run as, so the values are theirs.
      system: [
        `${agentChatPreamble(agentName, folder)}\n\n---\n\n${applyInputs(brief.body, brief.inputs, chatInputs)}`,
        inputsMessage(brief.inputs, chatInputs, p.name || null),
      ]
        .filter(Boolean)
        .join('\n\n'),
      memoryMessage: memoryText ? `Your memory (${memoryPath(folder)}), to read:\n\n${memoryText}` : null,
      history: historyMessages(history.reverse().map((r) => ({ role: r.role as ChatRole, text: r.text, status: r.status as ChatStatus }))),
      userTurn: chatUserTurn({ now: nowIso(startedAt, tz), personName: p.name, text }),
      tools,
      config,
      maxTurns: Math.min(CHAT_MAX_TURNS, brief.maxTurns),
      signal: AbortSignal.any(signals),
      budget,
      chatFn: opts.chatFn,
      onEvent: (e) => {
        if (e.type === 'tool') opts.onEvent?.({ type: 'tool', tool: e.tool, detail: e.detail })
        else if (e.type === 'tool_result') opts.onEvent?.({ type: 'tool_result', tool: e.tool, text: e.text.slice(0, 500) })
        else if (e.type === 'assistant') opts.onEvent?.({ type: 'assistant', text: e.text })
      },
    })
    usage = result.usage
    turns = result.turns
    trace = result.trace
    switch (result.reason) {
      case 'finished':
        finalText = result.finalText
        status = 'done'
        reason = 'finished'
        break
      case 'max_turns':
        finalText = result.finalText
        status = result.finalText ? 'done' : 'failed'
        reason = 'max_turns'
        break
      case 'stopped':
        reason = result.stopReason === 'run_cap' ? 'run_cap' : 'budget'
        break
      case 'aborted':
        reason = 'timeout'
        break
      case 'narrated':
        reason = 'narrated'
        break
      case 'error': {
        const err = result.error
        reason = 'error'
        errorMessage = err instanceof ModelError ? err.message : err?.message ?? 'The model did not answer.'
        break
      }
    }
  } catch (err) {
    reason = 'error'
    errorMessage = err instanceof Error ? err.message : 'The turn crashed.'
    logger.error('agents.chat.turn_crashed', { err, spaceId, agentName })
  }

  const cost = costMicros(usage, ref.pricing)
  const answer = (status === 'done' && finalText ? finalText : failureText(reason ?? 'error', errorMessage)).slice(0, CHAT_ANSWER_MAX)
  const stored = await prisma.$transaction(async (tx) => {
    const message = await tx.agentChatMessage.update({
      where: { id: claimed.pendingId },
      data: {
        text: answer,
        status,
        reason,
        errorMessage,
        trace: trace as unknown as object[],
        model: modelUsed,
        turns,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        costMicros: cost,
      },
      select: { id: true, role: true, text: true, status: true, reason: true, trace: true, createdAt: true },
    })
    await tx.agentChatThread.update({
      where: { id: claimed.threadId },
      data: { pendingMessageId: null, pendingSince: null, lastMessageAt: message.createdAt, lastPreview: chatPreview(answer) },
    })
    // Keep the thread bounded: everything past the newest CHAT_MAX_MESSAGES_KEPT goes.
    const overflow = await tx.agentChatMessage.findMany({
      where: { threadId: claimed.threadId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: CHAT_MAX_MESSAGES_KEPT,
      select: { id: true },
    })
    if (overflow.length) await tx.agentChatMessage.deleteMany({ where: { id: { in: overflow.map((r) => r.id) } } })
    return message
  })
  try {
    await meterModelUsage({ spaceId, name: agentName, model: modelUsed, startedAt, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, costMicros: cost })
  } catch (err) {
    logger.error('agents.chat.meter_failed', { err, spaceId, agentName })
  }
  const message = toDto(stored)
  opts.onEvent?.({ type: 'done', message })
  return { ok: true, userMessage, message }
}
