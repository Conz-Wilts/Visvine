/**
 * Leasing an agent a machine.
 *
 * The runtime scales to zero and is N processes, so nothing here holds a
 * container across requests: `agent_vms` is the handle, every call re-derives
 * the machine from the row, and the edge is addressed by (space, agent) rather
 * than by anything we remember. `getOrCreate` semantics all the way down, so
 * the scheduler tick and a request that both want the same machine cannot
 * produce two.
 *
 * The policy is compiled HERE, on every lease, from the space's connectors —
 * never cached on the edge and never authored there. A machine that cannot be
 * given a policy does not get leased.
 */
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { machineName, workspacePrefix } from '@visvine/vm-policy'
import { compileForSpace } from '@/lib/vm/policy'
import { allowedToRun, markAsleep, recordExec } from '@/lib/vm/quota'
import * as edge from '@/lib/vm/edge'
import type { InstanceType } from '@/lib/vm/edge'

/** Ten idle minutes, matching the platform's own timer and §16's cost model. */
const IDLE_MINUTES = 10
/** A lease nobody has touched for this long is reaped; the workspace outlives it. */
const LEASE_DAYS = 14
const DEFAULT_INSTANCE: InstanceType = 'standard-3'

export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QuotaExceededError'
  }
}

interface LeasedMachine {
  vmId: string
  substrateName: string
  policyHash: string
  booted: boolean
}

/**
 * Which world these machines belong to.
 *
 * Production and a developer's laptop share one edge and one bucket, so this is
 * what keeps them from addressing each other's machines. It is decided here,
 * never at the edge, and it defaults to `dev` — a deployment that forgets to
 * say it is production gets its own namespace rather than production's.
 */
export function environment(): string {
  const named = process.env.VISVINE_ENV?.trim()
  if (named) return named
  return process.env.NODE_ENV === 'production' ? 'prod' : 'dev'
}

/**
 * Lease the machine for (space, agent), booting it if it is not already up.
 *
 * Every call recompiles the policy and hands it down, so a connector an admin
 * just turned off stops being reachable on the next lease rather than at the
 * next boot. `taskAllow` narrows further and can never widen: an agent's run
 * passes the hosts of the connectors its brief declares, so its machine
 * reaches what its `run_connector` may and nothing more (an empty list is a
 * machine with no network). Undefined is the space's whole list, which is what
 * a person's own vm_exec / vm_browse get.
 */
async function leaseMachine(
  spaceId: string,
  agentName: string,
  options: { taskAllow?: readonly string[]; instanceType?: InstanceType } = {},
): Promise<LeasedMachine> {
  // Checked before anything is taken, so a space over its cap spends nothing
  // more rather than finding out afterwards. `QuotaExceededError` is not a
  // fault: it is the limit doing its job, and callers turn it into a refusal a
  // person can act on.
  const quota = await allowedToRun(spaceId)
  if (!quota.allowed) throw new QuotaExceededError(quota.reason)

  const compiled = await compileForSpace(spaceId, { taskAllow: options.taskAllow })
  const env = environment()
  const substrateName = machineName(env, spaceId, agentName)
  const workspaceKey = workspacePrefix(env, spaceId)
  const instanceType = options.instanceType ?? DEFAULT_INSTANCE
  const now = new Date()
  const expiresAt = new Date(now.getTime() + LEASE_DAYS * 24 * 60 * 60 * 1000)

  const row = await prisma.agentVm.upsert({
    where: { vm_identity: { spaceId, agentName } },
    create: {
      spaceId,
      agentName,
      substrateName,
      instanceType,
      workspaceKey,
      state: 'provisioning',
      policyHash: compiled.digest,
      lastActiveAt: now,
      expiresAt,
    },
    update: { instanceType, policyHash: compiled.digest, lastActiveAt: now, expiresAt },
  })

  try {
    const result = await edge.lease({
      environment: env,
      spaceId,
      agentName,
      policy: compiled.policy,
      instanceType,
      workspaceKey,
      idleMinutes: IDLE_MINUTES,
    })
    await prisma.agentVm.update({ where: { id: row.id }, data: { state: 'running' } })
    return { vmId: row.id, substrateName, policyHash: compiled.digest, booted: result.booted }
  } catch (err) {
    // The substrate being down is an outage of machines and nothing else: the
    // row says so, queued work stays queued, and the rest of the platform is
    // untouched because nothing else depends on one.
    await prisma.agentVm.update({ where: { id: row.id }, data: { state: 'unavailable' } })
    throw err
  }
}

interface RunOnMachineResult extends edge.ExecResult {
  vmId: string
  booted: boolean
}

/**
 * Run one command on the agent's machine. The lease is refreshed first, so a
 * machine that has slept wakes with the policy the space permits NOW.
 */
export async function runOnMachine(
  spaceId: string,
  agentName: string,
  cmd: readonly string[],
  options: { timeoutSeconds?: number; taskAllow?: readonly string[]; runId?: string | null; env?: Record<string, string> } = {},
): Promise<RunOnMachineResult> {
  const leased = await leaseMachine(spaceId, agentName, { taskAllow: options.taskAllow })
  const result = await edge.exec(environment(), spaceId, agentName, cmd, options.timeoutSeconds, options.runId, options.env)
  await Promise.all([
    prisma.agentVm.update({ where: { id: leased.vmId }, data: { lastActiveAt: new Date() } }),
    recordExec(spaceId),
  ])
  return { ...result, vmId: leased.vmId, booted: leased.booted }
}

/**
 * Open a page in the agent's browser. The lease is refreshed first, so the
 * browser opens under the policy the space permits NOW — a host it may not
 * reach is a page that does not load, judged at the boundary like any other
 * request.
 */
export async function browseOnMachine(
  spaceId: string,
  agentName: string,
  url: string,
  options: { taskAllow?: readonly string[] } = {},
): Promise<{ started: boolean; alreadyRunning: boolean; vmId: string }> {
  const leased = await leaseMachine(spaceId, agentName, { taskAllow: options.taskAllow })
  const result = await edge.browse(environment(), spaceId, agentName, url)
  await prisma.agentVm.update({ where: { id: leased.vmId }, data: { lastActiveAt: new Date() } })
  return { ...result, vmId: leased.vmId }
}

/**
 * The tick's half of the lifecycle. The platform's own idle timer is what stops
 * a container — this is only about rows: a lease nobody has touched in
 * LEASE_DAYS is reaped, and the machine is told to stop in case it is somehow
 * still up. The space's workspace is not touched; it outlives every agent.
 */
export async function reapExpiredLeases(now = new Date()): Promise<number> {
  const expired = await prisma.agentVm.findMany({
    where: { expiresAt: { lt: now }, state: { not: 'dead' } },
    select: { id: true, spaceId: true, agentName: true },
    take: 25,
  })
  let reaped = 0
  for (const vm of expired) {
    try {
      if (edge.edgeConfigured()) await edge.stop(environment(), vm.spaceId, vm.agentName)
    } catch (err) {
      logger.warn('vm.reap.stop_failed', { vmId: vm.id, err })
    }
    await prisma.agentVm.delete({ where: { id: vm.id } })
    reaped += 1
  }
  return reaped
}

/** Rows reconciled against the edge in one tick. Bounded so a minute stays a minute. */
const RECONCILE_PER_TICK = 25


/**
 * Put the rows back in step with the machines.
 *
 * Nothing tells us when the platform's idle timer stops a container — that is
 * the whole point of letting the platform own the timer — so a row left saying
 * `running` says it forever, and the meter bills a sleeping machine every
 * minute until the space is stopped for a bill it never ran up. This is the one
 * place that asks and writes down the answer.
 *
 * Asking is a read of the Durable Object, not of the container, so reconciling
 * never wakes anything. A machine the edge cannot answer for is left alone: an
 * edge outage must not silently zero a space's usage.
 */
export async function reconcileSleptMachines(
  /** Injected the way `stopOverspendingSpaces` injects its stop, so a test can answer for the edge. */
  ask: (spaceId: string, agentName: string) => Promise<{ running: boolean }> = (spaceId, agentName) =>
    edge.status(environment(), spaceId, agentName),
): Promise<number> {
  if (!edge.edgeConfigured()) return 0
  const running = await prisma.agentVm.findMany({
    where: { state: 'running' },
    select: { id: true, spaceId: true, agentName: true },
    take: RECONCILE_PER_TICK,
  })
  if (running.length === 0) return 0

  const verdicts = await Promise.all(
    running.map(async (vm) => {
      try {
        const state = await ask(vm.spaceId, vm.agentName)
        return { vm, awake: state.running }
      } catch (err) {
        logger.warn('vm.reconcile.unreachable', { vmId: vm.id, err })
        return { vm, awake: true }
      }
    }),
  )

  const slept = verdicts.filter((v) => !v.awake)
  if (slept.length > 0) await markAsleep(slept.map((v) => v.vm.id))
  return slept.length
}

/**
 * Put the machine to sleep now that the run is over.
 *
 * The platform's idle timer is a floor, not a policy: an agent that used its
 * machine for forty seconds still pays ten minutes for the silence afterwards,
 * which for a scheduled agent is most of what it costs all month. The run
 * knows it has finished — the timer can only guess — so the run says so.
 *
 * Refuses in the one case where idle is not idle: somebody is watching the
 * screen, or has taken the keyboard. A person looking at a machine expects it
 * to still be there when the agent stops, and the ten-minute timer is the right
 * policy for THEM.
 *
 * Best-effort by construction. A machine that will not stop is left to the
 * platform's timer, which is exactly where it would have been anyway, so
 * nothing here is worth failing a finished run over.
 */
export async function releaseMachineAfterRun(
  spaceId: string,
  agentName: string,
  /** The edge, injected the way the other tick helpers inject theirs, so a test can be the edge. */
  ops: {
    status?: (spaceId: string, agentName: string) => Promise<{ running: boolean; watching: number; takeover: boolean }>
    stop?: (spaceId: string, agentName: string) => Promise<unknown>
  } = {},
): Promise<boolean> {
  if (!edge.edgeConfigured()) return false
  const askStatus = ops.status ?? ((space: string, agent: string) => edge.status(environment(), space, agent))
  const askStop = ops.stop ?? ((space: string, agent: string) => edge.stop(environment(), space, agent))
  const vm = await prisma.agentVm.findUnique({
    where: { vm_identity: { spaceId, agentName } },
    select: { id: true, state: true },
  })
  if (!vm || vm.state !== 'running') return false

  try {
    const state = await askStatus(spaceId, agentName)
    if (!state.running) {
      await markAsleep([vm.id])
      return false
    }
    if (state.watching > 0 || state.takeover) return false
    await askStop(spaceId, agentName)
    await markAsleep([vm.id])
    return true
  } catch (err) {
    logger.warn('vm.release.failed', { spaceId, agent: agentName, err })
    return false
  }
}
