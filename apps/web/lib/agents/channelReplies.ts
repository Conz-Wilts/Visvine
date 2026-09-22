/**
 * When a run ends, the channels its messages came in on hear back.
 *
 * The runner calls this once per finished run, success or failure, after the
 * row is final. Each channel that can carry an answer looks among the events
 * the run consumed for its own reply addresses and sends the run's summary
 * there. Today that is iMessage; email and Slack fill the mailbox and are
 * answered by the agent's ordinary work, as they always were. Best effort,
 * and never the run's failure: the run is recorded whatever happens here.
 */
import { logger } from '@/lib/logger'
import { replyForRun } from '@/lib/imessage/reply'

export async function answerChannels(runId: string): Promise<void> {
  try {
    await replyForRun(runId)
  } catch (err) {
    logger.warn('agents.channel_reply.failed', { runId, err })
  }
}
