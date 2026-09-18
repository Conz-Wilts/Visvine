// The judged read of a finished run's final message (shared/runCheck.ts holds
// the comparison). One request: what the message claims, and how it says the
// run ended. No verdict returns nothing, and the run is recorded as before.

import { decide } from '@/lib/judge/client'
import { choiceOf, noulOf } from '@/lib/judge/shared/types'
import { RUN_CLAIM_AT, RUN_CLAIM_QUESTIONS, RUN_OUTCOME_CONFIDENCE, RUN_OUTCOME_QUESTION } from '@/lib/judge/shared/questions'
import { unbackedClaims, type RunOutcome, type RunTrace } from './shared/runCheck'

const CHECK_DEADLINE_MS = 3_000

export interface RunCheck {
  unbacked: string[]
  outcome: RunOutcome | null
}

export async function checkRun(finalText: string | null, trace: RunTrace): Promise<RunCheck> {
  if (!finalText?.trim()) return { unbacked: [], outcome: null }
  const answers = await decide(
    finalText.slice(0, 6_000),
    { ...RUN_CLAIM_QUESTIONS, outcome: RUN_OUTCOME_QUESTION },
    { deadlineMs: CHECK_DEADLINE_MS, patient: true },
  )
  const outcome = choiceOf(answers, 'outcome')
  return {
    unbacked: unbackedClaims({ wrote: noulOf(answers, 'wrote'), reached: noulOf(answers, 'reached') }, trace, RUN_CLAIM_AT),
    outcome: outcome && outcome.confidence >= RUN_OUTCOME_CONFIDENCE ? (outcome.choice as RunOutcome) : null,
  }
}
