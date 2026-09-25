/**
 * `app_tool_check_runs`: where a check report is kept, and the reads every
 * surface shares — the author's Tool tab, the Approvals queue, Visvine's
 * review. A report is written once, when it ran, and read as written.
 */
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import {
  CHECK_STAGES,
  decodeFindings,
  GLOBAL_STAGES,
  STAGE_STATUSES,
  type CheckReport,
  type CheckTrigger,
  type RiskScore,
  type StageResult,
} from './findings'

/** Working-copy runs kept per Tool; a version's runs are kept with the version. */
const KEEP_WORKING_RUNS = 6

export interface StoredReport {
  report: CheckReport
  sourceHash: string
  ranAt: string
  trigger: CheckTrigger
}

export async function recordReport(input: {
  /** Null for a version whose space is gone — its rows stay with the version. */
  spaceId: string | null
  name: string
  versionId: string | null
  sourceHash: string
  trigger: CheckTrigger
  report: CheckReport
}): Promise<void> {
  const rows = [input.report.compatibility, input.report.security].map((result) => ({
    spaceId: input.spaceId,
    name: input.name,
    versionId: input.versionId,
    sourceHash: input.sourceHash,
    stage: result.stage,
    status: result.status,
    trigger: input.trigger,
    findings: result.findings as unknown as Prisma.InputJsonValue,
    ...(result.risk ? { risk: result.risk as unknown as Prisma.InputJsonValue } : {}),
    analyzer: result.analyzer,
    durationMs: result.durationMs,
  }))
  await prisma.appToolCheckRun.createMany({ data: rows })
  if (input.versionId === null && input.spaceId) {
    const stale = await prisma.appToolCheckRun.findMany({
      where: { spaceId: input.spaceId, name: input.name, versionId: null },
      orderBy: { createdAt: 'desc' },
      skip: KEEP_WORKING_RUNS * CHECK_STAGES.length,
      select: { id: true },
    })
    if (stale.length > 0) await prisma.appToolCheckRun.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } })
  }
}

/**
 * One of Visvine's global stages (`ai`, `dynamic`) over a version offered for
 * listing. Read beside the version's own report; a later run replaces it.
 */
export async function recordGlobalStage(input: {
  spaceId: string | null
  name: string
  versionId: string
  sourceHash: string
  result: StageResult
}): Promise<void> {
  await prisma.appToolCheckRun.create({
    data: {
      spaceId: input.spaceId,
      name: input.name,
      versionId: input.versionId,
      sourceHash: input.sourceHash,
      stage: input.result.stage,
      status: input.result.status,
      trigger: 'review',
      findings: input.result.findings as unknown as Prisma.InputJsonValue,
      analyzer: input.result.analyzer,
      durationMs: input.result.durationMs,
    },
  })
}

type Row = {
  stage: string
  status: string
  trigger: string
  findings: Prisma.JsonValue
  risk: Prisma.JsonValue | null
  analyzer: string
  durationMs: number
  sourceHash: string
  createdAt: Date
}

const ROW_SELECT = {
  stage: true,
  status: true,
  trigger: true,
  findings: true,
  risk: true,
  analyzer: true,
  durationMs: true,
  sourceHash: true,
  createdAt: true,
} as const

function decodeRisk(raw: Prisma.JsonValue | null): RiskScore | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.score !== 'number' || !['low', 'medium', 'high'].includes(r.level as string)) return undefined
  return {
    score: r.score,
    level: r.level as RiskScore['level'],
    factors: Array.isArray(r.factors) ? r.factors.filter((f): f is string => typeof f === 'string') : [],
  }
}

function toStage(row: Row): StageResult | null {
  if (![...CHECK_STAGES, ...GLOBAL_STAGES].includes(row.stage as StageResult['stage'])) return null
  if (!(STAGE_STATUSES as readonly string[]).includes(row.status)) return null
  const risk = decodeRisk(row.risk)
  return {
    stage: row.stage as StageResult['stage'],
    status: row.status as StageResult['status'],
    findings: decodeFindings(row.findings),
    analyzer: row.analyzer,
    durationMs: row.durationMs,
    ...(risk ? { risk } : {}),
  }
}

/** The newest pair among rows sorted newest first, or null when a stage is missing. */
function newestReport(rows: readonly Row[]): StoredReport | null {
  const compatRow = rows.find((row) => row.stage === 'compatibility')
  const securityRow = rows.find((row) => row.stage === 'security')
  if (!compatRow || !securityRow) return null
  const compatibility = toStage(compatRow)
  const security = toStage(securityRow)
  if (!compatibility || !security) return null
  const newest = compatRow.createdAt > securityRow.createdAt ? compatRow : securityRow
  // A version offered for listing carries Visvine's two stages beside its own.
  const global: Partial<Pick<CheckReport, 'ai' | 'dynamic'>> = {}
  for (const stage of GLOBAL_STAGES) {
    const row = rows.find((candidate) => candidate.stage === stage)
    const result = row ? toStage(row) : null
    if (result) global[stage] = result
  }
  return {
    report: { compatibility, security, ...global },
    sourceHash: newest.sourceHash,
    ranAt: newest.createdAt.toISOString(),
    trigger: newest.trigger as CheckTrigger,
  }
}

/** The last report on a Tool's working copy in its space. */
export async function latestWorkingReport(spaceId: string, name: string): Promise<StoredReport | null> {
  const rows = await prisma.appToolCheckRun.findMany({
    where: { spaceId, name, versionId: null },
    orderBy: { createdAt: 'desc' },
    take: CHECK_STAGES.length * 2,
    select: ROW_SELECT,
  })
  return newestReport(rows)
}

/** The report a version was published with (or its latest rescan). */
export async function versionReports(versionIds: readonly string[]): Promise<Map<string, StoredReport>> {
  const out = new Map<string, StoredReport>()
  if (versionIds.length === 0) return out
  const rows = await prisma.appToolCheckRun.findMany({
    where: { versionId: { in: [...versionIds] } },
    orderBy: { createdAt: 'desc' },
    select: { ...ROW_SELECT, versionId: true },
  })
  const byVersion = new Map<string, Row[]>()
  for (const row of rows) {
    if (!row.versionId) continue
    const list = byVersion.get(row.versionId) ?? []
    list.push(row)
    byVersion.set(row.versionId, list)
  }
  for (const [id, list] of byVersion) {
    const report = newestReport(list)
    if (report) out.set(id, report)
  }
  return out
}

/** Working-copy reports whose space was deleted; a version's reports are kept with the version. */
export async function pruneOrphanWorkingReports(): Promise<number> {
  const removed = await prisma.appToolCheckRun.deleteMany({ where: { spaceId: null, versionId: null } })
  return removed.count
}
