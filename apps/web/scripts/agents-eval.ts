/**
 * How reliable agents are, measured: the live end-to-end run
 * (scripts/verify-agent-live.ts) repeated, and graded. Each run builds the
 * Hacker News agent from scratch, runs it on the real model and lets the judge
 * gate two saves. A run PASSES when it wrote ten stories and succeeded, or
 * failed honestly (`incomplete`) — a green run with nothing written is the one
 * outcome that fails the eval outright, because that is the lie the system
 * exists to prevent.
 *
 * Exits non-zero when fewer than --min-finish of the runs finished the job, a
 * run lied, the wake gate misjudged, or the median prompt tokens exceed
 * --max-tokens. Costs about a cent a run on a Flash model.
 *
 *   pnpm --filter @visvine/web agents:eval                       3 runs, google/gemini-3.8-flash
 *   pnpm --filter @visvine/web agents:eval --runs 5 --model google/gemini-2.5-flash --min-finish 0.6
 */
import { spawnSync } from 'node:child_process'

interface RunResult {
  status: string
  reason: string | null
  promptTokens: number
  stories: number
  handedBack: number
  gate: { relevant: boolean; irrelevant: boolean }
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const runs = Number(arg('runs', '3'))
const model = arg('model', 'google/gemini-3.8-flash')
const minFinish = Number(arg('min-finish', '0.8'))
const maxTokens = Number(arg('max-tokens', '150000'))

const results: RunResult[] = []
for (let i = 1; i <= runs; i++) {
  const out = spawnSync('npx', ['tsx', 'scripts/verify-agent-live.ts'], {
    env: { ...process.env, AGENT_LIVE_MODEL: model },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const line = (out.stdout ?? '').split('\n').find((l) => l.startsWith('RESULT '))
  if (!line) {
    console.log(`#${i} no result (exit ${out.status}) — ${(out.stderr ?? '').trim().split('\n').slice(-1)[0] ?? ''}`)
    continue
  }
  const r = JSON.parse(line.slice('RESULT '.length)) as RunResult
  results.push(r)
  console.log(`#${i} ${r.status} (${r.reason}) · ${r.stories} stories · ${r.promptTokens.toLocaleString('en-US')} prompt tokens · handed back ${r.handedBack}×`)
}

const finished = results.filter((r) => r.status === 'succeeded' && r.stories >= 10).length
const lied = results.filter((r) => r.status === 'succeeded' && r.stories === 0).length
const gateWrong = results.filter((r) => !r.gate.relevant || r.gate.irrelevant).length
const tokens = results.map((r) => r.promptTokens).sort((a, b) => a - b)
const median = tokens.length ? tokens[Math.floor(tokens.length / 2)] : 0
const rate = runs ? finished / runs : 0

console.log(
  `\n${model}: finished ${finished}/${runs} (${Math.round(rate * 100)}%) · green-but-empty ${lied} · gate wrong ${gateWrong} · median prompt tokens ${median.toLocaleString('en-US')}`,
)
const problems = [
  rate < minFinish ? `finished ${Math.round(rate * 100)}% < ${Math.round(minFinish * 100)}%` : null,
  lied ? `${lied} run(s) succeeded having written nothing` : null,
  gateWrong ? `the wake gate misjudged ${gateWrong} run(s)` : null,
  median > maxTokens ? `median prompt tokens ${median} > ${maxTokens}` : null,
].filter(Boolean)
if (problems.length) {
  console.log(`FAIL: ${problems.join('; ')}`)
  process.exitCode = 1
} else console.log('PASS')
