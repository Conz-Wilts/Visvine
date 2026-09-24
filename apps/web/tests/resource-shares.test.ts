/**
 * One resource, many shares — through the real message service, against the
 * local Postgres (skips without it; see tests/support/localDb.ts):
 *   • the same Sheet posted five times in two channels is ONE resource with
 *     five shares, and a private channel's shares are its members' alone;
 *   • removing a card removes that share only; the last share of a link that
 *     only messages carried sends it to the trash;
 *   • an edit moves the cards with the text but never resurrects a removed one;
 *   • deleting a message takes its shares with it;
 *   • a message can share a file its sender can see, and no other.
 * Unfurls are left pending or pointed at an unresolvable host, so no test
 * leaves the machine.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { localDb } from './support/localDb'

process.env.STORAGE_DRIVER = 'local'
process.env.GCS_RESOURCES_BUCKET ??= 'test-resources'
process.env.GCS_MEDIA_BUCKET ??= 'test-media'

const spaceId = `test-shares-${randomUUID().slice(0, 8)}`
const ana = randomUUID()
const ben = randomUUID()
let general = ''
let board = ''
let skip: string | null = null

const SHEET = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKl/edit#gid=0'

before(async () => {
  const db = await localDb()
  skip = db.skip
  const prisma = db.prisma
  if (!prisma) return
  for (const [id, name] of [[ana, 'Ana'], [ben, 'Ben']] as const) {
    await prisma.user.create({ data: { id, name, email: `${id}@test.local` } })
  }
  await prisma.space.create({ data: { id: spaceId, name: 'Shares test' } })
  await prisma.spaceMember.createMany({ data: [{ userId: ana, spaceId }, { userId: ben, spaceId }] })
  const { createChannelConversation, joinChannel } = await import('@/lib/messages')
  general = (await createChannelConversation(ana, spaceId, 'general')).id
  await joinChannel(ben, general)
  board = (await createChannelConversation(ana, spaceId, 'board', undefined, undefined, undefined, undefined, undefined, 'PRIVATE')).id
})

after(async () => {
  const { prisma } = await localDb()
  if (!prisma) return
  await prisma.contextNote.deleteMany({ where: { spaceId } }).catch(() => {})
  await prisma.contextGrant.deleteMany({ where: { spaceId } }).catch(() => {})
  await prisma.contextFolder.deleteMany({ where: { spaceId } }).catch(() => {})
  await prisma.node.deleteMany({ where: { spaceId } }).catch(() => {})
  await prisma.conversation.deleteMany({ where: { spaceId } }).catch(() => {})
  await prisma.space.delete({ where: { id: spaceId } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: [ana, ben] } } }).catch(() => {})
})

async function sheetResource() {
  const { prisma } = await localDb()
  return prisma!.resource.findUnique({
    where: { spaceId_canonicalUrl: { spaceId, canonicalUrl: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKl' } },
    include: { shares: true },
  })
}

test('five posts of one Sheet in two channels are one resource with five shares', async (t) => {
  if (skip) return t.skip(skip)
  const { sendMessage } = await import('@/lib/messages')
  for (let i = 0; i < 3; i++) await sendMessage(ana, general, { text: `numbers ${SHEET}` })
  await sendMessage(ana, board, { text: `board copy: ${SHEET.replace('#gid=0', '')}` })
  const sent = await sendMessage(ana, board, { text: `again https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKl/view?usp=sharing` })

  const sheet = await sheetResource()
  assert.ok(sheet)
  assert.equal(sheet.kind, 'link')
  assert.equal(sheet.provider, 'google-sheet')
  assert.equal(sheet.embedUrl, 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKl/preview')
  assert.equal(sheet.shares.length, 5)
  assert.deepEqual(new Set(sheet.shares.map((s) => s.conversationId)), new Set([general, board]))
  const card = sent.message.linkPreviews?.[0]
  assert.equal(card?.resourceId, sheet.id)
  assert.equal(card?.pending, true, 'drawn at once, filled in by the unfurl')
})

test('a private channel’s resource is its members’ alone', async (t) => {
  if (skip) return t.skip(skip)
  const { prisma } = await localDb()
  const { sendMessage } = await import('@/lib/messages')
  const { resourceViewer, visibleResourceWhere } = await import('@/lib/resources/visibility')
  await sendMessage(ana, board, { text: 'plan https://example.invalid/board-only' })
  const [anaSees, benSees] = await Promise.all(
    [ana, ben].map(async (user) =>
      prisma!.resource.findMany({
        where: { AND: [{ spaceId }, visibleResourceWhere(await resourceViewer(spaceId, user))] },
        select: { canonicalUrl: true },
      }),
    ),
  )
  assert.ok(anaSees.some((r) => r.canonicalUrl === 'https://example.invalid/board-only'))
  assert.ok(!benSees.some((r) => r.canonicalUrl === 'https://example.invalid/board-only'))
  assert.ok(benSees.some((r) => r.canonicalUrl?.includes('1AbCdEfGhIjKl')), 'the Sheet reaches Ben through #general')

  const { listChannelsForSpace, joinChannel } = await import('@/lib/messages')
  assert.ok(!(await listChannelsForSpace(ben, spaceId)).some((c) => c.id === board), 'unlisted to outsiders')
  await assert.rejects(joinChannel(ben, board), /not found/i, 'and not joinable')
})

test('removing a card removes that share; the last one of a message-only link trashes it', async (t) => {
  if (skip) return t.skip(skip)
  const { prisma } = await localDb()
  const { sendMessage, removeMessageShare } = await import('@/lib/messages')
  const sent = await sendMessage(ana, general, { text: 'once https://example.invalid/only-here' })
  const id = sent.message.linkPreviews![0].resourceId!
  const after = await removeMessageShare(ana, general, sent.message.id, id)
  assert.equal(after.message.linkPreviews?.length, 0)
  assert.equal(after.message.text.includes('only-here'), true, 'the link stays in the text')
  const row = await prisma!.resource.findUniqueOrThrow({ where: { id } })
  assert.ok(row.deletedAt, 'shared nowhere else: trashed')

  const sheet = (await sheetResource())!
  const one = sheet.shares.find((s) => s.conversationId === general)!
  await removeMessageShare(ana, general, one.messageId!, sheet.id)
  const still = (await sheetResource())!
  assert.equal(still.deletedAt, null, 'shared elsewhere: lives on')
  assert.equal(still.shares.length, 4)

  await assert.rejects(removeMessageShare(ben, general, sent.message.id, id), /author or a channel admin/)
})

test('an edit moves the cards with the text and never resurrects a removed one', async (t) => {
  if (skip) return t.skip(skip)
  const { sendMessage, editMessage, removeMessageShare } = await import('@/lib/messages')
  const sent = await sendMessage(ana, general, { text: 'a https://example.invalid/a b https://example.invalid/b' })
  const [a] = sent.message.linkPreviews!
  await removeMessageShare(ana, general, sent.message.id, a.resourceId!)
  const edited = await editMessage(ana, general, sent.message.id, 'a https://example.invalid/a c https://example.invalid/c')
  assert.deepEqual(
    edited.message.linkPreviews!.map((c) => c.url).sort(),
    ['https://example.invalid/c'],
    'b left with its text, c came with its text, a stayed removed',
  )
})

test('deleting a message takes its shares with it', async (t) => {
  if (skip) return t.skip(skip)
  const { prisma } = await localDb()
  const { sendMessage, deleteMessage } = await import('@/lib/messages')
  const sent = await sendMessage(ana, general, { text: 'gone soon https://example.invalid/deleted' })
  await deleteMessage(ana, general, sent.message.id)
  assert.equal(await prisma!.resourceShare.count({ where: { messageId: sent.message.id } }), 0)
})

test('a message shares a file its sender can see, and no other', async (t) => {
  if (skip) return t.skip(skip)
  const { prisma } = await localDb()
  const { sendMessage } = await import('@/lib/messages')
  const { addShares } = await import('@/lib/resources/shares')
  const secret = await prisma!.resource.create({
    data: { spaceId, name: 'minutes.pdf', fileType: 'pdf', kind: 'pdf', uploadedBy: ana, createdBy: ana },
  })
  await addShares([{ resourceId: secret.id, spaceId, conversationId: board, sharedBy: ana, via: 'upload' }])
  await assert.rejects(sendMessage(ben, general, { text: 'look', fileIds: [secret.id] }), /not one you can share/)
  const shared = await sendMessage(ana, general, { text: 'look', fileIds: [secret.id] })
  assert.equal(shared.message.files?.[0]?.id, secret.id, 'Ana is in #board, so she may share it on')
})

test('an unfurl that cannot reach its page still makes the entity, named after the host', async (t) => {
  if (skip) return t.skip(skip)
  const { prisma } = await localDb()
  const { sendMessage } = await import('@/lib/messages')
  const { drainJobs } = await import('@/lib/resources/jobs')
  const sent = await sendMessage(ana, general, { text: 'dead https://unreachable.invalid/page' })
  const id = sent.message.linkPreviews![0].resourceId!
  await drainJobs({ budgetMs: 10_000, resourceIds: [id] })
  const row = await prisma!.resource.findUniqueOrThrow({ where: { id }, include: { node: true } })
  assert.equal(row.fetchState, 'failed')
  assert.ok(row.node?.id.startsWith('resource:'))
})

test('a trashed resource is restored with its audience, and only a message-born link is trashed by losing its shares', async (t) => {
  if (skip) return t.skip(skip)
  const { prisma } = await localDb()
  const { trashResource, restoreResource, orphanGoesToTrash } = await import('@/lib/resources/shares')
  const { googleFileId } = await import('@/lib/resources/providers/googleDrive')
  assert.equal(orphanGoesToTrash({ source: 'link' }, 'message'), true)
  assert.equal(orphanGoesToTrash({ source: 'upload' }, 'message'), false)
  assert.equal(orphanGoesToTrash({ source: 'link' }, 'link'), false)
  assert.equal(googleFileId(SHEET), '1AbCdEfGhIjKl')
  const sheet = (await sheetResource())!
  await trashResource(sheet.id, ana)
  assert.ok((await prisma!.resource.findUniqueOrThrow({ where: { id: sheet.id } })).deletedAt)
  await restoreResource(sheet.id)
  const back = await prisma!.resource.findUniqueOrThrow({ where: { id: sheet.id } })
  assert.equal(back.deletedAt, null)
  assert.equal(back.state, 'ready')
})

test('the trash keeps a resource thirty days, then deletes it outright', async (t) => {
  if (skip) return t.skip(skip)
  const { prisma } = await localDb()
  const { purgeTrash } = await import('@/lib/resources/service')
  const day = 24 * 60 * 60 * 1000
  const make = (name: string, daysAgo: number) =>
    prisma!.resource.create({
      data: {
        spaceId, name, fileType: 'pdf', kind: 'pdf', uploadedBy: ana, createdBy: ana,
        state: 'deleted', deletedAt: new Date(Date.now() - daysAgo * day), deletedBy: ana,
      },
    })
  const old = await make('old.pdf', 31)
  const recent = await make('recent.pdf', 5)
  await purgeTrash(new Date(), 500)
  assert.equal(await prisma!.resource.findUnique({ where: { id: old.id } }), null, 'past its keep: gone')
  assert.ok(await prisma!.resource.findUnique({ where: { id: recent.id } }), 'still restorable')
})
