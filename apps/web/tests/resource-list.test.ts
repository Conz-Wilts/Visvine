/**
 * The one resources list: what a URL asks for, and what the query returns —
 * filtered by kind, channel, person, date and search (name, unfurl and the
 * text extracted from a file), paged, and never more than the viewer may see.
 * The query half runs against the local Postgres and skips without it.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { listQueryString, parseListQuery, PAGE_SIZE } from '../lib/resources/shared/listQuery'
import { localDb } from './support/localDb'

test('a list query is read from a URL, defaults filled and junk refused', () => {
  const q = parseListQuery(new URLSearchParams('kind=pdf&channel=c1&by=me&q=%20plan%20&sort=size&trash=1&offset=60&since=2026-09-01'))
  assert.deepEqual(q, {
    kind: 'pdf', channelId: 'c1', by: 'me', q: 'plan', since: '2026-09-01T00:00:00.000Z',
    sort: 'size', trash: true, offset: 60, limit: PAGE_SIZE,
  })
  const junk = parseListQuery(new URLSearchParams('kind=exe&sort=random&offset=-5&limit=9999&since=yesterday'))
  assert.equal(junk.kind, 'all')
  assert.equal(junk.sort, 'recent')
  assert.equal(junk.offset, 0)
  assert.equal(junk.limit, 100)
  assert.equal(junk.since, null)
  assert.equal(listQueryString({ kind: 'all', sort: 'recent', q: 'logo' }), 'q=logo', 'defaults leave the key short')
})

const spaceId = `test-list-${randomUUID().slice(0, 8)}`
const ana = randomUUID()
const ben = randomUUID()
let board = ''
let skip: string | null = null

before(async () => {
  const db = await localDb()
  skip = db.skip
  const prisma = db.prisma
  if (!prisma) return
  for (const [id, name] of [[ana, 'Ana'], [ben, 'Ben']] as const) {
    await prisma.user.create({ data: { id, name, email: `${id}@test.local` } })
  }
  await prisma.space.create({ data: { id: spaceId, name: 'List test' } })
  await prisma.spaceMember.createMany({ data: [{ userId: ana, spaceId }, { userId: ben, spaceId }] })
  const { createChannelConversation } = await import('@/lib/messages')
  board = (await createChannelConversation(ana, spaceId, 'board', undefined, undefined, undefined, undefined, undefined, 'PRIVATE')).id

  const { addShares } = await import('@/lib/resources/shares')
  const make = async (name: string, kind: string, by: string, share: string | null, extra: Record<string, unknown> = {}) => {
    const row = await prisma.resource.create({
      data: { spaceId, name, fileType: kind, kind: kind as never, uploadedBy: by, createdBy: by, fileSize: name.length * 100, ...extra },
    })
    await addShares([{ resourceId: row.id, spaceId, conversationId: share, sharedBy: by, via: 'upload' }])
    return row
  }
  await make('launch-logo.png', 'image', ana, null)
  await make('team-photo.jpg', 'image', ben, null, { createdAt: new Date('2025-01-01') })
  await make('Launch plan.pdf', 'pdf', ana, null, { sourcePath: `resources/plan-${spaceId}/Launch plan.pdf` })
  await make('Board minutes.pdf', 'pdf', ana, board)
  const path = `resources/plan-${spaceId}/Launch plan.pdf`
  const source = await prisma.contextSource.create({
    data: {
      spaceId, ownerKey: 'shared', path, name: 'Launch plan.pdf', kind: 'pdf', mimeType: 'application/pdf',
      sizeBytes: 100, gcsPath: '', status: 'ready', chunkCount: 1, createdBy: ana,
    },
  })
  await prisma.contextSourceChunk.create({
    data: { sourceId: source.id, spaceId, ownerKey: 'shared', path, seq: 0, text: 'The venue is the Auckland waterfront.' },
  })
})

after(async () => {
  const { prisma } = await localDb()
  if (!prisma) return
  await prisma.contextSourceChunk.deleteMany({ where: { spaceId } }).catch(() => {})
  await prisma.contextNote.deleteMany({ where: { spaceId } }).catch(() => {})
  await prisma.contextGrant.deleteMany({ where: { spaceId } }).catch(() => {})
  await prisma.node.deleteMany({ where: { spaceId } }).catch(() => {})
  await prisma.conversation.deleteMany({ where: { spaceId } }).catch(() => {})
  await prisma.space.delete({ where: { id: spaceId } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: [ana, ben] } } }).catch(() => {})
})

async function names(user: string, params: string): Promise<string[]> {
  const { listResources } = await import('@/lib/resources/list')
  const { resourceViewer } = await import('@/lib/resources/visibility')
  const page = await listResources(spaceId, await resourceViewer(spaceId, user), parseListQuery(new URLSearchParams(params)))
  return page.items.map((r) => r.name)
}

test('kind, person and date narrow the list', async (t) => {
  if (skip) return t.skip(skip)
  assert.deepEqual((await names(ana, 'kind=image&sort=name')), ['launch-logo.png', 'team-photo.jpg'])
  assert.deepEqual(await names(ana, 'kind=image&by=me'), ['launch-logo.png'])
  assert.deepEqual(await names(ana, 'kind=image&since=2026-01-01'), ['launch-logo.png'])
})

test('a private channel’s files are its members’ only, in every list', async (t) => {
  if (skip) return t.skip(skip)
  assert.ok((await names(ana, 'kind=pdf')).includes('Board minutes.pdf'))
  assert.ok(!(await names(ben, 'kind=pdf')).includes('Board minutes.pdf'))
  assert.deepEqual(await names(ben, `channel=${board}`), [], 'asking for the channel does not open it')
  assert.deepEqual(await names(ana, `channel=${board}`), ['Board minutes.pdf'])
})

test('search reads names and the text inside files', async (t) => {
  if (skip) return t.skip(skip)
  assert.deepEqual(await names(ana, 'q=logo'), ['launch-logo.png'])
  assert.deepEqual(await names(ana, 'q=waterfront'), ['Launch plan.pdf'])
})

test('pages follow on without repeating', async (t) => {
  if (skip) return t.skip(skip)
  const { listResources } = await import('@/lib/resources/list')
  const { resourceViewer } = await import('@/lib/resources/visibility')
  const viewer = await resourceViewer(spaceId, ana)
  const first = await listResources(spaceId, viewer, parseListQuery(new URLSearchParams('sort=name&limit=2')))
  assert.equal(first.items.length, 2)
  assert.equal(first.nextOffset, 2)
  const second = await listResources(spaceId, viewer, parseListQuery(new URLSearchParams('sort=name&limit=2&offset=2')))
  assert.equal(second.nextOffset, null)
  const all = [...first.items, ...second.items].map((r) => r.name)
  assert.equal(new Set(all).size, 4)
})

test('the trash lists what was deleted, to whoever may restore it', async (t) => {
  if (skip) return t.skip(skip)
  const { prisma } = await localDb()
  const { trashResource } = await import('@/lib/resources/shares')
  const photo = await prisma!.resource.findFirstOrThrow({ where: { spaceId, name: 'team-photo.jpg' } })
  await trashResource(photo.id, ben)
  assert.ok(!(await names(ana, 'kind=image')).includes('team-photo.jpg'))
  assert.deepEqual(await names(ben, 'trash=1'), ['team-photo.jpg'])
  assert.deepEqual(await names(ana, 'trash=1'), [], 'Ana did not make it and is not an admin')
})
