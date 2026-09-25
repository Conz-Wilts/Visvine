// A Tool is its folder, wherever the space filed it (lib/tools/location.ts).
//
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-folder-db.test.ts
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
    if (!dbUrl) return 'no local DATABASE_URL (apps/web/.env) — the tool folder test needs the Docker Postgres'
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

const SPACE = `test-tool-folder-${process.pid}`
const AUTHOR = `test-tool-folder-author-${process.pid}`
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
  await p.space.create({ data: { id: SPACE, name: 'tool folder test', timezone: 'UTC' } })
  await p.user.create({ data: { id: AUTHOR, email: `${AUTHOR}@local.test`, name: AUTHOR } })
  await p.spaceMember.create({ data: { spaceId: SPACE, userId: AUTHOR } })
}

async function teardown() {
  const p = prisma!
  await p.appToolInstall.deleteMany({ where: { spaceId: SPACE } })
  await p.appToolBuild.deleteMany({ where: { spaceId: SPACE } })
  await p.contextNote.deleteMany({ where: { spaceId: SPACE } })
  await p.contextFolder.deleteMany({ where: { spaceId: SPACE } })
  await p.node.deleteMany({ where: { spaceId: SPACE } })
  await p.spaceMember.deleteMany({ where: { spaceId: SPACE } })
  await p.space.deleteMany({ where: { id: SPACE } })
  await p.user.deleteMany({ where: { id: AUTHOR } })
}

test('a Tool filed in a folder of the space’s own is the same Tool, built where it is', async (t) => {
  const reason = await probe()
  if (reason) return t.skip(reason)
  const store = await import('@/lib/notes/store')
  const { toolFolderIn, toolContaining } = await import('@/lib/tools/location')
  const { readToolSources } = await import('@/lib/tools/builds')
  const { newToolIndexNote, wrapSource } = await import('@/lib/tools/config')
  const { writeGated } = await import('@/lib/notes/contextService')
  const { parseFrontmatter } = await import('@/lib/notes/shared/markdown')
  await setup()
  try {
    await store.createNote(CONTEXT, 'tools/deals/index.md', newToolIndexNote({ name: 'deals', title: 'Deals' }), ACTOR)
    await store.createNote(CONTEXT, 'tools/deals/ui.md', wrapSource('export default () => null', 'tsx'), ACTOR)

    await store.renameFolder(CONTEXT, 'tools/deals', 'teams/sales/deals', ACTOR)
    assert.equal(await toolFolderIn(SPACE, 'deals'), 'teams/sales/deals')
    const sources = await readToolSources(SPACE, 'deals')
    assert.ok(sources.index && sources.ui, 'the build reads its sources where they are')
    assert.equal(parseFrontmatter((await store.readNoteOrNull(CONTEXT, 'teams/sales/deals/index.md')) ?? '').type, 'tool')
    const node = await prisma!.node.findUnique({ where: { id: 'tool:deals' } })
    assert.equal((node?.metadata as { notePath?: string }).notePath, 'teams/sales/deals/index.md')
    assert.equal((await toolContaining(SPACE, 'teams/sales/deals/ui.md'))?.kind, 'ui')
    const build = await prisma!.appToolBuild.findUnique({ where: { app_tool_build_identity: { spaceId: SPACE, name: 'deals' } } })
    assert.ok(build, 'the build survived the move')

    await assert.rejects(store.renameFolder(CONTEXT, 'teams/sales/deals', 'teams/sales/pipeline', ACTOR), /keep the name/)
    await assert.rejects(store.renameFolder(CONTEXT, 'teams/sales/deals', 'people/deals', ACTOR), /built-in folders/)

    const author = principal(AUTHOR, false)
    const ai = await writeGated(author, CONTEXT, 'teams/sales/deals/ui.md', wrapSource('export default () => 1', 'tsx'), 'agent', 'agent:x')
    assert.equal(ai.status, 'denied', 'a Tool anywhere is frozen for AI')
    const twin = await writeGated(author, CONTEXT, 'teams/ops/deals/index.md', newToolIndexNote({ name: 'deals', title: 'Twin' }))
    assert.equal(twin.status, 'denied')

    await store.renameFolder(CONTEXT, 'teams/sales/deals', 'tools/deals', ACTOR)
    assert.equal(await toolFolderIn(SPACE, 'deals'), 'tools/deals')
  } finally {
    await teardown()
  }
})
