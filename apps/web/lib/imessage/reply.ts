/**
 * Answering the phone when a run ends.
 *
 * A text starts a run through the ordinary mailbox (`summonAgent`, channel
 * `imessage`), and the event it left carries the reply address under
 * `payload.imessage`. When the runner finishes ANY run it calls
 * `answerChannels`, which finds such events among the ones this run consumed
 * and texts the run's answer back from the line it arrived on. One sender:
 * the inbound door never replies with the run's text itself, so a run that
 * outlives the webhook's budget and one that finishes inside it are answered
 * the same way, exactly once.
 */
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import type { RunInput } from '@/lib/agents/runs'
import { sendText, typing } from './sendblue'
import { replyText } from './shared/reply'

/** What the inbound door stores on the mailbox event, under `payload.imessage`. */
export interface ImessageReplyAddress {
  line: string
  phone: string
  /** Where the run landed, named in the reply when the texter had a choice. */
  spaceName: string
  ambiguous: boolean
}

export function replyAddressOf(payload: unknown): ImessageReplyAddress | null {
  const p = (payload ?? {}) as Record<string, unknown>
  if (p.channel !== 'imessage') return null
  const a = (p.imessage ?? null) as Partial<ImessageReplyAddress> | null
  if (!a || typeof a.line !== 'string' || typeof a.phone !== 'string') return null
  return { line: a.line, phone: a.phone, spaceName: typeof a.spaceName === 'string' ? a.spaceName : '', ambiguous: a.ambiguous === true }
}

/** Text the run's answer to every phone whose message this run consumed. */
export async function replyForRun(runId: string): Promise<number> {
  const events = await prisma.agentEvent.findMany({
    where: { consumedBy: runId, kind: 'reply', payload: { path: ['channel'], equals: 'imessage' } },
    select: { payload: true },
  })
  if (events.length === 0) return 0
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: { status: true, summary: true, errorMessage: true, input: true },
  })
  if (!run || run.status === 'running') return 0
  const writes = ((run.input as RunInput | null)?.writes ?? []).filter((w) => typeof w === 'string')

  const seen = new Set<string>()
  let sent = 0
  for (const e of events) {
    const to = replyAddressOf(e.payload)
    if (!to) continue
    const key = `${to.line}→${to.phone}`
    if (seen.has(key)) continue
    seen.add(key)
    const content = replyText({
      status: run.status === 'succeeded' ? 'succeeded' : 'failed',
      summary: run.summary,
      error: run.errorMessage,
      writes,
      space: { name: to.spaceName, ambiguous: to.ambiguous },
    })
    await typing({ from: to.line, to: to.phone, stop: true }).catch(() => undefined)
    const r = await sendText({ from: to.line, to: to.phone, content })
    if (r.ok) sent += 1
    else logger.warn('imessage.reply.not_sent', { runId, line: to.line })
  }
  return sent
}
