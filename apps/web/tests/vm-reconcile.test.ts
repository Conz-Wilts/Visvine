/**
 * The meter bills what is awake, and only the edge knows what that is.
 *
 * The platform's idle timer stops a container without telling the control
 * plane, so an `agent_vms` row that says `running` goes on saying it forever
 * unless something asks. `reconcileSleptMachines` is that something, and the
 * tick runs it BEFORE the meter — a machine found asleep must stop being billed
 * on the same tick it is found, not the next one.
 *
 * Rows again, so this talks to the LOCAL Docker Postgres and SKIPS loudly when
 * there is none (same guard as tests/agents-tick.test.ts).
 *
 * Covered:
 *   • a row the edge says is stopped becomes `asleep`, and the next meter pass
 *     does not charge its space;
 *   • a row the edge says is still up keeps its state and keeps being metered;
 *   • an edge that throws leaves the row alone — an outage must not silently
 *     zero a space's usage;
 *   • a finished run stops its machine rather than serving out the platform's
 *     ten idle minutes, EXCEPT while somebody is watching the screen or holding
 *     the keyboard.
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
// `reconcileSleptMachines` is a no-op with no edge configured, which is the
// right answer in production and the wrong one for a test: the status function
// is injected, so what these need is only for `edgeConfigured()` to be true.
process.env.AGENT_EDGE_URL ??= 'https://edge.invalid'
process.env.EDGE_SERVICE_TOKEN ??= 'test-token'

type Prisma = typeof import('@/lib/prisma').default
let prisma: Prisma | null = null
let probed: Promise<string | null> | null = null

function probe(): Promise<string | null> {
  if (probed) return probed
  probed = (async () => {
    if (!dbUrl) return 'no local DATABASE_URL (apps/web/.env) — vm reconcile tests need the Docker Postgres'
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

const SPACE = `test-vm-reconcile-${process.pid}`
const ASLEEP = 'sleeper'
const AWAKE = 'worker'

async function teardown() {
  const p = prisma!
  await p.agentVmUsage.deleteMany({ where: { spaceId: SPACE } })
  await p.agentVm.deleteMany({ where: { spaceId: SPACE } })
  await p.space.deleteMany({ where: { id: SPACE } })
}

async function setup(agents: readonly string[]) {
  const p = prisma!
  await teardown()
  await p.space.create({ data: { id: SPACE, name: 'vm reconcile test', timezone: 'UTC' } })
  for (const agentName of agents) {
    await p.agentVm.create({
      data: {
        spaceId: SPACE,
        agentName,
        substrateName: `vm-test-${SPACE}:${agentName}`,
        workspaceKey: `test/${SPACE}`,
        state: 'running',
      },
    })
  }
}

async function stateOf(agentName: string): Promise<string> {
  const row = await prisma!.agentVm.findUniqueOrThrow({
    where: { vm_identity: { spaceId: SPACE, agentName } },
    select: { state: true },
  })
  return row.state
}

async function meteredSeconds(): Promise<number> {
  const { monthOf } = await import('@/lib/vm/quota')
  const row = await prisma!.agentVmUsage.findUnique({
    where: { usage_identity: { spaceId: SPACE, month: monthOf(new Date()) } },
    select: { seconds: true },
  })
  return row?.seconds ?? 0
}

test('a machine the platform put to sleep stops being metered', async (t) => {
  const why = await probe()
  if (why) return t.skip(why)
  const { reconcileSleptMachines } = await import('@/lib/vm/lease')
  const { meterAwakeMachines } = await import('@/lib/vm/quota')

  await setup([ASLEEP, AWAKE])

  // The sweep is platform-wide, so its count includes whatever else the local
  // database happens to be holding. What this test owns is its own two rows.
  await reconcileSleptMachines(async (_space, agentName) => ({ running: agentName === AWAKE }))
  assert.equal(await stateOf(ASLEEP), 'asleep')
  assert.equal(await stateOf(AWAKE), 'running')

  // One machine awake for one tick, not two: the sleeper is off the bill from
  // the tick it was found, which is the whole point of reconciling first.
  await meterAwakeMachines(60)
  assert.equal(await meteredSeconds(), 60)

  await teardown()
})

test('an edge that cannot answer leaves the row as it found it', async (t) => {
  const why = await probe()
  if (why) return t.skip(why)
  const { reconcileSleptMachines } = await import('@/lib/vm/lease')

  await setup([ASLEEP])
  await reconcileSleptMachines(async () => {
    throw new Error('edge down')
  })
  assert.equal(await stateOf(ASLEEP), 'running')

  await teardown()
})

test('a finished run stops its machine instead of paying out the idle timer', async (t) => {
  const why = await probe()
  if (why) return t.skip(why)
  const { releaseMachineAfterRun } = await import('@/lib/vm/lease')

  await setup([AWAKE])
  const stopped: string[] = []
  const released = await releaseMachineAfterRun(SPACE, AWAKE, {
    status: async () => ({ running: true, watching: 0, takeover: false }),
    stop: async (_space, agentName) => void stopped.push(agentName),
  })

  assert.equal(released, true)
  assert.deepEqual(stopped, [AWAKE])
  assert.equal(await stateOf(AWAKE), 'asleep')

  await teardown()
})

test('a machine somebody is watching is left running', async (t) => {
  const why = await probe()
  if (why) return t.skip(why)
  const { releaseMachineAfterRun } = await import('@/lib/vm/lease')

  await setup([AWAKE])
  let stopCalls = 0
  // A person looking at the screen expects it to still be there when the agent
  // stops; the ten-minute idle timer is the right policy for them.
  const watched = await releaseMachineAfterRun(SPACE, AWAKE, {
    status: async () => ({ running: true, watching: 1, takeover: false }),
    stop: async () => void (stopCalls += 1),
  })
  assert.equal(watched, false)

  const heldByAPerson = await releaseMachineAfterRun(SPACE, AWAKE, {
    status: async () => ({ running: true, watching: 0, takeover: true }),
    stop: async () => void (stopCalls += 1),
  })
  assert.equal(heldByAPerson, false)

  assert.equal(stopCalls, 0)
  assert.equal(await stateOf(AWAKE), 'running')

  await teardown()
})
