/**
 * A name is not an identity: an agent deleted and written again at the same
 * path is a NEW agent, and does not inherit the old one's operational life.
 *
 * `agent_state` is keyed by (space, name), so the row survives the note. What
 * tells the two apart is `brief_note_id` — the context_notes row the state was
 * derived from — and `syncAgentState` retires the previous incarnation when a
 * different note turns up at the name: its runs, its subscribers, the mail
 * still addressed to it. A RESTORE of the trashed note keeps the note's id, so
 * it is the same agent and keeps all of it.
 *
 * Rows racing rows again, so this talks to the LOCAL Docker Postgres and SKIPS
 * loudly when there is none (same guard as tests/agents-tick.test.ts).
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
      const env = readFileSync(join(root, '.env'), 'utf8')
      const m = env.match(/^DATABASE_URL=(.+)$/m)
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
    if (!dbUrl) return 'no local DATABASE_URL (apps/web/.env) — agent rebirth tests need the Docker Postgres'
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

const SPACE = `test-agents-rebirth-${process.pid}`
const AUTHOR = `test-rebirth-author-${process.pid}`
const SUBSCRIBER = `test-rebirth-sub-${process.pid}`
const NAME = 'digest'
const PATH = `agents/${NAME}/index.md`
const BRIEF = ['---', 'title: Digest', 'active: false', '---', '', 'Say something.', ''].join('\n')

async function teardown() {
  const p = prisma!
  await p.agentEvent.deleteMany({ where: { spaceId: SPACE } })
  await p.agentSubscription.deleteMany({ where: { spaceId: SPACE } })
  await p.agentRun.deleteMany({ where: { spaceId: SPACE } })
  await p.agentState.deleteMany({ where: { spaceId: SPACE } })
  await p.contextNote.deleteMany({ where: { spaceId: SPACE } })
  await p.spaceMember.deleteMany({ where: { spaceId: SPACE } })
  await p.space.deleteMany({ where: { id: SPACE } })
  await p.user.deleteMany({ where: { id: { in: [AUTHOR, SUBSCRIBER] } } })
}

async function setup() {
  const p = prisma!
  await teardown()
  await p.space.create({ data: { id: SPACE, name: 'agent rebirth test', timezone: 'UTC' } })
  for (const id of [AUTHOR, SUBSCRIBER]) {
    await p.user.create({ data: { id, email: `${id}@local.test`, name: id } })
    await p.spaceMember.create({ data: { spaceId: SPACE, userId: id } })
  }
}

/** Write the brief note the way the store does, and derive the state row. */
async function writeBrief(): Promise<string> {
  const { syncAgentState } = await import('@/lib/agents/hooks')
  const note = await prisma!.contextNote.create({
    data: { spaceId: SPACE, ownerKey: 'shared', path: PATH, content: BRIEF, createdBy: AUTHOR },
  })
  await syncAgentState(SPACE, NAME)
  return note.id
}

/** Trash it the way `deleteNote` does: the path is freed, the row stays. */
async function trashBrief(noteId: string) {
  await prisma!.contextNote.update({
    where: { id: noteId },
    data: { deletedAt: new Date(), deletedPath: PATH, path: `:trash:${noteId}` },
  })
}

/** The life a live agent accumulates: a run on its page, a subscriber, mail. */
async function giveItALife() {
  const p = prisma!
  const state = await p.agentState.findUniqueOrThrow({ where: { agent_identity: { spaceId: SPACE, name: NAME } } })
  await p.agentRun.create({
    data: { stateId: state.id, spaceId: SPACE, name: NAME, trigger: 'manual', status: 'succeeded', summary: 'did a thing' },
  })
  await p.agentSubscription.create({ data: { spaceId: SPACE, name: NAME, userId: SUBSCRIBER } })
  await p.agentEvent.create({
    data: { spaceId: SPACE, agentName: NAME, kind: 'note_written', source: 'notes/x.md', summary: 'x changed' },
  })
  return state.id
}

async function census() {
  const p = prisma!
  const state = await p.agentState.findUniqueOrThrow({ where: { agent_identity: { spaceId: SPACE, name: NAME } } })
  return {
    stateId: state.id,
    briefNoteId: state.briefNoteId,
    runs: await p.agentRun.count({ where: { stateId: state.id } }),
    subscribers: await p.agentSubscription.count({ where: { spaceId: SPACE, name: NAME } }),
    events: await p.agentEvent.count({ where: { spaceId: SPACE, agentName: NAME } }),
  }
}

test('an agent rewritten at a deleted one\'s name starts with an empty page', async (t) => {
  const skip = await probe()
  if (skip) return t.skip(skip)
  await setup()
  t.after(teardown)

  const first = await writeBrief()
  assert.equal((await census()).briefNoteId, first, 'the state row is bound to the note it came from')
  await giveItALife()
  assert.deepEqual(
    (({ runs, subscribers, events }) => ({ runs, subscribers, events }))(await census()),
    { runs: 1, subscribers: 1, events: 1 },
  )

  await trashBrief(first)
  const second = await writeBrief()
  assert.notEqual(second, first)

  const after = await census()
  assert.equal(after.briefNoteId, second, 'the row now belongs to the new note')
  assert.equal(after.runs, 0, 'the old agent\'s runs do not show on the new one\'s page')
  assert.equal(after.subscribers, 0, 'nobody is silently signed up to an agent they never saw')
  assert.equal(after.events, 0, 'mail addressed to the old agent is not delivered to this one')
})

test('restoring the trashed brief keeps everything: same note, same agent', async (t) => {
  const skip = await probe()
  if (skip) return t.skip(skip)
  await setup()
  t.after(teardown)

  const { syncAgentState } = await import('@/lib/agents/hooks')
  const noteId = await writeBrief()
  await giveItALife()
  await trashBrief(noteId)
  // A restore puts the same row back at the same path (store.restoreTrash).
  await prisma!.contextNote.update({ where: { id: noteId }, data: { deletedAt: null, deletedPath: null, path: PATH } })
  await syncAgentState(SPACE, NAME)

  const after = await census()
  assert.equal(after.briefNoteId, noteId)
  assert.equal(after.runs, 1, 'a restore is the same agent — its history comes back with it')
  assert.equal(after.subscribers, 1)
  assert.equal(after.events, 1)
})

test('a state row written before brief_note_id existed adopts its note, and keeps its runs', async (t) => {
  const skip = await probe()
  if (skip) return t.skip(skip)
  await setup()
  t.after(teardown)

  const { syncAgentState } = await import('@/lib/agents/hooks')
  const noteId = await writeBrief()
  await giveItALife()
  await prisma!.agentState.updateMany({ where: { spaceId: SPACE, name: NAME }, data: { briefNoteId: null } })

  await syncAgentState(SPACE, NAME)
  const after = await census()
  assert.equal(after.briefNoteId, noteId, 'an unstamped row binds to what it sees')
  assert.equal(after.runs, 1, 'and nothing is thrown away on the strength of a null')
})
