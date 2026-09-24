// A failed run's likely cause, asked of the judge once — and the model a
// brief suits. Both are advice for the person reading the page: nothing is
// retried, switched or gated on them, and no judge means no line.

import { decide } from '@/lib/judge/client'
import { choiceOf } from '@/lib/judge/shared/types'
import { JOB_SHAPE_CONFIDENCE, JOB_SHAPE_QUESTION, RUN_CAUSE_CONFIDENCE, RUN_CAUSE_QUESTION } from '@/lib/judge/shared/questions'
import { causeAdvice, type JobShape, type RunCause } from './shared/advice'

const DIAGNOSE_DEADLINE_MS = 3_000

/** One line for a failed run's page — "Likely cause: … — what to change" — or null. */
export async function diagnoseRun(input: { brief: string; finalText: string | null; error: string; lastResults: string[] }): Promise<string | null> {
  const state = [
    `Brief:\n${input.brief.slice(0, 2_000)}`,
    `Error: ${input.error.slice(0, 600)}`,
    input.finalText ? `The agent's last message:\n${input.finalText.slice(0, 1_500)}` : 'The agent gave no final message.',
    ...input.lastResults.slice(-3).map((r, i) => `Tool result ${i + 1}:\n${r.slice(0, 600)}`),
  ].join('\n\n')
  const answers = await decide(state, { cause: RUN_CAUSE_QUESTION }, { deadlineMs: DIAGNOSE_DEADLINE_MS, patient: true })
  const cause = choiceOf(answers, 'cause')
  if (!cause || cause.confidence < RUN_CAUSE_CONFIDENCE) return null
  return causeAdvice(cause.choice as RunCause)
}

const shapes = new Map<string, JobShape | null>()

/** How much the brief asks of its model, memoised per brief text in this process. Null without a verdict. */
export async function jobShapeOf(brief: string): Promise<JobShape | null> {
  const key = brief.trim().slice(0, 4_000)
  if (!key) return null
  if (shapes.has(key)) return shapes.get(key) ?? null
  const answers = await decide(key, { shape: JOB_SHAPE_QUESTION }, { deadlineMs: 2_500 })
  const shape = choiceOf(answers, 'shape')
  const out = shape && shape.confidence >= JOB_SHAPE_CONFIDENCE ? (shape.choice as JobShape) : null
  if (answers) shapes.set(key, out)
  if (shapes.size > 500) shapes.delete(shapes.keys().next().value!)
  return out
}
