/**
 * The compatibility stage: does this Tool fit the platform it is about to run
 * on? Pure — the build, the parsed config and (when a caller has them) the
 * space's facts in; findings out.
 *
 * Blocking here means "cannot run": an index note that does not parse, code
 * that does not compile, nothing to render. Everything else is advice an
 * author acts on before an admin reads it.
 */
import type { ToolConfig } from '../config'
import { perimeterIsEmpty } from '../perimeter'
import type { CheckFile, CheckFinding } from './findings'

interface Diagnostic {
  file: string
  message: string
  line: number | null
}

export interface CompatibilityInput {
  build: {
    ok: boolean
    errors: readonly Diagnostic[]
    warnings: readonly Diagnostic[]
    configError: string | null
  }
  config: ToolConfig | null
  hasUi: boolean
  /** The installing space's own types and what it lacks; omitted where no space is being asked about. */
  facts?: { customTypes: readonly string[]; missing: readonly string[] }
}

function asFile(name: string): CheckFile | undefined {
  return name === 'index.md' || name === 'ui.tsx' || name === 'data.js' ? name : undefined
}

function fromDiagnostic(d: Diagnostic, rule: string, severity: CheckFinding['severity']): CheckFinding {
  const file = asFile(d.file)
  return {
    rule,
    severity,
    message: d.message,
    ...(file ? { file } : {}),
    ...(d.line !== null ? { line: d.line } : {}),
  }
}

export function compatibilityFindings(input: CompatibilityInput): CheckFinding[] {
  const findings: CheckFinding[] = []
  const { build, config } = input
  if (build.configError || !config) {
    findings.push({
      rule: 'compat.config',
      severity: 'high',
      message: build.configError ?? 'index.md does not parse as a tool',
      file: 'index.md',
    })
  }
  for (const error of build.errors) findings.push(fromDiagnostic(error, 'compat.compile', 'high'))
  if (!input.hasUi) findings.push({ rule: 'compat.no-ui', severity: 'high', message: 'No ui.tsx — a tool must render something', file: 'ui.tsx' })
  for (const warning of build.warnings) findings.push(fromDiagnostic(warning, 'compat.design', 'low'))
  if (!config) return findings

  if (!config.description.trim()) {
    findings.push({ rule: 'compat.description', severity: 'low', message: 'No description — it is what About and the install sheet show', file: 'index.md' })
  }
  if (perimeterIsEmpty(config.perimeter)) {
    findings.push({ rule: 'compat.empty-perimeter', severity: 'info', message: 'Declares no reach — it can only draw its own UI', file: 'index.md' })
  }
  // A write glob under agents/ grants nothing without the agents it may create.
  if (config.perimeter.agents.length === 0 && config.perimeter.write.some((glob) => glob.split('/')[0] === 'agents')) {
    findings.push({
      rule: 'compat.inert-agent-write',
      severity: 'low',
      message: 'Writes under agents/ but declares no agents, so the glob grants nothing',
      file: 'index.md',
    })
  }
  if (input.facts) {
    const custom = new Set(input.facts.customTypes)
    for (const claim of config.surfaces.types) {
      if (claim.mode !== 'page' || custom.has(claim.type)) continue
      findings.push({
        rule: 'compat.page-downgrade',
        severity: 'low',
        message: `Claims the page for "${claim.type}", which is not a type this space invented — it installs as a tab`,
        file: 'index.md',
      })
    }
    for (const line of input.facts.missing) {
      findings.push({ rule: 'compat.requirement', severity: 'info', message: line, file: 'index.md' })
    }
  }
  return findings
}
