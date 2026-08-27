/**
 * A directory entity is a folder from its first write: `people/<slug>/index.md`
 * is the person's note, and a write addressed at the flat alias
 * (`people/<slug>.md`) lands there too. These run the real store against the
 * local Docker Postgres (`apps/web/.env` DATABASE_URL, host localhost only) and
 * skip loudly when there is none, the way tests/agents-tick.test.ts does.
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
type Store = typeof import('@/lib/notes/store')
let prisma: Prisma | null = null
let store: Store | null = null
let probed: Promise<string | null> | null = null

function probe(): Promise<string | null> {
  if (probed) return probed
  probed = (async () => {
    if (!dbUrl) return 'no local DATABASE_URL (apps/web/.env) — entity folder tests need the Docker Postgres'
    try {
      prisma = (await import('@/lib/prisma')).default
      await prisma.$queryRaw`SELECT 1`
      store = await import('@/lib/notes/store')
      return null
    } catch (e) {
      prisma = null
      return `local Postgres not reachable (${e instanceof Error ? e.message.split('\n')[0] : String(e)})`
    }
  })()
  return probed
}

import { parseFrontmatter } from '@/lib/notes/shared/markdown'

const SPACE = `test-entity-folders-${process.pid}`
const USER = `test-entity-folders-user-${process.pid}`
const actor = { id: USER, name: 'Entity Folders Test', email: null }
const shared = { spaceId: SPACE, ownerKey: 'shared' }

async function setup() {
  const p = prisma!
  await teardown()
  await p.space.create({ data: { id: SPACE, name: 'entity folders test', timezone: 'UTC' } })
  await p.user.create({ data: { id: USER, email: `${USER}@local.test`, name: USER } })
  await p.spaceMember.create({ data: { spaceId: SPACE, userId: USER } })
  await p.node.create({ data: { id: 'person:jo', type: 'person', name: 'Jo', spaceId: SPACE } })
  await p.node.create({ data: { id: 'event:launch', type: 'event', name: 'Launch', spaceId: SPACE } })
}

async function teardown() {
  const p = prisma!
  await p.noteProjectionJob.deleteMany({ where: { spaceId: SPACE } })
  await p.contextGrant.deleteMany({ where: { spaceId: SPACE } })
  await p.contextFolder.deleteMany({ where: { spaceId: SPACE } })
  await p.contextNote.deleteMany({ where: { spaceId: SPACE } })
  await p.link.deleteMany({ where: { spaceId: SPACE } })
  await p.node.deleteMany({ where: { spaceId: SPACE } })
  await p.spaceMember.deleteMany({ where: { spaceId: SPACE } })
  await p.space.deleteMany({ where: { id: SPACE } })
  await p.user.deleteMany({ where: { id: USER } })
}

async function livePaths(): Promise<string[]> {
  const rows = await prisma!.contextNote.findMany({
    where: { spaceId: SPACE, ownerKey: 'shared', deletedAt: null },
    select: { path: true },
    orderBy: { path: 'asc' },
  })
  return rows.map((r) => r.path)
}

test('a create addressed at the flat alias builds the entity folder', async (t) => {
  const skip = await probe()
  if (skip) return t.skip(skip)
  await setup()
  try {
    const s = store!
    const content = '---\ntitle: Jo\ntype: Person\nnode: person:jo\n---\n\nJo runs ops.\n'
    const note = await s.createNote(shared, 'people/jo.md', content, actor)
    assert.equal(note.path, 'people/jo/index.md')
    const paths = await livePaths()
    assert.ok(paths.includes('people/jo/index.md'), `index missing in ${paths}`)
    assert.ok(paths.includes('people/index.md'), `namespace index missing in ${paths}`)
    assert.ok(!paths.includes('people/jo.md'), 'the flat path must never hold the note')
    // The index IS the person: entity type and node survive the contract.
    const fm = parseFrontmatter(await s.readNote(shared, 'people/jo/index.md'))
    assert.equal(fm.type, 'Person')
    assert.equal(fm.node, 'person:jo')
    assert.ok((await s.readNote(shared, 'people/jo/index.md')).includes('Jo runs ops.'))
    // Reads through the alias reach the same note.
    assert.equal(await s.canonicalEntityWritePath(shared, 'people/jo.md'), 'people/jo/index.md')
    // A second create at either form is the idempotent "already exists" case.
    await assert.rejects(s.createNote(shared, 'people/jo.md', content, actor), /already exists/i)
    await assert.rejects(s.createNote(shared, 'people/jo/index.md', content, actor), /already exists/i)
  } finally {
    await teardown()
  }
})

test('a sub-note written under an entity with no note yet stubs the folder index', async (t) => {
  const skip = await probe()
  if (skip) return t.skip(skip)
  await setup()
  try {
    const s = store!
    await s.writeNote(shared, 'events/launch/run-of-show.md', '---\ntitle: Run of show\n---\n\n9am doors.\n', actor)
    const paths = await livePaths()
    assert.deepEqual(
      paths.filter((p) => p.startsWith('events/')),
      ['events/index.md', 'events/launch/index.md', 'events/launch/run-of-show.md'],
    )
    const fm = parseFrontmatter(await s.readNote(shared, 'events/launch/index.md'))
    assert.equal(fm.type, 'Event')
    assert.equal(fm.node, 'event:launch')
    assert.equal(fm.title, 'Launch')
  } finally {
    await teardown()
  }
})

test('a sub-note under a namespace with no entity behind it is refused', async (t) => {
  const skip = await probe()
  if (skip) return t.skip(skip)
  await setup()
  try {
    await assert.rejects(
      store!.writeNote(shared, 'people/nobody/comms.md', '---\ntitle: x\n---\n', actor),
      /not a directory entity/,
    )
  } finally {
    await teardown()
  }
})
