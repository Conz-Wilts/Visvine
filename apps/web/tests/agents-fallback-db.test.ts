/**
 * A run that falls short on its model gets ONE more go on its fallback, in the
 * same run — against the local Docker Postgres, with a scripted model so no
 * key is spent. The first model stalls ("Now I will write it."), the second
 * writes the note; the run succeeds on the fallback, says so on its page, and
 * the first model's shortfall is on the record. With no fallback the same
 * stall fails `incomplete`.
 *
 * Skips loudly when there is no local database (CI has one).
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/agents-fallback-db.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ChatFn } from '@/lib/notes/toolLoop'

const root = fileURLToPath(new URL('..', import.meta.url))

function localDatabaseUrl(): string | null {
  let url = process.env.DATABASE_URL ?? null
  if (!url) {
    try {
      const m = readFileSync(join(root, '.env'), 'utf8').match(/^DATABASE_URL=(.+)$/m)
      url = m ? m[1].trim().replace(/^["']|["']$/g, '') : null
    } catch {
      url = null
    }
  }
  if (!url) return null
  try {
    const host = new URL(url).hostname
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== 'visvine-postgres') return null
  } catch {
    return null
  }
  return url
}

const dbUrl = localDatabaseUrl()
if (dbUrl && !process.env.DATABASE_URL) process.env.DATABASE_URL = dbUrl
if (!process.env.SECRETS_KEY) process.env.SECRETS_KEY = 'ff'.repeat(32)

type Prisma = typeof import('@/lib/prisma').default
let prisma: Prisma | null = null
let probed: Promise<string | null> | null = null

function probe(): Promise<string | null> {
  if (probed) return probed
  probed = (async () => {
    if (!dbUrl) return 'no local DATABASE_URL (apps/web/.env) — the agent folder test needs the Docker Postgres'
    try {
      prisma = (await import('@/lib/prisma')).default
      await prisma.$queryRaw`SELECT 1`
      return null
    } catch (e) {
      prisma = null
      return `local Postgres not reachable (${e instanceof Error ? e.message.split('\n')[0] : String(e)})`
    }
  })()
  return probed
}


const SPACE = `test-agent-fallback-${process.pid}`
const AUTHOR = `test-agent-fallback-author-${process.pid}`
const CONTEXT = { spaceId: SPACE, ownerKey: 'shared' }
/** Agent node ids are global, and test files run side by side: a name no other test uses. */
const AGENT = `fallback-${process.pid}`
const ACTOR = { id: AUTHOR, name: 'Author' }

async function setup() {
  const p = prisma!
  await teardown()
  await p.space.create({ data: { id: SPACE, name: 'agent fallback test', timezone: 'UTC' } })
  await p.user.create({ data: { id: AUTHOR, email: `${AUTHOR}@local.test`, name: AUTHOR } })
  await p.spaceMember.create({ data: { spaceId: SPACE, userId: AUTHOR } })
  await p.contextGrant.create({ data: { spaceId: SPACE, subjectType: 'user', subjectId: AUTHOR, resourcePath: '', level: 30, grantedBy: 'system' } })
}

async function teardown() {
  const p = prisma!
  await p.space.deleteMany({ where: { id: SPACE } })
  await p.user.deleteMany({ where: { id: AUTHOR } })
}

/** A model that stalls on `stall`, and on any other model writes the note and finishes. */
function scripted(stall: string): ChatFn & { models: string[] } {
  const fn = Object.assign(
    async (messages: { role: string; content?: string | null }[], _tools: unknown, opts: { config?: { model?: string } }) => {
      const model = opts.config?.model ?? '?'
      fn.models.push(model)
      if (model === stall) return { content: 'I read the brief. Now I will write the note.', toolCalls: [], usage: { promptTokens: 100, completionTokens: 10 } }
      const wrote = messages.some((m) => m.role === 'tool')
      return wrote
        ? { content: `Wrote agents/${AGENT}/out.md.`, toolCalls: [], usage: { promptTokens: 120, completionTokens: 8 } }
        : {
            content: null,
            toolCalls: [{ id: 'w1', name: 'write_context', arguments: JSON.stringify({ path: `agents/${AGENT}/out.md`, content: '---\ntitle: Out\n---\nDone.\n' }) }],
            usage: { promptTokens: 110, completionTokens: 20 },
          }
    },
    { models: [] as string[] },
  )
  return fn as ChatFn & { models: string[] }
}

async function runOnce(chatFn: ChatFn) {
  const { executeRun } = await import('@/lib/agents/runner')
  const state = await prisma!.agentState.findUniqueOrThrow({ where: { agent_identity: { spaceId: SPACE, name: AGENT } } })
  const run = await prisma!.agentRun.create({
    data: { stateId: state.id, spaceId: SPACE, name: AGENT, trigger: 'manual', status: 'running', startedBy: AUTHOR, runAsUserId: AUTHOR, events: [] },
  })
  await prisma!.agentState.update({ where: { id: state.id }, data: { status: 'running', runningSince: new Date(), currentRunId: run.id } })
  const outcome = await executeRun(run.id, { chatFn })
  return { outcome, row: await prisma!.agentRun.findUniqueOrThrow({ where: { id: run.id } }) }
}

test('a run that falls short on its model finishes on its fallback; without one it fails incomplete', async (t) => {
  const reason = await probe()
  if (reason) return t.skip(reason)
  const store = await import('@/lib/notes/store')
  const { encryptSecret } = await import('@/lib/crypto/secrets')
  const { MODEL_CATALOG, modelFromCatalog } = await import('@/lib/models/catalog')
  const { configureAgent } = await import('@/lib/agents/service')
  const prevJudge = process.env.JUDGE
  process.env.JUDGE = 'off'
  await setup()
  try {
    const openai = MODEL_CATALOG.find((m) => m.id === 'openai')!
    await store.writeNote(CONTEXT, 'models/openai.md', modelFromCatalog(openai, { name: 'openai', title: 'OpenAI', description: 'test', values: { model: 'gpt-4.1-mini' } }).content, ACTOR)
    await prisma!.connectorSecret.create({ data: { spaceId: SPACE, name: 'MODEL_KEY_OPENAI', ciphertext: encryptSecret('sk-test'), createdBy: AUTHOR } })
    await store.writeNote(CONTEXT, `agents/${AGENT}/index.md`, `---\ntype: agent\ntitle: Digest\n---\nWrite agents/${AGENT}/out.md.\n`, ACTOR)
    const admin = { userId: AUTHOR, email: `${AUTHOR}@local.test`, name: AUTHOR, spaceId: SPACE, spaceAdmin: true, access: (await import('@/lib/notes/shared/authz')).OPEN_ACCESS, superAdmin: true } as never

    const pinned = await configureAgent(admin, CONTEXT, AGENT, { model: 'openai/gpt-4.1-mini' })
    assert.ok(pinned.ok, pinned.ok ? '' : pinned.error)
    const alone = await runOnce(scripted('gpt-4.1-mini'))
    assert.equal(alone.outcome.status, 'failed')
    assert.equal(alone.row.terminalReason, 'incomplete')

    assert.ok((await configureAgent(admin, CONTEXT, AGENT, { fallbackModel: 'openai/gpt-4.1' })).ok)
    const chat = scripted('gpt-4.1-mini')
    const saved = await runOnce(chat)
    assert.equal(saved.outcome.status, 'succeeded', saved.row.errorMessage ?? '')
    assert.equal(saved.row.model, 'openai/gpt-4.1', 'the run records the model that did the job')
    assert.ok(chat.models.includes('gpt-4.1-mini') && chat.models.includes('gpt-4.1'))
    const events = saved.row.events as { type: string; text?: string }[]
    assert.ok(events.some((e) => e.type === 'system' && /Fell short on openai\/gpt-4\.1-mini/.test(e.text ?? '')))
    assert.ok(events.some((e) => e.type === 'system' && (e.text ?? '').startsWith('Handed back')), 'the stall was handed back first, and says so')
    assert.ok(await store.readNoteOrNull(CONTEXT, `agents/${AGENT}/out.md`))
    // Each attempt is billed to the model that spent it.
    const usage = await prisma!.agentModelUsage.findMany({ where: { spaceId: SPACE, name: AGENT }, select: { model: true, promptTokens: true } })
    const byModel = Object.fromEntries(usage.map((u) => [u.model, u.promptTokens]))
    assert.ok(byModel['openai/gpt-4.1-mini'] > 0, 'the first attempt is on the first model')
    assert.ok(byModel['openai/gpt-4.1'] > 0, 'the second on the fallback')
  } finally {
    if (prevJudge === undefined) delete process.env.JUDGE
    else process.env.JUDGE = prevJudge
    await teardown()
  }
})
