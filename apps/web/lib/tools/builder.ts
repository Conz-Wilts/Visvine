/**
 * `build_tool` — a whole Tool from one sentence, on the space's own model.
 *
 * The order is the point. A model asked to write a Tool from nothing decides
 * the layout, the states and the look by accident, and a vague request gets a
 * vague Tool. Here it decides only what the Tool is ABOUT — a template's spec:
 * nouns, fields, stages, realistic sample rows — and the template, built and
 * polished by hand, decides how it looks. Then the result is looked at: every
 * screen captured and scored by eye (./visualReview.ts), and while the score is
 * under the bar and the time allows, the model gets the fixes and one chance
 * to rewrite `ui.tsx` — kept only when it compiles, renders and scores higher.
 *
 * Every write goes through the same action handlers an MCP client uses
 * (create_tool, write_tool, check_tool), so the gates are theirs. The model is
 * the space's (`toolComplete`: its key, its budget cap, metered under the
 * Tool's name); with none, the answer is the stand-in an MCP client carries
 * itself — the chosen template, its spec guide and example — the way
 * `run_agent` hands a round back.
 */
import { ActionError, type ActionCaller } from '@/lib/actions/types'
import { appToolHandlers } from '@/lib/actions/defs/apps'
import { renderCatalog } from './catalog'
import { toolComplete } from './toolAi'
import { checkSpec, defaultSpecText, matchTemplates, templateById, TOOL_TEMPLATES, type ToolTemplate } from './templates'
import { passes, type VisualVerdict } from './shared/visualRubric'
import { logger } from '@/lib/logger'

export interface BuildToolArgs {
  space_id: string
  request: string
  name?: string
  /** Overrule the template choice. */
  template?: string
  /** Wall clock for the whole build; polish rounds stop when it runs short. */
  budget_seconds?: number
  /** At most this many rewrite rounds after the first review. */
  polish_rounds?: number
}

export const DEFAULT_BUILD_BUDGET_S = 100
const SPEC_ATTEMPTS = 3
/** A polish round needs about this long: a rewrite, a compile and a second review. */
const POLISH_ROUND_S = 150

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'tool'

/** The first JSON object in a model's answer. */
function jsonIn(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

/** The source in a model's answer: a fenced tsx block, else the whole answer. */
function sourceIn(text: string): string {
  const fenced = /```(?:tsx|typescript|ts|jsx)?\s*\n([\s\S]*?)```/.exec(text)
  return (fenced ? fenced[1] : text).trim()
}

function specPrompt(request: string, candidates: ToolTemplate[], existing: string[]): string {
  return [
    'You are the product designer for an internal-tools builder. A person on a team asked for a Tool in one line — often vague. Your job is to decide what a great version of it is FOR THIS TEAM and describe it as a spec for one of the finished templates below. The template decides the layout and looks; you decide what it is about.',
    '',
    `The request: "${request}"`,
    '',
    'Rules:',
    '- A vague request still gets a complete, opinionated spec: the fields, stages and options a real team doing this would want. Never ask questions.',
    '- Sample rows are the first thing the person sees: realistic, specific, varied (real-sounding people and company names, plausible amounts, dates spread around today), covering every option. Never "Item 1", "Test", lorem ipsum.',
    '- Labels are one to three words. Options are in the order work flows through them, each with a fitting hue (green for done/good, red for lost/blocked, gray for not started).',
    '- title: 1–3 words, the thing it is ("Deal Pipeline", "Offsite Poll"). description: one plain sentence. name: lower-case-with-hyphens.',
    existing.length ? `- These names are taken in the space: ${existing.join(', ')}.` : '',
    '',
    'Templates, best match first:',
    ...candidates.flatMap((t) => [
      '',
      `### ${t.id} — ${t.title}`,
      t.summary,
      '',
      'How to write its spec:',
      t.specGuide,
      '',
      'Its example spec (the SHAPE to follow — write your own content):',
      '```',
      defaultSpecText(t.id),
      '```',
    ]),
    '',
    'Answer with one JSON object and nothing else:',
    '{"template": "<id>", "name": "<name>", "title": "<Title>", "description": "<one sentence>", "spec": { … }}',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

function polishPrompt(request: string, source: string, verdict: VisualVerdict): string {
  return [
    'You are improving the interface of an internal Tool. It is React (TSX) compiled in a sandbox; only `react` and `@visvine/tool-kit` may be imported. The kit is below — use its blocks rather than raw elements, its colours rather than any hex or Tailwind palette class.',
    '',
    `The person asked for: "${request}"`,
    '',
    `A designer scored the current screens ${verdict.score}/10 and asked for these fixes:`,
    ...verdict.fixes.map((f) => `- ${f}`),
    '',
    'Rewrite ui.tsx to make those fixes. Keep the SPEC block, the collection names, the band action ids and section ids exactly as they are — the Tool\'s data and surfaces depend on them. Change only what the fixes need; do not strip features.',
    '',
    'The current ui.tsx:',
    '```tsx',
    source,
    '```',
    '',
    'The kit:',
    renderCatalog(),
    '',
    'Answer with the complete new ui.tsx in one ```tsx block and nothing else.',
  ].join('\n')
}

interface Step {
  step: string
  ok: boolean
  detail?: string
}

export async function buildTool(ctx: ActionCaller, args: BuildToolArgs) {
  const started = Date.now()
  const budgetMs = Math.min(600, Math.max(30, args.budget_seconds ?? DEFAULT_BUILD_BUDGET_S)) * 1000
  const left = () => budgetMs - (Date.now() - started)
  const steps: Step[] = []

  const ranked = matchTemplates(args.request)
  const forced = args.template ? templateById(args.template) : null
  if (args.template && !forced) throw new ActionError(400, `No template "${args.template}" — pick one of ${TOOL_TEMPLATES.map((t) => t.id).join(', ')}.`)
  const candidates = forced ? [forced] : ranked.slice(0, 3).map((m) => templateById(m.id)!)

  const listed = await appToolHandlers.listTools(ctx, { space_id: args.space_id })
  const taken = new Set(listed.authored.map((t) => t.name))

  // ── the spec ──
  const meter = args.name ? slug(args.name) : 'builder'
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: specPrompt(args.request, candidates, [...taken]) },
  ]
  let chosen: { template: ToolTemplate; spec: Record<string, unknown>; name: string; title: string; description: string } | null = null
  for (let attempt = 1; attempt <= SPEC_ATTEMPTS && !chosen; attempt++) {
    const reply = await toolComplete({ spaceId: args.space_id, toolName: meter, messages: messages as never, maxTokens: 8000, timeoutMs: 120_000 })
    if (!reply.ok) {
      if (reply.code === 'degraded') return standIn(args.request, candidates[0], reply.message)
      throw new ActionError(reply.code === 'rate_limited' ? 429 : 502, reply.message)
    }
    const answer = jsonIn(reply.text)
    const template = templateById(String(answer?.template ?? '')) ?? candidates[0]
    const checked = answer?.spec ? checkSpec(template, answer.spec) : { ok: false as const, problems: ['no `spec` in the answer'] }
    if (answer && checked.ok) {
      const title = String(answer.title ?? '').trim().slice(0, 40) || template.title
      chosen = {
        template,
        spec: checked.spec,
        title,
        description: String(answer.description ?? '').trim().slice(0, 240) || template.summary,
        name: slug(args.name ?? String(answer.name ?? title)),
      }
      steps.push({ step: 'spec', ok: true, detail: `${template.id}, attempt ${attempt}` })
    } else {
      const problems = checked.ok ? ['the answer was not one JSON object'] : checked.problems
      steps.push({ step: 'spec', ok: false, detail: problems.join('; ') })
      messages.push({ role: 'assistant', content: reply.text }, { role: 'user', content: `That spec does not fit the ${template.id} template:\n- ${problems.join('\n- ')}\nAnswer again with the whole corrected JSON object.` })
    }
  }
  if (!chosen) throw new ActionError(422, `The model could not write a spec that fits: ${steps.at(-1)?.detail ?? 'no answer'}`)

  // ── the Tool ──
  let name = chosen.name
  for (let n = 2; taken.has(name); n++) name = `${chosen.name}-${n}`
  const created = await appToolHandlers.createTool(ctx, {
    space_id: args.space_id,
    name,
    title: chosen.title,
    description: chosen.description,
    template: chosen.template.id,
    spec: chosen.spec,
    plan: `## Design\n\n**Asked for:** ${args.request}\n\n**Built from:** the ${chosen.template.title} template — ${chosen.template.summary}`,
  })
  steps.push({ step: 'create', ok: created.build.ok, detail: created.build.ok ? undefined : JSON.stringify(created.build).slice(0, 300) })

  // ── look, then polish while it pays ──
  let review = await appToolHandlers.reviewTool(ctx, { space_id: args.space_id, name, request: args.request })
  let best = review.available ? review.verdict : null
  steps.push({ step: 'review', ok: Boolean(best), detail: best ? `${best.score}/10` : review.available ? 'no verdict' : review.reason })

  const rounds = Math.max(0, Math.min(3, args.polish_rounds ?? 2))
  for (let round = 1; round <= rounds && best && !passes(best) && left() > POLISH_ROUND_S * 1000; round++) {
    const current = await appToolHandlers.readTool(ctx, { space_id: args.space_id, name, file: 'ui.tsx' })
    const source = String((current.files as Record<string, string | null>)['ui.tsx'] ?? '')
    const reply = await toolComplete({ spaceId: args.space_id, toolName: name, messages: [{ role: 'user', content: polishPrompt(args.request, source, best) }], maxTokens: 12000, timeoutMs: 300_000 })
    if (!reply.ok) {
      steps.push({ step: `polish ${round}`, ok: false, detail: reply.message })
      break
    }
    const next = sourceIn(reply.text)
    const written = await appToolHandlers.writeTool(ctx, { space_id: args.space_id, name, file: 'ui.tsx', content: next })
    if (!written.build.ok) {
      await appToolHandlers.writeTool(ctx, { space_id: args.space_id, name, file: 'ui.tsx', content: source })
      steps.push({ step: `polish ${round}`, ok: false, detail: 'did not compile — kept the previous version' })
      continue
    }
    review = await appToolHandlers.reviewTool(ctx, { space_id: args.space_id, name, request: args.request })
    const verdict = review.available ? review.verdict : null
    const broke = review.available && (review.console_errors?.length ?? 0) > 0
    if (!verdict || broke || verdict.score <= best.score) {
      await appToolHandlers.writeTool(ctx, { space_id: args.space_id, name, file: 'ui.tsx', content: source })
      steps.push({ step: `polish ${round}`, ok: false, detail: broke ? 'threw at runtime — kept the previous version' : `scored ${verdict?.score ?? '?'} — kept the previous version` })
      continue
    }
    steps.push({ step: `polish ${round}`, ok: true, detail: `${best.score} → ${verdict.score}` })
    best = verdict
  }

  logger.info('tools.build_tool.done', { spaceId: args.space_id, name, template: chosen.template.id, score: best?.score ?? null, ms: Date.now() - started })
  return {
    name,
    title: chosen.title,
    template: chosen.template.id,
    preview_url: created.preview_url,
    score: best?.score ?? null,
    passes: best ? passes(best) : null,
    review: best ? { scores: best.scores, fixes: best.fixes, summary: best.summary } : null,
    steps,
    seconds: Math.round((Date.now() - started) / 1000),
    next: [
      'Open the preview link and show the person. It opens with sample rows; `useSampleRows` puts them in once per install.',
      best && !passes(best) ? 'The review still has fixes: read_tool ui.tsx, make them with write_tool, then check_tool { review: true }.' : 'Publish with publish_tool when the person is happy.',
    ],
  }
}

/** No model in the space: the round handed back for the caller's own model to carry. */
function standIn(request: string, template: ToolTemplate, reason: string) {
  return {
    ran: false,
    reason,
    stand_in: {
      template: template.id,
      spec_guide: template.specGuide,
      example: defaultSpecText(template.id),
      instructions: `Write the spec yourself (a vague request still gets a full, opinionated one with realistic sample rows), then call create_tool { template: "${template.id}", spec, name, title, description }. Then check_tool { review: true, request: ${JSON.stringify(request)} }.`,
    },
  }
}
