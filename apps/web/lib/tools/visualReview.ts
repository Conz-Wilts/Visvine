/**
 * A Tool's screens judged by eye: a screenshot of each (lib/tools/screenshot.ts)
 * read by a vision model against the rubric in ./shared/visualRubric.ts.
 *
 * On the deployment's own key (`OPENROUTER_API_KEY`), like the judge: this is
 * the platform reviewing a build, not a tenant's model running for them, and
 * it spends a few thousand tokens of a cheap model per screen. `TOOL_REVIEW_MODEL`
 * picks the model. Fails open, like every judge call: no key, `TOOL_REVIEW=off`,
 * a timeout or an unreadable answer is `null`, and the caller carries on as if
 * no review existed. A verdict never gates anything — it is advice an author
 * (or build_tool's fix round) acts on.
 */
import { logger } from '@/lib/logger'
import { combineVerdicts, parseVerdict, reviewPrompt, type ReviewContext, type VisualVerdict } from './shared/visualRubric'

const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_REVIEW_MODEL = 'google/gemini-3.8-flash'
const REVIEW_TIMEOUT_MS = 45_000

export interface ReviewScreen {
  /** Base64 image, as screenshot.ts returns it. */
  imageBase64: string
  mime: 'image/png' | 'image/jpeg'
  screen?: string
}

export function visualReviewAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.OPENROUTER_API_KEY) && env.TOOL_REVIEW !== 'off'
}

export function reviewModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.TOOL_REVIEW_MODEL || DEFAULT_REVIEW_MODEL
}

/** One screen's verdict, or null. */
export async function reviewScreen(ctx: ReviewContext, shot: ReviewScreen, model = reviewModel()): Promise<VisualVerdict | null> {
  if (!visualReviewAvailable()) return null
  try {
    const res = await fetch(OPENROUTER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 6000,
        // Reasoning models spend from the same allowance; keep the thinking short.
        reasoning: { effort: 'low' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: reviewPrompt({ ...ctx, screen: shot.screen ?? ctx.screen }) },
              { type: 'image_url', image_url: { url: `data:${shot.mime};base64,${shot.imageBase64}` } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(REVIEW_TIMEOUT_MS),
    })
    if (!res.ok) {
      logger.warn('tools.visual_review.upstream', { status: res.status, body: (await res.text().catch(() => '')).slice(0, 200) })
      return null
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const verdict = parseVerdict(data.choices?.[0]?.message?.content ?? '')
    if (!verdict) logger.warn('tools.visual_review.unreadable', { model })
    return verdict
  } catch (err) {
    logger.warn('tools.visual_review.failed', { err })
    return null
  }
}

/** Every screen, reviewed in parallel, folded into one verdict for the Tool. */
export async function reviewScreens(ctx: ReviewContext, shots: ReviewScreen[], model = reviewModel()): Promise<{ verdict: VisualVerdict | null; screens: Array<{ screen: string; verdict: VisualVerdict | null }> }> {
  const verdicts = await Promise.all(shots.map((shot) => reviewScreen(ctx, shot, model)))
  return {
    verdict: verdicts.every((v): v is VisualVerdict => v !== null) ? combineVerdicts(verdicts) : null,
    screens: shots.map((shot, i) => ({ screen: shot.screen ?? 'main', verdict: verdicts[i] })),
  }
}
