/**
 * How good is the Tool builder, as a number: build each prompt in
 * scripts/eval/tool-prompts.ts against the running dev server, screenshot every
 * section and band action, and have an independent designer model score each
 * screen on the rubric in lib/tools/shared/visualRubric.ts.
 *
 * Two ways to build, so a change can be measured against what came before:
 *
 *   template   build_tool — the server's own path: a finished template, a spec
 *              written for the request, review and polish rounds.
 *   freeform   a model given the author guide and the component catalog as it
 *              stood before the page blocks writes the whole Tool itself —
 *              config, collections and ui.tsx — with two rounds to fix compile
 *              errors. What an MCP client did before templates existed.
 *
 * Local only. It needs `pnpm dev` on :3000, OPENROUTER_API_KEY, and writes a
 * throwaway `tool-lab` space (its model is a custom endpoint on OpenRouter).
 * Screenshots and scores land in apps/web/.eval/tools/<run>/.
 *
 *   pnpm --filter @visvine/web eval:tools [--mode template|freeform] [--only crm,kudos] [--limit 5]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import prisma from '../lib/prisma'
import { createSession, COOKIE_NAME } from '../lib/session'
import { encryptSecret } from '../lib/crypto/secrets'
import { reviewScreen } from '../lib/tools/visualReview'
import { combineVerdicts, passes, RUBRIC, type VisualVerdict } from '../lib/tools/shared/visualRubric'
import { TOOL_AUTHOR_GUIDE } from '../lib/tools/sdkDocs'
import { TOOL_CATALOG } from '../lib/tools/catalog'
import { TOOL_PROMPTS } from './eval/tool-prompts'

const ORIGIN = process.env.EVAL_ORIGIN ?? 'http://localhost:3000'
const SPACE = 'tool-lab'
const BUILDER_MODEL = process.env.EVAL_BUILDER_MODEL ?? 'anthropic/claude-sonnet-5'
const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL ?? 'google/gemini-3.1-pro-preview'
const USER_EMAIL = process.env.DEV_MCP_USER ?? 'admin@local.dev'

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}
const MODE = (arg('mode') ?? 'template') as 'template' | 'freeform'
const ONLY = arg('only')?.split(',').map((s) => s.trim())
const LIMIT = Number(arg('limit') ?? TOOL_PROMPTS.length)

let cookie = ''

async function act<T = Record<string, unknown>>(name: string, input: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${ORIGIN}/api/actions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `${COOKIE_NAME}=${cookie}` },
    body: JSON.stringify(input),
  })
  const text = await res.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = { error: text.slice(0, 400) }
  }
  if (!res.ok) throw new Error(`${name} ${res.status}: ${JSON.stringify(body).slice(0, 600)}`)
  const b = body as { result?: T }
  return (b.result ?? body) as T
}

// ── the lab ──

async function setUp(): Promise<void> {
  const user = await prisma.user.findFirst({ where: { email: USER_EMAIL } })
  if (!user) throw new Error(`No user ${USER_EMAIL} — seed the local database first`)
  cookie = await createSession({ userId: user.id, name: user.name ?? 'Eval', email: user.email ?? USER_EMAIL } as never, { maxAgeSeconds: 6 * 3600 })

  const exists = await prisma.space.findUnique({ where: { id: SPACE }, select: { id: true } })
  if (!exists) await act('create_space', { name: 'Tool Lab', id: SPACE, visibility: 'private' }).catch(async (err) => {
    // Some deployments take the id from the name; either way it must exist now.
    if (!(await prisma.space.findUnique({ where: { id: SPACE } }))) throw err
  })

  await act('edit_context', {
    space_id: SPACE,
    path: 'models/builder.md',
    content: [
      '---',
      'type: model',
      'title: "Builder"',
      'provider: custom',
      'base_url: https://openrouter.ai/api/v1',
      `model: ${BUILDER_MODEL}`,
      'description: "The eval\'s builder model, on OpenRouter"',
      '---',
      '',
      'The model build_tool runs on in the tool lab.',
      '',
    ].join('\n'),
  })
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new Error('OPENROUTER_API_KEY is needed for the builder and the judge')
  await prisma.connectorSecret.upsert({
    where: { secret_identity: { spaceId: SPACE, name: 'MODEL_KEY_CUSTOM' } },
    create: { spaceId: SPACE, name: 'MODEL_KEY_CUSTOM', ciphertext: encryptSecret(key), createdBy: USER_EMAIL },
    update: { ciphertext: encryptSecret(key) },
  })
}

// ── building ──

const OLD_KIT = new Set([
  'Page', 'Toolbar', 'StatRow', 'Stat', 'Progress', 'ListDetail', 'MonthCalendar', 'Icon', 'FieldValue', 'FieldInput', 'RecordForm',
  'RecordDialog', 'RecordTable', 'RecordBoard', 'RecordsEmpty', 'HueChip', 'HueDot', 'useSampleRows',
])

function oldCatalog(): string {
  return TOOL_CATALOG.filter((e) => !OLD_KIT.has(e.name))
    .map((e) => `### ${e.name}\n${e.what} ${e.when}\nProps: ${e.props}\n\`\`\`tsx\n${e.snippet}\n\`\`\``)
    .join('\n\n')
}

async function openrouter(messages: Array<{ role: string; content: string }>, maxTokens = 16000): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    body: JSON.stringify({ model: BUILDER_MODEL, messages, max_tokens: maxTokens }),
  })
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  return data.choices?.[0]?.message?.content ?? ''
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'tool'

async function buildFreeform(request: string, name: string): Promise<{ name: string; notes: string[] }> {
  const notes: string[] = []
  const system = [
    'You build Visvine Tools. Read the guide and the component catalog, then build the Tool the person asked for in ONE answer.',
    TOOL_AUTHOR_GUIDE,
    '## Components',
    oldCatalog(),
  ].join('\n\n')
  const ask = [
    `The person asked: "${request}"`,
    'Answer with one JSON object: {"title": "…", "description": "…", "facts": {"surfaces": {"rail": {"label": "…", "icon": "grid"}, "types": [], "nav": null | {"style":"tabs","sections":[{"id","label"}]}, "actions": [{"id","label"}]}, "collections": {…}}, "ui": "<the whole ui.tsx>"}',
  ].join('\n')
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: ask },
  ]
  const raw = await openrouter(messages)
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  const answer = JSON.parse(raw.slice(start, end + 1)) as { title: string; description: string; facts: Record<string, unknown>; ui: string }
  await act('create_tool', { space_id: SPACE, name, title: answer.title, description: answer.description })
  try {
    await act('configure_tool', { space_id: SPACE, name, facts: { sdk: '^2.0.0', ...answer.facts } })
  } catch (err) {
    notes.push(`configure refused: ${String(err).slice(0, 200)}`)
  }
  let ui = answer.ui
  for (let round = 0; round < 3; round++) {
    const written = await act<{ build: { ok: boolean; errors?: unknown } }>('write_tool', { space_id: SPACE, name, file: 'ui.tsx', content: ui })
    if (written.build.ok) break
    notes.push(`compile round ${round + 1}: ${JSON.stringify(written.build.errors).slice(0, 200)}`)
    const fixed = await openrouter([...messages, { role: 'assistant', content: raw }, { role: 'user', content: `ui.tsx did not compile: ${JSON.stringify(written.build.errors)}\nAnswer with the whole fixed ui.tsx only.` }])
    ui = (/```(?:tsx)?\n([\s\S]*?)```/.exec(fixed)?.[1] ?? fixed).trim()
  }
  return { name, notes }
}

// ── judging ──

interface Shot {
  screen: string
  image: string
  mime: 'image/png' | 'image/jpeg'
  errors: string[]
}

async function capture(name: string): Promise<Shot[]> {
  const tool = await act<{ config?: { title: string; surfaces: { nav?: { sections: Array<{ id: string; label: string }> } | null; actions?: Array<{ id: string; label: string }> } } | null }>('read_tool', { space_id: SPACE, name, file: 'index.md' })
  const sections = tool.config?.surfaces.nav?.sections ?? []
  const plan: Array<{ screen: string; section?: string; action?: string }> = [
    ...(sections.length ? sections.map((s) => ({ screen: `the ${s.label} section`, section: s.id })) : [{ screen: 'the main page' }]),
    ...(tool.config?.surfaces.actions ?? []).map((a) => ({ screen: `the dialog opened by "${a.label}"`, action: a.id, section: sections[0]?.id })),
  ]
  const shots: Shot[] = []
  for (const p of plan) {
    // The first look seeds sample rows; give it a beat, then take the real one.
    if (shots.length === 0) await act('preview_tool', { space_id: SPACE, name, screenshot: true, ...(p.section ? { section: p.section } : {}) }).catch(() => null)
    const out = await act<{ screenshot?: { available: boolean; png_base64?: string | null; jpeg_base64?: string | null; mime?: 'image/png' | 'image/jpeg'; console_errors?: string[] } }>('preview_tool', {
      space_id: SPACE,
      name,
      screenshot: true,
      ...(p.section ? { section: p.section } : {}),
      ...(p.action ? { action: p.action } : {}),
    })
    const s = out.screenshot
    const image = s?.png_base64 ?? s?.jpeg_base64
    if (s?.available && image && s.mime) shots.push({ screen: p.screen, image, mime: s.mime, errors: s.console_errors ?? [] })
  }
  return shots
}

async function judge(request: string, title: string, shots: Shot[]): Promise<VisualVerdict | null> {
  const verdicts = await Promise.all(shots.map((s) => reviewScreen({ request, title, screen: s.screen }, { imageBase64: s.image, mime: s.mime }, JUDGE_MODEL)))
  let combined = combineVerdicts(verdicts.filter((v): v is VisualVerdict => v !== null))
  // A screen that threw is a broken Tool, whatever it looks like.
  if (combined && shots.some((s) => s.errors.length)) combined = { ...combined, score: Math.min(combined.score, 4), fixes: ['Console errors on load', ...combined.fixes] }
  return combined
}

// ── the run ──

async function main() {
  await setUp()
  const run = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${MODE}`
  const dir = join(process.cwd(), '.eval', 'tools', run)
  mkdirSync(dir, { recursive: true })
  const prompts = TOOL_PROMPTS.filter((p) => !ONLY || ONLY.some((o) => p.includes(o))).slice(0, LIMIT)
  const results: Array<Record<string, unknown>> = []

  for (const request of prompts) {
    const started = Date.now()
    const name = `${MODE === 'freeform' ? 'ff' : 'tp'}-${slug(request)}-${Date.now().toString(36).slice(-4)}`
    const row: Record<string, unknown> = { request, mode: MODE }
    try {
      if (MODE === 'template') {
        const built = await act<{ name: string; title: string; template: string; score: number | null; steps: unknown }>('build_tool', { space_id: SPACE, request, name, budget_seconds: 420, polish_rounds: 2 })
        Object.assign(row, { name: built.name, title: built.title, template: built.template, self_score: built.score, steps: built.steps })
      } else {
        const built = await buildFreeform(request, name)
        Object.assign(row, { name: built.name, notes: built.notes })
      }
      const shots = await capture(String(row.name))
      shots.forEach((s, i) => writeFileSync(join(dir, `${slug(request)}-${i}.${s.mime === 'image/png' ? 'png' : 'jpg'}`), Buffer.from(s.image, 'base64')))
      const verdict = await judge(request, String(row.title ?? row.name), shots)
      Object.assign(row, { score: verdict?.score ?? null, passes: verdict ? passes(verdict) : false, scores: verdict?.scores, fixes: verdict?.fixes, console_errors: shots.flatMap((s) => s.errors) })
    } catch (err) {
      Object.assign(row, { score: 0, error: String(err).slice(0, 500) })
      // A model that stopped answering (a spent key, an outage) fails every
      // prompt after it too: stop, rather than record a run of zeros.
      if (/ (429|502): /.test(String(err)) && results.at(-1)?.error) {
        results.push(row)
        console.error(`Stopping: the builder's model is not answering — ${String(err).slice(0, 200)}`)
        break
      }
    }
    row.seconds = Math.round((Date.now() - started) / 1000)
    results.push(row)
    console.log(`${String(row.score ?? '—').padStart(5)}  ${request}${row.template ? `  [${String(row.template)}]` : ''}${row.error ? `  ERROR ${String(row.error).slice(0, 120)}` : ''}  (${String(row.seconds)}s)`)
    writeFileSync(join(dir, 'results.json'), JSON.stringify(results, null, 2))
  }

  const scored = results.map((r) => Number(r.score ?? 0))
  const mean = scored.reduce((a, b) => a + b, 0) / Math.max(1, scored.length)
  const perKey = Object.fromEntries(
    RUBRIC.map((r) => [r.key, Math.round((results.reduce((a, row) => a + Number((row.scores as Record<string, number> | undefined)?.[r.key] ?? 0), 0) / Math.max(1, results.length)) * 10) / 10]),
  )
  const summary = { run, mode: MODE, builder: BUILDER_MODEL, judge: JUDGE_MODEL, prompts: results.length, mean: Math.round(mean * 100) / 100, min: Math.min(...scored), passing: results.filter((r) => r.passes).length, per_criterion: perKey }
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log('\n' + JSON.stringify(summary, null, 2))
  console.log(`\nScreens and scores: ${dir}`)
  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
