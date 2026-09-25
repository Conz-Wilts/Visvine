/**
 * Visvine's global stages over a version offered for listing — the AI review
 * and the dynamic run — run once per co-signed request, from the queue
 * (./queue.ts), and written where every other stage is (`app_tool_check_runs`,
 * stages `ai` and `dynamic`). A reviewer reads them beside the static stages;
 * a blocking finding keeps the version off the shelf (registry.ts#reviewVersion).
 *
 * The dynamic run: a honeypot space made for this run and seeded with canaries
 * (./honeypot.ts), the version run in it through the `review` bridge target as
 * the review runner, a browser watching (./runners.ts), then the evidence read
 * and scanned (./shared/canaries.ts#scanEvidence), and the honeypot deleted.
 *
 * A verified publisher's version is listed without a person when every stage
 * came back clean (registry.ts#shouldAutoApprove) — never before the stages
 * have run, and never when the dynamic run could not.
 */
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { aiConfigured, chatWithTools, type AgentMessage } from '@/lib/notes/ai'
import { randomBytes } from 'node:crypto'
import { appOrigin, toolsOrigin } from '../origin'
import { describePerimeter } from '../perimeter'
import { manifestOf } from '../config'
import {
  AUTO_APPROVE_NOTE,
  AUTO_REVIEWER,
  decideListing,
  decodeToolConfig,
  decodeToolPerimeter,
  previousApprovedVersion,
  shouldAutoApprove,
} from '../registry'
import { verifiedPublishers } from '../publishers'
import { recordGlobalStage, versionReports } from '../checks/runs'
import { stageStatus, type CheckFinding, type StageResult } from '../checks/findings'
import { aiReviewMessages, AI_ANALYZER, parseAiReview } from './shared/aiReview'
import { canaryIndexOf, DYNAMIC_ANALYZER, planHoneypot, scanEvidence } from './shared/canaries'
import { dropHoneypot, makeHoneypot, readHoneypot } from './honeypot'
import { pickRunner, RUN_WATCH_MS, type DynamicRunner } from './runners'
import { recordReviewEvent, reviewEvents } from './events'
import { mintReviewTicket } from './ticket'
import { claimReview, MAX_REVIEW_ATTEMPTS } from './queue'
import { raiseIncident } from '../monitor'

export type ReviewStatus = 'passed' | 'flagged' | 'blocked' | 'unavailable' | 'error'

export interface ReviewDeps {
  /** The model's answer to the review's messages. Absent: the deployment's chat model, when the AI review is on. */
  complete?: (messages: AgentMessage[]) => Promise<string>
  /** Where the browser runs. Absent: `pickRunner()`. */
  runner?: DynamicRunner | { unavailable: string }
}

/**
 * Whether the AI review runs by itself: `TOOLS_AI_REVIEW=on|off`, and unset,
 * in production when the deployment's model is configured — a dev server does
 * not spend a key on it unless asked.
 */
function aiReviewEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const flag = env.TOOLS_AI_REVIEW?.trim().toLowerCase()
  if (flag === 'off') return false
  if (flag === 'on') return aiConfigured()
  return env.NODE_ENV === 'production' && aiConfigured()
}

async function deploymentComplete(messages: AgentMessage[]): Promise<string> {
  const reply = await chatWithTools(messages, [], { maxTokens: 1500, signal: AbortSignal.timeout(60_000) })
  return reply.content ?? ''
}

function stage(stageName: 'ai' | 'dynamic', findings: CheckFinding[], analyzer: string, started: number): StageResult {
  return { stage: stageName, status: stageStatus(findings), findings, analyzer, durationMs: Date.now() - started }
}

/** The version's code as the review reads it: file → source. */
function filesOf(version: { uiSource: string; dataSource: string; modules: unknown }): Record<string, string> {
  const files: Record<string, string> = { 'src/ui.tsx': version.uiSource }
  if (version.dataSource.trim()) files['src/data.js'] = version.dataSource
  if (version.modules && typeof version.modules === 'object' && !Array.isArray(version.modules)) {
    for (const [file, code] of Object.entries(version.modules as Record<string, unknown>)) {
      if (typeof code === 'string') files[file] = code
    }
  }
  return files
}

async function aiStage(
  version: { title: string; description: string | null; perimeter: unknown; uiSource: string; dataSource: string; modules: unknown },
  deps: ReviewDeps,
): Promise<StageResult> {
  const started = Date.now()
  const complete = deps.complete ?? (aiReviewEnabled() ? deploymentComplete : null)
  if (!complete) {
    return stage('ai', [{ rule: 'ai.unavailable', severity: 'info', message: 'The AI review did not run here.' }], AI_ANALYZER, started)
  }
  const files = filesOf(version)
  try {
    const text = await complete(
      aiReviewMessages({
        title: version.title,
        description: version.description ?? '',
        reach: describePerimeter(decodeToolPerimeter(version.perimeter)),
        files,
      }),
    )
    const findings = parseAiReview(text, Object.keys(files))
    return stage(
      'ai',
      findings ?? [{ rule: 'ai.unreadable', severity: 'info', message: 'The AI review answered in a shape it could not read.' }],
      AI_ANALYZER,
      started,
    )
  } catch (err) {
    // Fails open: the review adds findings, and one that could not run adds none.
    logger.warn('tools.review.ai_failed', { err })
    return stage('ai', [{ rule: 'ai.unavailable', severity: 'info', message: 'The AI review could not reach the model.' }], AI_ANALYZER, started)
  }
}

function mintToken(): string {
  return `vvc-${randomBytes(6).toString('hex')}`
}

async function dynamicStage(
  runId: string,
  version: { config: unknown; name: string },
  deps: ReviewDeps,
): Promise<{ result: StageResult; ran: boolean }> {
  const started = Date.now()
  const runner = deps.runner ?? (await pickRunner())
  if ('unavailable' in runner) {
    return { result: stage('dynamic', [{ rule: 'dynamic.unavailable', severity: 'info', message: runner.unavailable }], DYNAMIC_ANALYZER, started), ran: false }
  }
  const plan = planHoneypot(manifestOf(decodeToolConfig(version.config, version.name)), mintToken)
  const honeypot = await makeHoneypot(runId, plan)
  try {
    await prisma.appToolReviewRun.update({
      where: { id: runId },
      data: {
        honeypotSpaceId: honeypot.spaceId,
        runnerUserId: honeypot.runner.id,
        runner: runner.kind,
        canaries: canaryIndexOf(plan),
      },
    })
    const ticket = await mintReviewTicket(runId, honeypot.runner.id)
    const app = appOrigin()
    const result = await runner.run({
      enterUrl: `${app}/api/tools/review-run/enter?ticket=${encodeURIComponent(ticket)}`,
      appOrigin: app,
      toolsOrigin: toolsOrigin() ?? app,
      durationMs: RUN_WATCH_MS,
      honeypotSpaceId: honeypot.spaceId,
      runId,
    })
    if (!result.ok) {
      return {
        result: stage('dynamic', [{ rule: 'dynamic.unavailable', severity: 'info', message: `The dynamic run did not complete: ${result.reason}` }], DYNAMIC_ANALYZER, started),
        ran: false,
      }
    }
    for (const observation of result.observations) {
      await recordReviewEvent(runId, observation.kind, null, observation.detail)
    }
    const [events, notes] = await Promise.all([reviewEvents(runId), readHoneypot(honeypot)])
    const findings = scanEvidence({
      canaries: canaryIndexOf(plan),
      notes,
      events: events.map((event) => ({
        kind: event.kind,
        method: event.method,
        detail: (event.detail && typeof event.detail === 'object' && !Array.isArray(event.detail) ? event.detail : {}) as Record<string, unknown>,
      })),
      rendered: result.mounted,
    })
    return { result: stage('dynamic', findings, DYNAMIC_ANALYZER, started), ran: true }
  } finally {
    await dropHoneypot(honeypot.spaceId)
  }
}

/** Run one claimed review to its end. Never throws: a failure is the run's status. */
async function runReview(runId: string, deps: ReviewDeps = {}): Promise<ReviewStatus> {
  const run = await prisma.appToolReviewRun.findUnique({ where: { id: runId }, select: { versionId: true, attempts: true } })
  if (!run) return 'error'
  const version = await prisma.appToolVersion.findUnique({
    where: { id: run.versionId },
    select: {
      id: true,
      key: true,
      name: true,
      version: true,
      title: true,
      description: true,
      config: true,
      perimeter: true,
      uiSource: true,
      dataSource: true,
      modules: true,
      sourceSpaceId: true,
      listingId: true,
      marketplaceStatus: true,
    },
  })
  if (!version) return 'error'
  // Stamped with the hash the version was published from, like its other stages.
  const published = await prisma.appToolCheckRun.findFirst({ where: { versionId: version.id }, select: { sourceHash: true } })
  const sourceHash = published?.sourceHash ?? `v${version.version}`
  const record = (result: StageResult) =>
    recordGlobalStage({ spaceId: null, name: version.name, versionId: version.id, sourceHash, result })

  try {
    const ai = await aiStage(version, deps)
    await record(ai)
    const dynamic = await dynamicStage(runId, version, deps)
    await record(dynamic.result)

    const all = [...ai.findings, ...dynamic.result.findings]
    const status: ReviewStatus = all.some((f) => f.severity === 'high')
      ? 'blocked'
      : !dynamic.ran
        ? 'unavailable'
        : all.some((f) => f.severity !== 'info')
          ? 'flagged'
          : 'passed'
    await prisma.appToolReviewRun.update({ where: { id: runId }, data: { status, finishedAt: new Date(), error: null } })
    if (dynamic.ran && status !== 'blocked') await maybeAutoApprove(version, all)
    // A version already listed that its dynamic run now catches is Visvine's
    // own severe signal: it holds the listing at once (lib/tools/monitor.ts).
    if (version.marketplaceStatus === 'approved') await raiseDynamicIncidents(version, dynamic.result.findings)
    return status
  } catch (err) {
    logger.error('tools.review.run_failed', { err, runId })
    const message = err instanceof Error ? err.message.slice(0, 500) : 'The review failed.'
    await prisma.appToolReviewRun
      .update({
        where: { id: runId },
        // Put back for the next tick until it has had its tries.
        data: run.attempts < MAX_REVIEW_ATTEMPTS ? { status: 'queued', error: message } : { status: 'error', finishedAt: new Date(), error: message },
      })
      .catch(() => undefined)
    return 'error'
  }
}

const KIND_OF_RULE: Record<string, 'navigation' | 'csp' | 'canary'> = {
  'dynamic.navigation': 'navigation',
  'dynamic.csp': 'csp',
  'dynamic.egress': 'csp',
}

async function raiseDynamicIncidents(
  version: { id: string; key: string; listingId: string | null; sourceSpaceId: string },
  findings: CheckFinding[],
): Promise<void> {
  const seen = new Set<string>()
  for (const finding of findings) {
    if (finding.severity !== 'high' || seen.has(finding.rule)) continue
    seen.add(finding.rule)
    await raiseIncident({
      kind: KIND_OF_RULE[finding.rule] ?? 'canary',
      severity: 'severe',
      source: 'dynamic',
      key: version.key,
      listingId: version.listingId,
      versionId: version.id,
      spaceId: version.sourceSpaceId,
      detail: { rule: finding.rule, message: finding.message },
    })
  }
}

/** A verified publisher's fast path, once every automated stage has read the version. */
async function maybeAutoApprove(
  version: { id: string; key: string; name: string; version: number; config: unknown; sourceSpaceId: string; listingId: string | null; marketplaceStatus: string | null },
  globalFindings: CheckFinding[],
): Promise<void> {
  if (version.marketplaceStatus !== 'pending') return
  const [previous, reports, verified] = await Promise.all([
    previousApprovedVersion(version.key, version.version, 'marketplace'),
    versionReports([version.id]),
    verifiedPublishers([version.sourceSpaceId]),
  ])
  const security = reports.get(version.id)?.report.security.findings ?? null
  const approve = shouldAutoApprove({
    verifiedPublishers: verified,
    sourceSpaceId: version.sourceSpaceId,
    previous: previous?.config ?? null,
    next: decodeToolConfig(version.config, version.name),
    securityFindings: security ? [...security, ...globalFindings] : null,
  })
  if (!approve) return
  await decideListing(version.id, version, 'approved', AUTO_REVIEWER, AUTO_REVIEWER, AUTO_APPROVE_NOTE)
}

/**
 * A reviewer asking for the review now: queue it (or take the one waiting)
 * and run it in this request. Bounded by the run itself — a browser session
 * of under a minute.
 */
export async function runReviewNow(versionId: string, deps: ReviewDeps = {}): Promise<ReviewStatus | 'busy'> {
  const { enqueueReview } = await import('./queue')
  const runId = await enqueueReview(versionId)
  const claimed = await prisma.appToolReviewRun.updateMany({
    where: { id: runId, status: 'queued' },
    data: { status: 'running', startedAt: new Date(), attempts: { increment: 1 } },
  })
  if (claimed.count === 0) return 'busy'
  return runReview(runId, deps)
}

/** Drain the queue within a budget — the minute tick's share. */
export async function drainToolReviews(opts: { budgetMs: number; deps?: ReviewDeps }): Promise<{ ran: number }> {
  const started = Date.now()
  let ran = 0
  while (Date.now() - started < opts.budgetMs) {
    const claimed = await claimReview()
    if (!claimed) break
    await runReview(claimed.id, opts.deps)
    ran++
  }
  return { ran }
}
