/**
 * Known advisories against the curated dependencies at the versions Visvine
 * vendors (`app_tool_advisories`), read from OSV (https://osv.dev) by the
 * nightly pass. A package is only ever at the version the server pins
 * (@visvine/tool-protocol/dependencies), so one query per package covers every
 * Tool that declares it.
 *
 * The security stage reads what is stored for a Tool's declared dependencies
 * (checks/analyze.ts) and flags it — never blocks: the fix is the
 * deployment's, bumping the vendored version, not the author's. A new
 * advisory makes every listed version that declares the package a rescan's
 * business (lib/tools/rescan.ts).
 */
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { CURATED_DEPENDENCIES } from '@visvine/tool-protocol/dependencies'

export interface Advisory {
  package: string
  version: string
  advisoryId: string
  summary: string
  severity: 'low' | 'medium' | 'high'
  url: string | null
}

/** What an advisory feed answers for one package at one version. */
export type AdvisoryFetcher = (pkg: string, version: string) => Promise<Array<Omit<Advisory, 'package' | 'version'>>>

const OSV_QUERY = 'https://api.osv.dev/v1/query'

/** An OSV severity word → ours. GitHub's MODERATE is our medium; CRITICAL our high. */
function severityOf(raw: unknown): Advisory['severity'] {
  const word = typeof raw === 'string' ? raw.toUpperCase() : ''
  if (word === 'HIGH' || word === 'CRITICAL') return 'high'
  if (word === 'MODERATE' || word === 'MEDIUM') return 'medium'
  return 'low'
}

/** OSV's query endpoint, bounded and failing open to "nothing known". */
const osvFetcher: AdvisoryFetcher = async (pkg, version) => {
  const res = await fetch(OSV_QUERY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ package: { name: pkg, ecosystem: 'npm' }, version }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`OSV answered ${res.status}`)
  const body = (await res.json()) as { vulns?: Array<Record<string, unknown>> }
  return (body.vulns ?? []).map((v) => ({
    advisoryId: String(v.id ?? ''),
    summary: String(v.summary ?? v.details ?? v.id ?? '').slice(0, 300),
    severity: severityOf((v.database_specific as { severity?: unknown } | undefined)?.severity),
    url: typeof v.id === 'string' ? `https://osv.dev/vulnerability/${v.id}` : null,
  })).filter((a) => a.advisoryId)
}

/**
 * Ask the feed about every curated dependency and keep what it says. Returns
 * the packages that gained an advisory, which a rescan then reads again.
 */
export async function refreshAdvisories(fetcher: AdvisoryFetcher = osvFetcher): Promise<{ checked: number; changed: string[] }> {
  const changed: string[] = []
  let checked = 0
  for (const [pkg, spec] of Object.entries(CURATED_DEPENDENCIES)) {
    let found: Awaited<ReturnType<AdvisoryFetcher>>
    try {
      found = await fetcher(pkg, spec.version)
    } catch (err) {
      logger.warn('tools.advisories.fetch_failed', { err, pkg })
      continue
    }
    checked++
    const known = new Set(
      (await prisma.appToolAdvisory.findMany({ where: { package: pkg, version: spec.version }, select: { advisoryId: true } })).map((row) => row.advisoryId),
    )
    let gained = false
    for (const advisory of found) {
      if (!known.has(advisory.advisoryId)) gained = true
      await prisma.appToolAdvisory.upsert({
        where: { app_tool_advisory_identity: { package: pkg, version: spec.version, advisoryId: advisory.advisoryId } },
        create: { package: pkg, version: spec.version, ...advisory },
        update: { summary: advisory.summary, severity: advisory.severity, url: advisory.url, fetchedAt: new Date() },
      })
    }
    if (gained) changed.push(pkg)
  }
  return { checked, changed }
}

/** What is known against these packages at the versions Visvine vendors. */
export async function advisoriesFor(packages: readonly string[]): Promise<Advisory[]> {
  const pinned = packages.filter((pkg) => Object.hasOwn(CURATED_DEPENDENCIES, pkg))
  if (pinned.length === 0) return []
  const rows = await prisma.appToolAdvisory.findMany({
    where: {
      OR: pinned.map((pkg) => ({ package: pkg, version: CURATED_DEPENDENCIES[pkg as keyof typeof CURATED_DEPENDENCIES].version })),
    },
  })
  return rows.map((row) => ({
    package: row.package,
    version: row.version,
    advisoryId: row.advisoryId,
    summary: row.summary,
    severity: row.severity === 'high' ? 'high' : row.severity === 'medium' ? 'medium' : 'low',
    url: row.url,
  }))
}
