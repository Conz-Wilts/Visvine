/**
 * What goes back to the phone when a run ends. Pure.
 *
 * The run's final text is the reply. Two things are added around it and
 * nothing else: when the texter could have been talking to more than one
 * space, the name of the one this landed in (so "Added it" is never a
 * mystery), and when the run failed, one plain line instead of silence.
 */

/** iMessage takes ~19k; a phone screen does not. */
export const REPLY_CAP = 3_000

export interface ReplyInput {
  status: 'succeeded' | 'failed'
  summary: string | null
  error: string | null
  /** Note paths the run wrote. */
  writes: readonly string[]
  /** Where it ran — named in the reply only when there was a choice. */
  space: { name: string; ambiguous: boolean }
}

/** Markdown the model tends to write, flattened for a text bubble. */
export function plainText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[^\n]*\n?/g, ''))
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,;:!?])/g, '$1$2')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,;:!?])/g, '$1$2')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, label?: string) => label ?? target)
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function replyText(input: ReplyInput): string {
  let body: string
  if (input.status === 'failed') {
    body = input.error ? `Couldn't do that. ${plainText(input.error)}` : "Couldn't do that."
  } else {
    body = input.summary ? plainText(input.summary) : input.writes.length ? 'Done.' : 'Nothing to report.'
  }
  if (body.length > REPLY_CAP) body = `${body.slice(0, REPLY_CAP - 1).trimEnd()}…`
  if (input.space.ambiguous) {
    const where = input.writes.length ? `Saved in ${input.space.name}` : `In ${input.space.name}`
    body = `${body}\n\n— ${where}`
  }
  return body
}

export const NOT_LINKED_REPLY =
  "This number isn't linked to a Visvine account. Link it under Settings → Accounts → Phone, then text the code here."
export const TEXT_ONLY_REPLY = 'Text only — I can’t read audio, images or stickers yet.'
export const NOT_A_MEMBER_REPLY = "You're not a member of this space any more."
export const NO_AGENT_REPLY = 'This space has no phone agent yet. An admin can add one under Console → iMessage.'
export const BUSY_REPLY = 'An agent is already running here — send that again in a minute.'
export const OFF_REPLY = 'iMessage is switched off for this space.'
export const LINKED_REPLY = (name: string) => `Linked. Texts here run as ${name}.`
export const SWITCHED_REPLY = (name: string) => `Now in ${name}.`
