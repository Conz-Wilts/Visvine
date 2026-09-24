/**
 * A resumable upload end to end, against the local Postgres and the local
 * storage driver in a scratch folder: chunks, a resume after a drop, the
 * sniff refusal, the original kept byte for byte, renditions drawn, the space
 * share and entity made — and the job claim racing itself. Skips (never
 * passes) without the Docker database; see tests/support/localDb.ts.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { localDb } from './support/localDb'

const storageDir = mkdtempSync(join(tmpdir(), 'vv-storage-'))
process.env.STORAGE_DRIVER = 'local'
process.env.STORAGE_LOCAL_DIR = storageDir
process.env.GCS_RESOURCES_BUCKET = 'test-resources'
process.env.GCS_MEDIA_BUCKET = 'test-media'

const spaceId = `test-uploads-${randomUUID().slice(0, 8)}`
const userId = randomUUID()
let skip: string | null = null

before(async () => {
  const db = await localDb()
  skip = db.skip
  if (!db.prisma) return
  await db.prisma.user.create({ data: { id: userId, name: 'Ana Upload', email: `${userId}@test.local` } })
  await db.prisma.space.create({ data: { id: spaceId, name: 'Upload test' } })
  await db.prisma.spaceMember.create({ data: { userId, spaceId, status: 'active' } })
})

after(async () => {
  const { prisma } = await localDb()
  if (prisma) {
    await prisma.contextNote.deleteMany({ where: { spaceId } }).catch(() => {})
    await prisma.contextGrant.deleteMany({ where: { spaceId } }).catch(() => {})
    await prisma.contextFolder.deleteMany({ where: { spaceId } }).catch(() => {})
    await prisma.contextSource.deleteMany({ where: { spaceId } }).catch(() => {})
    await prisma.node.deleteMany({ where: { spaceId } }).catch(() => {})
    await prisma.space.delete({ where: { id: spaceId } }).catch(() => {})
    await prisma.user.delete({ where: { id: userId } }).catch(() => {})
  }
  rmSync(storageDir, { recursive: true, force: true })
})

async function sendAll(id: string, bytes: Buffer, chunk: number) {
  const { receiveLocalChunk } = await import('@/lib/resources/upload')
  let offset = 0
  let complete = false
  while (!complete) {
    const end = Math.min(offset + chunk, bytes.length) - 1
    const reply = await receiveLocalChunk(id, userId, `bytes ${offset}-${end}/${bytes.length}`, bytes.subarray(offset, end + 1))
    complete = reply.complete
    offset = reply.received
  }
}

test('an image uploads in chunks, resumes, and becomes a shared entity with renditions', async (t) => {
  if (skip) return t.skip(skip)
  const { prisma } = await localDb()
  const { initUpload, receiveLocalChunk, completeUpload } = await import('@/lib/resources/upload')
  const { localRead } = await import('@/lib/storage/localStore')

  const photo = await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 30, g: 90, b: 200 } } })
    .jpeg({ quality: 95 })
    .withExifMerge({ IFD0: { Artist: 'Ana' } })
    .toBuffer()
  const started = await initUpload({ userId, spaceId, name: 'Launch logo.jpg', size: photo.length, mimeType: 'image/jpeg', origin: 'http://localhost:3000' })
  assert.equal(started.uploadUrl, `/api/resources/uploads/${started.id}`)

  // A first chunk lands, the connection drops, the client asks where it got to.
  const first = 4096
  await receiveLocalChunk(started.id, userId, `bytes 0-${first - 1}/${photo.length}`, photo.subarray(0, first))
  const status = await receiveLocalChunk(started.id, userId, `bytes */${photo.length}`, Buffer.alloc(0))
  assert.deepEqual(status, { complete: false, received: first })
  // A chunk that skips ahead is refused; the resume carries on from the offset.
  await assert.rejects(receiveLocalChunk(started.id, userId, `bytes ${first + 10}-${first + 20}/${photo.length}`, Buffer.alloc(11)))
  await sendAll(started.id, photo, 4096)

  const done = await completeUpload(started.id, userId)
  assert.equal(done.kind, 'image')
  // What the request's own budget did not finish, a pull does.
  const { drainJobs } = await import('@/lib/resources/jobs')
  await drainJobs({ budgetMs: 30_000, resourceIds: [started.id] })
  assert.ok(done.nodeId?.startsWith('resource:'))

  const row = await prisma!.resource.findUniqueOrThrow({
    where: { id: started.id },
    include: { shares: true, renditions: true },
  })
  assert.equal(row.state, 'ready')
  assert.equal(row.fileSize, photo.length)
  assert.deepEqual([row.width, row.height], [1200, 800])
  assert.ok(row.contentHash)
  assert.deepEqual(row.shares.map((s) => s.conversationId), [null], 'shared to the space')
  assert.deepEqual(row.renditions.map((r) => r.kind).sort(), ['preview', 'thumb'])

  const original = await localRead('test-resources', row.gcsPath!)
  assert.ok(original?.bytes.equals(photo), 'the original is stored byte for byte, EXIF and all')
  const thumb = await localRead('test-resources', row.renditions.find((r) => r.kind === 'thumb')!.gcsPath)
  assert.equal((await sharp(thumb!.bytes).metadata()).exif, undefined)
})

test('a file whose bytes contradict its name is refused and leaves nothing behind', async (t) => {
  if (skip) return t.skip(skip)
  const { prisma } = await localDb()
  const { initUpload, completeUpload } = await import('@/lib/resources/upload')
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
  const started = await initUpload({ userId, spaceId, name: 'avatar.png', size: pdf.length, origin: 'http://localhost:3000' })
  await sendAll(started.id, pdf, 1024)
  await assert.rejects(completeUpload(started.id, userId), /not what its name says/)
  assert.equal(await prisma!.resource.findUnique({ where: { id: started.id } }), null)
})

test('a program is refused before an upload opens', async (t) => {
  if (skip) return t.skip(skip)
  const { initUpload } = await import('@/lib/resources/upload')
  await assert.rejects(initUpload({ userId, spaceId, name: 'setup.exe', size: 100, origin: 'x' }), /program/)
})

test('only the uploader can send or finish an upload', async (t) => {
  if (skip) return t.skip(skip)
  const { initUpload, receiveLocalChunk, completeUpload } = await import('@/lib/resources/upload')
  const started = await initUpload({ userId, spaceId, name: 'notes.txt', size: 5, origin: 'x' })
  await assert.rejects(receiveLocalChunk(started.id, randomUUID(), 'bytes 0-4/5', Buffer.from('hello')), /Not found/)
  await assert.rejects(completeUpload(started.id, randomUUID()), /Not found/)
})

test('eight drains racing over ten jobs run each exactly once', async (t) => {
  if (skip) return t.skip(skip)
  const { prisma } = await localDb()
  const { enqueueJobs, drainJobs } = await import('@/lib/resources/jobs')
  const rows = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      prisma!.resource.create({
        data: { spaceId, name: `x${i}.bin`, fileType: 'bin', uploadedBy: userId, createdBy: userId, kind: 'other' },
      }),
    ),
  )
  const ids = rows.map((r) => r.id)
  for (const id of ids) await enqueueJobs(id, ['rendition'])
  const reports = await Promise.all(Array.from({ length: 8 }, () => drainJobs({ budgetMs: 3_000, resourceIds: ids, batch: 2 })))
  assert.equal(reports.reduce((sum, r) => sum + r.ran, 0), 10)
  const jobs = await prisma!.resourceJob.findMany({ where: { resourceId: { in: ids } } })
  assert.ok(jobs.every((job) => job.state === 'done' && job.attempts === 1), JSON.stringify(jobs.map((j) => [j.state, j.attempts])))
})

/** The smallest honest PDF: one page saying `text`. pdf.js repairs the xref offsets. */
function tinyPdf(text: string): Buffer {
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((obj, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body)
}

test('a PDF gets its page count, a drawn first page and searchable text', async (t) => {
  if (skip) return t.skip(skip)
  const { prisma } = await localDb()
  const { initUpload, completeUpload } = await import('@/lib/resources/upload')
  const pdf = tinyPdf('Launch plan for Aotearoa')
  const started = await initUpload({ userId, spaceId, name: 'Launch plan.pdf', size: pdf.length, mimeType: 'application/pdf', origin: 'x' })
  await sendAll(started.id, pdf, 8192)
  await completeUpload(started.id, userId)
  const { drainJobs } = await import('@/lib/resources/jobs')
  await drainJobs({ budgetMs: 30_000, resourceIds: [started.id] })
  const row = await prisma!.resource.findUniqueOrThrow({ where: { id: started.id }, include: { renditions: true } })
  assert.equal(row.kind, 'pdf')
  assert.equal(row.pageCount, 1)
  assert.deepEqual(row.renditions.map((r) => r.kind).sort(), ['page1', 'thumb'])
  assert.ok(/^resources\/launch-plan(-\d+)?\//.test(row.sourcePath ?? ''), `text sits in the entity folder (${row.sourcePath})`)
  const chunks = await prisma!.contextSourceChunk.findMany({ where: { spaceId, path: row.sourcePath! }, select: { text: true } })
  assert.ok(chunks.some((c) => c.text.includes('Launch plan for Aotearoa')))
})
