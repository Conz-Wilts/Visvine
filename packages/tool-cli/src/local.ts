/**
 * A project built and checked on the author's own machine — with the server's
 * own code: the build a working copy gets (`buildFromSources`) and the static
 * stages a publish runs (`runStaticChecks`), bundled into this CLI from the
 * same source. What passes here passes there; what the server alone knows
 * (the space's advisories, its connectors and types) it says on push.
 */
import { buildFromSources, toolDiagnosticLine, type BuiltTool } from '@/lib/tools/buildSources'
import { packageNotes, type PackageRead } from '@/lib/tools/package/shared/layout'
import { runStaticChecks } from '@/lib/tools/checks/analyze'
import { blockingFindings, findingLine, reportStatus, sortFindings, type CheckReport } from '@/lib/tools/checks/findings'

export async function buildProject(pkg: PackageRead): Promise<BuiltTool> {
  const notes = packageNotes(pkg)
  return buildFromSources(pkg.name, { ...notes, folder: `tools/${pkg.name}` })
}

export async function checkProject(pkg: PackageRead, build: BuiltTool): Promise<CheckReport> {
  return runStaticChecks({
    index: packageNotes(pkg).index,
    ui: pkg.ui,
    data: pkg.data,
    modules: pkg.modules,
    config: build.config ?? pkg.config,
    build: { ok: build.ok, errors: build.errors, warnings: build.warnings, configError: build.configError },
    advisories: [],
  })
}

/** A build and a report as the lines a terminal shows — errors first. */
export function describeCheck(build: BuiltTool, report: CheckReport | null): { ok: boolean; errors: string[]; warnings: string[]; flags: string[] } {
  const errors = [...(build.configError ? [`visvine-tool.json ${build.configError}`] : []), ...build.errors.map(toolDiagnosticLine)]
  const warnings = build.warnings.map(toolDiagnosticLine)
  if (!report) return { ok: false, errors, warnings, flags: [] }
  const blocking = blockingFindings(report).map(findingLine)
  const flags = sortFindings([...report.compatibility.findings, ...report.security.findings])
    .filter((f) => f.severity === 'medium' || f.severity === 'low')
    .map((f) => `${f.severity}: ${findingLine(f)}`)
  return { ok: build.ok && reportStatus(report) !== 'blocked', errors: [...errors, ...blocking], warnings, flags }
}
