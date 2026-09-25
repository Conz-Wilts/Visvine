/**
 * The AI review — the deployment's chat model reading a version's code
 * against what it says it is and what it declares. Pure: the prompt, and the
 * answer back to findings (tests/tools-review.test.ts).
 *
 * The model can only ADD a finding, never clear one, and never block: every
 * finding it raises is at most `medium`, so it flags a version for the person
 * who reviews it and decides nothing on its own. Not the judge — the judge is
 * weak at intent (AGENTS.md), and intent is the whole question here.
 */
import type { CheckFile, CheckFinding } from '../../checks/findings'

export const AI_ANALYZER = 'ai@1'

/** How much code the model is shown, all files together. */
const CODE_BUDGET_CHARS = 60_000
const MAX_FINDINGS = 10

export interface AiReviewInput {
  title: string
  description: string
  /** The declared reach, in words (lib/tools/perimeter.ts#describePerimeter). */
  reach: string[]
  /** file → code: `src/ui.tsx`, `src/data.js`, modules. */
  files: Record<string, string>
}

const SYSTEM = [
  'You review a Visvine Tool before it is listed for every space to install.',
  'A Tool is a React interface in a sandboxed frame plus optional server handlers. It reaches the space only through a bridge,',
  'and only what its permissions declare; it has no network of its own.',
  'Compare what the code does with its description and its declared permissions.',
  'List only concrete things they do not account for:',
  '- data sent somewhere the description does not give a reason for (a connector, an agent, an action, the AI);',
  '- data from one place written somewhere more people can read it;',
  '- code that hides what it does: encoded strings, indirection, dynamic code;',
  '- anything that asks a person for a password, a token or a sign-in;',
  '- behaviour that only happens later, for some people, or on some data;',
  '- permissions used for something other than the stated purpose.',
  'Do not list style, performance or ordinary bugs. Do not repeat what the description already says it does.',
  `Answer with JSON only: {"findings":[{"severity":"medium"|"low","file":"src/ui.tsx","line":12,"message":"one sentence"}]}.`,
  `At most ${MAX_FINDINGS} findings; an empty list when the code does what it says and nothing else.`,
].join('\n')

/** The two messages the review sends. */
export function aiReviewMessages(input: AiReviewInput): Array<{ role: 'system' | 'user'; content: string }> {
  let budget = CODE_BUDGET_CHARS
  const blocks: string[] = []
  for (const [file, code] of Object.entries(input.files).sort(([a], [b]) => (a === 'src/ui.tsx' ? -1 : b === 'src/ui.tsx' ? 1 : a.localeCompare(b)))) {
    if (budget <= 0) {
      blocks.push(`--- ${file} (not shown: over the review budget)`)
      continue
    }
    const numbered = code
      .split('\n')
      .map((line, at) => `${at + 1}: ${line}`)
      .join('\n')
    const shown = numbered.slice(0, budget)
    budget -= shown.length
    blocks.push(`--- ${file}\n${shown}${shown.length < numbered.length ? '\n… (cut)' : ''}`)
  }
  const user = [
    `Title: ${input.title}`,
    `Description: ${input.description || '(none)'}`,
    'Declared permissions:',
    ...(input.reach.length ? input.reach.map((line) => `- ${line}`) : ['- none']),
    '',
    'Code:',
    ...blocks,
  ].join('\n')
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user },
  ]
}

/** The first JSON object in a reply — bare, or inside a fence. */
function jsonOf(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * The model's answer → findings, or null when it did not answer in the
 * shape asked (the stage then says so rather than claiming a clean read).
 * Severity is clamped: `high` from the model is read as `medium`.
 */
export function parseAiReview(text: string, files: readonly string[]): CheckFinding[] | null {
  const parsed = jsonOf(text)
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { findings?: unknown }).findings)) return null
  const out: CheckFinding[] = []
  for (const raw of (parsed as { findings: unknown[] }).findings.slice(0, MAX_FINDINGS)) {
    if (!raw || typeof raw !== 'object') continue
    const f = raw as Record<string, unknown>
    const message = typeof f.message === 'string' ? f.message.replace(/\s+/g, ' ').trim().slice(0, 240) : ''
    if (!message) continue
    const file = typeof f.file === 'string' && files.includes(f.file) ? (f.file as CheckFile) : undefined
    const line = typeof f.line === 'number' && Number.isInteger(f.line) && f.line > 0 ? f.line : undefined
    out.push({
      rule: 'ai.review',
      severity: f.severity === 'low' ? 'low' : 'medium',
      message,
      ...(file ? { file } : {}),
      ...(file && line ? { line } : {}),
    })
  }
  return out
}
