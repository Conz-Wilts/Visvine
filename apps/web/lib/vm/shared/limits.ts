/**
 * What a space may spend on machines, and what an unusual egress log looks like.
 *
 * Pure, because both questions have to be answerable the same way in a test, in
 * the tick, and in a refusal a person reads. Nothing here does I/O; the halves
 * that need rows are in `lib/vm/quota.ts` and `lib/vm/anomaly.ts`.
 *
 * The costing that shapes these numbers is docs/machines.md § Cost and quota: an
 * awake machine is roughly $0.10 an hour, so a monthly cap is really an answer
 * to "how much is this space allowed to spend before someone looks at it".
 */

/** USD per awake hour of the default shape, for turning seconds into money a person recognises. */
const USD_PER_AWAKE_HOUR = 0.1

/**
 * Hours of machine a space gets in a month before new work is refused.
 *
 * `null` — uncapped — is the product decision, not an oversight: machine time
 * is a small fraction of what a space pays, so a member who needs a machine at
 * 3am gets one, and nobody meets a ceiling they were never told about. A space
 * that needs a limit is given one explicitly as `vmMonthlyHours`.
 *
 * That removes the refusal but NOT the accounting: every awake minute is still
 * metered, and `SPEND_ALERT_HOURS` is what a runaway trips instead of a cap.
 */
export const DEFAULT_MONTHLY_HOURS: number | null = null

/**
 * Hours in a month that mean somebody should look, uncapped or not.
 *
 * With no ceiling to refuse at, this is the whole early warning: a space past
 * it is doing something no ordinary use of agents produces — a loop, a machine
 * that will not sleep, a schedule firing far more often than it reads. It warns
 * and never refuses, because the cost of stopping real work at 3am is higher
 * than the cost of the hours, and the alert reaches a person either way.
 */
export const SPEND_ALERT_HOURS = 300

export interface Quota {
  /** Hours a month. Null = uncapped, which is a decision an admin makes explicitly. */
  monthlyHours: number | null
}

export interface Usage {
  seconds: number
  execs: number
}

export type QuotaVerdict =
  | { allowed: true; remainingSeconds: number | null }
  | { allowed: false; reason: string }

/** Hours a space has burned this month, for a log line a person reads. */
export function hoursOf(seconds: number): number {
  return seconds / 3_600
}

/** Has this space passed the point where somebody should look? Never a refusal. */
export function overSpendAlert(seconds: number): boolean {
  return hoursOf(seconds) >= SPEND_ALERT_HOURS
}

/** Cost of some awake seconds, in USD. The bill people see is this, not seconds. */
export function usdFor(seconds: number): number {
  return (seconds / 3_600) * USD_PER_AWAKE_HOUR
}

/**
 * May this space start more machine work?
 *
 * Checked before a lease, so the refusal happens before anything is spent
 * rather than after. It is a soft ceiling by one tick — a machine already awake
 * finishes its minute — which is the same softness the agent budget accepts,
 * and for the same reason: the alternative is killing work mid-write.
 */
export function checkQuota(quota: Quota, usage: Usage): QuotaVerdict {
  if (quota.monthlyHours === null) return { allowed: true, remainingSeconds: null }
  const cap = Math.max(0, Math.round(quota.monthlyHours * 3_600))
  const remaining = cap - usage.seconds
  if (remaining > 0) return { allowed: true, remainingSeconds: remaining }
  return {
    allowed: false,
    reason:
      `This space has used its ${quota.monthlyHours} hours of machine time this month ` +
      `(about $${usdFor(usage.seconds).toFixed(2)}). An admin can raise the cap, or it resets next month.`,
  }
}

/** One line of the egress log, as the detectors read it. */
export interface EgressSample {
  host: string
  verdict: 'allow' | 'deny' | 'approval'
  bytes: number | null
  at: Date
}

type AnomalyKind = 'repeated_denials' | 'bulk_egress' | 'destination_spread'

export interface Anomaly {
  kind: AnomalyKind
  detail: string
  /** Hosts worth naming in the alert. Never more than a handful. */
  hosts: string[]
}

/** Denials this many times over the window is somebody trying doors, not a typo. */
export const DENIAL_ALERT_THRESHOLD = 20
/** Bytes to a single host in the window that look like a copy rather than a call. */
export const BULK_BYTES_THRESHOLD = 50_000_000
/** Distinct hosts one machine touches before the pattern itself is the signal. */
export const SPREAD_THRESHOLD = 40

/**
 * What an egress log says when something is wrong.
 *
 * Three shapes, and none of them is proof: a compromised agent and a badly
 * written skill look identical from here. The point is to put a human in front
 * of the log, which is why these are `warn`-level signals about the system
 * working — a denial is the policy doing its job — and never `error`, which is
 * reserved for a fault and is what pages someone.
 */
export function detectAnomalies(samples: readonly EgressSample[]): Anomaly[] {
  const found: Anomaly[] = []
  if (samples.length === 0) return found

  const denied = samples.filter((s) => s.verdict !== 'allow')
  if (denied.length >= DENIAL_ALERT_THRESHOLD) {
    const hosts = [...new Set(denied.map((s) => s.host))]
    found.push({
      kind: 'repeated_denials',
      detail: `${denied.length} refusals across ${hosts.length} host(s)`,
      hosts: hosts.slice(0, 5),
    })
  }

  const bytesByHost = new Map<string, number>()
  for (const sample of samples) {
    if (sample.verdict !== 'allow' || !sample.bytes) continue
    bytesByHost.set(sample.host, (bytesByHost.get(sample.host) ?? 0) + sample.bytes)
  }
  const bulk = [...bytesByHost.entries()].filter(([, bytes]) => bytes >= BULK_BYTES_THRESHOLD)
  if (bulk.length > 0) {
    found.push({
      kind: 'bulk_egress',
      detail: bulk.map(([host, bytes]) => `${host}: ${(bytes / 1_000_000).toFixed(0)} MB`).join(', '),
      hosts: bulk.map(([host]) => host).slice(0, 5),
    })
  }

  const distinct = new Set(samples.filter((s) => s.verdict === 'allow').map((s) => s.host))
  if (distinct.size >= SPREAD_THRESHOLD) {
    found.push({
      kind: 'destination_spread',
      detail: `${distinct.size} distinct hosts reached`,
      hosts: [...distinct].slice(0, 5),
    })
  }

  return found
}
