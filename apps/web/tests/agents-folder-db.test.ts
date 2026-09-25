/**
 * An agent's folder, against the local Docker Postgres: the brief written at
 * `agents/<name>/index.md` makes the `agent:` node and is held to the entity
 * contract; the write gate opens the rest of the folder to that agent's own
 * runs and nothing else; the activation is in that same brief and drives the
 * state row; the folder is the agent's identity — never renamed, and a
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
    assert.equal((await own('agents/digest/memory.md')).status, 'applied')
    assert.equal((await appendLogGated(author, CONTEXT, 'agents/digest/memory.md', 'ran', 'agent', 'agent:digest')).status, 'applied')

    const brief = await own('agents/digest/index.md', BRIEF.replace('digest', 'anything I like'))
    assert.equal(brief.status, 'denied')
    assert.match(brief.status === 'denied' ? brief.reason : '', /frozen for AI/)
    assert.equal((await own('agents/digest/activation.md', '---\ntype: agent-activation\nactive: true\nschedule: hourly\n---\n')).status, 'denied', 'nor the pre-merge activation note')
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

test('how it runs is the record: whoever can edit the brief turns it on, runs_as is an admin\'s, and the note refuses run keys', async (t) => {
  const reason = await probe()
  if (reason) return t.skip(reason)
  const store = await import('@/lib/notes/store')
  const { writeGated } = await import('@/lib/notes/contextService')
  const { configureAgent } = await import('@/lib/agents/service')
  const { agentConfigOf } = await import('@/lib/agents/briefs')
  const { parseFrontmatter } = await import('@/lib/notes/shared/markdown')
  await setup()
  try {
    await store.createNote(CONTEXT, 'agents/digest/index.md', BRIEF, ACTOR)
    // The older shape's `model:` was folded into the record and taken out of the note.
    assert.equal((await agentConfigOf(SPACE, 'digest'))?.model, 'openai/gpt-4.1-mini')
    assert.equal(parseFrontmatter((await store.readNoteOrNull(CONTEXT, 'agents/digest/index.md')) ?? '').model, undefined)

    // A note may not say how it runs any more — not even its own author.
    const current = (await store.readNoteOrNull(CONTEXT, 'agents/digest/index.md')) ?? ''
    const withKey = current.replace('---\n', '---\nschedule: hourly\n')
    const refused = await writeGated(principal(AUTHOR, false), CONTEXT, 'agents/digest/index.md', withKey)
    assert.equal(refused.status, 'denied')
    assert.match(refused.status === 'denied' ? refused.reason : '', /configure_agent/)
    // Prose is still the author's to edit.
    assert.equal((await writeGated(principal(AUTHOR, false), CONTEXT, 'agents/digest/index.md', current.replace('write a digest', 'write a short digest'))).status, 'applied')

    // A member who can edit the brief turns the agent on — but may only run it
    // as themselves; naming somebody else's connections is an admin's call.
    const member = principal(AUTHOR, false)
    const asOther = await configureAgent(member, CONTEXT, 'digest', { runsAs: ADMIN })
    assert.equal(asOther.ok, false)
    assert.match(asOther.ok ? '' : asOther.error, /run as someone else/)
    assert.ok((await configureAgent(member, CONTEXT, 'digest', { runsAs: AUTHOR })).ok)
    assert.ok((await configureAgent(principal(ADMIN, true), CONTEXT, 'digest', { runsAs: ADMIN })).ok, 'an admin may repoint it')
    // And only a person adds themselves to who it runs for.
    const forOther = await configureAgent(member, CONTEXT, 'digest', { runsFor: [{ userId: ADMIN, at: null, timezone: null, model: null }] })
    assert.equal(forOther.ok, false)

    const on = await configureAgent(member, CONTEXT, 'digest', { active: true, schedule: { kind: 'hourly' }, timezone: 'UTC' })
    assert.ok(on.ok, on.ok ? '' : on.error)
    const row = await prisma!.agentState.findUniqueOrThrow({ where: { agent_identity: { spaceId: SPACE, name: 'digest' } } })
    assert.equal(row.active, true)
    assert.ok(row.nextRunAt, 'an hourly clock was derived from the record')
    assert.equal(row.runAsUserId, ADMIN)
    assert.ok((await prisma!.agentConfigChange.count({ where: { spaceId: SPACE, name: 'digest' } })) >= 3, 'each change is kept')

    // The folder IS the agent, and its name is the agent's identity: it moves
    // between folders but is never renamed, and deleting it
    // takes the brief and the node, and retires the row (the run history
    // hangs off it, so it stays).
    await assert.rejects(store.renameFolder(CONTEXT, 'agents/digest', 'agents/summary', ACTOR), /keep the name/)
    await store.deleteFolder(CONTEXT, 'agents/digest')
    assert.equal(await store.readNoteOrNull(CONTEXT, 'agents/digest/index.md'), null)
    assert.equal(await prisma!.node.findUnique({ where: { id: 'agent:digest' } }), null, 'the node went with the brief')
    const gone = await prisma!.agentState.findUniqueOrThrow({ where: { agent_identity: { spaceId: SPACE, name: 'digest' } } })
    assert.equal(gone.active, false)
    assert.equal(gone.deactivatedReason, 'deleted')
  } finally {
    await teardown()
  }
})

test('a brief in the older shape is adopted: its keys and a pre-merge activation.md become the record', async (t) => {
  const reason = await probe()
  if (reason) return t.skip(reason)
  const store = await import('@/lib/notes/store')
  const { agentConfigOf } = await import('@/lib/agents/briefs')
  const { parseFrontmatter } = await import('@/lib/notes/shared/markdown')
  await setup()
  try {
    const { adoptNoteConfig } = await import('@/lib/agents/hooks')
    // Rows as they stood before the record: written straight to the table, as
    // a deployment's existing notes are, and adopted the way the script does.
    await prisma!.contextNote.createMany({
      data: [
        { spaceId: SPACE, ownerKey: 'shared', path: 'agents/digest/activation.md', createdBy: AUTHOR, content: '---\ntype: agent-activation\nactive: true\nschedule: hourly\ntimezone: UTC\n---\n' },
        { spaceId: SPACE, ownerKey: 'shared', path: 'agents/digest/index.md', createdBy: AUTHOR, content: BRIEF.replace('---\nEach', `for:\n  - user: ${AUTHOR}\n---\nEach`) },
      ],
    })
    assert.equal(await agentConfigOf(SPACE, 'digest'), null, 'no record yet — the note still says')
    await adoptNoteConfig(SPACE, 'digest')
    const config = await agentConfigOf(SPACE, 'digest')
    assert.ok(config, 'the brief now has a record')
    assert.equal(config.active, true, 'the older shape keeps running')
    assert.deepEqual(config.schedule, { kind: 'hourly' })
    assert.equal(config.model, 'openai/gpt-4.1-mini')
    assert.deepEqual(config.runsFor.map((e) => e.userId), [AUTHOR])
    const fm = parseFrontmatter((await store.readNoteOrNull(CONTEXT, 'agents/digest/index.md')) ?? '')
    assert.equal(fm.model, undefined)
    assert.equal(fm.for, undefined)
    const row = await prisma!.agentState.findUniqueOrThrow({ where: { agent_identity: { spaceId: SPACE, name: 'digest' } } })
    assert.equal(row.active, true)
    assert.ok(row.configuredAt)
  } finally {
    await teardown()
  }
})

test('an agent filed in a folder of the space’s own is the same agent, found where it is', async (t) => {
  const reason = await probe()
  if (reason) return t.skip(reason)
  const store = await import('@/lib/notes/store')
  const { findAgentBrief } = await import('@/lib/agents/briefs')
  const { agentFolderIn, agentContaining } = await import('@/lib/agents/location')
  const { writeGated } = await import('@/lib/notes/contextService')
  const { parseFrontmatter } = await import('@/lib/notes/shared/markdown')
  await setup()
  try {
    await store.createNote(CONTEXT, 'agents/digest/index.md', BRIEF, ACTOR)
    await store.createNote(CONTEXT, 'agents/digest/memory.md', '# Memory\n', ACTOR)
    const before = await prisma!.agentState.findUniqueOrThrow({ where: { agent_identity: { spaceId: SPACE, name: 'digest' } } })

    // Out of agents/ into a team's folder: same note, same row, same node.
    await store.renameFolder(CONTEXT, 'agents/digest', 'teams/growth/digest', ACTOR)
    assert.equal(await agentFolderIn(SPACE, 'digest'), 'teams/growth/digest')
    assert.equal((await findAgentBrief(SPACE, 'digest'))?.path, 'teams/growth/digest/index.md')
    const after = await prisma!.agentState.findUniqueOrThrow({ where: { agent_identity: { spaceId: SPACE, name: 'digest' } } })
    assert.equal(after.id, before.id, 'the state row carried over')
    assert.equal(after.briefNoteId, before.briefNoteId)
    const node = await prisma!.node.findUnique({ where: { id: 'agent:digest' } })
    assert.equal((node?.metadata as { notePath?: string }).notePath, 'teams/growth/digest/index.md')
    assert.equal(parseFrontmatter((await store.readNoteOrNull(CONTEXT, 'teams/growth/digest/index.md')) ?? '').type, 'agent')
    assert.deepEqual(await agentContaining(SPACE, 'teams/growth/digest/memory.md'), { name: 'digest', folder: 'teams/growth/digest', file: 'own' })
    assert.equal(await agentContaining(SPACE, 'teams/growth/plan.md'), null)

    // Renamed, it would be another agent — refused; into a built-in folder, refused.
    await assert.rejects(store.renameFolder(CONTEXT, 'teams/growth/digest', 'teams/growth/summary', ACTOR), /keep the name/)
    await assert.rejects(store.renameFolder(CONTEXT, 'teams/growth/digest', 'people/digest', ACTOR), /built-in folders/)

    // The gate keeps agents/'s rules there: AI writes only its own notes, and a
    // second agent may not take the name.
    const author = principal(AUTHOR, false)
    const own = await writeGated(author, CONTEXT, 'teams/growth/digest/report.md', '# Report\n', 'agent', 'agent:digest')
    assert.equal(own.status, 'applied')
    const other = await writeGated(author, CONTEXT, 'teams/growth/digest/report.md', '# Report\n', 'agent', 'agent:someone-else')
    assert.equal(other.status, 'denied')
    const brief = await writeGated(author, CONTEXT, 'teams/growth/digest/index.md', BRIEF.replace('Digest', 'Changed'), 'agent', 'agent:digest')
    assert.equal(brief.status, 'denied')
    const clash = await writeGated(author, CONTEXT, 'teams/sales/digest/index.md', '---\ntype: agent\ntitle: Twin\n---\nAnother.\n')
    assert.equal(clash.status, 'denied')
    assert.match(clash.status === 'denied' ? clash.reason : '', /already exists/)

    // And back home.
    await store.renameFolder(CONTEXT, 'teams/growth/digest', 'agents/digest', ACTOR)
    assert.equal(await agentFolderIn(SPACE, 'digest'), 'agents/digest')
  } finally {
    await teardown()
  }
})

test('a landing folder moves into a folder of the space’s own, and new things land there', async (t) => {
  const reason = await probe()
  if (reason) return t.skip(reason)
  const store = await import('@/lib/notes/store')
  const { landingFolderOf } = await import('@/lib/notes/landing')
  const { agentFolderIn } = await import('@/lib/agents/location')
  const { createAgentBrief } = await import('@/lib/agents/service')
  const { writeGated } = await import('@/lib/notes/contextService')
  const { parseFrontmatter } = await import('@/lib/notes/shared/markdown')
  await setup()
  try {
    await store.createNote(CONTEXT, 'agents/digest/index.md', BRIEF, ACTOR)
    await store.createNote(CONTEXT, 'teams/index.md', '---\ntitle: Teams\n---\n', ACTOR)

    // The whole folder goes; the agent in it keeps its name and its row.
    await store.renameFolder(CONTEXT, 'agents', 'teams/agents', ACTOR)
    assert.equal(await landingFolderOf(CONTEXT, 'agents'), 'teams/agents')
    assert.equal(parseFrontmatter((await store.readNoteOrNull(CONTEXT, 'teams/agents/index.md')) ?? '').home, 'agents')
    assert.equal(await agentFolderIn(SPACE, 'digest'), 'teams/agents/digest')

    // A new agent lands there, and so does a note addressed to the built-in name.
    const made = await createAgentBrief(principal(ADMIN, true), CONTEXT, { name: 'weekly', title: 'Weekly', body: 'Write the week up.' })
    assert.ok(made.ok, made.ok ? '' : made.error)
    assert.equal(await agentFolderIn(SPACE, 'weekly'), 'teams/agents/weekly')
    const aliased = await writeGated(principal(ADMIN, true), CONTEXT, 'agents/notes.md', '# Notes\n')
    assert.equal(aliased.status === 'applied' ? aliased.path : null, 'teams/agents/notes.md')

    // Never into another built-in folder, and nothing else takes the name.
    await assert.rejects(store.renameFolder(CONTEXT, 'teams/agents', 'people/agents', ACTOR), /built-in/)

    // Back to its own name: the index stops saying it moved.
    await store.renameFolder(CONTEXT, 'teams/agents', 'agents', ACTOR)
    assert.equal(await landingFolderOf(CONTEXT, 'agents'), 'agents')
    assert.equal(parseFrontmatter((await store.readNoteOrNull(CONTEXT, 'agents/index.md')) ?? '').home, undefined)

    // Deleted only while it holds nothing; then the root index remembers.
    await assert.rejects(store.deleteFolder(CONTEXT, 'agents'), /holds/)
    await store.createNote(CONTEXT, 'index.md', '---\ntitle: Space\n---\n', ACTOR).catch(() => undefined)
    await store.deleteFolder(CONTEXT, 'agents/digest')
    await store.deleteFolder(CONTEXT, 'agents/weekly')
    await store.deleteNote(CONTEXT, 'agents/notes.md')
    await store.deleteFolder(CONTEXT, 'agents')
    assert.deepEqual(parseFrontmatter((await store.readNoteOrNull(CONTEXT, 'index.md')) ?? '').hidden, ['agents'])
  } finally {
    await teardown()
  }
})
