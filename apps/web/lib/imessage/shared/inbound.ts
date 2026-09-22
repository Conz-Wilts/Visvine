/**
 * What Sendblue posts, read into the one shape the inbound door works with.
 *
 * Pure. The account has ONE webhook for every line, so the payload's
 * `sendblue_number` (the line that received the text) is what routes it to a
 * space, and `from_number` is the sender's claim of who they are — matched
 * against linked phones, never trusted on its own.
 */
import { z } from 'zod'
import { isE164 } from './phone'

export const inboundPayloadSchema = z.object({
  message_handle: z.string().min(1).max(200),
  from_number: z.string().min(3).max(32),
  sendblue_number: z.string().min(3).max(32),
  content: z.string().max(20_000).nullish(),
  is_outbound: z.boolean().optional(),
  media_url: z.string().max(2_000).nullish(),
  group_id: z.string().max(200).nullish(),
  status: z.string().max(40).optional(),
  date_sent: z.string().max(64).optional(),
})

export type InboundPayload = z.infer<typeof inboundPayloadSchema>

export interface InboundText {
  handle: string
  from: string
  line: string
  text: string
}

export type InboundRead =
  | { kind: 'text'; message: InboundText }
  /** Our own outbound echoed back, a delivery status, or a group message — nothing to do. */
  | { kind: 'ignore'; reason: 'outbound' | 'group' | 'status' | 'bad_number' }
  /** Something arrived that is not text: an audio message, an image, a sticker. */
  | { kind: 'not_text'; from: string; line: string; handle: string }

/**
 * Sendblue posts to one URL for a sent message's status changes AND for a
 * received message; only a received, inbound, direct, textual one is work.
 */
export function readInbound(payload: InboundPayload): InboundRead {
  if (payload.is_outbound) return { kind: 'ignore', reason: 'outbound' }
  if (payload.group_id) return { kind: 'ignore', reason: 'group' }
  const status = (payload.status ?? '').toUpperCase()
  if (status && status !== 'RECEIVED' && status !== 'DELIVERED' && status !== 'SENT') return { kind: 'ignore', reason: 'status' }
  if (!isE164(payload.from_number) || !isE164(payload.sendblue_number)) return { kind: 'ignore', reason: 'bad_number' }
  const text = (payload.content ?? '').replace(/\r\n/g, '\n').trim()
  if (!text) return { kind: 'not_text', from: payload.from_number, line: payload.sendblue_number, handle: payload.message_handle }
  return { kind: 'text', message: { handle: payload.message_handle, from: payload.from_number, line: payload.sendblue_number, text } }
}

/** How long a seen `message_handle` is remembered, so a provider retry is never a second run. */
export const IMESSAGE_INBOUND_KEEP_DAYS = 7
