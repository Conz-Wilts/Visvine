/**
 * Metering machines, and refusing when a space has had its share.
 *
 * The I/O half of `shared/limits.ts`. Two jobs:
 *
 *   • **Meter.** The tick adds its own interval to every space with a machine
 *     awake. The platform's timer is what bills, so the platform's timer is
 *     what counts — no sampling of container APIs, no trust in a process to
 *     report its own uptime.
 *   • **Refuse.** A lease is checked before it is taken, so a space over its
 *     cap spends nothing more rather than discovering it afterwards.
 *
 * The cap is per space and per month because that is the unit an admin can plan
 * against, and it is soft by one tick: a machine already awake finishes its
 * minute. The alternative is killing work mid-write, which trades a predictable
 * small overrun for an unpredictable large mess.
 */
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { checkQuota, DEFAULT_MONTHLY_HOURS, usdFor, type QuotaVerdict } from '@/lib/vm/shared/limits'

/** The UTC month an instant falls in. Usage is keyed on this. */
export function monthOf(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))
}

/**
 * A space's cap, in hours a month.
 *
 * One number, read from the space's feature config so an admin can change it
 * without a deploy, defaulting to something a runaway cannot quietly exceed.
 * `null` there means uncapped, and an admin has to write it — the absence of a
 * setting is the default, never "no limit".
 */
export async function quotaFor(spaceId: string): Promise<{ monthlyHours: number | null }> {
  const space = await prisma.space.findUnique({ where: { id: spaceId }, select: { featureConfig: true } })
  const config = (space?.featureConfig ?? {}) as Record<string, unknown>
  const raw = (config.vmMonthlyHours ?? undefined) as unknown
  if (raw === null) return { monthlyHours: null }
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return { monthlyHours: raw }
  return { monthlyHours: DEFAULT_MONTHLY_HOURS }
}

export async function usageFor(spaceId: string, at = new Date()): Promise<{ seconds: number; execs: number }> {
  const row = await prisma.agentVmUsage.findUnique({
    where: { usage_identity: { spaceId, month: monthOf(at) } },
    select: { seconds: true, execs: true },
  })
  return { seconds: row?.seconds ?? 0, execs: row?.execs ?? 0 }
}

/** May this space start machine work now? Checked before a lease is taken. */
export async function allowedToRun(spaceId: string, at = new Date()): Promise<QuotaVerdict> {
  const [quota, usage] = await Promise.all([quotaFor(spaceId), usageFor(spaceId, at)])
  return checkQuota(quota, usage)
}

/** Count a command against the space, for a bill that says what the seconds bought. */
export async function recordExec(spaceId: string, at = new Date()): Promise<void> {
  const month = monthOf(at)
  await prisma.agentVmUsage.upsert({
    where: { usage_identity: { spaceId, month } },
    create: { spaceId, month, seconds: 0, execs: 1 },
    update: { execs: { increment: 1 } },
  })
}

/**
 * The tick's meter: add `intervalSeconds` for every space with a machine awake.
 *
 * Counting per space rather than per machine is deliberate — two machines awake
 * in one space cost twice, and the row that has to say so is the space's.
 */
export async function meterAwakeMachines(intervalSeconds: number, at = new Date()): Promise<number> {
  const awake = await prisma.agentVm.groupBy({
    by: ['spaceId'],
    where: { state: 'running' },
    _count: { _all: true },
  })
  if (awake.length === 0) return 0

  const month = monthOf(at)
  for (const row of awake) {
    const seconds = intervalSeconds * row._count._all
    await prisma.agentVmUsage.upsert({
      where: { usage_identity: { spaceId: row.spaceId, month } },
      create: { spaceId: row.spaceId, month, seconds, execs: 0 },
      update: { seconds: { increment: seconds } },
    })
  }
  return awake.length
}

/**
 * Stop the machines of any space that has gone past its cap.
 *
 * The lease check refuses new work; this is what deals with work already
 * running, because a machine left awake keeps costing whether or not anything
 * new starts. Says so out loud: this is the system working as designed, so it
 * is a warn, and the space's admins see it on the agent's timeline.
 */
export async function stopOverspendingSpaces(
  stop: (spaceId: string, agentName: string) => Promise<unknown>,
  at = new Date(),
): Promise<number> {
  const running = await prisma.agentVm.findMany({
    where: { state: 'running' },
    select: { id: true, spaceId: true, agentName: true },
    take: 50,
  })
  const checked = new Map<string, QuotaVerdict>()
  let stopped = 0

  for (const vm of running) {
    let verdict = checked.get(vm.spaceId)
    if (!verdict) {
      verdict = await allowedToRun(vm.spaceId, at)
      checked.set(vm.spaceId, verdict)
    }
    if (verdict.allowed) continue

    const usage = await usageFor(vm.spaceId, at)
    logger.warn('vm.quota.stopping', {
      spaceId: vm.spaceId,
      agent: vm.agentName,
      hours: (usage.seconds / 3_600).toFixed(1),
      usd: usdFor(usage.seconds).toFixed(2),
    })
    try {
      await stop(vm.spaceId, vm.agentName)
    } catch (err) {
      // The machine not stopping is worth knowing about, but the row must still
      // move: a lease we cannot stop is one we should stop trying to lease.
      logger.warn('vm.quota.stop_failed', { vmId: vm.id, err })
    }
    await prisma.agentVm.update({ where: { id: vm.id }, data: { state: 'asleep' } })
    stopped += 1
  }
  return stopped
}
