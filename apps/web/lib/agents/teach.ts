/**
 * Turning a demonstration into a skill.
 *
 * A human takes control of an agent's machine and does the task once (§12). The
 * machine records what it can honestly record — what was clicked, which named
 * keys were pressed, what was on screen at each step, which files changed — and
 * never what was typed, because a takeover exists so a password can be entered
 * where the model cannot see it.
 *
 * From that trace the AGENT writes the skill, in its own words. That is the
 * whole point: a replay of coordinates would break the first time a button
 * moved, and what we want kept is the intent. The draft is a note, so reviewing
 * it is reading a diff and improving it is an edit.
 *
 * What is written is a draft or a pending submission, never an approved skill:
 * approving one is agreeing to the reach it claims, and that is an admin's
 * decision (`statusOnPublish`).
 */
import { chatWithTools, extractJsonObject, type ChatConfig } from '@/lib/notes/ai'
import { logger } from '@/lib/logger'
import { skillIndexPath, skillStepsPath, slugify, type SkillStatus } from '@/lib/agents/shared/skills'

/** One step of a demonstration, as the machine recorded it. */
export interface TraceStep {
  at: string
  kind: string
  where: string
  x?: number
  y?: number
  key?: string
  typedChars?: number
}

export interface Demonstration {
  agent: string
  by: string
  heldMs: number
  steps: readonly TraceStep[]
  touched: readonly string[]
  imageDigest?: string | null
  runId?: string | null
}

export interface SkillDraft {
  slug: string
  title: string
  indexPath: string
  stepsPath: string
  index: string
  steps: string
}

/** What the model is shown. Never the frames, and never anything typed. */
export function describeTrace(demo: Demonstration): string {
  const lines = demo.steps.map((step, i) => {
    const where = step.where ? ` on "${step.where}"` : ''
    if (step.kind === 'click') return `${i + 1}. clicked at (${step.x}, ${step.y})${where}`
    if (step.kind === 'key') return `${i + 1}. pressed ${step.key}${where}`
    if (step.kind === 'type') return `${i + 1}. typed ${step.typedChars ?? 0} characters${where}`
    return `${i + 1}. ${step.kind}${where}`
  })
  const touched = demo.touched.length ? `\nFiles changed:\n${demo.touched.map((f) => `- ${f}`).join('\n')}` : ''
  return `${lines.join('\n')}${touched}`
}

const SYSTEM = [
  'You are writing down a task a person just demonstrated on your machine, so you can do it yourself next time.',
  'You are given a coarse trace: click coordinates, key names, the title of whatever was on screen at each step,',
  'and which files changed. You are NOT given what was typed — passwords are entered this way on purpose.',
  '',
  'Write the procedure in terms of what was being ACHIEVED, not the coordinates. Coordinates will be wrong next',
  'time; the intent will not. Where the trace is ambiguous, say plainly what you are unsure of rather than',
  'inventing a step. Where the person typed something you cannot see, describe what belongs there.',
  '',
  'Answer as JSON only: {"title": string, "description": string, "keywords": string[], "steps": string,',
  '"uncertain": string[]}. `steps` is markdown prose, numbered. `keywords` are short phrases a request about this',
  'task would contain. `uncertain` is what you could not tell from the trace.',
].join('\n')

interface DraftJson {
  title: string
  description: string
  keywords: string[]
  steps: string
  uncertain: string[]
}

/** Read the model's answer without trusting it: anything missing degrades, nothing throws. */
export function coerceDraft(raw: string): DraftJson | null {
  let parsed: unknown
  try {
    parsed = extractJsonObject(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const value = parsed as Record<string, unknown>
  const title = typeof value.title === 'string' ? value.title.trim() : ''
  if (!title) return null
  return {
    title: title.slice(0, 120),
    description: typeof value.description === 'string' ? value.description.trim().slice(0, 400) : '',
    keywords: Array.isArray(value.keywords)
      ? value.keywords.filter((k): k is string => typeof k === 'string').map((k) => k.trim().slice(0, 60)).slice(0, 12)
      : [],
    steps: typeof value.steps === 'string' ? value.steps.trim() : '',
    uncertain: Array.isArray(value.uncertain)
      ? value.uncertain.filter((u): u is string => typeof u === 'string').slice(0, 10)
      : [],
  }
}

function yamlList(values: readonly string[]): string {
  return values.length ? `\n${values.map((v) => `  - ${JSON.stringify(v)}`).join('\n')}` : ' []'
}

/** The two notes a skill is, ready to write. */
export function renderSkill(demo: Demonstration, draft: DraftJson, status: SkillStatus): SkillDraft {
  const slug = slugify(draft.title)
  const front = [
    '---',
    'type: skill',
    `title: ${JSON.stringify(draft.title)}`,
    `description: ${JSON.stringify(draft.description)}`,
    `status: ${status}`,
    `keywords:${yamlList(draft.keywords)}`,
    // Declared reach starts empty: what a skill needs is learned by running it,
    // and an approver should be shown a claim the agent made, not one we guessed.
    'hosts: []',
    'actions: []',
    `taught_by: ${JSON.stringify(demo.by)}`,
    demo.runId ? `taught_in_run: ${JSON.stringify(demo.runId)}` : null,
    demo.imageDigest ? `image_digest: ${JSON.stringify(demo.imageDigest)}` : null,
    '---',
  ]
    .filter(Boolean)
    .join('\n')

  const uncertain = draft.uncertain.length
    ? `\n\n## What I am not sure about\n\n${draft.uncertain.map((u) => `- ${u}`).join('\n')}`
    : ''

  const index = `${front}\n\n${draft.description || draft.title}\n\nDemonstrated by ${demo.by} in ${Math.round(
    demo.heldMs / 1000,
  )}s, ${demo.steps.length} step${demo.steps.length === 1 ? '' : 's'}. The procedure is in \`steps.md\`.${uncertain}\n`

  const steps = `# ${draft.title}\n\n${draft.steps || 'The demonstration was too short to describe.'}\n`

  return {
    slug,
    title: draft.title,
    indexPath: skillIndexPath(demo.agent, slug),
    stepsPath: skillStepsPath(demo.agent, slug),
    index,
    steps,
  }
}

/**
 * Ask the agent's own model to write the skill. The model is the space's
 * (`lib/agents/providers.ts`), so teaching costs the space's key like any other
 * run — the platform never spends on this.
 */
export async function draftSkill(
  config: ChatConfig,
  demo: Demonstration,
  status: SkillStatus,
): Promise<SkillDraft | null> {
  const trace = describeTrace(demo)
  if (!trace.trim()) return null

  const answer = await chatWithTools(
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Here is what I did on your machine:\n\n${trace}` },
    ],
    [],
    { config },
  )
  const draft = coerceDraft(answer.content ?? '')
  if (!draft) {
    logger.warn('agents.teach.unreadable_draft', { agent: demo.agent, chars: (answer.content ?? '').length })
    return null
  }
  return renderSkill(demo, draft, status)
}
