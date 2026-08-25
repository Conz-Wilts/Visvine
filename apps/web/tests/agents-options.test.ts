/**
 * lib/agents/options.ts against the local Docker Postgres: which providers
 * have a key, which connectors a brief may name (model connectors excluded
 * from the runnable set, a custom one enabling the `custom` provider), the
 * sibling agents, and the default model for a new brief. Skips loudly when
 * there is no local database, as tests/agents-tick.test.ts does.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/agents-options.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

async function probe(): Promise<string | null> {
  if (!dbUrl) return 'no local DATABASE_URL (apps/web/.env) — agents options tests need the Docker Postgres'
  try {
    prisma = (await import('@/lib/prisma')).default
    await prisma.$queryRaw`SELECT 1`
    return null
  } catch (e) {
    prisma = null
    return `local Postgres not reachable (${e instanceof Error ? e.message.split('\n')[0] : String(e)})`
  }
}

const SPACE = `test-agents-options-${process.pid}`

async function teardown() {
  const p = prisma!
  await p.connectorSecret.deleteMany({ where: { spaceId: SPACE } })
  await p.contextNote.deleteMany({ where: { spaceId: SPACE } })
  await p.space.deleteMany({ where: { id: SPACE } })
}

const note = (path: string, content: string) =>
  prisma!.contextNote.create({ data: { spaceId: SPACE, ownerKey: 'shared', path, content, createdBy: 'test' } })

test('agentOptions: providers, key status, connectors, agents, default model', async (t) => {
  const reason = await probe()
  if (reason) return t.skip(reason)
  const { agentOptions } = await import('@/lib/agents/options')
  const { AGENT_TOOL_OPTIONS, DEFAULT_AGENT_MODEL } = await import('@/lib/agents/config')
  await teardown()
  await prisma!.space.create({ data: { id: SPACE, name: 'agents options test' } })
  try {
    // Nothing configured: every provider keyless, the registry default model.
    const empty = await agentOptions(SPACE)
    assert.ok(empty.providers.every((p) => !p.keyStored))
    assert.equal(empty.providers.find((p) => p.id === 'custom')?.endpointConfigured, false)
    assert.equal(empty.providers.find((p) => p.id === 'gemini')?.endpointConfigured, true)
    assert.deepEqual(empty.connectors, [])
    assert.deepEqual(empty.agents, [])
    assert.deepEqual(empty.tools, AGENT_TOOL_OPTIONS)
    assert.equal(empty.defaultModel, DEFAULT_AGENT_MODEL)

    await prisma!.connectorSecret.create({ data: { spaceId: SPACE, name: 'MODEL_KEY_OPENAI', ciphertext: 'x' } })
    await note('connectors/hubspot.md', '---\ntype: connector\nhosts: [api.hubapi.com]\n---\nCRM.\n')
    await note('connectors/old.md', '---\ntype: connector\nenabled: false\nhosts: [example.com]\n---\nOff.\n')
    await note('connectors/llm.md', '---\ntype: connector\nkind: model\nprovider: custom\nbase_url: https://llm.example.com/v1/\n---\n')
    await note('connectors/readme.md', 'Not a connector.\n')
    await note('agents/digest.md', '---\ntype: agent\nmodel: openai/gpt-4.1-mini\n---\nBrief.\n')
    await note('agents/ops/sync.md', '---\ntype: agent\nmodel: openai/gpt-4.1-mini\n---\nBrief.\n')
    await note('agents/live/digest.md', '---\ntype: agent-activation\nactive: false\n---\n')
    await note('agents/ops/index.md', '---\ntitle: Ops\n---\n')

    const o = await agentOptions(SPACE)
    assert.equal(o.providers.find((p) => p.id === 'openai')?.keyStored, true)
    assert.equal(o.providers.find((p) => p.id === 'gemini')?.keyStored, false)
    assert.equal(o.providers.find((p) => p.id === 'custom')?.endpointConfigured, true)
    assert.deepEqual(
      o.connectors,
      [
        { name: 'hubspot', kind: 'http', enabled: true },
        { name: 'llm', kind: 'model', enabled: true },
        { name: 'old', kind: 'http', enabled: false },
      ],
    )
    assert.deepEqual(o.agents, ['digest', 'sync'])
    // The first provider holding a key is where a new brief starts.
    assert.equal(o.defaultModel, 'openai/gpt-4.1')
  } finally {
    await teardown()
  }
})
