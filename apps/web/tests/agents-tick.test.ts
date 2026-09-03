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
 *   • canTriggerRun (transcript + Run-now gate): author yes, admin yes, a
 *     member who can edit the brief yes, a view-only member no.
 *   • agent_events: 50 enqueues → the pending cap, one tick claim carrying
 *     them all (trigger `event`, oldest first), dedupe by key; an event during
 *     a run doesn't pull next_run_at but release re-arms it; glob/webhook
 *     recipient lookups and the no-self-loop rule.
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
  // reclaimStale counts EVERY stale running row in the database, not just this
  // space's — so a fixture an interrupted earlier run left behind (a different
  // pid, so a different SPACE, never torn down) makes the count assertions
  // off by one, once, and then vanishes because that very run reclaimed it.
  await teardownOrphans()
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

/** Fixtures from earlier runs of this file that never reached teardown. */
async function teardownOrphans() {
  const p = prisma!
  const spaceId = { startsWith: 'test-agents-tick-' }
  await p.agentEvent.deleteMany({ where: { spaceId } })
  await p.agentSubscription.deleteMany({ where: { spaceId } })
  await p.connectorSecret.deleteMany({ where: { spaceId } })
  await p.agentRun.deleteMany({ where: { spaceId } })
  await p.agentState.deleteMany({ where: { spaceId } })
  await p.contextNote.deleteMany({ where: { spaceId } })
  await p.spaceMember.deleteMany({ where: { spaceId } })
  await p.space.deleteMany({ where: { id: spaceId } })
  await p.user.deleteMany({ where: { id: { startsWith: 'test-agents-' }, email: { endsWith: '@local.test' } } })
}

async function teardown() {
  const p = prisma!
  await p.agentEvent.deleteMany({ where: { spaceId: SPACE } })
  await p.agentSubscription.deleteMany({ where: { spaceId: SPACE } })
  await p.connectorSecret.deleteMany({ where: { spaceId: SPACE } })
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

test('canTriggerRun (transcript + Run-now gate): author, admin and a member who can edit the brief yes; a read-only member no', async (t) => {
  const reason = await probe()
  if (reason) return t.skip(reason)
  const { canTriggerRun } = await import('@/lib/agents/service')
  const { agentBriefPath } = await import('@/lib/agents/config')
  const { OPEN_ACCESS, LEVEL_VIEW } = await import('@/lib/notes/shared/authz')
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
    const principal = (userId: string, spaceAdmin: boolean, access = OPEN_ACCESS) => ({
      userId,
      email: `${userId}@local.test`,
      name: userId,
      spaceId: SPACE,
      spaceAdmin,
      access,
    })
    const readOnly = { ...OPEN_ACCESS, grants: [{ ...OPEN_ACCESS.grants[0], level: LEVEL_VIEW }] }
    assert.equal(await canTriggerRun(principal(AUTHOR, false, readOnly), SPACE, 'gated'), true, 'the author, whatever their grants')
    assert.equal(await canTriggerRun(principal(ADMIN, true), SPACE, 'gated'), true)
    assert.equal(await canTriggerRun(principal(MEMBER, false), SPACE, 'gated'), true, 'a member who can edit the brief')
    assert.equal(await canTriggerRun(principal(MEMBER, false, readOnly), SPACE, 'gated'), false, 'a member who can only read it')
    assert.equal(await canTriggerRun(principal(MEMBER, false), SPACE, 'no-such-agent'), false)
  } finally {
    await teardown()
  }
})

// ── events: the mailbox behind reactive agents ──────────────────────────────

test('enqueueAgentEvent: 50 enqueues → one claim of ≤ cap; dedupe collapses; pull-forward only when idle', async (t) => {
  const reason = await probe()
  if (reason) return t.skip(reason)
  const { enqueueAgentEvent, claimEvents, MAX_PENDING_EVENTS, MAX_EVENTS_PER_RUN } = await import('@/lib/agents/events')
  const { tick } = await import('@/lib/agents/schedule')
  process.env.AGENT_DISPATCH = 'inline'
  await setup()
  try {
    // An event-only agent: active, idle, no clock (next_run_at null), listening on people/**.
    const st = await prisma!.agentState.create({
      data: { spaceId: SPACE, name: 'listener', runAsUserId: AUTHOR, active: true, triggersJson: { context: ['people/**'], webhook: null }, debounceMs: 5_000 },
    })
    const before = Date.now()
    let ok = 0
    let capped = 0
    for (let i = 0; i < 50; i++) {
      const r = await enqueueAgentEvent({ spaceId: SPACE, agentName: 'listener', kind: 'note_written', source: `people/p${i}.md`, summary: `saved #${i}`, payload: { i } })
      if (r.ok) ok++
      else if ('capped' in r) capped++
    }
    assert.equal(ok, MAX_PENDING_EVENTS, 'pending cap holds')
    assert.equal(capped, 50 - MAX_PENDING_EVENTS)
    // The first enqueue pulled next_run_at to now + debounce (5s); later ones didn't push it out.
    const armed = await state(st.id)
    assert.ok(armed.nextRunAt, 'next_run_at armed by the first event')
    const delta = armed.nextRunAt!.getTime() - before
    assert.ok(delta >= 0 && delta <= 5_000 + 60_000, `armed within debounce (got ${delta}ms)`)

    // Dedupe: while a key is pending, a second enqueue with it is a no-op.
    const d1 = await enqueueAgentEvent({ spaceId: SPACE, agentName: 'dup', kind: 'note_written', source: 'people/a.md', summary: 's', dedupeKey: 'note_written:people/a.md' })
    const d2 = await enqueueAgentEvent({ spaceId: SPACE, agentName: 'dup', kind: 'note_written', source: 'people/a.md', summary: 's', dedupeKey: 'note_written:people/a.md' })
    assert.ok(d1.ok)
    assert.ok(!d2.ok && 'deduped' in d2)

    // The tick, at a time past the debounce, claims ONE run and stamps every pending event with it.
    const later = new Date(armed.nextRunAt!.getTime() + 1_000)
    // No brief note exists → the tick's re-derive path would sync (and deactivate) — give it a brief + live note.
    await prisma!.contextNote.createMany({
      data: [
        { spaceId: SPACE, ownerKey: 'shared', path: 'agents/listener/index.md', content: '---\ntype: agent\nmodel: openai/gpt-4o-mini\n---\nReact.\n', createdBy: AUTHOR },
        { spaceId: SPACE, ownerKey: 'shared', path: 'agents/listener/activation.md', content: '---\ntype: agent-activation\nactive: true\non:\n  context: ["people/**"]\ndebounce: 5s\n---\n', createdBy: ADMIN },
      ],
    })
    // Match the hash the tick will compute so it claims without re-deriving.
    const { parseAgentActivation, scheduleHash } = await import('@/lib/agents/config')
    const { parseFrontmatter } = await import('@/lib/notes/shared/markdown')
    const parsed = parseAgentActivation(parseFrontmatter('---\ntype: agent-activation\nactive: true\non:\n  context: ["people/**"]\ndebounce: 5s\n---\n'))
    assert.ok(parsed.ok)
    if (!parsed.ok) return
    await prisma!.agentState.update({ where: { id: st.id }, data: { scheduleHash: scheduleHash(parsed.activation, 'UTC') } })

    // The tick is global: refuse to run it if some other due agent in this DB would be claimed and dispatched.
    const otherDue = await prisma!.agentState.count({ where: { active: true, status: 'idle', nextRunAt: { lte: later }, NOT: { spaceId: SPACE } } })
    if (otherDue > 0) return t.skip(`${otherDue} other due agent(s) in the local DB — not running the global tick`)
    const report = await tick(later)
    assert.equal(report.claimed.length, 1, 'one run for the whole burst')
    const runId = report.claimed[0]
    const run = await prisma!.agentRun.findUniqueOrThrow({ where: { id: runId } })
    assert.equal(run.trigger, 'event')
    assert.equal(run.eventCount, MAX_PENDING_EVENTS)
    const input = run.input as { events: { kind: string; source: string }[] }
    assert.equal(input.events.length, MAX_PENDING_EVENTS)
    assert.equal(input.events[0].source, 'people/p0.md', 'oldest first')
    const consumed = await prisma!.agentEvent.count({ where: { spaceId: SPACE, agentName: 'listener', consumedBy: runId } })
    assert.equal(consumed, MAX_PENDING_EVENTS)
    assert.equal(await prisma!.agentEvent.count({ where: { spaceId: SPACE, agentName: 'listener', consumedBy: null } }), 0)
    assert.ok(MAX_EVENTS_PER_RUN >= MAX_PENDING_EVENTS)
    // A second claim finds nothing.
    assert.equal((await claimEvents(SPACE, 'listener', 'nope')).length, 0)
    // The inline run failed fast (no key) and released; the row is idle with no clock.
    const after = await state(st.id)
    assert.equal(after.status, 'idle')
    assert.equal(after.nextRunAt, null, 'event-only agent goes back to no clock once the mail is taken')
  } finally {
    await prisma!.agentEvent.deleteMany({ where: { spaceId: SPACE } })
    await teardown()
  }
})

test('an event that arrives while the agent is running does not pull next_run_at; release re-arms it', async (t) => {
  const reason = await probe()
  if (reason) return t.skip(reason)
  const { enqueueAgentEvent } = await import('@/lib/agents/events')
  const { executeRun } = await import('@/lib/agents/runner')
  await setup()
  try {
    const before = Date.now()
    const st2 = await makeAgent('busy2', { status: 'running', runningSince: new Date(), failures: 0 })
    await prisma!.agentState.update({ where: { id: st2.id }, data: { triggersJson: { context: ['people/**'], webhook: null }, debounceMs: 5_000, nextRunAt: null } })
    await prisma!.contextNote.create({
      data: { spaceId: SPACE, ownerKey: 'shared', path: 'agents/busy2.md', content: '---\ntype: agent\nmodel: openai/gpt-4o-mini\n---\nReact.\n', createdBy: AUTHOR },
    })
    // An undecryptable key row makes the run fail with `bad_key` (config, counts as a failure) WITHOUT deactivating.
    await prisma!.connectorSecret.create({ data: { spaceId: SPACE, name: 'MODEL_KEY_OPENAI', ciphertext: 'garbage' } })
    // The brief was inserted behind the store's back, and the space was rebuilt under a process that already
    // memoised its access seeding: drop the cached vault and grant the author root access by hand.
    ;(await import('@/lib/notes/vaultCache')).invalidateVault({ spaceId: SPACE, ownerKey: 'shared' })
    await prisma!.contextGrant.create({ data: { spaceId: SPACE, subjectType: 'user', subjectId: AUTHOR, resourcePath: '', level: 30, grantedBy: 'system' } })
    const running2 = await makeRun(st2.id, 'busy2', new Date())
    await prisma!.agentState.update({ where: { id: st2.id }, data: { currentRunId: running2.id } })
    await enqueueAgentEvent({ spaceId: SPACE, agentName: 'busy2', kind: 'webhook', source: 'hubspot', summary: 'contact.created' })
    assert.equal((await state(st2.id)).nextRunAt, null, 'a running row is not pulled forward')
    // executeRun fails at the undecryptable key (config) — counts as a failure, no deactivation, row released idle.
    const outcome = await executeRun(running2.id)
    assert.equal(outcome.status, 'failed')
    const re = await state(st2.id)
    assert.equal(re.status, 'idle')
    assert.equal(re.active, true)
    assert.ok(re.nextRunAt, 'release re-armed next_run_at for the mail that arrived mid-run')
    const delta = re.nextRunAt!.getTime() - before
    assert.ok(delta >= 0 && delta <= 5_000 + 60_000, `re-armed within debounce (got ${delta}ms)`)
  } finally {
    await prisma!.agentEvent.deleteMany({ where: { spaceId: SPACE } })
    await teardown()
  }
})

test('matchNoteTriggers / webhookRecipients / fireNoteTriggers (self-loop excluded)', async (t) => {
  const reason = await probe()
  if (reason) return t.skip(reason)
  const { matchNoteTriggers, webhookRecipients, fireNoteTriggers } = await import('@/lib/agents/events')
  await setup()
  try {
    await prisma!.agentState.createMany({
      data: [
        { spaceId: SPACE, name: 'people-watcher', runAsUserId: AUTHOR, active: true, triggersJson: { context: ['people/**'], webhook: null } },
        { spaceId: SPACE, name: 'hub', runAsUserId: AUTHOR, active: true, triggersJson: { context: [], webhook: 'hubspot' } },
        { spaceId: SPACE, name: 'off', runAsUserId: AUTHOR, active: false, triggersJson: { context: ['people/**'], webhook: 'hubspot' } },
        { spaceId: SPACE, name: 'clock', runAsUserId: AUTHOR, active: true },
      ],
    })
    assert.deepEqual(await matchNoteTriggers(SPACE, 'people/alice.md'), ['people-watcher'])
    assert.deepEqual(await matchNoteTriggers(SPACE, 'reports/x.md'), [])
    assert.deepEqual(await matchNoteTriggers(SPACE, 'agents/people-watcher.md'), [])
    assert.deepEqual(await webhookRecipients(SPACE, 'hubspot'), ['hub'])
    assert.deepEqual(await webhookRecipients(SPACE, 'stripe'), [])

    const fired = await fireNoteTriggers(SPACE, 'people/alice.md', { id: AUTHOR, name: 'Author' }, 'edit')
    assert.deepEqual(fired, ['people-watcher'])
    // Same path again while pending: deduped (one row per path).
    assert.deepEqual(await fireNoteTriggers(SPACE, 'people/alice.md', { id: AUTHOR, name: 'Author' }, 'edit'), [])
    assert.equal(await prisma!.agentEvent.count({ where: { spaceId: SPACE, agentName: 'people-watcher', consumedBy: null } }), 1)
    // The agent's own write does not wake itself.
    assert.deepEqual(await fireNoteTriggers(SPACE, 'people/bob.md', { id: AUTHOR, name: 'Author' }, 'agent', { exceptAgent: 'people-watcher' }), [])
  } finally {
    await prisma!.agentEvent.deleteMany({ where: { spaceId: SPACE } })
    await teardown()
  }
})

test('claimManualRun resets next_run_at once it takes the mail; a trigger-only agent with no mail is released by the tick without a run', async (t) => {
  const reason = await probe()
  if (reason) return t.skip(reason)
  process.env.AGENT_DISPATCH = 'inline'
  const { enqueueAgentEvent } = await import('@/lib/agents/events')
  const { claimManualRun, tick } = await import('@/lib/agents/schedule')
  const { parseAgentActivation, scheduleHash } = await import('@/lib/agents/config')
  const { parseFrontmatter } = await import('@/lib/notes/shared/markdown')
  await setup()
  try {
    const live = '---\ntype: agent-activation\nactive: true\non:\n  context: ["people/**"]\ndebounce: 5s\n---\n'
    const parsed = parseAgentActivation(parseFrontmatter(live))
    assert.ok(parsed.ok)
    if (!parsed.ok) return
    await prisma!.contextNote.createMany({
      data: [
        { spaceId: SPACE, ownerKey: 'shared', path: 'agents/only/index.md', content: '---\ntype: agent\nmodel: openai/gpt-4o-mini\n---\nReact.\n', createdBy: AUTHOR },
        { spaceId: SPACE, ownerKey: 'shared', path: 'agents/only/activation.md', content: live, createdBy: ADMIN },
      ],
    })
    // The inline run must fail WITHOUT deactivating (as in the mid-run test): an undecryptable key + root access for the author.
    await prisma!.connectorSecret.create({ data: { spaceId: SPACE, name: 'MODEL_KEY_OPENAI', ciphertext: 'garbage' } })
    ;(await import('@/lib/notes/vaultCache')).invalidateVault({ spaceId: SPACE, ownerKey: 'shared' })
    await prisma!.contextGrant.create({ data: { spaceId: SPACE, subjectType: 'user', subjectId: AUTHOR, resourcePath: '', level: 30, grantedBy: 'system' } })
    const st = await prisma!.agentState.create({
      data: { spaceId: SPACE, name: 'only', runAsUserId: AUTHOR, active: true, triggersJson: { context: ['people/**'], webhook: null }, debounceMs: 5_000, scheduleHash: scheduleHash(parsed.activation, 'UTC') },
    })
    // An event pulls next_run_at forward …
    assert.ok((await enqueueAgentEvent({ spaceId: SPACE, agentName: 'only', kind: 'note_written', source: 'people/a.md', summary: 's' })).ok)
    const armed = await state(st.id)
    assert.ok(armed.nextRunAt, 'armed by the event')
    // … "Run now" takes the mail, and with it the reason for that deadline.
    const manual = await claimManualRun(SPACE, 'only', AUTHOR)
    assert.equal(manual.ok, true)
    if (!manual.ok) return
    assert.equal((await state(st.id)).nextRunAt, null, 'a trigger-only agent has no clock once its mail is consumed')
    assert.equal((await run(manual.runId)).eventCount, 1)
    await manual.dispatch
    assert.equal((await state(st.id)).status, 'idle')

    // The phantom: a pulled-forward deadline with no mail behind it (what the
    // old manual claim left). The tick gives the claim back — idle, no clock,
    // NO run row.
    const past = new Date(Date.now() - 1_000)
    await prisma!.agentState.update({ where: { id: st.id }, data: { nextRunAt: past, lastRunAt: past } })
    const otherDue = await prisma!.agentState.count({ where: { active: true, status: 'idle', nextRunAt: { lte: new Date() }, NOT: { spaceId: SPACE } } })
    if (otherDue > 0) return t.skip(`${otherDue} other due agent(s) in the local DB — not running the global tick`)
    const runsBefore = await prisma!.agentRun.count({ where: { spaceId: SPACE, name: 'only' } })
    const report = await tick(new Date())
    assert.equal(report.claimed.length, 0, 'nothing dispatched')
    const after = await state(st.id)
    assert.equal(after.status, 'idle')
    assert.equal(after.currentRunId, null)
    assert.equal(after.nextRunAt, null)
    assert.equal(after.lastRunAt?.getTime(), past.getTime(), 'last_run_at is not moved by a run that did not happen')
    assert.equal(await prisma!.agentRun.count({ where: { spaceId: SPACE, name: 'only' } }), runsBefore, 'no run row either')
  } finally {
    await prisma!.agentEvent.deleteMany({ where: { spaceId: SPACE } })
    await teardown()
  }
})

test('event chains: depth rides payload → run input → next hop, and chains stop after MAX_EVENT_CHAIN_DEPTH', async (t) => {
  const reason = await probe()
  if (reason) return t.skip(reason)
  const { enqueueAgentEvent, fireNoteTriggers, claimEvents, MAX_EVENT_CHAIN_DEPTH } = await import('@/lib/agents/events')
  const { agentNoteWritten, agentNoteRenamed } = await import('@/lib/agents/hooks')
  const { listAudit } = await import('@/lib/notes/audit')
  await setup()
  try {
    // A and B both listen on people/**: each one's writes wake the other.
    const a = await prisma!.agentState.create({ data: { spaceId: SPACE, name: 'a', runAsUserId: AUTHOR, active: true, triggersJson: { context: ['people/**'], webhook: null } } })
    await prisma!.agentState.create({ data: { spaceId: SPACE, name: 'b', runAsUserId: AUTHOR, active: true, triggersJson: { context: ['people/**'], webhook: null } } })
    const shared = { spaceId: SPACE, ownerKey: 'shared' }
    const human = { id: AUTHOR, name: 'Author' }

    // Refused outright above the ceiling; a human's event is depth 0.
    const looped = await enqueueAgentEvent({ spaceId: SPACE, agentName: 'a', kind: 'note_written', source: 'people/z.md', summary: 's', chain: { depth: MAX_EVENT_CHAIN_DEPTH + 1, via: 'b' } })
    assert.deepEqual(looped, { ok: false, looped: true })
    await agentNoteWritten(shared, 'people/h.md', human, { changed: true, origin: 'edit' })
    const [h] = await claimEvents(SPACE, 'a', 'run-h0')
    assert.deepEqual((h.payload as { chain: unknown }).chain, { depth: 0, via: null })
    await claimEvents(SPACE, 'b', 'run-h0b')

    // A's run consumed events at depth 2 (recorded on the run row the way the tick does).
    const runA = await prisma!.agentRun.create({
      data: { stateId: a.id, spaceId: SPACE, name: 'a', trigger: 'event', status: 'running', startedAt: new Date(), input: { events: [{ kind: 'note_written', source: 'people/x.md', summary: 's', at: new Date().toISOString(), depth: 2 }] } },
    })
    await prisma!.agentState.update({ where: { id: a.id }, data: { status: 'running', currentRunId: runA.id } })
    // A's own write: never to itself; to B at depth 3 (the last allowed hop).
    assert.deepEqual(await fireNoteTriggers(SPACE, 'people/y.md', human, 'agent', { exceptAgent: 'a' }), ['b'])
    const [toB] = await claimEvents(SPACE, 'b', 'run-b1')
    assert.deepEqual((toB.payload as { chain: unknown }).chain, { depth: 3, via: 'a' })

    // A run that consumed depth 3 is at the ceiling: its writes wake nobody, and the cut is audited once per run.
    await prisma!.agentRun.update({ where: { id: runA.id }, data: { input: { events: [{ kind: 'note_written', source: 'people/y.md', summary: 's', at: new Date().toISOString(), depth: 3 }] } } })
    assert.deepEqual(await fireNoteTriggers(SPACE, 'people/y2.md', human, 'agent', { exceptAgent: 'a' }), [])
    // The same through the store-hook stamps, for a write and for a rename.
    await agentNoteWritten(shared, 'people/y3.md', human, { changed: true, origin: 'agent', model: 'agent:a' })
    await agentNoteRenamed(shared, 'people/old.md', 'people/y4.md', human, { origin: 'agent', model: 'agent:a' })
    assert.equal(await prisma!.agentEvent.count({ where: { spaceId: SPACE, consumedBy: null } }), 0, 'nothing enqueued past the ceiling')
    const cuts = (await listAudit(SPACE)).filter((e) => e.action === 'agent' && /trigger loop cut at depth 3/.test(e.detail ?? ''))
    assert.equal(cuts.length, 1, 'audited once per run, however many writes')
    assert.equal(((await run(runA.id)).input as { loopCut?: boolean }).loopCut, true)

    // A rename stamped with an agent excludes that agent (no self-loop) and
    // wakes the other; with no run in flight it is a fresh hop (depth 1).
    await prisma!.agentState.update({ where: { id: a.id }, data: { status: 'idle', currentRunId: null } })
    await agentNoteRenamed(shared, 'people/p.md', 'people/q.md', human, { origin: 'agent', model: 'agent:b' })
    assert.equal(await prisma!.agentEvent.count({ where: { spaceId: SPACE, agentName: 'b', consumedBy: null } }), 0, 'B does not wake itself by renaming')
    const [aEv] = await claimEvents(SPACE, 'a', 'run-a2')
    assert.equal(aEv.source, 'people/q.md')
    assert.deepEqual((aEv.payload as { chain: unknown }).chain, { depth: 1, via: 'b' })
  } finally {
    await prisma!.agentEvent.deleteMany({ where: { spaceId: SPACE } })
    await teardown()
  }
})

test('a fire fans out: one run per subscriber, each acting as that person', async (t) => {
  const reason = await probe()
  if (reason) return t.skip(reason)
  const { enqueueAgentEvent } = await import('@/lib/agents/events')
  const { tick } = await import('@/lib/agents/schedule')
  const { parseAgentActivation, scheduleHash } = await import('@/lib/agents/config')
  const { parseFrontmatter } = await import('@/lib/notes/shared/markdown')
  process.env.AGENT_DISPATCH = 'inline'
  await setup()
  try {
    const activationNote = '---\ntype: agent-activation\nactive: true\non:\n  context: ["people/**"]\ndebounce: 5s\n---\n'
    const parsed = parseAgentActivation(parseFrontmatter(activationNote))
    assert.ok(parsed.ok)
    if (!parsed.ok) return
    const st = await prisma!.agentState.create({
      data: {
        spaceId: SPACE,
        name: 'fan',
        runAsUserId: AUTHOR,
        active: true,
        triggersJson: { context: ['people/**'], webhook: null },
        debounceMs: 5_000,
        scheduleHash: scheduleHash(parsed.activation, 'UTC'),
      },
    })
    await prisma!.contextNote.createMany({
      data: [
        { spaceId: SPACE, ownerKey: 'shared', path: 'agents/fan/index.md', content: '---\ntype: agent\nmodel: openai/gpt-4o-mini\n---\nSummarise.\n', createdBy: AUTHOR },
        { spaceId: SPACE, ownerKey: 'shared', path: 'agents/fan/activation.md', content: activationNote, createdBy: ADMIN },
      ],
    })
    await prisma!.agentSubscription.create({ data: { spaceId: SPACE, name: 'fan', userId: MEMBER } })
    // An undecryptable model key: the inline runs then fail `bad_key` — a
    // platform fault that neither deactivates nor calls a provider — so the
    // group keeps claiming, which is the behaviour under test.
    await prisma!.connectorSecret.create({ data: { spaceId: SPACE, name: 'MODEL_KEY_OPENAI', ciphertext: 'aes256gcm$AAAA$AAAA$AAAA' } })
    // The briefs went in behind the store's back, and SPACE is one id per
    // process: an earlier test in this file has already memoised its access
    // seeding, so the author cannot read `agents/fan/index.md` and the run
    // fails `author_gone` — which deactivates the row and takes the fan-out
    // with it. Drop the cached vault and grant the author root by hand.
    ;(await import('@/lib/notes/vaultCache')).invalidateVault({ spaceId: SPACE, ownerKey: 'shared' })
    await prisma!.contextGrant.create({ data: { spaceId: SPACE, subjectType: 'user', subjectId: AUTHOR, resourcePath: '', level: 30, grantedBy: 'system' } })

    await enqueueAgentEvent({ spaceId: SPACE, agentName: 'fan', kind: 'note_written', source: 'people/p.md', summary: 'saved', payload: {} })
    const armed = await state(st.id)
    assert.ok(armed.nextRunAt)
    const later = new Date(armed.nextRunAt!.getTime() + 1_000)
    const otherDue = await prisma!.agentState.count({ where: { active: true, status: 'idle', nextRunAt: { lte: later }, NOT: { spaceId: SPACE } } })
    if (otherDue > 0) return t.skip(`${otherDue} other due agent(s) in the local DB — not running the global tick`)

    const report = await tick(later)
    assert.equal(report.dispatched.length, 2, 'the author run, then one per subscriber')
    const runs = await Promise.all(report.dispatched.map((d) => run(d.runId)))
    assert.equal(runs[0].runAsUserId, null, 'the first run is the state row identity (the author)')
    assert.equal(runs[1].runAsUserId, MEMBER, 'the fan-out run acts as the subscriber')
    assert.equal(runs[1].trigger, runs[0].trigger, 'a fan-out run keeps the fire that woke it')
    const input = runs[1].input as { events: { source: string }[] }
    assert.equal(input.events[0].source, 'people/p.md', 'event summaries ride the subscriber run input')
    assert.equal(runs[1].eventCount, 0, 'payloads were consumed by the first run only')
    // Both inline runs failed fast (no model key) and released; one row, idle.
    const after = await state(st.id)
    assert.equal(after.status, 'idle')
  } finally {
    await prisma!.agentEvent.deleteMany({ where: { spaceId: SPACE } })
    await teardown()
  }
})

test.after(async () => {
  await prisma?.$disconnect()
})
