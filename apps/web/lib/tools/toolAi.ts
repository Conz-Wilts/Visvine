/**
 * `ai.complete` and `ai.decide` — a Tool asking the space's AI.
 *
 * `complete` is one answer from the SPACE's model, on the space's key, under
 * the key's monthly cap and metered under the Tool's name
 * (`tool:<name>`) beside the agents' spend. `decide` is the platform's judge
 * over the Tool's own questions, on the space's judge allowance — the same
 * door an agent's `decide` uses. Neither writes, grants or gates anything;
 * what a Tool does with the answer goes through the bridge's other gates, and
 * a Tool that declares either writes under the AI-assisted origin that Freeze
 * for AI refuses (lib/tools/bridge.ts).
 */
import { resolveAgentChatConfig } from '@/lib/agents/providers'
import { costMicros, preRunStop } from '@/lib/agents/budget'
import { ledgerSpendForMonth, meterModelUsage } from '@/lib/agents/runs'
import { chatWithTools, ModelError, type AgentMessage } from '@/lib/notes/ai'
import { decideMany, judgeConfigured, SPACE_ITEMS_PER_TOKEN, takeSpaceJudgeAllowance } from '@/lib/judge/client'
import { askedQuestion, parseAsked, ASKED_ITEM_CHARS } from '@/lib/judge/shared/questions'
import { choiceOf, noulOf, scoreOf } from '@/lib/judge/shared/types'
import { logger } from '@/lib/logger'
import type { BridgeErrorCode, DecideAnswer } from './protocol'

type Failure = { ok: false; code: BridgeErrorCode; message: string }

/** What a Tool's spend is recorded under, beside the agents'. */
function toolMeterName(name: string): string {
  return `tool:${name}`
}

export async function toolComplete(input: {
  spaceId: string
  toolName: string
  messages: AgentMessage[]
  maxTokens: number
}): Promise<{ ok: true; text: string } | Failure> {
  const resolved = await resolveAgentChatConfig(input.spaceId, null)
  if (!resolved.ok) return { ok: false, code: 'degraded', message: resolved.message }
  const { config, ref } = resolved
  const now = new Date()
  const keySpent = resolved.keyBudgetCents === null ? null : await ledgerSpendForMonth(input.spaceId, ref.provider.id, now)
  const cap = preRunStop({
    spentThisMonthMicros: null,
    monthlyCapCents: null,
    pricing: ref.pricing,
    keySpentThisMonthMicros: keySpent,
    keyCapCents: resolved.keyBudgetCents,
  })
  if (cap) return { ok: false, code: 'rate_limited', message: `The monthly budget on the ${ref.provider.label} model is reached.` }

  let text = ''
  let usage = { promptTokens: 0, completionTokens: 0 }
  try {
    const reply = await chatWithTools(input.messages, [], {
      config,
      maxTokens: input.maxTokens,
      signal: AbortSignal.timeout(60_000),
    })
    text = reply.content ?? ''
    usage = reply.usage ?? usage
  } catch (err) {
    if (err instanceof ModelError) {
      return { ok: false, code: err.kind === 'quota' ? 'rate_limited' : 'internal', message: 'The space’s model did not answer.' }
    }
    if (err instanceof Error && err.name === 'TimeoutError') return { ok: false, code: 'timeout', message: 'The space’s model took too long.' }
    throw err
  } finally {
    void meterModelUsage({
      spaceId: input.spaceId,
      name: toolMeterName(input.toolName),
      model: `${ref.provider.id}/${ref.modelId}`,
      startedAt: now,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costMicros: costMicros(usage, ref.pricing),
    }).catch((err) => logger.error('tools.ai.meter_failed', { err, spaceId: input.spaceId }))
  }
  return { ok: true, text }
}

export async function toolDecide(input: {
  spaceId: string
  items: string[]
  questions: unknown
}): Promise<{ ok: true; answers: Array<DecideAnswer | null> } | Failure> {
  const asked = parseAsked(input.questions)
  if (typeof asked === 'string') return { ok: false, code: 'invalid', message: asked.replace(/^error: /, '') }
  if (!judgeConfigured()) return { ok: false, code: 'degraded', message: 'There is no judge on this deployment.' }
  for (let spent = 0; spent < input.items.length; spent += SPACE_ITEMS_PER_TOKEN) {
    const allowance = await takeSpaceJudgeAllowance(input.spaceId)
    if (!allowance.ok) return { ok: false, code: 'rate_limited', message: 'This space has used its judge allowance for now.' }
  }
  const questions = Object.fromEntries(asked.map((q) => [q.id, askedQuestion(q)]))
  const answers = await decideMany(
    input.items.map((text) => ({ state: text.slice(0, ASKED_ITEM_CHARS), questions })),
    { deadlineMs: 20_000 },
  )
  return {
    ok: true,
    answers: answers.map((ans) => {
      if (!ans) return null
      const out: DecideAnswer = {}
      for (const q of asked) {
        if (q.type === 'yes_no') {
          const v = noulOf(ans, q.id)
          if (v !== undefined) out[q.id] = { type: 'yes_no', probability: v }
        } else if (q.type === 'choice') {
          const v = choiceOf(ans, q.id)
          if (v) out[q.id] = { type: 'choice', choice: v.choice, confidence: v.confidence }
        } else {
          const v = scoreOf(ans, q.id)
          if (v) out[q.id] = { type: 'scale', option: q.options[Math.round(v.score)] ?? '', score: v.score, confidence: v.confidence }
        }
      }
      return out
    }),
  }
}
