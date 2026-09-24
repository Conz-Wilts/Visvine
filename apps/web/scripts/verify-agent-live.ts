/**
 * An agent, end to end, against the local database and the real model — the
 * way a person gets one: asked of an AI over the actions, then run.
 *
 *   1. a fresh space, "Agent live test", with ONE model: Gemini Flash through
 *      OpenRouter, keyed with the deployment's own OPENROUTER_API_KEY;
 *   2. `create_agent` writes `hn-ai-digest` — the note is the brief, the record
 *      says it may fetch the web — then `configure_agent` caps its turns;
 *   3. `run_agent` runs it now: it reads Hacker News and writes the top ten AI
 *      stories, with links, to agents/hn-ai-digest/top-ai.md;
 *   4. the wake gate: the agent is switched on for saves under inbox/, one
 *      relevant note and one irrelevant note are saved, and the judge decides
 *      which of them is worth a run.
 *
 * Every call to the judge (Jev, OpenRouter's Decisions endpoint) and to the
 * chat model is logged as it happens, so what the judge was asked and what it
 * answered is on the screen beside what the agent did.
 *
 * Costs a few cents of OpenRouter credit. Local only. Re-runnable: the test
 * space is replaced on every run.
 *
 *   pnpm --filter @visvine/web agents:verify:live
 *   AGENT_LIVE_MODEL=google/gemini-2.5-flash pnpm --filter @visvine/web agents:verify:live
 */
import '../../../scripts/guard-local-db.mjs'
import 'dotenv/config'

process.env.AGENT_DISPATCH = 'inline'

const MODEL = process.env.AGENT_LIVE_MODEL ?? 'google/gemini-3.8-flash'
const SPACE_NAME = 'Agent live test'
const AGENT = 'hn-ai-digest'
const ADMIN = { userId: 'user_dev_admin', name: 'Dev Admin', email: 'admin@visvine.local' }

const INSTRUCTIONS = `You keep a running list of the best AI stories on Hacker News.

## Each run
1. Fetch both of these with fetch_url. They are Hacker News's own search API, as JSON; every hit has a title,
   a url, points and an objectID.
   - https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=60&attributesToRetrieve=title,url,points,objectID&attributesToHighlight= (the front page now)
   - https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=points%3E40&hitsPerPage=100&attributesToRetrieve=title,url,points,objectID&attributesToHighlight= (recent stories with more than 40 points)
2. Put the two lists together, one entry per objectID.
3. Decide which are about AI with decide (at most 48 titles a call, so split the list): items are the titles,
   and one yes_no question with id "ai" asking "This headline is about artificial intelligence: AI models, LLMs, agents, machine learning, AI companies
   or AI policy." Keep the stories answered 0.6 or higher.
4. Take the ten with the most points.

## Write to
Write agents/hn-ai-digest/top-ai.md, replacing what is there, exactly in this shape:

---
title: Top AI stories on Hacker News
---
1. [Story title](story url) · 557 points · [discussion](https://news.ycombinator.com/item?id=<objectID>)
2. …

Most points first. A story with no url links its title to the discussion. Do every step in this run, calling the
tools yourself — never stop to describe what comes next. When the note is written, reply with one line: how many
stories you listed.`

// ── what the judge and the model were asked ────────────────────────────────

const judgeLog: { questions: string[]; answers: unknown; ms: number }[] = []
/** Which of the judge's uses a request is, by the question ids it asks (lib/judge/shared/questions.ts). */
function judgeUse(ids: string[]): string {
  if (ids.includes('injects')) return 'injection signal on a fetched page'
  if (ids.includes('wake')) return 'wake gate'
  if (ids.includes('outcome')) return 'run check: claims vs trace'
  if (ids.every((id) => /^s\d+$/.test(id))) return 'services the instructions name'
  return "the agent's own decide"
}
let chatCalls = 0
const realFetch = globalThis.fetch
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const started = Date.now()
  const res = await realFetch(input, init)
  if (url.includes('/api/alpha/decisions')) {
    const body = JSON.parse(String(init?.body ?? '{}')) as { questions?: Record<string, unknown> }
    const answers = await res
      .clone()
      .json()
      .then((d: { answers?: unknown }) => d.answers)
      .catch(() => `HTTP ${res.status}`)
    const entry = { questions: Object.keys(body.questions ?? {}), answers, ms: Date.now() - started }
    judgeLog.push(entry)
    const shown = JSON.stringify(answers)
    console.log(`  ⚖︎ judge  [${judgeUse(entry.questions)}] ${entry.questions.slice(0, 4).join(', ')}${entry.questions.length > 4 ? ` +${entry.questions.length - 4}` : ''} → ${shown.length > 220 ? `${shown.slice(0, 220)}…` : shown} (${entry.ms} ms)`)
  } else if (url.includes('openrouter.ai') && url.includes('/chat/completions')) {
    chatCalls++
    console.log(`  ◇ model  call ${chatCalls} → ${res.status} (${Date.now() - started} ms)`)
  }
  return res
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not set in apps/web/.env')
  const { default: prisma } = await import('../lib/prisma')
  const { provisionSpace } = await import('../lib/spaces/provision')
  const { encryptSecret } = await import('../lib/crypto/secrets')
  const { MODEL_CATALOG, modelFromCatalog } = await import('../lib/models/catalog')
  const store = await import('../lib/notes/store')
  const { runAction } = await import('../lib/actions/run')
  const { MCP_SCOPES } = await import('../lib/mcp/scopes')
  const { readAgent } = await import('../lib/agents/briefs')
  const { claimEvents } = await import('../lib/agents/events')
  const { gateWake } = await import('../lib/agents/wakeGate')
  const { principalForUser } = await import('../lib/agents/principal')
  const { writeGated } = await import('../lib/notes/contextService')

  const caller = { ...ADMIN, scopes: [...MCP_SCOPES] }
  const act = async (name: string, input: Record<string, unknown>) => {
    const out = await runAction(caller, name, input)
    return out.result as Record<string, unknown>
  }

  console.log(`\n1. A fresh space with one model: ${MODEL} through OpenRouter`)
  await prisma.space.deleteMany({ where: { name: SPACE_NAME, parentId: null } })
  const made = await provisionSpace({ name: SPACE_NAME, creator: { id: ADMIN.userId, name: ADMIN.name, email: ADMIN.email } })
  if (!made.ok) throw new Error(made.error)
  const spaceId = made.space.id
  const context = { spaceId, ownerKey: 'shared' }
  const openrouter = MODEL_CATALOG.find((m) => m.id === 'openrouter')!
  const model = modelFromCatalog(openrouter, { name: 'flash', title: 'Flash', description: 'Light and cheap', values: { model: MODEL } })
  await store.writeNote(context, 'models/flash.md', model.content, { id: ADMIN.userId, name: ADMIN.name })
  await prisma.connectorSecret.create({
    data: { spaceId, name: 'MODEL_KEY_OPENROUTER', ciphertext: encryptSecret(process.env.OPENROUTER_API_KEY), createdBy: ADMIN.userId },
  })
  console.log(`   space ${spaceId}`)

  console.log('\n2. create_agent, then configure_agent')
  const created = await act('create_agent', {
    space_id: spaceId,
    name: AGENT,
    title: 'HN AI digest',
    description: 'The ten best AI stories on Hacker News, with links',
    tags: ['Research'],
    tools: ['web'],
    instructions: INSTRUCTIONS,
  })
  console.log(`   model: ${created.model} (${created.model_source}) · ready: ${created.ready} · needs: ${JSON.stringify(created.needs)}`)
  const configured = await act('configure_agent', { space_id: spaceId, agent: AGENT, max_turns: 12 })
  console.log(`   record: tools ${JSON.stringify(configured.tools)} · max_turns ${configured.max_turns} · active ${configured.active}`)
  const brief = await store.readNoteOrNull(context, `agents/${AGENT}/index.md`)
  console.log(`   the note carries no run keys: ${!/^(tools|max_turns|active|model):/m.test(brief ?? '')}`)
  // A person editing the note — not an AI, which agents/ refuses outright —
  // may change its prose but not how it runs.
  const admin = await principalForUser(spaceId, ADMIN.userId)
  const withSchedule = await writeGated(admin!, context, `agents/${AGENT}/index.md`, (brief ?? '').replace('---\n', '---\nschedule: hourly\n'))
  console.log(`   a person's edit that sets the schedule in the note: ${withSchedule.status === 'denied' ? `refused — ${withSchedule.reason.slice(0, 100)}…` : 'written (WRONG)'}`)

  console.log('\n3. run_agent — reading Hacker News')
  const ran = await act('run_agent', { space_id: spaceId, agent: AGENT })
  const runId = String(ran.run_id)
  let run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } })
  for (let i = 0; run.status === 'running' && i < 120; i++) {
    await new Promise((r) => setTimeout(r, 2_000))
    run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } })
  }
  const events = (run.events ?? []) as { type: string; tool?: string; detail?: string; text?: string }[]
  console.log(`   ${run.status} (${run.terminalReason}) · model ${run.model} · ${run.turns} turns · ${run.promptTokens}+${run.completionTokens} tokens`)
  console.log(`   tools: ${events.filter((e) => e.type === 'tool').map((e) => `${e.tool}(${(e.detail ?? '').slice(0, 60)})`).join(' → ')}`)
  for (const e of events) {
    if (e.type === 'tool_result') console.log(`   ← ${e.tool}: ${(e.text ?? '').replace(/\s+/g, ' ').slice(0, 110)}`)
    else if (e.type === 'assistant') console.log(`   says: ${(e.text ?? '').replace(/\s+/g, ' ').slice(0, 160)}`)
    else if (e.type === 'system') console.log(`   system: ${e.text}`)
  }
  if (run.summary) console.log(`   final: ${run.summary.replace(/\s+/g, ' ').slice(0, 200)}`)
  if (run.errorMessage) console.log(`   error: ${run.errorMessage}`)
  const output = await store.readNoteOrNull(context, `agents/${AGENT}/top-ai.md`)
  console.log(output ? `\n----- agents/${AGENT}/top-ai.md -----\n${output}\n-----` : '   (no output note)')

  console.log('\n4. The wake gate — switched on for saves under inbox/')
  await act('activate_agent', { space_id: spaceId, agent: AGENT, on_context: ['inbox/**'], debounce: '5s' })
  const actor = { id: ADMIN.userId, name: ADMIN.name }
  await store.writeNote(context, 'inbox/refresh.md', '---\ntitle: Refresh the AI list\n---\nThere is a big new model release on the Hacker News front page today — please update the list of top AI stories.\n', actor)
  await store.writeNote(context, 'inbox/lunch.md', '---\ntitle: Friday lunch\n---\nWe are ordering pizza on Friday. Reply with your topping.\n', actor)
  const claimed = await claimEvents(spaceId, AGENT, `gate-${Date.now()}`)
  const agent = await readAgent(spaceId, AGENT)
  const kept = await gateWake({ spaceId, agentName: AGENT, runId: 'gate-demo', briefPath: agent!.note.path, briefContent: agent!.note.content, events: claimed })
  for (const e of claimed) console.log(`   ${e.source}: ${kept.some((k) => k.id === e.id) ? 'wakes it' : 'declined'}`)
  await act('deactivate_agent', { space_id: spaceId, agent: AGENT })

  console.log(`\nJudge calls: ${judgeLog.length} · model calls: ${chatCalls}`)
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
