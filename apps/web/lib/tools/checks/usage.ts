/**
 * Declared against used, and the permission risk score. Pure.
 *
 * A Tool's reach is what its manifest declares, and the bridge refuses the
 * rest — so two mismatches are worth saying before anyone installs it:
 *
 *   used but undeclared   a call the perimeter will refuse at run time (it
 *                         cannot work, so the author wants to know now);
 *   declared but unused   reach the code never exercises (least privilege:
 *                         an admin should not be asked to approve it).
 *
 * Only literal arguments are judged; a path the code computes is not guessed.
 *
 * The risk score reads the manifest alone and never blocks: it tells whoever
 * approves which reach deserves a second look — broad reads paired with
 * writes (the laundering shape), a connector beside wide reads (the way out),
 * configuration reads, every agent.
 */
import {
  globMatch,
  refuseAgent,
  refuseConnector,
  refuseRead,
  refuseWrite,
  type ToolPerimeter,
} from '../perimeter'
import type { ToolConfig } from '../config'
import type { BridgeCallSite } from './codeRules'
import type { CheckFinding, RiskScore } from './findings'

const READS = new Set<BridgeCallSite['method']>(['context.read', 'context.list', 'context.search'])
const WRITES = new Set<BridgeCallSite['method']>(['context.write', 'context.append'])

/** The literal part of a glob, up to its first wildcard. */
function globPrefix(glob: string): string {
  const at = glob.search(/[*?[]/)
  return at < 0 ? glob : glob.slice(0, at)
}

/** Can anything under this list glob be read under the perimeter? */
function listReachable(perimeter: ToolPerimeter, glob: string): boolean {
  const prefix = globPrefix(glob).replace(/\/+$/, '')
  return perimeter.read.some((declared) => {
    const declaredPrefix = globPrefix(declared).replace(/\/+$/, '')
    return (
      declared === glob ||
      prefix.startsWith(declaredPrefix) ||
      declaredPrefix.startsWith(prefix) ||
      globMatch(declared, `${prefix}/x.md`)
    )
  })
}

export function declaredVsUsed(
  perimeter: ToolPerimeter,
  calls: readonly BridgeCallSite[],
  handlers: readonly string[] | null,
): CheckFinding[] {
  const findings: CheckFinding[] = []
  const at = (call: BridgeCallSite) => ({ file: call.file, ...(call.line ? { line: call.line } : {}) })

  for (const call of calls) {
    if (call.arg === null) continue
    if (call.method === 'context.read' && refuseRead(perimeter, call.arg)) {
      findings.push({ rule: 'usage.undeclared-read', severity: 'medium', message: `Reads ${call.arg}, which the perimeter does not declare`, ...at(call) })
    } else if (call.method === 'context.list' && !listReachable(perimeter, call.arg)) {
      findings.push({ rule: 'usage.undeclared-read', severity: 'medium', message: `Lists ${call.arg}, which the perimeter does not declare`, ...at(call) })
    } else if (WRITES.has(call.method) && refuseWrite(perimeter, call.arg)) {
      findings.push({ rule: 'usage.undeclared-write', severity: 'medium', message: `Writes ${call.arg}, which the perimeter does not declare`, ...at(call) })
    } else if (call.method === 'connectors.call' && refuseConnector(perimeter, call.arg)) {
      findings.push({ rule: 'usage.undeclared-connector', severity: 'medium', message: `Calls connector ${call.arg}, which it does not declare`, ...at(call) })
    } else if (call.method === 'agents.run' && refuseAgent(perimeter, call.arg)) {
      findings.push({ rule: 'usage.undeclared-agent', severity: 'medium', message: `Runs agent ${call.arg}, which it does not declare`, ...at(call) })
    } else if (call.method === 'data.call' && handlers !== null && !handlers.includes(call.arg)) {
      findings.push({ rule: 'usage.missing-handler', severity: 'medium', message: `Calls data handler ${call.arg}, which data.js does not define`, ...at(call) })
    }
  }

  const uses = (methods: Set<BridgeCallSite['method']>) => calls.some((call) => methods.has(call.method))
  const unused = (rule: string, message: string) => findings.push({ rule, severity: 'low', message, file: 'index.md' })
  if (perimeter.write.length > 0 && !uses(WRITES)) unused('usage.unused-write', 'Declares writes it never makes')
  if (perimeter.read.length > 0 && !uses(READS) && !uses(WRITES)) unused('usage.unused-read', 'Declares reads it never makes')
  if (perimeter.connectors.length > 0 && !uses(new Set(['connectors.call']))) {
    unused('usage.unused-connector', `Declares connectors (${perimeter.connectors.join(', ')}) it never calls`)
  }
  if (perimeter.agents.length > 0 && !uses(new Set(['agents.run']))) {
    // An agent is also declared to create its brief, which is a write, not a run.
    const writesBriefs = calls.some((call) => WRITES.has(call.method) && (call.arg ?? '').startsWith('agents/'))
    if (!writesBriefs) unused('usage.unused-agent', `Declares agents (${perimeter.agents.join(', ')}) it never runs`)
  }
  return findings
}

/** A glob at the root of the context, or `**` itself. */
function isBroad(glob: string): boolean {
  const g = glob.replace(/^\/+/, '')
  return g === '**' || g === '*' || g === '**/*' || g.startsWith('**/') || g === '' || g === '/'
}

const CONFIG_ROOTS = ['connectors', 'agents', 'tools', 'models', 'settings']

export function riskScore(config: Pick<ToolConfig, 'perimeter' | 'surfaces'>): RiskScore {
  const { perimeter, surfaces } = config
  const factors: string[] = []
  let score = 0
  const broadRead = perimeter.read.some(isBroad)
  const broadWrite = perimeter.write.some(isBroad)
  if (broadRead) {
    score += 25
    factors.push('reads everything its viewer can')
  }
  if (broadWrite) {
    score += 20
    factors.push('writes anywhere its viewer can')
  }
  if (perimeter.read.length > 0 && perimeter.write.length > 0 && (broadRead || broadWrite)) {
    score += 20
    factors.push('reads widely and writes — what one viewer sees can land where others read it')
  }
  if (perimeter.connectors.length > 0 && perimeter.read.length > 0) {
    score += 20
    factors.push(`space data can leave through ${perimeter.connectors.join(', ')}`)
  }
  if (perimeter.connectors.includes('*')) {
    score += 10
    factors.push('calls any connector')
  }
  if (perimeter.agents.includes('*')) {
    score += 10
    factors.push('runs any agent')
  }
  const configReads = perimeter.read.filter((glob) => CONFIG_ROOTS.includes(glob.split('/')[0]))
  if (configReads.length > 0) {
    score += 15
    factors.push(`reads configuration (${configReads.join(', ')})`)
  }
  if (perimeter.write.some((glob) => glob.split('/')[0] === 'people')) {
    score += 10
    factors.push('writes people records')
  }
  if (surfaces.types.some((claim) => claim.mode === 'page')) {
    score += 5
    factors.push('takes over a type’s page')
  }
  score = Math.min(100, score)
  const level = score >= 45 ? 'high' : score >= 25 ? 'medium' : 'low'
  return { score, level, factors }
}

/** The score as findings: a high score flags the version for a person; the rest is said, not flagged. */
export function riskFindings(risk: RiskScore): CheckFinding[] {
  if (risk.level === 'low') return []
  return [
    {
      rule: 'risk.permissions',
      severity: risk.level === 'high' ? 'medium' : 'info',
      message: `Risk ${risk.score} — ${risk.factors.join('; ')}`,
      file: 'index.md',
    },
  ]
}
