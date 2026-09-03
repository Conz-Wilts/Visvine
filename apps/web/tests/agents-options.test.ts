/**
 * lib/agents/options.ts against the local Docker Postgres: the MODELS a space
 * has (one per `kind: model` connector, with why a broken one cannot run),
 * which of them a brief that names none would use, the connectors a brief may
 * name, and the sibling agents. Skips loudly when there is no local database,
 * as tests/agents-tick.test.ts does.
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

test('agentOptions: the models a space has, its default, connectors and agents', async (t) => {
  const reason = await probe()
  if (reason) return t.skip(reason)
  const { agentOptions } = await import('@/lib/agents/options')
  const { AGENT_TOOL_OPTIONS } = await import('@/lib/agents/config')
  await teardown()
  await prisma!.space.create({ data: { id: SPACE, name: 'agents options test' } })
  try {
    // Nothing configured: no models, and a sentence saying to go and add one.
    // Emphatically NOT a provider list — offering one the space has no key for
    // is what wrote `gemini` into briefs nobody could run.
    const empty = await agentOptions(SPACE)
    assert.deepEqual(empty.models, [])
    assert.equal(empty.spaceModel, null)
    assert.match(empty.noModels ?? '', /no model/i)
    assert.deepEqual(empty.connectors, [])
    assert.deepEqual(empty.agents, [])
    assert.deepEqual(empty.tools, AGENT_TOOL_OPTIONS)

    await note('connectors/hubspot.md', '---\ntype: connector\nhosts: [api.hubapi.com]\n---\nCRM.\n')
    await note('connectors/old.md', '---\ntype: connector\nenabled: false\nhosts: [example.com]\n---\nOff.\n')
    // A model with no key yet: listed, with why it cannot run.
    await note('models/anthropic.md', '---\ntype: model\nprovider: anthropic\nmodel: claude-sonnet-5\n---\n')
    await note('connectors/readme.md', 'Not a connector.\n')
    await note('agents/digest/index.md', '---\ntype: agent\n---\nBrief.\n')
    await note('agents/sync/index.md', '---\ntype: agent\n---\nBrief.\n')
    await note('agents/digest/report.md', '---\ntitle: A report\n---\nWritten by a run.\n')

    const keyless = await agentOptions(SPACE)
    assert.deepEqual(
      keyless.models.map((m) => ({ ref: m.ref, name: m.name, ok: m.problem === null })),
      [{ ref: 'anthropic/claude-sonnet-5', name: 'anthropic', ok: false }],
    )
    // A model without its key is not one the space can run on.
    assert.equal(keyless.spaceModel, null)
    assert.match(keyless.noModels ?? '', /no model that can run/i)

    await prisma!.connectorSecret.create({ data: { spaceId: SPACE, name: 'MODEL_KEY_ANTHROPIC', ciphertext: 'x' } })
    const o = await agentOptions(SPACE)
    assert.equal(o.noModels, null)
    assert.deepEqual(o.spaceModel, {
      ref: 'anthropic/claude-sonnet-5',
      label: 'claude-sonnet-5',
      name: 'anthropic',
    })
    // Every connector is listed for the brief's `connectors:`; a model is not
    // a connector, so it is not among them.
    assert.deepEqual(
      o.connectors,
      [
        { name: 'hubspot', enabled: true },
        { name: 'old', enabled: false },
      ],
    )
    assert.deepEqual(o.agents, ['digest', 'sync'])

    // Note order decides, so "the first one under Models" is a sentence an
    // admin can act on. `anthropic` sorts before `openai`.
    await prisma!.connectorSecret.create({ data: { spaceId: SPACE, name: 'MODEL_KEY_OPENAI', ciphertext: 'x' } })
    await note('models/openai.md', '---\ntype: model\nprovider: openai\nmodel: gpt-4.1\n---\n')
    const two = await agentOptions(SPACE)
    assert.equal(two.models.length, 2)
    assert.equal(two.spaceModel?.name, 'anthropic')

    // A model that names nothing falls back to the provider's first model, so
    // a note written before `model:` existed still runs — and the shape before
    // models/ existed (a `kind: model` connector) is still read until
    // db:models:migrate moves it.
    await note('connectors/gemini.md', '---\ntype: connector\nkind: model\nprovider: gemini\n---\n')
    const legacy = await agentOptions(SPACE)
    assert.equal(legacy.models.find((m) => m.name === 'gemini')?.ref, 'gemini/gemma-4-31b-it')
    // …but it is not a connector the brief may declare.
    assert.ok(!legacy.connectors.some((c) => c.name === 'gemini'))
  } finally {
    await teardown()
  }
})
