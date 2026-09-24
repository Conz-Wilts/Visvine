// The judged read of a finished run's final message (shared/runCheck.ts holds
// the comparison). One request: what the message claims, and how it says the
// run ended. No verdict returns nothing, and the run is recorded as before.

import { decide } from '@/lib/judge/client'
import { choiceOf, noulOf } from '@/lib/judge/shared/types'
import { RUN_CLAIM_AT, RUN_CLAIM_QUESTIONS, RUN_OUTCOME_CONFIDENCE, RUN_OUTCOME_QUESTION } from '@/lib/judge/shared/questions'
import { unbackedClaims, type RunOutcome, type RunTrace, type RunVerdict } from './shared/runCheck'

const CHECK_DEADLINE_MS = 3_000

/** Null when the judge gave no verdict — which says nothing about the run. */
export async function checkRun(finalText: string | null, trace: RunTrace): Promise<RunVerdict | null> {
  if (!finalText?.trim()) return null
  const answers = await decide(
    finalText.slice(0, 6_000),
    { ...RUN_CLAIM_QUESTIONS, outcome: RUN_OUTCOME_QUESTION },
    { deadlineMs: CHECK_DEADLINE_MS, patient: true },
  )
  if (!answers) return null
  const outcome = choiceOf(answers, 'outcome')
  return {
    unbacked: unbackedClaims({ wrote: noulOf(answers, 'wrote'), reached: noulOf(answers, 'reached') }, trace, RUN_CLAIM_AT),
    outcome: outcome && outcome.confidence >= RUN_OUTCOME_CONFIDENCE ? (outcome.choice as RunOutcome) : null,
  }
}
