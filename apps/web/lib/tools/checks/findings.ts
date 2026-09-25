/**
 * The shape every check stage reports in, and how a stage's findings become
 * its verdict. Pure.
 *
 * A finding is one thing a check noticed, with where it was. Its severity is
 * what decides: `high` BLOCKS a publish — the version is never written — while
 * `medium` and `low` flag it for whoever approves, and `info` is only said.
 * Nothing here is re-run for a person: the report an admin or a Visvine
 * reviewer reads is the one the author already saw (`app_tool_check_runs`).
 */

/** The stages every publish runs. */
export const CHECK_STAGES = ['compatibility', 'security'] as const
/** The stages Visvine runs on a version offered for listing (lib/tools/review). */
export const GLOBAL_STAGES = ['ai', 'dynamic'] as const
type CheckStage = (typeof CHECK_STAGES)[number] | (typeof GLOBAL_STAGES)[number]

const FINDING_SEVERITIES = ['high', 'medium', 'low', 'info'] as const
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number]

export const STAGE_STATUSES = ['passed', 'flagged', 'blocked'] as const
export type StageStatus = (typeof STAGE_STATUSES)[number]

/** Why a check stage ran: a check asked for, a publish, a rules change re-reading a version, or a listing's review. */
export type CheckTrigger = 'check' | 'publish' | 'rescan' | 'review'

/** The files a finding can point into, by their author-facing names. */
export type CheckFile = 'index.md' | 'ui.tsx' | 'data.js' | `src/${string}`

export interface CheckFinding {
  /** Stable id of the rule, e.g. `escape.top-navigation` — what a reviewer searches by. */
  rule: string
  severity: FindingSeverity
  /** One line, naming the thing — never a paragraph. */
  message: string
  file?: CheckFile
  /** 1-based. */
  line?: number
  /** 0-based, as esbuild reports it. */
  column?: number
}

/** The permission risk score (security stage): 0–100 and what made it. */
export interface RiskScore {
  score: number
  level: 'low' | 'medium' | 'high'
  factors: string[]
}

export interface StageResult {
  stage: CheckStage
  status: StageStatus
  findings: CheckFinding[]
  /** Which rules ran — a rescan re-runs versions whose analyzer is older than the current one. */
  analyzer: string
  durationMs: number
  /** Security only. */
  risk?: RiskScore
}

/** Both stages, as publish and `check_tool` run them — and, once a version is offered for listing, the global two. */
export interface CheckReport {
  compatibility: StageResult
  security: StageResult
  ai?: StageResult
  dynamic?: StageResult
}

/** A report's stages that ran, in the order they read. */
export function reportStages(report: CheckReport): StageResult[] {
  return [report.compatibility, report.security, report.ai, report.dynamic].filter((stage): stage is StageResult => !!stage)
}

const RANK: Record<FindingSeverity, number> = { high: 0, medium: 1, low: 2, info: 3 }

/** Worst first, then by file and line, so a report reads top-down. */
export function sortFindings(findings: readonly CheckFinding[]): CheckFinding[] {
  return [...findings].sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      (a.file ?? '').localeCompare(b.file ?? '') ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.rule.localeCompare(b.rule),
  )
}

/** One finding per rule, file and line — a rule matching a line twice says it once. */
export function dedupeFindings(findings: readonly CheckFinding[]): CheckFinding[] {
  const seen = new Set<string>()
  const out: CheckFinding[] = []
  for (const f of findings) {
    const key = `${f.rule}|${f.file ?? ''}|${f.line ?? ''}|${f.message}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(f)
  }
  return out
}

/** Any high blocks; anything else short of info flags; otherwise it passed. */
export function stageStatus(findings: readonly CheckFinding[]): StageStatus {
  if (findings.some((f) => f.severity === 'high')) return 'blocked'
  if (findings.some((f) => f.severity !== 'info')) return 'flagged'
  return 'passed'
}

/** The worse of two statuses. */
function worstStatus(a: StageStatus, b: StageStatus): StageStatus {
  const order: StageStatus[] = ['blocked', 'flagged', 'passed']
  return order[Math.min(order.indexOf(a), order.indexOf(b))]
}

/** A report's overall verdict: the worst of its stages. */
export function reportStatus(report: CheckReport): StageStatus {
  return reportStages(report).reduce<StageStatus>((worst, stage) => worstStatus(worst, stage.status), 'passed')
}

/** The findings that stop a publish (or a listing), worst first. */
export function blockingFindings(report: CheckReport): CheckFinding[] {
  return sortFindings(reportStages(report).flatMap((stage) => stage.findings).filter((f) => f.severity === 'high'))
}

/** `ui.tsx:12 — message`, the one line a refusal or a list row shows. */
export function findingLine(f: CheckFinding): string {
  const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ''} — ` : ''
  return `${where}${f.message}`
}

/** Decode a stored findings column; anything unreadable is dropped rather than trusted. */
export function decodeFindings(raw: unknown): CheckFinding[] {
  if (!Array.isArray(raw)) return []
  const out: CheckFinding[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const f = entry as Record<string, unknown>
    if (typeof f.rule !== 'string' || typeof f.message !== 'string') continue
    if (!(FINDING_SEVERITIES as readonly string[]).includes(f.severity as string)) continue
    out.push({
      rule: f.rule,
      severity: f.severity as FindingSeverity,
      message: f.message,
      ...(f.file === 'index.md' || f.file === 'ui.tsx' || f.file === 'data.js' || (typeof f.file === 'string' && /^src\/[\w.-]+$/.test(f.file))
        ? { file: f.file as CheckFile }
        : {}),
      ...(typeof f.line === 'number' ? { line: f.line } : {}),
      ...(typeof f.column === 'number' ? { column: f.column } : {}),
    })
  }
  return out
}
