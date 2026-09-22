/**
 * A text arrives (docs/imessage.md § A message).
 *
 * The one webhook for the whole account lands here with the line that received
 * it and the phone that sent it. In order: is it a message at all; have we
 * seen it; which space's line; who is texting (a verified link, or a code that
 * makes one); may they, here; where in the family; then the ordinary summons
 * of the space's `phone` agent, as them. The reply is the run's answer, sent
 * by `reply.ts` when the run ends — this module answers only the things that
 * never start a run: linking, "which space?", and refusals.
 *
 * Every refusal to an unknown phone is rate-limited to one an hour, because a
 * line answering strangers is a line anyone can spend.
 */
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { takeToken } from '@/lib/rateLimit'
import { resolveContext, principalOf } from '@/lib/notes/resolve'
import { summonAgent } from '@/lib/agents/summon'
import { dispatchWithin } from '@/lib/agents/dispatch'
import { isActiveMemberOf } from '@/lib/spaces/membership'
import { imessageOn, lineByNumber, type LineRow } from './lines'
import { userForPhone, verifyLinkCode } from './links'
import { shareProfileWith } from './profile'
import { sendText, typing } from './sendblue'
import { candidatesFor, judgeTarget, rememberThread, threadTarget } from './targets'
import { PHONE_AGENT } from './shared/brief'
import { IMESSAGE_INBOUND_KEEP_DAYS, readInbound, type InboundPayload, type InboundText } from './shared/inbound'
import { codeInText } from './shared/link'
import { askWhich, pickTarget } from './shared/targets'
import {
  BUSY_REPLY,
  LINKED_REPLY,
  NOT_A_MEMBER_REPLY,
  NOT_LINKED_REPLY,
  NO_AGENT_REPLY,
  OFF_REPLY,
  SWITCHED_REPLY,
  TEXT_ONLY_REPLY,
} from './shared/reply'
import type { ImessageReplyAddress } from './reply'

/**
 * How long the webhook waits for the run before answering Sendblue. Sendblue
 * gives an endpoint 45 s; the run keeps going after this and `reply.ts` sends
 * the answer when it ends, so this only decides how long the instance that
 * took the webhook stays with the run — which in `inline` dispatch (dev) is
 * what keeps the run alive at all.
 */
export const IMESSAGE_AWAIT_MS = 35_000

/** Texts from one phone: a person types slower than this; a loop does not. */
const PER_PHONE = { capacity: 12, refillPerSec: 0.2 }
/** A stranger hears "not linked" once an hour, and nothing else. */
const STRANGER = { capacity: 1, refillPerSec: 1 / 3600 }

export type InboundOutcome =
  | { kind: 'ignored'; reason: string }
  | { kind: 'deduped' }
  | { kind: 'linked'; userId: string }
  | { kind: 'refused'; reason: string; replied: boolean }
  | { kind: 'asked'; candidates: string[] }
  | { kind: 'switched'; spaceId: string }
  | { kind: 'run'; spaceId: string; runId: string | null; settled: boolean }

async function firstSeen(handle: string, now: Date): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ handle: string }[]>`
    INSERT INTO "imessage_inbound" ("handle", "received_at") VALUES (${handle}, ${now})
    ON CONFLICT DO NOTHING RETURNING "handle"`
  if (rows.length && Math.random() < 0.02) {
    const cutoff = new Date(now.getTime() - IMESSAGE_INBOUND_KEEP_DAYS * 86_400_000)
    await prisma.imessageInbound.deleteMany({ where: { receivedAt: { lt: cutoff } } }).catch(() => undefined)
  }
  return rows.length > 0
}

async function replyOnce(line: LineRow, phone: string, content: string, bucket: string, cfg = STRANGER): Promise<boolean> {
  const allowed = await takeToken(`imessage:${bucket}:${line.id}:${phone}`, cfg)
  if (!allowed.ok) return false
  await sendText({ from: line.number, to: phone, content })
  return true
}

export async function handleInbound(payload: InboundPayload, now = new Date()): Promise<InboundOutcome> {
  const read = readInbound(payload)
  if (read.kind === 'ignore') return { kind: 'ignored', reason: read.reason }

  const handle = read.kind === 'text' ? read.message.handle : read.handle
  const from = read.kind === 'text' ? read.message.from : read.from
  const lineNumber = read.kind === 'text' ? read.message.line : read.line

  if (!(await firstSeen(handle, now))) return { kind: 'deduped' }

  const line = await lineByNumber(lineNumber)
  if (!line) {
    logger.warn('imessage.inbound.unknown_line', { line: lineNumber })
    return { kind: 'ignored', reason: 'unknown_line' }
  }
  const pace = await takeToken(`imessage:in:${from}`, PER_PHONE)
  if (!pace.ok) return { kind: 'ignored', reason: 'rate' }

  // Who is texting. A phone with no verified link may be redeeming a code;
  // anything else from it gets one line, once an hour.
  const user = await userForPhone(from)
  if (!user) {
    const code = read.kind === 'text' ? codeInText(read.message.text) : null
    if (code) {
      const linked = await verifyLinkCode(from, code, now)
      if (linked) {
        await sendText({ from: line.number, to: from, content: LINKED_REPLY(linked.name) })
        await shareProfileWith(line, from).catch(() => undefined)
        return { kind: 'linked', userId: linked.userId }
      }
    }
    const replied = await replyOnce(line, from, NOT_LINKED_REPLY, 'stranger')
    return { kind: 'refused', reason: 'not_linked', replied }
  }

  if (read.kind === 'not_text') {
    await sendText({ from: line.number, to: from, content: TEXT_ONLY_REPLY })
    return { kind: 'refused', reason: 'not_text', replied: true }
  }
  const message: InboundText = read.message

  const space = await prisma.space.findUnique({ where: { id: line.spaceId }, select: { id: true, name: true, featureConfig: true } })
  if (!space) return { kind: 'ignored', reason: 'unknown_space' }
  if (line.status !== 'active' || !imessageOn(space.featureConfig)) {
    const replied = await replyOnce(line, from, OFF_REPLY, 'off')
    return { kind: 'refused', reason: 'off', replied }
  }

  // Where in the family. The texter's own standing decides the set.
  const candidates = await candidatesFor(space.id, user.userId)
  if (candidates.length === 0) {
    const member = await isActiveMemberOf(user.userId, space.id)
    const replied = await replyOnce(line, from, member ? NO_AGENT_REPLY : NOT_A_MEMBER_REPLY, member ? 'no-agent' : 'not-member')
    return { kind: 'refused', reason: member ? 'no_agent' : 'not_a_member', replied }
  }
  const current = await threadTarget(line.id, from)
  let pick = pickTarget(message.text, candidates, current)
  if (pick.kind === 'undecided') {
    const judged = await judgeTarget(message.text, candidates)
    pick = judged ? { kind: 'target', spaceId: judged, switched: false } : { kind: 'ask', candidates: pick.candidates }
  }
  if (pick.kind === 'ask') {
    await sendText({ from: line.number, to: from, content: askWhich(candidates) })
    return { kind: 'asked', candidates: candidates.map((c) => c.spaceId) }
  }
  await rememberThread(line.id, from, pick.spaceId)
  const target = candidates.find((c) => c.spaceId === pick.spaceId)!
  if (pick.switched) {
    await sendText({ from: line.number, to: from, content: SWITCHED_REPLY(target.name) })
    return { kind: 'switched', spaceId: target.spaceId }
  }

  // The summons, as the texter, in the space the text is for. Membership and
  // grants come from the same resolve every route uses.
  const resolved = await resolveContext({ userId: user.userId, name: user.name, email: user.email }, target.spaceId)
  if (resolved instanceof Response) {
    const replied = await replyOnce(line, from, NOT_A_MEMBER_REPLY, 'not-member')
    return { kind: 'refused', reason: 'not_a_member', replied }
  }
  const principal = await principalOf(resolved)
  const address: ImessageReplyAddress = { line: line.number, phone: from, spaceName: target.name, ambiguous: candidates.length > 1 }
  await typing({ from: line.number, to: from, ms: IMESSAGE_AWAIT_MS + 30_000 }).catch(() => undefined)
  const summoned = await summonAgent({
    spaceId: target.spaceId,
    name: PHONE_AGENT,
    principal,
    text: message.text,
    channel: 'imessage',
    externalId: `sendblue:${message.handle}`,
    payload: { imessage: address },
    gate: 'member',
  })
  if (!summoned.ok) {
    const content = summoned.status === 403 ? NOT_A_MEMBER_REPLY : summoned.status === 404 ? NO_AGENT_REPLY : summoned.message
    await sendText({ from: line.number, to: from, content })
    return { kind: 'refused', reason: `summon_${summoned.status}`, replied: true }
  }
  if (!summoned.runId) {
    await sendText({ from: line.number, to: from, content: summoned.waiting === 'running' ? BUSY_REPLY : NO_AGENT_REPLY })
    return { kind: 'run', spaceId: target.spaceId, runId: null, settled: false }
  }
  // Stay with the run for a while: in inline dispatch this is what carries it;
  // in self dispatch it is already on another instance. Either way the reply
  // is sent when the run ends, by the run-end hook, not here.
  const settled = summoned.dispatch ? (await dispatchWithin(summoned.dispatch, IMESSAGE_AWAIT_MS)) !== null : false
  return { kind: 'run', spaceId: target.spaceId, runId: summoned.runId, settled }
}
