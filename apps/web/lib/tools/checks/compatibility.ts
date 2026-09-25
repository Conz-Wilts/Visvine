/**
 * The compatibility stage: does this Tool fit the platform it is about to run
 * on? Pure — the build, the parsed config and (when a caller has them) the
 * space's facts in; findings out.
 *
 * Blocking here means "cannot run": an index note that does not parse, code
 * that does not compile, nothing to render. Everything else is advice an
 * author acts on before an admin reads it.
 */
import { manifestOf, type ToolConfig } from '../config'
import { perimeterIsEmpty } from '../perimeter'
import { TOOL_ACTIONS } from '../actionAllowlist'
import { dependencyDenial } from '@visvine/tool-protocol/dependencies'
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
  const facts = manifestOf(config)
  const p = facts.permissions
  const declaresMore =
    p.records.read.length + p.records.write.length + p.resources.read.length + p.actions.length > 0 ||
    p.ai.complete ||
    p.ai.decide ||
    p.ui.download
  if (perimeterIsEmpty(config.perimeter) && !declaresMore) {
    findings.push({ rule: 'compat.empty-perimeter', severity: 'info', message: 'Declares no reach — it can only draw its own UI', file: 'index.md' })
  }
  // A dependency is served by this server or not at all: one it does not
  // serve, or at a version it does not, cannot load in any frame.
  for (const [name, range] of Object.entries(facts.dependencies)) {
    const denial = dependencyDenial(name, range)
    if (denial) findings.push({ rule: 'compat.dependency', severity: 'high', message: denial, file: 'index.md' })
  }
  // Listed for other spaces, a Tool calls its connectors' named actions only.
  const unnamed = p.connectors.filter((use) => !use.actions?.length).map((use) => use.use)
  if (facts.manifestVersion === 2 && config.manifest && unnamed.length) {
    findings.push({
      rule: 'compat.connector-actions',
      severity: 'low',
      message: `Installed outside this space, a tool calls only the named actions it declares — name them for ${unnamed.join(', ')}`,
      file: 'index.md',
    })
  }
  // An action no tool may run is reach nobody can ever grant: say so before an admin is asked.
  for (const action of p.actions) {
    if (Object.hasOwn(TOOL_ACTIONS, action)) continue
    findings.push({
      rule: 'compat.action',
      severity: 'high',
      message: `permissions.actions names ${action}, which is not an action a tool may run (${Object.keys(TOOL_ACTIONS).join(', ')})`,
      file: 'index.md',
    })
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
