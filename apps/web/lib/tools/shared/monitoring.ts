/**
 * Watching listed Tools, as rules — pure (tests/tools-anomaly.test.ts).
 *
 *   anomalies     a day's counts against the version's own baseline: refusals
 *                 spiking (flag), reads far above what it usually reads
 *                 (flag), errors and timeouts spiking (quality)
 *   suspension    whether a listing's open incidents are enough to hold it
 *                 everywhere at once: a severe signal from two independent
 *                 viewers, or one from Visvine's own dynamic run — so a single
 *                 forged report cannot take a competitor's Tool down. CSP
 *                 violations count as severe once two viewers report them.
 *                 A member's report never holds a listing by itself; it goes
 *                 to a reviewer.
 */

/** One install-day's counts, as the rules read them. */
export interface DayCounts {
  calls: number
  refusals: number
  /** `internal` and `timeout` answers — the Tool or Visvine failing, not a gate. */
  errors: number
  bytesRead: number
}

export interface Anomaly {
  rule: 'refusals' | 'reads' | 'errors'
  severity: 'flag' | 'quality'
  message: string
}

/** A baseline is the mean of up to the last week's days; none is a first day. */
export function baselineOf(days: readonly DayCounts[]): DayCounts | null {
  if (days.length === 0) return null
  const sum = days.reduce(
    (acc, d) => ({ calls: acc.calls + d.calls, refusals: acc.refusals + d.refusals, errors: acc.errors + d.errors, bytesRead: acc.bytesRead + d.bytesRead }),
    { calls: 0, refusals: 0, errors: 0, bytesRead: 0 },
  )
  const n = days.length
  return { calls: sum.calls / n, refusals: sum.refusals / n, errors: sum.errors / n, bytesRead: sum.bytesRead / n }
}

function mb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(bytes >= 10_000_000 ? 0 : 1)} MB`
}

/** What is unusual about today, against the baseline. Quiet days say nothing. */
export function anomaliesFor(today: DayCounts, baseline: DayCounts | null): Anomaly[] {
  const out: Anomaly[] = []
  const usual = (value: number | undefined) => Math.round(value ?? 0)
  if (
    today.refusals >= 20 &&
    today.refusals > 0.3 * Math.max(1, today.calls) &&
    today.refusals > 5 * Math.max(baseline?.refusals ?? 0, 4)
  ) {
    out.push({ rule: 'refusals', severity: 'flag', message: `Refused ${today.refusals} times today (usually ${usual(baseline?.refusals)})` })
  }
  if (today.bytesRead > 5_000_000 && today.bytesRead > 10 * Math.max(baseline?.bytesRead ?? 0, 50_000)) {
    out.push({ rule: 'reads', severity: 'flag', message: `Read ${mb(today.bytesRead)} today (usually ${mb(baseline?.bytesRead ?? 0)})` })
  }
  if (today.errors >= 10 && today.errors > 0.2 * Math.max(1, today.calls) && today.errors > 5 * Math.max(baseline?.errors ?? 0, 2)) {
    out.push({ rule: 'errors', severity: 'quality', message: `Failed ${today.errors} of ${today.calls} calls today (usually ${usual(baseline?.errors)})` })
  }
  return out
}

/** An open incident, as the suspension rule reads it. */
export interface SignalIncident {
  kind: string
  severity: string
  source: string
  viewerId: string | null
  detail?: Record<string, unknown>
}

export type SuspensionDecision = { suspend: true; reason: string } | { suspend: false }

const KIND_WORDS: Record<string, string> = {
  navigation: 'tried to leave its frame',
  csp: 'broke its content policy',
  canary: 'moved planted data where it should not',
}

/** Whether a listing's open incidents hold it everywhere. */
export function suspensionDecision(incidents: readonly SignalIncident[]): SuspensionDecision {
  const dynamic = incidents.find((i) => i.source === 'dynamic' && i.severity === 'severe')
  if (dynamic) return { suspend: true, reason: `Visvine’s dynamic run caught it: it ${KIND_WORDS[dynamic.kind] ?? 'did something it declared no reach for'}` }

  // Viewer signals: a severe incident, or a CSP report, each counted by who saw it.
  const byKind = new Map<string, Set<string>>()
  for (const incident of incidents) {
    if (incident.source !== 'viewer' || !incident.viewerId) continue
    const counts = incident.severity === 'severe' || incident.kind === 'csp'
    if (!counts) continue
    const viewers = byKind.get(incident.kind) ?? new Set<string>()
    viewers.add(incident.viewerId)
    byKind.set(incident.kind, viewers)
  }
  const allViewers = new Set([...byKind.values()].flatMap((set) => [...set]))
  if (allViewers.size >= 2) {
    const [kind] = [...byKind.entries()].sort((a, b) => b[1].size - a[1].size)[0]
    return { suspend: true, reason: `It ${KIND_WORDS[kind] ?? 'misbehaved'} for ${allViewers.size} people` }
  }
  return { suspend: false }
}
