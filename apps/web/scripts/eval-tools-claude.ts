/**
 * The Tool builder measured the way people actually use it: an AI client
 * connected to the Visvine MCP, given a one-line request and nothing else.
 *
 * Each prompt in scripts/eval/tool-prompts.ts is handed to a FRESH headless
 * Claude Code session (`claude -p`, the local subscription) whose only tools
 * are the local `/api/mcp` — no repo, no CLAUDE.md, no hints beyond what the
 * MCP itself says. When it finishes, every section and band action of the Tool
 * it made is captured through `preview_tool`, and a second, separate Claude
 * session reads the screenshots and scores them on the rubric in
 * lib/tools/shared/visualRubric.ts, noting anything broken.
 *
 * Nothing here depends on code newer than the MCP surface it drives, so the
 * same runner measures an older checkout of the server (the baseline).
 *
 * Needs `pnpm dev` on :3000, `claude` on the PATH, AUTH_SECRET in the env.
 * Output: apps/web/.eval/tools/<run>/ — screenshots, transcripts' errors,
 * results.json, summary.json, report.md.
 *
 *   pnpm --filter @visvine/web eval:tools [--label after] [--only crm,kudos] [--limit 5] [--concurrency 3]
 */
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SignJWT } from 'jose'
import { combineVerdicts, parseVerdict, passes, RUBRIC, type VisualVerdict } from '../lib/tools/shared/visualRubric'
import { TOOL_PROMPTS } from './eval/tool-prompts'

const ORIGIN = process.env.EVAL_ORIGIN ?? 'http://localhost:3000'
const SPACE = process.env.EVAL_SPACE ?? 'tool-lab'
const USER = { userId: process.env.EVAL_USER_ID ?? 'user_dev_admin', name: 'Dev Admin', email: 'admin@local.dev' }

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}
const LABEL = arg('label') ?? 'after'
const ONLY = arg('only')?.split(',').map((s) => s.trim())
const LIMIT = Number(arg('limit') ?? TOOL_PROMPTS.length)
const CONCURRENCY = Number(arg('concurrency') ?? 3)
const BUILDER_MODEL = arg('builder-model') ?? 'sonnet'
const JUDGE_MODEL = arg('judge-model') ?? 'opus'
const BUILD_TIMEOUT_MS = 30 * 60_000

let cookie = ''

async function act<T = Record<string, unknown>>(name: string, input: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${ORIGIN}/api/actions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `auth_session=${cookie}` },
    body: JSON.stringify(input),
  })
  const text = await res.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = { error: text.slice(0, 400) }
  }
  if (!res.ok) throw new Error(`${name} ${res.status}: ${JSON.stringify(body).slice(0, 400)}`)
  return ((body as { result?: T }).result ?? body) as T
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'tool'

// ── a headless Claude session ──

interface Session {
  result: string
  turns: number
  toolCalls: number
  /** Tool results the MCP returned as errors, with what was asked. */
  toolErrors: string[]
  seconds: number
  failed: string | null
}

function runClaude(prompt: string, opts: { cwd: string; model: string; allowed: string[]; mcp?: string; addDir?: string }): Promise<Session> {
  const args = ['-p', prompt, '--model', opts.model, '--output-format', 'stream-json', '--verbose', '--allowedTools', ...opts.allowed]
  if (opts.mcp) args.push('--mcp-config', opts.mcp, '--strict-mcp-config')
  if (opts.addDir) args.push('--add-dir', opts.addDir)
  const started = Date.now()
  return new Promise((resolve) => {
    const child = spawn('claude', args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let buffer = ''
    const session: Session = { result: '', turns: 0, toolCalls: 0, toolErrors: [], seconds: 0, failed: null }
    const pending = new Map<string, string>()
    const onLine = (line: string) => {
      if (!line.trim()) return
      let event: Record<string, unknown>
      try {
        event = JSON.parse(line) as Record<string, unknown>
      } catch {
        return
      }
      const content = ((event.message as { content?: unknown[] } | undefined)?.content ?? []) as Array<Record<string, unknown>>
      for (const block of content) {
        if (block.type === 'tool_use') {
          session.toolCalls++
          pending.set(String(block.id), `${String(block.name).replace('mcp__visvine-dev__', '')} ${JSON.stringify(block.input).slice(0, 160)}`)
        }
        if (block.type === 'tool_result' && block.is_error) {
          const text = Array.isArray(block.content) ? (block.content as Array<{ text?: string }>).map((c) => c.text ?? '').join(' ') : String(block.content ?? '')
          session.toolErrors.push(`${pending.get(String(block.tool_use_id)) ?? '?'} → ${text.slice(0, 300)}`)
        }
      }
      if (event.type === 'result') {
        session.result = String(event.result ?? '')
        session.turns = Number(event.num_turns ?? 0)
        if (event.is_error) session.failed = String(event.subtype ?? 'error')
      }
    }
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        onLine(buffer.slice(0, nl))
        buffer = buffer.slice(nl + 1)
      }
    })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
    const timer = setTimeout(() => {
      session.failed = 'timeout'
      child.kill('SIGTERM')
    }, BUILD_TIMEOUT_MS)
    child.on('close', (code) => {
      clearTimeout(timer)
      onLine(buffer)
      session.seconds = Math.round((Date.now() - started) / 1000)
      if (code !== 0 && !session.failed) session.failed = `exit ${code}: ${stderr.slice(0, 300)}`
      resolve(session)
    })
  })
}

// ── building ──

function builderPrompt(request: string): string {
  return [
    `You are connected to a Visvine workspace through the visvine-dev MCP. A teammate in the space \`${SPACE}\` asked for a Tool:`,
    '',
    `"${request}"`,
    '',
    'Build it for them in that space. They are not around to answer questions — make every decision yourself, and finish the job.',
    'When you are done, the LAST line of your reply must be exactly: TOOL: <name> — the lower-case name you gave create_tool.',
  ].join('\n')
}

/** The Tool the builder named — by its name, or failing that by its title. */
async function toolNamed(said: string): Promise<string | null> {
  if (!said) return null
  const listed = await act<{ authored: Array<{ name: string; title: string }> }>('list_tools', { space_id: SPACE })
  const byName = listed.authored.find((t) => t.name === said.toLowerCase())
  if (byName) return byName.name
  const byTitle = listed.authored.filter((t) => t.title.toLowerCase() === said.toLowerCase())
  return byTitle.at(-1)?.name ?? null
}

// ── capturing ──

interface Shot {
  screen: string
  file: string
  errors: string[]
}

async function capture(name: string, dir: string, base: string): Promise<{ shots: Shot[]; title: string; captureErrors: string[] }> {
  const tool = await act<{ title?: string; config?: { title: string; surfaces: { nav?: { sections: Array<{ id: string; label: string }> } | null; actions?: Array<{ id: string; label: string }> } } | null }>('read_tool', { space_id: SPACE, name, file: 'index.md' })
  const sections = tool.config?.surfaces.nav?.sections ?? []
  const plan: Array<{ screen: string; section?: string; action?: string }> = [
    ...(sections.length ? sections.map((s) => ({ screen: `the ${s.label} section`, section: s.id })) : [{ screen: 'the main page' }]),
    ...(tool.config?.surfaces.actions ?? []).map((a) => ({ screen: `the dialog opened by pressing "${a.label}"`, action: a.id, section: sections[0]?.id })),
  ].slice(0, 6)
  const shots: Shot[] = []
  const captureErrors: string[] = []
  for (const [i, p] of plan.entries()) {
    type Capture = { available: boolean; reason?: string; png_base64?: string | null; jpeg_base64?: string | null; mime?: string; console_errors?: string[]; action_missing?: string }
    const out = await act<{ screenshot?: Capture }>('preview_tool', {
      space_id: SPACE,
      name,
      screenshot: true,
      ...(p.section ? { section: p.section } : {}),
      ...(p.action ? { action: p.action } : {}),
    }).catch((err: unknown) => ({ screenshot: { available: false, reason: String(err) } as Capture }))
    const s = out.screenshot
    const image = s?.png_base64 ?? s?.jpeg_base64
    if (!s?.available || !image) {
      captureErrors.push(`${p.screen}: ${s?.reason ?? 'no image'}`)
      continue
    }
    if (s.action_missing) captureErrors.push(`${p.screen}: ${s.action_missing}`)
    const file = join(dir, `${base}-${i}.${s.mime === 'image/jpeg' ? 'jpg' : 'png'}`)
    writeFileSync(file, Buffer.from(image, 'base64'))
    shots.push({ screen: p.screen, file, errors: s.console_errors ?? [] })
  }
  return { shots, title: tool.config?.title ?? tool.title ?? name, captureErrors }
}

// ── judging ──

function judgePrompt(request: string, title: string, shots: Shot[]): string {
  return [
    'You are a demanding product designer judging an internal tool that an AI built inside a SaaS app. The app draws the left rail and the top band (the band shows the tool\'s sections as tabs and its buttons on the right); judge everything, but mostly the tool\'s content area.',
    `The person's whole request was: "${request}". The tool is titled "${title}".`,
    '',
    'Read each screenshot file with the Read tool:',
    ...shots.map((s, i) => `${i + 1}. ${s.file} — ${s.screen}`),
    '',
    'Score EACH screen on each criterion from 0 to 10 (10 = indistinguishable from Linear/Notion/Stripe; 5 = a competent but plain prototype; an error card, a blank or a loading screen is 0–2):',
    ...RUBRIC.map((r) => `- ${r.key}: ${r.ask}`),
    '',
    'List up to 5 concrete fixes per screen (one sentence each, naming the element). Also list anything BROKEN — an error, a blank or stuck loading screen, cut-off or overlapping content, a control that is clearly the wrong kind, placeholder text, a button that seems to do nothing — in `broken`, and say in `fit` whether the tool is a sensible answer to the request.',
    '',
    'Answer with ONE JSON object and nothing else:',
    `{"screens": [{"screen": "<as named above>", "summary": "<one line>", "scores": {${RUBRIC.map((r) => `"${r.key}": <0-10>`).join(', ')}}, "fixes": ["…"]}], "broken": ["…"], "fit": "<one line>"}`,
  ].join('\n')
}

function jsonIn(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

async function judge(request: string, title: string, shots: Shot[], dir: string): Promise<{ verdict: VisualVerdict | null; broken: string[]; fit: string; screens: Array<{ screen: string; score: number | null }> }> {
  const session = await runClaude(judgePrompt(request, title, shots), { cwd: dir, model: JUDGE_MODEL, allowed: ['Read'], addDir: dir })
  const answer = jsonIn(session.result)
  const screens = (Array.isArray(answer?.screens) ? answer.screens : []) as Array<Record<string, unknown>>
  const verdicts = screens.map((s) => parseVerdict(JSON.stringify(s)))
  const ok = verdicts.filter((v): v is VisualVerdict => v !== null)
  return {
    verdict: combineVerdicts(ok),
    broken: Array.isArray(answer?.broken) ? (answer.broken as unknown[]).map(String) : session.failed ? [`judge failed: ${session.failed}`] : [],
    fit: typeof answer?.fit === 'string' ? answer.fit : '',
    screens: screens.map((s, i) => ({ screen: String(s.screen ?? shots[i]?.screen ?? i), score: verdicts[i]?.score ?? null })),
  }
}

// ── one prompt ──

async function evaluate(request: string, dir: string, mcp: string): Promise<Record<string, unknown>> {
  const started = Date.now()
  const base = slug(request)
  const row: Record<string, unknown> = { request }
  const work = mkdtempSync(join(tmpdir(), 'vv-eval-'))
  const built = await runClaude(builderPrompt(request), { cwd: work, model: BUILDER_MODEL, allowed: ['mcp__visvine-dev'], mcp })
  const name = await toolNamed(/TOOL:\s*`?([^`\n]+?)`?\s*$/m.exec(built.result.trim())?.[1]?.trim() ?? '')
  Object.assign(row, {
    name,
    build_seconds: built.seconds,
    turns: built.turns,
    tool_calls: built.toolCalls,
    builder_errors: built.toolErrors,
    builder_failed: built.failed,
    builder_said: built.result.slice(-600),
  })
  if (!name) {
    Object.assign(row, { score: 0, error: built.failed ? `builder ${built.failed}` : 'the builder never named a Tool' })
    return row
  }
  try {
    const source = await act<{ files: Record<string, string | null> }>('read_tool', { space_id: SPACE, name, file: 'ui.tsx' })
    row.from_template = /\/\/ @spec\n/.test(source.files['ui.tsx'] ?? '')
    const { shots, title, captureErrors } = await capture(name, dir, base)
    row.title = title
    row.capture_errors = captureErrors
    row.console_errors = [...new Set(shots.flatMap((s) => s.errors))]
    if (shots.length === 0) {
      Object.assign(row, { score: 0, error: 'no screen could be captured' })
      return row
    }
    const judged = await judge(request, title, shots, dir)
    let score = judged.verdict?.score ?? 0
    // A Tool that throws on load is broken, however it looks.
    if ((row.console_errors as string[]).length) score = Math.min(score, 4)
    Object.assign(row, {
      score,
      passes: judged.verdict ? passes(judged.verdict) && score === judged.verdict.score : false,
      scores: judged.verdict?.scores,
      screens: judged.screens,
      fixes: judged.verdict?.fixes,
      broken: judged.broken,
      fit: judged.fit,
    })
  } catch (err) {
    Object.assign(row, { score: 0, error: String(err).slice(0, 400) })
  }
  row.seconds = Math.round((Date.now() - started) / 1000)
  return row
}

// ── the run ──

function report(summary: Record<string, unknown>, results: Array<Record<string, unknown>>): string {
  const lines = [
    `# Tool builder eval — ${String(summary.label)}`,
    '',
    `Builder: claude -p (${BUILDER_MODEL}) over the local MCP · judge: claude -p (${JUDGE_MODEL}) · ${results.length} prompts`,
    '',
    `**Mean ${String(summary.mean)} / 10** · min ${String(summary.min)} · passing (≥ 8.5, no criterion < 6) ${String(summary.passing)} · from a template ${String(summary.from_template)}`,
    '',
    '| Prompt | Score | Tool | Template | Build | Errors |',
    '|---|---|---|---|---|---|',
    ...results.map((r) => {
      const errs = [
        ...((r.builder_errors as string[] | undefined) ?? []).map(() => 'mcp'),
        ...((r.console_errors as string[] | undefined) ?? []).map(() => 'console'),
        ...((r.capture_errors as string[] | undefined) ?? []).map(() => 'capture'),
        ...(r.error ? ['FAILED'] : []),
      ]
      return `| ${String(r.request)} | ${String(r.score ?? '—')} | ${String(r.title ?? r.name ?? '—')} | ${r.from_template ? 'yes' : 'no'} | ${String(r.build_seconds ?? '—')}s · ${String(r.tool_calls ?? '—')} calls | ${errs.length ? [...new Set(errs)].map((e) => `${e}×${errs.filter((x) => x === e).length}`).join(' ') : '—'} |`
    }),
    '',
    '## Per prompt',
    '',
    ...results.flatMap((r) => [
      `### ${String(r.request)} — ${String(r.score ?? '—')}`,
      '',
      ...(r.fit ? [`Fit: ${String(r.fit)}`, ''] : []),
      ...(r.error ? [`**Failed:** ${String(r.error)}`, ''] : []),
      ...(((r.broken as string[] | undefined) ?? []).length ? ['Broken:', ...(r.broken as string[]).map((b) => `- ${b}`), ''] : []),
      ...(((r.builder_errors as string[] | undefined) ?? []).length ? ['MCP errors the builder hit:', ...(r.builder_errors as string[]).map((b) => `- ${b}`), ''] : []),
      ...(((r.console_errors as string[] | undefined) ?? []).length ? ['Console errors:', ...(r.console_errors as string[]).map((b) => `- ${b}`), ''] : []),
      ...(((r.capture_errors as string[] | undefined) ?? []).length ? ['Capture:', ...(r.capture_errors as string[]).map((b) => `- ${b}`), ''] : []),
      ...(((r.fixes as string[] | undefined) ?? []).length ? ['Fixes:', ...(r.fixes as string[]).map((b) => `- ${b}`), ''] : []),
    ]),
  ]
  return lines.join('\n')
}

async function main() {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET is needed to act as the dev user')
  cookie = await new SignJWT({ ...USER }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('8h').sign(new TextEncoder().encode(secret))

  const run = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${LABEL}`
  const dir = join(process.cwd(), '.eval', 'tools', run)
  mkdirSync(dir, { recursive: true })
  const mcp = join(dir, 'mcp.json')
  writeFileSync(mcp, JSON.stringify({ mcpServers: { 'visvine-dev': { type: 'http', url: `${ORIGIN}/api/mcp` } } }))

  // A clean lab: Tools left from an earlier run would change what the builder
  // is told ("this space already has 12 Tools — extend one").
  const before = await act<{ authored: Array<{ name: string }> }>('list_tools', { space_id: SPACE })
  for (const t of before.authored) {
    await fetch(`${ORIGIN}/api/spaces/${SPACE}/tools/authoring/${t.name}`, { method: 'DELETE', headers: { Cookie: `auth_session=${cookie}` } })
  }

  const prompts = TOOL_PROMPTS.filter((p) => !ONLY || ONLY.some((o) => p.includes(o))).slice(0, LIMIT)
  const results: Array<Record<string, unknown>> = new Array(prompts.length)
  let next = 0
  const worker = async () => {
    while (next < prompts.length) {
      const i = next++
      const row = await evaluate(prompts[i], dir, mcp)
      results[i] = row
      console.log(`${String(row.score ?? '—').padStart(5)}  ${prompts[i]}  ${row.error ? `FAILED ${String(row.error).slice(0, 100)}` : ''}`)
      writeFileSync(join(dir, 'results.json'), JSON.stringify(results.filter(Boolean), null, 2))
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker))

  const scored = results.map((r) => Number(r.score ?? 0))
  const per = Object.fromEntries(
    RUBRIC.map((r) => [r.key, Math.round((results.reduce((a, row) => a + Number((row.scores as Record<string, number> | undefined)?.[r.key] ?? 0), 0) / results.length) * 10) / 10]),
  )
  const summary = {
    label: LABEL,
    run,
    builder: BUILDER_MODEL,
    judge: JUDGE_MODEL,
    prompts: results.length,
    mean: Math.round((scored.reduce((a, b) => a + b, 0) / results.length) * 100) / 100,
    min: Math.min(...scored),
    passing: results.filter((r) => r.passes).length,
    from_template: results.filter((r) => r.from_template).length,
    failed: results.filter((r) => r.error).length,
    per_criterion: per,
  }
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2))
  writeFileSync(join(dir, 'report.md'), report(summary, results))
  console.log('\n' + JSON.stringify(summary, null, 2))
  console.log(`\nReport: ${join(dir, 'report.md')}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
