/**
 * The acceptance path an AI takes with a space's resources, end to end
 * through `runAction` against the local Postgres and the local storage driver
 * (skips without the Docker database; see tests/support/localDb.ts):
 *   • Ana's MCP client posts `logo.png` into her private #brand channel;
 *   • list_resources finds it for Ana and not for Ben, who is not in #brand;
 *   • create_event with it as the cover copies the image into the event's own
 *     media, and `resource_access` records the use and the door (`mcp`);
 *   • Ben naming the same id gets the 404 an absent file gets;
 *   • an agent running as Ana does the same, recorded as `agent` with its name;
 *   • read_resource and share_resource answer under the same gate.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { localDb } from './support/localDb'
import type { ActionCaller } from '@/lib/actions/types'

const storageDir = mkdtempSync(join(tmpdir(), 'vv-logo-'))
process.env.STORAGE_DRIVER = 'local'
process.env.STORAGE_LOCAL_DIR = storageDir
process.env.GCS_RESOURCES_BUCKET = 'test-resources'
process.env.GCS_MEDIA_BUCKET = 'test-media'

const spaceId = `test-logo-${randomUUID().slice(0, 8)}`
const ana = randomUUID()
const ben = randomUUID()
let brand = ''
let general = ''
let skip: string | null = null
let logoId = ''

async function caller(userId: string, extra: Partial<ActionCaller> = {}): Promise<ActionCaller> {
  const { MCP_SCOPES } = await import('@/lib/mcp/scopes')
  return {
    userId,
    name: userId === ana ? 'Ana' : 'Ben',
    email: `${userId}@test.local`,
    scopes: [...MCP_SCOPES],
    via: 'mcp',
    ...extra,
  }
}

async function run(who: ActionCaller, name: string, input: unknown) {
  const { runAction } = await import('@/lib/actions/run')
  return (await runAction(who, name, input)).result as Record<string, unknown>
}

before(async () => {
  const db = await localDb()
  skip = db.skip
  const prisma = db.prisma
  if (!prisma) return
  for (const [id, name] of [[ana, 'Ana'], [ben, 'Ben']] as const) {
    await prisma.user.create({ data: { id, name, email: `${id}@test.local` } })
  }
  await prisma.space.create({ data: { id: spaceId, name: 'Logo test' } })
  await prisma.spaceMember.createMany({ data: [{ userId: ana, spaceId, status: 'active' }, { userId: ben, spaceId, status: 'active' }] })
  const { createChannelConversation, joinChannel } = await import('@/lib/messages')
  brand = (await createChannelConversation(ana, spaceId, 'brand', undefined, undefined, undefined, undefined, undefined, 'PRIVATE')).id
  general = (await createChannelConversation(ana, spaceId, 'general')).id
  await joinChannel(ben, general)
})

after(async () => {
  const { prisma } = await localDb()
  if (prisma) {
    await prisma.resourceAccess.deleteMany({ where: { spaceId } }).catch(() => {})
    await prisma.contextNote.deleteMany({ where: { spaceId } }).catch(() => {})
    await prisma.contextGrant.deleteMany({ where: { spaceId } }).catch(() => {})
    await prisma.contextFolder.deleteMany({ where: { spaceId } }).catch(() => {})
    await prisma.link.deleteMany({ where: { spaceId } }).catch(() => {})
    await prisma.node.deleteMany({ where: { spaceId } }).catch(() => {})
    await prisma.conversation.deleteMany({ where: { spaceId } }).catch(() => {})
    await prisma.space.delete({ where: { id: spaceId } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: { in: [ana, ben] } } }).catch(() => {})
  }
  rmSync(storageDir, { recursive: true, force: true })
})

test('an MCP upload into a private channel is that channel’s alone', async (t) => {
  if (skip) return t.skip(skip)
  const png = await sharp({ create: { width: 640, height: 640, channels: 4, background: { r: 240, g: 80, b: 40, alpha: 1 } } })
    .png()
    .toBuffer()
  const posted = await run(await caller(ana), 'upload_file', {
    space_id: spaceId,
    content_base64: png.toString('base64'),
    name: 'logo.png',
    channel_id: brand,
    message: 'the new logo',
  })
  logoId = posted.resource_id as string
  assert.ok(logoId)
  assert.match(String(posted.message_href), new RegExp(`/channels/${brand}\\?message=`))

  const { prisma } = await localDb()
  const shares = await prisma!.resourceShare.findMany({ where: { resourceId: logoId } })
  assert.deepEqual(shares.map((s) => [s.conversationId, s.via]), [[brand, 'action']], 'shared in #brand by the post, nowhere else')

  const anaSees = await run(await caller(ana), 'list_resources', { space_id: spaceId, kind: 'image', q: 'logo' })
  const rows = anaSees.resources as Array<Record<string, unknown>>
  assert.deepEqual(rows.map((r) => r.resource_id), [logoId])
  assert.equal(rows[0].usable_as_cover, true)
  assert.equal((rows[0].shares as Array<{ channel_id: string }>)[0].channel_id, brand)
  assert.ok(!JSON.stringify(rows).includes('X-Goog-Signature') && !JSON.stringify(rows).includes('sig='), 'no signed URL')

  const benSees = await run(await caller(ben), 'list_resources', { space_id: spaceId, kind: 'image', q: 'logo' })
  assert.deepEqual(benSees.resources, [])
  const everywhere = await run(await caller(ana), 'list_resources', { kind: 'image' })
  assert.ok((everywhere.resources as Array<{ resource_id: string }>).some((r) => r.resource_id === logoId), 'no space_id reads every space')
  const aliased = await run(await caller(ana), 'list_drive', { space_id: spaceId, kind: 'image' })
  assert.ok(Array.isArray(aliased.resources), 'the old name still answers')
})

test('create_event takes it as the cover, copied into the event’s own media, and the use is recorded', async (t) => {
  if (skip) return t.skip(skip)
  const { prisma } = await localDb()
  const made = await run(await caller(ana), 'create_event', {
    space_id: spaceId,
    title: 'Launch',
    start_at: '2026-11-01T18:00:00.000Z',
    cover_resource_id: logoId,
  })
  assert.equal(made.cover_image_set, true)
  const eventId = made.event_id as string
  const { mediaPrefixBare } = await import('@/lib/storage/objectPaths')
  const { localList } = await import('@/lib/storage/localStore')
  const stored = await localList('test-media', `${mediaPrefixBare('event', eventId)}/`)
  assert.ok(stored.length >= 2, `the image's variants sit under the event's prefix (${stored.map((s) => s.name).join(', ')})`)

  const use = await prisma!.resourceAccess.findFirst({ where: { resourceId: logoId, action: 'use' } })
  assert.ok(use)
  assert.equal(use.via, 'mcp')
  assert.equal(use.userId, ana)
  assert.equal(use.targetNodeId, eventId)
})

test('Ben, outside #brand, is told there is no such file', async (t) => {
  if (skip) return t.skip(skip)
  await assert.rejects(
    run(await caller(ben), 'create_event', { space_id: spaceId, title: 'Nope', start_at: '2026-11-02T18:00:00.000Z', cover_resource_id: logoId }),
    (err: Error & { status?: number }) => err.status === 404,
  )
  await assert.rejects(run(await caller(ben), 'read_resource', { resource_id: logoId }), (err: Error & { status?: number }) => err.status === 404)
  await assert.rejects(
    run(await caller(ben), 'share_resource', { resource_id: logoId, channel_id: general }),
    (err: Error & { status?: number }) => err.status === 404,
  )
})

test('an agent running as Ana is recorded as the agent', async (t) => {
  if (skip) return t.skip(skip)
  const { prisma } = await localDb()
  const runId = randomUUID()
  const agent = await caller(ana, { via: 'agent', agentName: 'brand-bot', runId })
  const listed = await run(agent, 'list_resources', { space_id: spaceId, kind: 'image', q: 'logo' })
  assert.equal((listed.resources as unknown[]).length, 1)
  await run(agent, 'create_event', { space_id: spaceId, title: 'Launch two', start_at: '2026-11-03T18:00:00.000Z', cover_resource_id: logoId })
  const use = await prisma!.resourceAccess.findFirst({ where: { resourceId: logoId, action: 'use', via: 'agent' } })
  assert.equal(use?.agentName, 'brand-bot')
  assert.equal(use?.runId, runId)

  const shared = await run(agent, 'share_resource', { resource_id: logoId, channel_id: general, text: 'for everyone' })
  const share = await prisma!.resourceShare.findFirst({ where: { messageId: shared.message_id as string } })
  assert.equal(share?.via, 'agent')
  assert.equal(share?.agentName, 'brand-bot')
  const benSees = await run(await caller(ben), 'list_resources', { space_id: spaceId, kind: 'image' })
  assert.deepEqual((benSees.resources as Array<{ resource_id: string }>).map((r) => r.resource_id), [logoId], 'shared into #general, Ben sees it now')
})

test('read_resource answers the facts, the note and where it was shared, and records the read', async (t) => {
  if (skip) return t.skip(skip)
  const { prisma } = await localDb()
  const read = await run(await caller(ana), 'read_resource', { resource_id: logoId })
  assert.equal(read.kind, 'image')
  assert.equal(read.width, 640)
  assert.equal(read.space_id, spaceId)
  assert.ok(String(read.note_path).startsWith('resources/'))
  assert.equal(typeof read.note, 'string')
  assert.equal((read.shares as unknown[]).length, 2)
  assert.equal(read.text, null, 'an image has no text')
  assert.ok(await prisma!.resourceAccess.findFirst({ where: { resourceId: logoId, action: 'read', via: 'mcp' } }))
})
