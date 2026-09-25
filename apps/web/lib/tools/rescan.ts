/**
 * Rescans: when the static rules change (a new `ANALYZER_VERSION`) or the
 * advisory feed learns something about a curated dependency, every listed
 * version is read again by the stages it was published with, and what is NEW
 * — a high or medium finding its last report did not have — opens an incident
 * for a reviewer (lib/tools/monitor.ts). A rescan never lists, unlists or
 * suspends by itself: rules change under code that was fine yesterday, and
 * that is a person's call. The nightly pass runs it; a reviewer can too.
 */
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { ANALYZER_VERSION, runStaticChecks } from './checks/analyze'
import { recordReport, versionReports } from './checks/runs'
import type { CheckFinding } from './checks/findings'
import { manifestOf } from './config'
import { decodeToolConfig } from './registry'
import { advisoriesFor } from './advisories'
import { raiseIncident } from './monitor'

function findingKey(f: CheckFinding): string {
  return `${f.rule}|${f.file ?? ''}|${f.line ?? ''}|${f.message}`
}

function modulesOf(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'))
}

/**
 * Read every listed version again whose last report is older than the rules,
 * or that declares a package the feed just learned about (`packages`), or all
 * of them (`force`). Returns how many it read and how many incidents it opened.
 */
export async function rescanListed(opts: { force?: boolean; packages?: readonly string[] } = {}): Promise<{ versions: number; incidents: number }> {
  const listed = await prisma.appToolVersion.findMany({
    where: { status: 'approved', marketplaceStatus: 'approved', revokedAt: null, listing: { state: { not: 'revoked' } } },
    select: {
      id: true,
      key: true,
      name: true,
      version: true,
      sourceSpaceId: true,
      listingId: true,
      config: true,
      indexSource: true,
      uiSource: true,
      dataSource: true,
      modules: true,
    },
    take: 500,
  })
  const reports = await versionReports(listed.map((v) => v.id))
  const touched = new Set(opts.packages ?? [])
  let versions = 0
  let incidents = 0
  for (const version of listed) {
    const config = decodeToolConfig(version.config, version.name)
    const deps = Object.keys(manifestOf(config).dependencies)
    const before = reports.get(version.id)
    const stale = !before || before.report.security.analyzer !== ANALYZER_VERSION
    const advised = deps.some((pkg) => touched.has(pkg))
    if (!opts.force && !stale && !advised) continue
    try {
      const report = await runStaticChecks({
        index: version.indexSource,
        ui: version.uiSource,
        data: version.dataSource || null,
        modules: modulesOf(version.modules),
        config,
        build: { ok: true, errors: [], warnings: [], configError: null },
        advisories: await advisoriesFor(deps),
      })
      const space = await prisma.space.findUnique({ where: { id: version.sourceSpaceId }, select: { id: true } })
      await recordReport({
        spaceId: space?.id ?? null,
        name: version.name,
        versionId: version.id,
        sourceHash: before?.sourceHash ?? `v${version.version}`,
        trigger: 'rescan',
        report,
      })
      versions++
      const seen = new Set(before ? [...before.report.compatibility.findings, ...before.report.security.findings].map(findingKey) : [])
      const fresh = [...report.compatibility.findings, ...report.security.findings].filter(
        (f) => (f.severity === 'high' || f.severity === 'medium') && !seen.has(findingKey(f)),
      )
      if (fresh.length === 0) continue
      await raiseIncident({
        kind: 'rescan',
        severity: fresh.some((f) => f.severity === 'high') ? 'severe' : 'flag',
        source: 'rescan',
        key: version.key,
        listingId: version.listingId,
        versionId: version.id,
        spaceId: version.sourceSpaceId,
        detail: { analyzer: ANALYZER_VERSION, findings: fresh.slice(0, 20) },
      })
      incidents++
    } catch (err) {
      logger.warn('tools.rescan.failed', { err, versionId: version.id })
    }
  }
  return { versions, incidents }
}
