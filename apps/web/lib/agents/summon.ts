/**
 * Saying something to an agent and having it act on it NOW.
 *
 * The inline door on a managed agent. The words go through the same delivery
 * every channel uses (`deliverMessage` → the mailbox), and then — when the
 * agent is idle and the sender may run it — the ordinary manual claim takes
 * that mail into a run that starts immediately, as the sender. Nothing about
 * the agent changes: the brief is the brief, the run is audited like any
 * other, and when it ends the thread ends. When the agent is already running
 * the message waits in the mailbox for its next run, which is what "sent" has
 * always meant.
 *
 * One function behind the page's box and the `run_agent` action, so a message
 * that starts a run behaves the same through either door.
 */
import { deliverMessage } from './channels'
import { claimManualRun } from './schedule'
import { canTriggerRun } from './service'
import { clean, MAX_BODY, MAX_SUBJECT, type ChannelKind } from './shared/channels'
import type { DispatchResult } from './dispatch'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'

export type SummonResult =
  | {
      ok: true
      eventId: string
      /** The run the message started, or null when it waits for the next one. */
      runId: string | null
      dispatch: Promise<DispatchResult> | null
      /** Why no run started, when it didn't — shown beside "sent". */
      waiting: 'running' | 'cannot_run' | 'claimed' | null
    }
  | { ok: false; status: number; message: string }

export async function summonAgent(input: {
  spaceId: string
  name: string
  principal: ContextPrincipal
  text: string
  /** Start a run now when possible (default true). False is the old "read on its next run". */
  run?: boolean
  /** Where the words came from. The page's box and `run_agent` are `in_app`; a text is `imessage`. */
  channel?: ChannelKind
  /** The provider's id for the message, so a retried delivery is one message. Defaults to one per call. */
  externalId?: string
  /** Anything the run should carry about where to answer — a reply address the run-end hook reads. */
  payload?: Record<string, unknown>
  /**
   * Who may make this agent run. `brief` (default) is the page's rule — the
   * author, or anyone who can edit the brief (`canTriggerRun`). `member` is
   * for a door whose admin has opened it to every member of the space
   * (iMessage: switching the tool on IS that decision); membership was already
   * checked by the delivery, so nothing further is asked here.
   */
  gate?: 'brief' | 'member'
}): Promise<SummonResult> {
  const { spaceId, name, principal } = input
  const body = clean(input.text, MAX_BODY)
  const run = input.run !== false
  const delivered = await deliverMessage(
    {
      channel: input.channel ?? 'in_app',
      spaceId,
      agentName: name,
      from: { userId: principal.userId, email: principal.email ?? undefined, display: principal.name },
      subject: clean(body, MAX_SUBJECT),
      body,
      // One send is one message; a double-click is deduped by the mailbox.
      externalId: input.externalId ?? `${principal.userId}:${Date.now()}`,
      payload: input.payload,
    },
    // A person is here asking for a run: the agent need not be switched on for
    // unattended runs (the claim below carries the same waiver).
    { allowInactive: run },
  )
  if (!delivered.ok) {
    const status = delivered.reason === 'not_a_member' ? 403 : delivered.reason === 'dropped' ? 409 : 404
    return { ok: false, status, message: delivered.message }
  }
  if (!run) return { ok: true, eventId: delivered.eventId, runId: null, dispatch: null, waiting: null }
  if (input.gate !== 'member' && !(await canTriggerRun(principal, spaceId, name))) {
    return { ok: true, eventId: delivered.eventId, runId: null, dispatch: null, waiting: 'cannot_run' }
  }
  // A person said something to it: attended, as them, whether or not the agent
  // is switched on for unattended runs.
  const claimed = await claimManualRun(spaceId, name, principal.userId, new Date(), { allowInactive: true })
  if (!claimed.ok) {
    return { ok: true, eventId: delivered.eventId, runId: null, dispatch: null, waiting: claimed.code === 'busy' ? 'running' : 'claimed' }
  }
  return { ok: true, eventId: delivered.eventId, runId: claimed.runId, dispatch: claimed.dispatch ?? null, waiting: null }
}
