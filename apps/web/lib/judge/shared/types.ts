// The judge's wire types, pure. A judge reads a `state` and answers typed
// questions about it, each with a probability — it never writes text. Three
// question shapes (OpenRouter's Decisions API, served by TypeSafe's Jev):
//
//   noul    is this statement true of the state?      → one number, 0..1
//   choice  which of these options?                   → option + probabilities
//   score   where on this ordered rubric?             → position + probabilities
//
// An answer is untrusted like any model output: `coerceAnswers` keeps only
// answers of the asked shape with numbers in range, so a caller reading
// `answers.x` either gets a usable value or undefined.

type JudgeText = string

export interface NoulQuestion {
  type: 'noul'
  instructions: JudgeText
  criteria?: { true: JudgeText; false: JudgeText }
}

export interface ChoiceQuestion {
  type: 'choice'
  instructions: JudgeText
  /** option id → what choosing it means. */
  criteria: Record<string, JudgeText>
}

export interface ScoreQuestion {
  type: 'score'
  instructions: JudgeText
  /** Ordered levels, lowest first; the score is a position on this list. */
  criteria: JudgeText[]
}

type JudgeQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion
export type JudgeQuestions = Record<string, JudgeQuestion>
export type JudgeState = string | Record<string, unknown> | unknown[]

interface NoulAnswer {
  type: 'noul'
  noul: number
}
export interface ChoiceAnswer {
  type: 'choice'
  choice: string
  probabilities: Record<string, number>
  confidence: number
}
export interface ScoreAnswer {
  type: 'score'
  score: number
  confidence: number
}
type JudgeAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer
export type JudgeAnswers = Record<string, JudgeAnswer>

const unit = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null

/** Keep the answers that match what was asked; drop everything else. */
export function coerceAnswers(raw: unknown, asked: JudgeQuestions): JudgeAnswers {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const out: JudgeAnswers = {}
  for (const [id, q] of Object.entries(asked)) {
    const a = r[id]
    if (typeof a !== 'object' || a === null) continue
    const o = a as Record<string, unknown>
    if (o.type !== q.type) continue
    if (q.type === 'noul') {
      const noul = unit(o.noul)
      if (noul !== null) out[id] = { type: 'noul', noul }
    } else if (q.type === 'choice') {
      if (typeof o.choice !== 'string' || !(o.choice in q.criteria)) continue
      const probabilities: Record<string, number> = {}
      const p = typeof o.probabilities === 'object' && o.probabilities !== null ? (o.probabilities as Record<string, unknown>) : {}
      for (const key of Object.keys(q.criteria)) probabilities[key] = unit(p[key]) ?? 0
      out[id] = { type: 'choice', choice: o.choice, probabilities, confidence: unit(o.confidence) ?? 0 }
    } else {
      const score = typeof o.score === 'number' && Number.isFinite(o.score) ? o.score : null
      if (score === null || score < 0 || score > q.criteria.length - 1) continue
      out[id] = { type: 'score', score, confidence: unit(o.confidence) ?? 0 }
    }
  }
  return out
}

/** A noul's value, or undefined when the judge gave no usable answer. */
export function noulOf(answers: JudgeAnswers | null | undefined, id: string): number | undefined {
  const a = answers?.[id]
  return a?.type === 'noul' ? a.noul : undefined
}

export function choiceOf(answers: JudgeAnswers | null | undefined, id: string): ChoiceAnswer | undefined {
  const a = answers?.[id]
  return a?.type === 'choice' ? a : undefined
}

export function scoreOf(answers: JudgeAnswers | null | undefined, id: string): ScoreAnswer | undefined {
  const a = answers?.[id]
  return a?.type === 'score' ? a : undefined
}
