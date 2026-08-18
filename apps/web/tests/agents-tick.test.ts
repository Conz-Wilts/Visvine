/**
 * The tick's claim / reclaim / release contract, against a real Postgres.
 *
 * Everything here is about rows racing each other, which is exactly what a
 * pure-function test can't show — so this file talks to the LOCAL Docker
 * database (`apps/web/.env` DATABASE_URL, host localhost/127.0.0.1 only; the
 * same guard as scripts/guard-local-db.mjs) and SKIPS, loudly, when it can't
 * reach one. CI has no Postgres, so there these are reported as skipped, not
 * passed. Run locally with the dev DB up: `pnpm db:up && pnpm test`.
 *
 * Covered:
 *   • reclaimStale honours the grace: MAX_RUN_MS alone is not stale,
 *     MAX_RUN_MS + RECLAIM_GRACE_MS is; the run is failed `timeout`, the row
 *     freed, current_run_id cleared, failures +1, and MAX_CONSECUTIVE_FAILURES
 *     deactivates (`repeated_failure`).
 *   • the executor's release is a CAS on current_run_id: a run whose claim
 *     was reclaimed (and the row re-claimed by a newer run) does NOT flip the
 *     row idle or touch the failure count; a run that still holds the claim
 *     does.
 *   • claimManualRun mints the run id into current_run_id and refuses a
 *     second claim while the first is running (per-agent CAS).
 *   • canTriggerRun (transcript + Run-now gate): author yes, admin yes,
 *     other member no.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

function localDatabaseUrl(): string | null {
  const fromEnv = process.env.DATABASE_URL
  let url = fromEnv ?? null
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

/** Connect once; resolves to a skip reason, or null when the local DB answers. */
function probe(): Promise<string | null> {
  if (probed) return probed
  probed = (async () => {
    if (!dbUrl) return 'no local DATABASE_URL (apps/web/.env) — agents tick tests need the Docker Postgres'
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

import { MAX_CONSECUTIVE_FAILURES, MAX_RUN_MS, RECLAIM_GRACE_MS } from '@/lib/agents/limits'

// ── fixtures ────────────────────────────────────────────────────────────────

const SPACE = `test-agents-tick-${process.pid}`
const AUTHOR = `test-agents-author-${process.pid}`
const MEMBER = `test-agents-member-${process.pid}`
const ADMIN = `test-agents-admin-${process.pid}`

async function setup() {
  const p = prisma!
  await teardown()
  await p.space.create({ data: { id: SPACE, name: 'agents tick test', timezone: 'UTC' } })
  for (const [id, email] of [
    [AUTHOR, `${AUTHOR}@local.test`],
    [MEMBER, `${MEMBER}@local.test`],
    [ADMIN, `${ADMIN}@local.test`],
  ]) {
    await p.user.create({ data: { id, email, name: id } })
    await p.spaceMember.create({ data: { spaceId: SPACE, userId: id } })
  }
}

async function teardown() {
  const p = prisma!
  await p.agentRun.deleteMany({ where: { spaceId: SPACE } })
  await p.agentState.deleteMany({ where: { spaceId: SPACE } })
  await p.contextNote.deleteMany({ where: { spaceId: SPACE } })
  await p.spaceMember.deleteMany({ where: { spaceId: SPACE } })
  await p.space.deleteMany({ where: { id: SPACE } })
  await p.user.deleteMany({ where: { id: { in: [AUTHOR, MEMBER, ADMIN] } } })
}

async function makeAgent(name: string, o: { active?: boolean; status?: 'idle' | 'running'; runningSince?: Date | null; failures?: number } = {}) {
  return prisma!.agentState.create({
    data: {
      spaceId: SPACE,
      name,
      runAsUserId: AUTHOR,
      active: o.active ?? true,
      status: o.status ?? 'idle',
      runningSince: o.runningSince ?? null,
      consecutiveFailures: o.failures ?? 0,
    },
  })
}

async function makeRun(stateId: string, name: string, startedAt: Date) {
  return prisma!.agentRun.create({
    data: { stateId, spaceId: SPACE, name, trigger: 'scheduled', status: 'running', startedAt },
  })
}

const state = (id: string) => prisma!.agentState.findUniqueOrThrow({ where: { id } })
const run = (id: string) => prisma!.agentRun.findUniqueOrThrow({ where: { id } })

// ── tests ───────────────────────────────────────────────────────────────────

test('reclaimStale: grace period, timeout bookkeeping, and repeated_failure', async (t) => {
  const reason = await probe()
  if (reason) return t.skip(reason)
  const { reclaimStale } = await import('@/lib/agents/schedule')
  await setup()
  try {
    const now = new Date()
    const justAtCap = new Date(now.getTime() - MAX_RUN_MS - 30_000) // past the run cap, inside the grace
    const wellPast = new Date(now.getTime() - MAX_RUN_MS - RECLAIM_GRACE_MS - 60_000)

    const fresh = await makeAgent('inside-grace', { status: 'running', runningSince: justAtCap })
    const freshRun = await makeRun(fresh.id, 'inside-grace', justAtCap)
    await prisma!.agentState.update({ where: { id: fresh.id }, data: { currentRunId: freshRun.id } })

    const stale = await makeAgent('stale', { status: 'running', runningSince: wellPast, failures: 0 })
    const staleRun = await makeRun(stale.id, 'stale', wellPast)
    await prisma!.agentState.update({ where: { id: stale.id }, data: { currentRunId: staleRun.id } })

    const dying = await makeAgent('dying', { status: 'running', runningSince: wellPast, failures: MAX_CONSECUTIVE_FAILURES - 1 })
    const dyingRun = await makeRun(dying.id, 'dying', wellPast)
    await prisma!.agentState.update({ where: { id: dying.id }, data: { currentRunId: dyingRun.id } })

    const reclaimed = await reclaimStale(now)
    assert.equal(reclaimed, 2, 'only the two rows past MAX_RUN_MS + grace are reclaimed')

    // Inside the grace: untouched — the executor is still allowed to release.
    const f = await state(fresh.id)
    assert.equal(f.status, 'running')
    assert.equal(f.currentRunId, freshRun.id)
    assert.equal((await run(freshRun.id)).status, 'running')

    // Stale: freed, run failed as timeout, failure counted, claim cleared.
    const s = await state(stale.id)
    assert.equal(s.status, 'idle')
    assert.equal(s.runningSince, null)
    assert.equal(s.currentRunId, null)
    assert.equal(s.consecutiveFailures, 1)
    assert.equal(s.active, true)
    const sr = await run(staleRun.id)
    assert.equal(sr.status, 'failed')
    assert.equal(sr.terminalReason, 'timeout')

    // Third strike by timeout deactivates, exactly like a live failure would.
    const d = await state(dying.id)
    assert.equal(d.status, 'idle')
    assert.equal(d.consecutiveFailures, MAX_CONSECUTIVE_FAILURES)
    assert.equal(d.active, false)
    assert.equal(d.deactivatedReason, 'repeated_failure')

    // Idempotent: a second pass finds nothing.
    assert.equal(await reclaimStale(now), 0)
  } finally {
    await teardown()
  }
})

test('release is a CAS on current_run_id: a reclaimed run cannot flip the row under a newer claim', async (t) => {
  const reason = await probe()
  if (reason) return t.skip(reason)
  const { executeRun } = await import('@/lib/agents/runner')
  await setup()
  try {
    // No brief note exists, so executeRun fails fast with `config` and goes
    // straight to release() — the shortest real path through the release CAS.
    const st = await makeAgent('racer', { status: 'running', runningSince: new Date(), failures: 1 })
    const oldRun = await makeRun(st.id, 'racer', new Date(Date.now() - MAX_RUN_MS))
    const newRun = await makeRun(st.id, 'racer', new Date())
    // The tick reclaimed oldRun and re-claimed the agent for newRun.
    await prisma!.agentState.update({ where: { id: st.id }, data: { currentRunId: newRun.id, consecutiveFailures: 2 } })

    const late = await executeRun(oldRun.id)
    assert.equal(late.status, 'failed')
    // Its own run row is finalised…
    assert.equal((await run(oldRun.id)).status, 'failed')
    // …but the state row still belongs to newRun: running, count untouched, not deactivated.
    const afterLate = await state(st.id)
    assert.equal(afterLate.status, 'running', 'late release must not idle the row under the newer run')
    assert.equal(afterLate.currentRunId, newRun.id)
    assert.equal(afterLate.consecutiveFailures, 2, 'late release must not double-count')
    assert.equal(afterLate.active, true)
    assert.equal(late.deactivated, null)

    // The run that DOES hold the claim releases normally.
    const own = await executeRun(newRun.id)
    assert.equal(own.status, 'failed')
    const afterOwn = await state(st.id)
    assert.equal(afterOwn.status, 'idle')
    assert.equal(afterOwn.currentRunId, null)
    assert.equal(afterOwn.runningSince, null)
    // A missing brief is a `deleted` deactivation, so active flips off here.
    assert.equal(afterOwn.active, false)
    assert.equal(afterOwn.deactivatedReason, 'deleted')
  } finally {
    await teardown()
  }
})

test('claimManualRun names its run in current_run_id and is exclusive per agent', async (t) => {
  const reason = await probe()
  if (reason) return t.skip(reason)
  process.env.AGENT_DISPATCH = 'inline'
  const { claimManualRun } = await import('@/lib/agents/schedule')
  await setup()
  try {
    const st = await makeAgent('manual', { active: true })
    const first = await claimManualRun(SPACE, 'manual', AUTHOR)
    assert.equal(first.ok, true)
    if (!first.ok) return
    const claimed = await state(st.id)
    assert.equal(claimed.status, 'running')
    assert.equal(claimed.currentRunId, first.runId, 'the claim names the run it minted')
    assert.equal((await run(first.runId)).id, first.runId)

    // Meanwhile a second "Run now" is refused by the per-agent CAS.
    const second = await claimManualRun(SPACE, 'manual', AUTHOR)
    assert.equal(second.ok, false)
    if (!second.ok) assert.equal(second.code, 'busy')

    // Let the inline dispatch finish (no brief → fails fast) and release.
    await first.dispatch
    const released = await state(st.id)
    assert.equal(released.status, 'idle')
    assert.equal(released.currentRunId, null)
  } finally {
    await teardown()
  }
})

test('canTriggerRun (transcript + Run-now gate): author and admin yes, other member no', async (t) => {
  const reason = await probe()
  if (reason) return t.skip(reason)
  const { canTriggerRun } = await import('@/lib/agents/service')
  const { agentBriefPath } = await import('@/lib/agents/config')
  const { OPEN_ACCESS } = await import('@/lib/notes/shared/authz')
  await setup()
  try {
    await prisma!.contextNote.create({
      data: {
        spaceId: SPACE,
        ownerKey: 'shared',
        path: agentBriefPath('gated'),
        content: '---\ntype: agent\nmodel: openai/gpt-4o-mini\n---\nDo the thing.\n',
        createdBy: AUTHOR,
      },
    })
    const principal = (userId: string, spaceAdmin: boolean) => ({
      userId,
      email: `${userId}@local.test`,
      name: userId,
      spaceId: SPACE,
      spaceAdmin,
      access: OPEN_ACCESS,
    })
    assert.equal(await canTriggerRun(principal(AUTHOR, false), SPACE, 'gated'), true)
    assert.equal(await canTriggerRun(principal(ADMIN, true), SPACE, 'gated'), true)
    assert.equal(await canTriggerRun(principal(MEMBER, false), SPACE, 'gated'), false)
    assert.equal(await canTriggerRun(principal(MEMBER, false), SPACE, 'no-such-agent'), false)
  } finally {
    await teardown()
  }
})

test.after(async () => {
  await prisma?.$disconnect()
})
