/**
 * The static stages — compatibility and security — over one Tool's sources.
 * Runs inside a publish request, so it takes well under a second: one esbuild
 * transform of `ui.tsx`, two acorn parses, and rules that are all pure
 * (`./codeRules`, `./textRules`, `./usage`, `./compatibility`).
 *
 * `ui.tsx` is read as esbuild leaves it — types gone, JSX as calls — with the
 * source map carrying every finding back to the author's own line. `data.js`
 * is parsed as written. A file that will not parse gets its text rules only;
 * the compatibility stage has already said it does not compile.
 */
import { parse, type Program } from 'acorn'
import { transform } from 'esbuild'
import type { ToolConfig } from '../config'
import { scanCode, type CodeScan } from './codeRules'
import { compatibilityFindings, type CompatibilityInput } from './compatibility'
import {
  dedupeFindings,
  sortFindings,
  stageStatus,
  type CheckFinding,
  type CheckReport,
  type StageResult,
  type CheckFile,
} from './findings'
import { positionLookup } from './sourceMap'
import { scanSecrets, scanSourceText, scanStrings } from './textRules'
import { declaredVsUsed, riskFindings, riskScore, sourceReach } from './usage'

/** Bumped whenever a rule is added or changed, so a rescan knows which versions to re-read. */
const ANALYZER_VERSION = 'static-1'

export interface StaticCheckInput {
  /** The sources as the author wrote them: index.md whole, ui.tsx and data.js unwrapped. */
  index: string | null
  ui: string | null
  data: string | null
  /** The interface's own modules, by file (`src/chart.tsx`) — scanned as ui.tsx is. */
  modules?: Record<string, string>
  config: ToolConfig | null
  build: CompatibilityInput['build']
  facts?: CompatibilityInput['facts']
}

const EMPTY_SCAN: CodeScan = { findings: [], calls: [], handlers: [], strings: [] }

async function scanUi(code: string, file: CheckFile = 'ui.tsx'): Promise<CodeScan> {
  let out
  try {
    out = await transform(code, {
      loader: file.endsWith('.ts') ? 'ts' : 'tsx',
      jsx: 'automatic',
      format: 'esm',
      target: 'es2022',
      sourcemap: 'external',
      sourcefile: file,
      logLevel: 'silent',
    })
  } catch {
    return EMPTY_SCAN
  }
  let program: Program
  try {
    program = parse(out.code, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  } catch {
    return EMPTY_SCAN
  }
  return scanCode({ file, program, locate: positionLookup(out.map) })
}

function scanData(code: string): CodeScan {
  try {
    const program = parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      locations: true,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
    })
    return scanCode({ file: 'data.js', program })
  } catch {
    return EMPTY_SCAN
  }
}

function stage(stageName: StageResult['stage'], findings: CheckFinding[], startedAt: number): StageResult {
  const clean = sortFindings(dedupeFindings(findings))
  return {
    stage: stageName,
    status: stageStatus(clean),
    findings: clean,
    analyzer: ANALYZER_VERSION,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
  }
}

export async function runStaticChecks(input: StaticCheckInput): Promise<CheckReport> {
  const compatStarted = performance.now()
  const compatibility = stage(
    'compatibility',
    compatibilityFindings({ build: input.build, config: input.config, hasUi: !!input.ui?.trim(), facts: input.facts }),
    compatStarted,
  )

  const securityStarted = performance.now()
  const ui = input.ui ? await scanUi(input.ui) : EMPTY_SCAN
  const data = input.data?.trim() ? scanData(input.data) : EMPTY_SCAN
  const moduleScans = await Promise.all(
    Object.entries(input.modules ?? {}).map(async ([file, code]) => ({ file: file as CheckFile, code, scan: await scanUi(code, file as CheckFile) })),
  )
  const findings: CheckFinding[] = [...ui.findings, ...data.findings, ...moduleScans.flatMap((m) => m.scan.findings)]
  for (const m of moduleScans) {
    findings.push(...scanSourceText(m.code, m.file), ...scanSecrets(m.code, m.file), ...scanStrings(m.scan.strings, m.file))
  }
  if (input.ui) findings.push(...scanSourceText(input.ui, 'ui.tsx'), ...scanSecrets(input.ui, 'ui.tsx'))
  if (input.data) findings.push(...scanSourceText(input.data, 'data.js'), ...scanSecrets(input.data, 'data.js'))
  if (input.index) findings.push(...scanSourceText(input.index, 'index.md'), ...scanSecrets(input.index, 'index.md'))
  findings.push(...scanStrings(ui.strings, 'ui.tsx'), ...scanStrings(data.strings, 'data.js'))

  let risk: StageResult['risk']
  if (input.config) {
    const hasData = !!input.data?.trim()
    const calls = [...ui.calls, ...data.calls, ...moduleScans.flatMap((m) => m.scan.calls)]
    findings.push(...declaredVsUsed(sourceReach(input.config), calls, hasData ? data.handlers : []))
    risk = riskScore(input.config)
    findings.push(...riskFindings(risk))
  }
  const security = stage('security', findings, securityStarted)
  return { compatibility, security: risk ? { ...security, risk } : security }
}
