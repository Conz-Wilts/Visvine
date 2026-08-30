/**
 * An agent's folder, against the local Docker Postgres: the brief written at
 * `agents/<name>/index.md` makes the `agent:` node and is held to the entity
 * contract; the write gate opens the rest of the folder to that agent's own
 * runs and nothing else; the activation beside it is admin-only and drives
 * the state row; the folder is the agent's identity — never renamed, and a
 * delete takes the node with it and retires the row.
 *
 * Skips loudly when there is no local database (CI has one).
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/agents-folder-db.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OPEN_ACCESS } from '@/lib/notes/shared/authz'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'

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

const SPACE = `test-agent-folder-${process.pid}`
const AUTHOR = `test-agent-folder-author-${process.pid}`
const ADMIN = `test-agent-folder-admin-${process.pid}`
const CONTEXT = { spaceId: SPACE, ownerKey: 'shared' }
const ACTOR = { id: AUTHOR, name: 'Author', email: `${AUTHOR}@local.test` }

const principal = (userId: string, spaceAdmin: boolean): ContextPrincipal => ({
  userId,
  email: `${userId}@local.test`,
  name: userId,
  spaceId: SPACE,
  spaceAdmin,
  access: OPEN_ACCESS,
})

async function setup() {
  const p = prisma!
  await teardown()
  await p.space.create({ data: { id: SPACE, name: 'agent folder test', timezone: 'UTC' } })
  for (const id of [AUTHOR, ADMIN]) {
    await p.user.create({ data: { id, email: `${id}@local.test`, name: id } })
    await p.spaceMember.create({ data: { spaceId: SPACE, userId: id } })
  }
}

async function teardown() {
  const p = prisma!
  await p.agentRun.deleteMany({ where: { spaceId: SPACE } })
  await p.agentState.deleteMany({ where: { spaceId: SPACE } })
  await p.contextNote.deleteMany({ where: { spaceId: SPACE } })
  await p.contextFolder.deleteMany({ where: { spaceId: SPACE } })
  await p.node.deleteMany({ where: { spaceId: SPACE } })
  await p.spaceMember.deleteMany({ where: { spaceId: SPACE } })
  await p.space.deleteMany({ where: { id: SPACE } })
  await p.user.deleteMany({ where: { id: { in: [AUTHOR, ADMIN] } } })
}

const BRIEF = '---\ntype: agent\ntitle: Digest\nmodel: openai/gpt-4.1-mini\n---\nEach run, write a digest to your folder.\n'

test('the brief at agents/<name>/index.md is the agent: node, contract, state row', async (t) => {
  const reason = await probe()
  if (reason) return t.skip(reason)
  const store = await import('@/lib/notes/store')
  const { findAgentBrief } = await import('@/lib/agents/briefs')
  const { parseFrontmatter } = await import('@/lib/notes/shared/markdown')
  await setup()
  try {
    await store.createNote(CONTEXT, 'agents/digest/index.md', BRIEF, ACTOR)

    const node = await prisma!.node.findUnique({ where: { id: 'agent:digest' } })
    assert.ok(node, 'the write made the agent node')
    assert.equal(node.type, 'agent')
    assert.equal(node.name, 'Digest')
    assert.equal((node.metadata as { notePath?: string }).notePath, 'agents/digest/index.md')

    const fm = parseFrontmatter((await store.readNoteOrNull(CONTEXT, 'agents/digest/index.md')) ?? '')
    assert.equal(fm.type, 'agent', 'the lower-case type the runtime matches on survives the index contract')
    assert.equal(fm.node, 'agent:digest')
    assert.equal(fm.title, 'Digest')

    const brief = await findAgentBrief(SPACE, 'digest')
    assert.equal(brief?.path, 'agents/digest/index.md')
    assert.equal(brief?.createdBy, AUTHOR)

    const state = await prisma!.agentState.findUnique({ where: { agent_identity: { spaceId: SPACE, name: 'digest' } } })
    assert.ok(state, 'the hook made the state row')
    assert.equal(state.active, false)
    assert.equal(state.runAsUserId, AUTHOR)

    // The flat alias reads through to the folder.
    assert.equal(await store.readNoteOrNull(CONTEXT, 'agents/digest.md'), null, 'nothing lives at the alias')
    assert.equal(await store.canonicalEntityWritePath(CONTEXT, 'agents/digest.md'), 'agents/digest/index.md')
  } finally {
    await teardown()
  }
})

test('the folder is the agent\'s own to write — and only its own', async (t) => {
  const reason = await probe()
  if (reason) return t.skip(reason)
  const store = await import('@/lib/notes/store')
  const { writeGated, appendLogGated } = await import('@/lib/notes/contextService')
  await setup()
  try {
    await store.createNote(CONTEXT, 'agents/digest/index.md', BRIEF, ACTOR)
    await store.createNote(CONTEXT, 'agents/other/index.md', BRIEF.replace('Digest', 'Other'), ACTOR)
    const author = principal(AUTHOR, false)
    const own = (path: string, content = '---\ntitle: Report\n---\nDone.\n') => writeGated(author, CONTEXT, path, content, 'agent', 'agent:digest')

    assert.equal((await own('agents/digest/2026-01-31.md')).status, 'applied')
    assert.equal((await own('agents/digest/state.md')).status, 'applied')
    assert.equal((await appendLogGated(author, CONTEXT, 'agents/digest/state.md', 'ran', 'agent', 'agent:digest')).status, 'applied')

    const brief = await own('agents/digest/index.md', BRIEF.replace('digest', 'anything I like'))
    assert.equal(brief.status, 'denied')
    assert.match(brief.status === 'denied' ? brief.reason : '', /frozen for AI/)
    assert.equal((await own('agents/digest/activation.md', '---\ntype: agent-activation\nactive: true\nschedule: hourly\n---\n')).status, 'denied')
    assert.equal((await own('agents/other/report.md')).status, 'denied', "another agent's folder")
    assert.equal((await own('agents/digest/deep/report.md')).status, 'denied', 'no sub-folders of its own')
    assert.equal((await writeGated(author, CONTEXT, 'agents/digest/report.md', '# x', 'agent', 'mcp')).status, 'denied', 'a generic AI write is not the agent')
    assert.equal((await writeGated(author, CONTEXT, 'agents/digest/report.md', '# x', 'maintenance')).status, 'denied')

    // The activation sitting beside the brief is untouched by any of that.
    assert.equal(await store.readNoteOrNull(CONTEXT, 'agents/digest/activation.md'), null)
    // And a person still writes the folder freely.
    assert.equal((await writeGated(author, CONTEXT, 'agents/digest/notes.md', '# mine')).status, 'applied')
  } finally {
    await teardown()
  }
})

test('the activation beside the brief is admin-only and drives the state row; deleting the folder retires the agent', async (t) => {
  const reason = await probe()
  if (reason) return t.skip(reason)
  const store = await import('@/lib/notes/store')
  const { writeGated } = await import('@/lib/notes/contextService')
  const { newActivationNote } = await import('@/lib/agents/config')
  await setup()
  try {
    await store.createNote(CONTEXT, 'agents/digest/index.md', BRIEF, ACTOR)
    const live = newActivationNote({ active: true, schedule: { kind: 'hourly' } })
    const byMember = await writeGated(principal(AUTHOR, false), CONTEXT, 'agents/digest/activation.md', live)
    assert.equal(byMember.status, 'denied')
    assert.match(byMember.status === 'denied' ? byMember.reason : '', /Only space admins can activate/)

    assert.equal((await writeGated(principal(ADMIN, true), CONTEXT, 'agents/digest/activation.md', live)).status, 'applied')
    const on = await prisma!.agentState.findUniqueOrThrow({ where: { agent_identity: { spaceId: SPACE, name: 'digest' } } })
    assert.equal(on.active, true)
    assert.ok(on.nextRunAt, 'an hourly clock was derived from the note')

    // The folder IS the agent, and like every entity folder its path is the
    // entity's identity: it cannot be renamed, only deleted — and deleting it
    // takes the brief, the activation and the node, and retires the row (the
    // run history hangs off it, so it stays).
    await assert.rejects(store.renameFolder(CONTEXT, 'agents/digest', 'agents/summary', ACTOR), /entity's identity/)
    await store.deleteFolder(CONTEXT, 'agents/digest')
    assert.equal(await store.readNoteOrNull(CONTEXT, 'agents/digest/index.md'), null)
    assert.equal(await store.readNoteOrNull(CONTEXT, 'agents/digest/activation.md'), null)
    assert.equal(await prisma!.node.findUnique({ where: { id: 'agent:digest' } }), null, 'the node went with the brief')
    const gone = await prisma!.agentState.findUniqueOrThrow({ where: { agent_identity: { spaceId: SPACE, name: 'digest' } } })
    assert.equal(gone.active, false)
    assert.equal(gone.deactivatedReason, 'deleted')
  } finally {
    await teardown()
  }
})
