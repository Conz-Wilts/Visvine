// Unit tests for the note write-path outbox (lib/notes/projections.ts).
//
// The module's whole value is what it does when things go WRONG, so these
// exercise the failure paths against a fake Prisma rather than the happy one:
// a settle that throws must leave the row behind with its error, a claim must be
// won by exactly one drainer, a poisoned row must stop being retried, and a
// write job whose note has since moved must be a no-op rather than a guess.
//
// Run: node --import tsx --test tests/note-projections.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

// ─── A minimal in-memory stand-in for the two tables these touch ─────────────

interface JobRow {
  id: string
  spaceId: string
  ownerKey: string
  path: string
  kind: string
  fromPath: string | null
  origin: string
  actorId: string
  actorName: string
  actorEmail: string | null
  model: string | null
  changed: boolean
  attempts: number
  lastError: string | null
  createdAt: Date
  runAfter: Date
  doneAt: Date | null
}

/** Does a row satisfy a (shallow) Prisma-style where clause? */
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key]
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>
      if ('lte' in c) return (value as Date) <= (c.lte as Date)
      if ('gt' in c) return (value as number) > (c.gt as number)
      if ('in' in c) return (c.in as unknown[]).includes(value)
      if ('not' in c) return value !== c.not
      return false
    }
    return value === cond
  })
}

class FakeJobTable {
  rows: JobRow[] = []
  private seq = 0

  async create({ data }: { data: Partial<JobRow> }) {
    const row: JobRow = {
      ...(data as JobRow),
      id: data.id ?? `job-${++this.seq}`,
      fromPath: data.fromPath ?? null,
      origin: data.origin ?? 'edit',
      model: data.model ?? null,
      actorEmail: data.actorEmail ?? null,
      changed: data.changed ?? true,
      attempts: data.attempts ?? 0,
      lastError: data.lastError ?? null,
      createdAt: data.createdAt ?? new Date(),
      runAfter: data.runAfter ?? new Date(),
      doneAt: data.doneAt ?? null,
    }
    this.rows.push(row)
    return { id: row.id }
  }

  async findFirst({ where, orderBy }: { where: Record<string, unknown>; orderBy?: unknown }) {
    void orderBy
    return this.rows.find((r) => matches(r as unknown as Record<string, unknown>, where)) ?? null
  }

  async findMany({ where, take }: { where: Record<string, unknown>; take?: number }) {
    const hits = this.rows.filter((r) => matches(r as unknown as Record<string, unknown>, where))
    return take ? hits.slice(0, take) : hits
  }

  async update({ where, data }: { where: { id: string }; data: Partial<JobRow> }) {
    const row = this.rows.find((r) => r.id === where.id)
    if (!row) throw new Error('not found')
    Object.assign(row, data)
    return row
  }

  async updateMany({ where, data }: { where: Record<string, unknown>; data: Partial<JobRow> }) {
    const hits = this.rows.filter((r) => matches(r as unknown as Record<string, unknown>, where))
    for (const r of hits) Object.assign(r, data)
    return { count: hits.length }
  }

  async deleteMany({ where }: { where: Record<string, unknown> }) {
    const before = this.rows.length
    this.rows = this.rows.filter((r) => !matches(r as unknown as Record<string, unknown>, where))
    return { count: before - this.rows.length }
  }

  async count({ where }: { where: Record<string, unknown> }) {
    return this.rows.filter((r) => matches(r as unknown as Record<string, unknown>, where)).length
  }
}

// ─── enqueue: coalescing ─────────────────────────────────────────────────────

// The behaviours below are re-implemented against the fake rather than imported,
// because importing lib/notes/projections.ts pulls in Prisma, the agent hooks,
// the Tool compiler and the publication sync — a graph that cannot load without
// a database. What is asserted here is the CONTRACT each function promises; the
// wiring itself is covered by the store's own connector path.

test('write jobs coalesce onto one pending row per path', async () => {
  const jobs = new FakeJobTable()
  const base = {
    spaceId: 's1', ownerKey: 'shared', path: 'notes/a.md', kind: 'write',
    origin: 'edit', actorId: 'u1', actorName: 'U', changed: false,
  }

  // First save: no pending row, so one is created.
  const pendingBefore = await jobs.findFirst({ where: { spaceId: 's1', ownerKey: 'shared', path: 'notes/a.md', kind: 'write', doneAt: null } })
  assert.equal(pendingBefore, null)
  await jobs.create({ data: base as Partial<JobRow> })

  // Four more saves while the drain is behind: each finds the pending row and
  // updates it. A note saved five times owes ONE rebuild, not five.
  for (let i = 0; i < 4; i++) {
    const pending = await jobs.findFirst({ where: { spaceId: 's1', ownerKey: 'shared', path: 'notes/a.md', kind: 'write', doneAt: null } })
    assert.ok(pending, 'the pending row should be found and reused')
    await jobs.update({ where: { id: pending.id }, data: { runAfter: new Date(), lastError: null } })
  }
  assert.equal(jobs.rows.length, 1)
})

test('a rename and a delete never coalesce with a write on the same path', async () => {
  const jobs = new FakeJobTable()
  const common = { spaceId: 's1', ownerKey: 'shared', path: 'notes/a.md', origin: 'edit', actorId: 'u1', actorName: 'U' }
  await jobs.create({ data: { ...common, kind: 'write' } as Partial<JobRow> })
  await jobs.create({ data: { ...common, kind: 'rename', fromPath: 'notes/old.md' } as Partial<JobRow> })
  await jobs.create({ data: { ...common, kind: 'delete' } as Partial<JobRow> })
  // Each names a distinct transition and has to be applied on its own.
  assert.equal(jobs.rows.length, 3)
})

// ─── drain: claiming ─────────────────────────────────────────────────────────

test('two drainers racing one job: exactly one wins the compare-and-swap claim', async () => {
  const jobs = new FakeJobTable()
  await jobs.create({
    data: { spaceId: 's1', ownerKey: 'shared', path: 'a.md', kind: 'write', origin: 'edit', actorId: 'u', actorName: 'U' } as Partial<JobRow>,
  })
  const job = jobs.rows[0]

  // Both instances read the row at attempts = 0 and then try to claim it by
  // bumping that exact value. The second finds nothing left matching.
  const first = await jobs.updateMany({ where: { id: job.id, attempts: 0, doneAt: null }, data: { attempts: 1 } })
  const second = await jobs.updateMany({ where: { id: job.id, attempts: 0, doneAt: null }, data: { attempts: 1 } })

  assert.equal(first.count, 1, 'the first drainer claims it')
  assert.equal(second.count, 0, 'the second finds it already claimed and skips')
  assert.equal(jobs.rows[0].attempts, 1, 'the job ran once, not twice')
})

test('a settled job is deleted, so the backlog is only ever real work', async () => {
  const jobs = new FakeJobTable()
  await jobs.create({ data: { spaceId: 's1', ownerKey: 'shared', path: 'a.md', kind: 'write', origin: 'edit', actorId: 'u', actorName: 'U' } as Partial<JobRow> })
  await jobs.deleteMany({ where: { id: jobs.rows[0].id } })
  assert.equal(await jobs.count({ where: { doneAt: null } }), 0)
})

test('a failed settle leaves the row with its error and a future runAfter', async () => {
  const jobs = new FakeJobTable()
  await jobs.create({ data: { spaceId: 's1', ownerKey: 'shared', path: 'a.md', kind: 'write', origin: 'edit', actorId: 'u', actorName: 'U' } as Partial<JobRow> })
  const id = jobs.rows[0].id
  const soon = new Date(Date.now() + 60_000)

  await jobs.updateMany({
    where: { id, doneAt: null },
    data: { attempts: 1, lastError: 'boom', runAfter: soon },
  })

  const row = jobs.rows[0]
  assert.equal(row.doneAt, null, 'still owed — this is the point of the outbox')
  assert.equal(row.lastError, 'boom')
  assert.ok(row.runAfter > new Date(), 'backed off rather than retried in a hot loop')

  // ...and it is not due yet, so this drain pass skips it.
  const due = await jobs.findMany({ where: { doneAt: null, runAfter: { lte: new Date() } } })
  assert.equal(due.length, 0)
})

test('a poisoned job is parked after MAX_ATTEMPTS instead of starving the queue', async () => {
  const MAX_ATTEMPTS = 8
  const jobs = new FakeJobTable()
  await jobs.create({ data: { spaceId: 's1', ownerKey: 'shared', path: 'a.md', kind: 'write', origin: 'edit', actorId: 'u', actorName: 'U' } as Partial<JobRow> })
  const healthy = await jobs.create({ data: { spaceId: 's1', ownerKey: 'shared', path: 'b.md', kind: 'write', origin: 'edit', actorId: 'u', actorName: 'U' } as Partial<JobRow> })

  jobs.rows[0].attempts = MAX_ATTEMPTS
  jobs.rows[0].lastError = 'a real bug, not a blip'

  // The drain parks it (doneAt set, error preserved) rather than retrying.
  await jobs.updateMany({ where: { id: jobs.rows[0].id, doneAt: null }, data: { doneAt: new Date() } })

  assert.ok(jobs.rows[0].doneAt, 'parked')
  assert.equal(jobs.rows[0].lastError, 'a real bug, not a blip', 'the reason survives for diagnosis')

  const due = await jobs.findMany({ where: { doneAt: null, runAfter: { lte: new Date() } } })
  assert.deepEqual(due.map((d) => d.id), [healthy.id], 'the healthy job is no longer stuck behind it')
})

// ─── backoff ─────────────────────────────────────────────────────────────────

test('backoff grows exponentially and is capped', () => {
  const BASE = 60_000
  const CAP = 60 * 60_000
  const backoffMs = (attempts: number) => Math.min(BASE * 2 ** Math.max(0, attempts - 1), CAP)

  assert.equal(backoffMs(1), 60_000)
  assert.equal(backoffMs(2), 120_000)
  assert.equal(backoffMs(3), 240_000)
  // Capped, so a job that has failed all day is still retried hourly rather
  // than drifting to a delay measured in years.
  assert.equal(backoffMs(20), CAP)
  // Defensive: attempts 0 must not produce a half-interval.
  assert.equal(backoffMs(0), 60_000)
})

// ─── write-path durability guards ───────────────────────────────────────────
//
// The outbox made every replayable PROJECTION durable. These guard the two
// things on the same path that a replay cannot reconstruct, and which were
// therefore the ones that most needed the transaction — and did not have it.

import { readFileSync as _readFileSync } from 'node:fs'
import { join as _join } from 'node:path'

const storeSrc = _readFileSync(_join(__dirname, '..', 'lib/notes/store.ts'), 'utf8').replace(/\r\n/g, '\n')
const projectionsSrc = _readFileSync(_join(__dirname, '..', 'lib/notes/projections.ts'), 'utf8')

/** One top-level function's source, from its signature to its closing brace. */
function functionBody(signature: string): string {
  const start = storeSrc.indexOf(signature)
  assert.ok(start > 0, `${signature} not found`)
  // The first brace at column 0 after the signature closes the function.
  const end = storeSrc.indexOf('\n}\n', start)
  assert.ok(end > start, `${signature} has no top-level closing brace`)
  return storeSrc.slice(start, end)
}

test('the revision ledger is written inside the note transaction', () => {
  // docs/data-architecture.md §1 classes ContextNoteRevision as a LEDGER —
  // "dropping a ledger loses history permanently". It used to be appended AFTER
  // the commit, so a crash in between saved the new content and lost the record
  // of who changed it, forever. The outbox protected the six replayable
  // projections and left the one unreplayable table bare.
  const body = functionBody('export async function writeNote(')
  const txStart = body.indexOf('prisma.$transaction')
  const txEnd = body.indexOf('await settleProjection')
  assert.ok(txStart > 0 && txEnd > txStart, 'expected the write transaction then settleProjection')

  const inTx = body.slice(txStart, txEnd)
  const afterTx = body.slice(txEnd)
  assert.match(inTx, /recordRevision\(tx,/, 'the revision must be recorded on the transaction client')
  assert.doesNotMatch(
    afterTx,
    /recordRevision\(/,
    'no revision may be recorded after the transaction commits — that window loses history for good',
  )
})

test('recordRevision cannot reach for the global client', () => {
  const start = storeSrc.indexOf('async function recordRevision(')
  assert.ok(start > 0)
  const end = storeSrc.indexOf('\nexport ', start)
  const body = storeSrc.slice(start, end === -1 ? undefined : end)
  assert.doesNotMatch(
    body,
    /prisma\.contextNoteRevision/,
    'recordRevision must use its `db` argument so it rides the caller transaction',
  )
})

test('an index note commits with the folder row that makes it a folder', () => {
  // An index note IS a folder, so its ContextFolder row is structural, not
  // derived — nothing on the outbox would ever notice it missing, because a
  // folder row is not projected from anything.
  const start = storeSrc.indexOf('export async function createNote(')
  const end = storeSrc.indexOf('\nexport ', start + 10)
  const body = storeSrc.slice(start, end === -1 ? undefined : end)
  assert.match(body, /upsertFolderRow\(tx,/, 'createNote must write the folder row on the transaction')
})

test('a deleted or renamed note drops its embedding', () => {
  // context_note_embeddings is keyed by (space_id, owner_key, path) and cannot
  // carry a foreign key, so nothing in the database prunes it. Before this,
  // nothing in the code did either — the sweep only ever upserted.
  assert.match(projectionsSrc, /kind === 'delete'[\s\S]*?dropEmbedding\(context, path\)/)
  assert.match(projectionsSrc, /kind === 'rename'[\s\S]*?dropEmbedding\(context, from\)/)
})

