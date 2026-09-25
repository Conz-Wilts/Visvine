/**
 * Monitoring listed Tools, with teeth (docs/tools.md § Monitoring).
 *
 *   incidents     what a viewer's browser, Visvine's dynamic run, the rules
 *                 over telemetry or a rescan saw — written at once
 *                 (`raiseIncident`), each naming the listing it concerns
 *   suspension    after a severe signal the listing's open incidents are
 *                 weighed (./shared/monitoring.ts#suspensionDecision): two
 *                 independent viewers, or Visvine's own dynamic run, hold it
 *                 everywhere outside its publisher at once — every bridge call
 *                 answers `revoked`, and open frames are removed by their host
 *                 within a minute (lib/tools/verdicts.ts)
 *   anomalies     the minute tick reads today's counts against each install's
 *                 own last week (`sweepAnomalies`) and flags what is unusual,
 *                 once a day per rule
 *
 * A person clears or confirms an incident, and reinstates or removes a
 * listing, on the review console. The monitor only ever suspends.
 */
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { decodeListingState, holdListing } from './verdicts'
import { anomaliesFor, baselineOf, suspensionDecision } from './shared/monitoring'
import { dayCounts, recentDays } from './telemetry'

type IncidentKind = 'navigation' | 'csp' | 'report' | 'canary' | 'anomaly' | 'rescan'
type IncidentSeverity = 'severe' | 'flag' | 'quality' | 'report'
type IncidentSource = 'viewer' | 'dynamic' | 'monitor' | 'rescan'

export interface RaisedIncident {
  kind: IncidentKind
  severity: IncidentSeverity
  source?: IncidentSource
  key?: string | null
  listingId?: string | null
  versionId?: string | null
  installId?: string | null
  spaceId?: string | null
  viewerId?: string | null
  detail?: Record<string, unknown>
}

/** How far back open incidents count toward a suspension. */
const SIGNAL_WINDOW_MS = 7 * 86_400_000

/** The listing an incident concerns: named, found through its install or version, or by its key. */
async function listingOf(input: RaisedIncident): Promise<{ id: string; key: string; state: string } | null> {
  if (input.listingId) {
    return prisma.appToolListing.findUnique({ where: { id: input.listingId }, select: { id: true, key: true, state: true } })
  }
  if (input.installId) {
    const install = await prisma.appToolInstall.findUnique({ where: { id: input.installId }, select: { listingId: true, key: true } })
    if (install?.listingId) {
      return prisma.appToolListing.findUnique({ where: { id: install.listingId }, select: { id: true, key: true, state: true } })
    }
  }
  if (input.versionId) {
    const version = await prisma.appToolVersion.findUnique({ where: { id: input.versionId }, select: { listingId: true } })
    if (version?.listingId) {
      return prisma.appToolListing.findUnique({ where: { id: version.listingId }, select: { id: true, key: true, state: true } })
    }
  }
  if (input.key) return prisma.appToolListing.findUnique({ where: { key: input.key }, select: { id: true, key: true, state: true } })
  return null
}

/**
 * Record an incident, and — when it could tip the balance — weigh the
 * listing's open incidents and suspend it. Never throws: a monitoring failure
 * must not fail the request that reported it.
 */
export async function raiseIncident(input: RaisedIncident): Promise<{ suspended: boolean }> {
  try {
    const listing = await listingOf(input)
    await prisma.appToolIncident.create({
      data: {
        kind: input.kind,
        severity: input.severity,
        source: input.source ?? 'viewer',
        key: input.key ?? listing?.key ?? null,
        listingId: listing?.id ?? null,
        versionId: input.versionId ?? null,
        installId: input.installId ?? null,
        spaceId: input.spaceId ?? null,
        viewerId: input.viewerId ?? null,
        detail: (input.detail ?? {}) as object,
      },
    })
    const weighs = input.severity === 'severe' || input.kind === 'csp'
    if (!listing || !weighs || decodeListingState(listing.state) !== 'active') return { suspended: false }
    const open = await prisma.appToolIncident.findMany({
      where: { listingId: listing.id, status: 'open', createdAt: { gte: new Date(Date.now() - SIGNAL_WINDOW_MS) } },
      select: { kind: true, severity: true, source: true, viewerId: true },
    })
    const decision = suspensionDecision(open)
    if (!decision.suspend) return { suspended: false }
    const held = await holdListing({ listingId: listing.id }, 'suspended', 'monitor', decision.reason)
    if (held.ok) logger.warn('tools.monitor.suspended', { listingId: listing.id, key: listing.key, reason: decision.reason })
    return { suspended: held.ok }
  } catch (err) {
    logger.error('tools.monitor.incident_failed', { err, kind: input.kind })
    return { suspended: false }
  }
}

/**
 * The rules over telemetry, for every install that ran today. One incident per
 * install, rule and day — a spike is said once, not every minute it lasts.
 */
export async function sweepAnomalies(now: Date = new Date()): Promise<number> {
  const day = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`)
  const active = await prisma.appToolTelemetry.findMany({ where: { day }, select: { installId: true }, distinct: ['installId'], take: 500 })
  if (active.length === 0) return 0
  const today = await dayCounts(active.map((row) => row.installId), now)
  let raised = 0
  for (const [installId, counts] of today) {
    const found = anomaliesFor(counts, baselineOf(await recentDays(installId, now)))
    if (found.length === 0) continue
    const install = await prisma.appToolInstall.findUnique({ where: { id: installId }, select: { spaceId: true, versionId: true, key: true, listingId: true } })
    if (!install) continue
    const already = await prisma.appToolIncident.findMany({
      where: { installId, kind: 'anomaly', createdAt: { gte: day } },
      select: { detail: true },
    })
    const said = new Set(already.map((row) => (row.detail as { rule?: string } | null)?.rule))
    for (const anomaly of found) {
      if (said.has(anomaly.rule)) continue
      await raiseIncident({
        kind: 'anomaly',
        severity: anomaly.severity,
        source: 'monitor',
        key: install.key,
        listingId: install.listingId,
        versionId: install.versionId,
        installId,
        spaceId: install.spaceId,
        detail: { rule: anomaly.rule, message: anomaly.message },
      })
      raised++
    }
  }
  return raised
}
