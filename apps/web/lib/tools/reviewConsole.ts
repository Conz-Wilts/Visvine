/**
 * What Visvine's reviewers read and decide beyond the listing queue: the
 * incidents monitoring and members raised, and every listing with its state.
 * Super-admin only at the routes; the reads here assume that gate.
 */
import prisma from '@/lib/prisma'
import { isSuperAdmin } from '@/lib/session'
import { decodeToolConfig } from './registry'
import { decodeListingState, type ListingState } from './verdicts'
import { verifiedPublishers } from './publishers'
import type { RegistryError } from './registry'

export interface IncidentRow {
  id: string
  kind: string
  severity: string
  source: string
  status: string
  createdAt: string
  resolvedAt: string | null
  /** What it said, in a line — a report's note, an anomaly's message, a rule. */
  summary: string | null
  listing: { id: string; key: string; title: string; state: ListingState } | null
  versionId: string | null
  space: { id: string; name: string | null } | null
  /** Whether a person's browser raised it — who is never shown. */
  fromViewer: boolean
}

export interface ListingRow {
  id: string
  key: string
  title: string
  publisher: { spaceId: string; name: string | null; verified: boolean }
  state: ListingState
  stateReason: string | null
  stateAt: string | null
  listedAt: string | null
  stagedUntil: string | null
  installs: number
  openIncidents: number
  transferTo: string | null
}

function summaryOf(kind: string, detail: unknown): string | null {
  const d = detail && typeof detail === 'object' && !Array.isArray(detail) ? (detail as Record<string, unknown>) : {}
  if (typeof d.note === 'string' && d.note) return d.note
  if (typeof d.message === 'string' && d.message) return d.message
  if (kind === 'csp' && Array.isArray(d.violations)) {
    const first = d.violations[0] as { directive?: string; blocked?: string } | undefined
    return first ? `${first.directive ?? 'policy'} → ${first.blocked ?? 'somewhere'}` : null
  }
  if (Array.isArray(d.findings) && d.findings.length) {
    const first = d.findings[0] as { message?: string }
    return `${first.message ?? 'a new finding'}${d.findings.length > 1 ? ` (and ${d.findings.length - 1} more)` : ''}`
  }
  return null
}

async function titlesOf(listingIds: readonly string[]): Promise<Map<string, string>> {
  if (listingIds.length === 0) return new Map()
  const rows = await prisma.appToolVersion.findMany({
    where: { listingId: { in: [...listingIds] } },
    orderBy: { createdAt: 'desc' },
    select: { listingId: true, name: true, title: true, config: true },
  })
  const out = new Map<string, string>()
  for (const row of rows) {
    if (row.listingId && !out.has(row.listingId)) out.set(row.listingId, decodeToolConfig(row.config, row.name).title || row.title)
  }
  return out
}

export async function listIncidents(opts: { status?: 'open' | 'all' } = {}): Promise<IncidentRow[]> {
  const rows = await prisma.appToolIncident.findMany({
    where: opts.status === 'all' ? {} : { status: 'open' },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  const listingIds = [...new Set(rows.map((r) => r.listingId).filter((id): id is string => !!id))]
  const [listings, titles, spaces] = await Promise.all([
    prisma.appToolListing.findMany({ where: { id: { in: listingIds } }, select: { id: true, key: true, state: true } }),
    titlesOf(listingIds),
    prisma.space.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.spaceId).filter((id): id is string => !!id))] } },
      select: { id: true, name: true },
    }),
  ])
  return rows.map((row) => {
    const listing = listings.find((l) => l.id === row.listingId)
    return {
      id: row.id,
      kind: row.kind,
      severity: row.severity,
      source: row.source,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      summary: summaryOf(row.kind, row.detail),
      listing: listing
        ? { id: listing.id, key: listing.key, title: titles.get(listing.id) ?? listing.key, state: decodeListingState(listing.state) }
        : null,
      versionId: row.versionId,
      space: row.spaceId ? { id: row.spaceId, name: spaces.find((s) => s.id === row.spaceId)?.name ?? null } : null,
      fromViewer: !!row.viewerId,
    }
  })
}

/** A reviewer's word on an incident: nothing to it (`clear`), or it happened (`confirm`). */
export async function resolveIncident(
  id: string,
  reviewer: { userId: string; email: string },
  action: 'clear' | 'confirm',
): Promise<{ ok: true } | RegistryError> {
  if (!isSuperAdmin(reviewer.email)) return { ok: false, status: 403, error: 'Only Visvine reviewers resolve incidents.' }
  const row = await prisma.appToolIncident.findUnique({ where: { id }, select: { status: true } })
  if (!row) return { ok: false, status: 404, error: 'No such incident.' }
  if (row.status !== 'open') return { ok: false, status: 409, error: `This incident is already ${row.status}.` }
  await prisma.appToolIncident.update({
    where: { id },
    data: { status: action === 'clear' ? 'cleared' : 'confirmed', resolvedBy: reviewer.userId, resolvedAt: new Date() },
  })
  return { ok: true }
}

export async function listListings(): Promise<ListingRow[]> {
  const rows = await prisma.appToolListing.findMany({ orderBy: { updatedAt: 'desc' }, take: 500 })
  const ids = rows.map((r) => r.id)
  const publisherIds = rows.map((r) => r.publisherSpaceId)
  const [titles, installs, incidents, spaces, verified] = await Promise.all([
    titlesOf(ids),
    prisma.appToolInstall.groupBy({ by: ['listingId'], where: { listingId: { in: ids } }, _count: { _all: true } }),
    prisma.appToolIncident.groupBy({ by: ['listingId'], where: { listingId: { in: ids }, status: 'open' }, _count: { _all: true } }),
    prisma.space.findMany({ where: { id: { in: [...new Set(publisherIds)] } }, select: { id: true, name: true } }),
    verifiedPublishers(publisherIds),
  ])
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    title: titles.get(row.id) ?? row.key,
    publisher: {
      spaceId: row.publisherSpaceId,
      name: spaces.find((s) => s.id === row.publisherSpaceId)?.name ?? null,
      verified: verified.has(row.publisherSpaceId),
    },
    state: decodeListingState(row.state),
    stateReason: row.stateReason,
    stateAt: row.stateAt?.toISOString() ?? null,
    listedAt: row.listedAt?.toISOString() ?? null,
    stagedUntil: row.stagedUntil?.toISOString() ?? null,
    installs: installs.find((i) => i.listingId === row.id)?._count._all ?? 0,
    openIncidents: incidents.find((i) => i.listingId === row.id)?._count._all ?? 0,
    transferTo: row.transferTo,
  }))
}
