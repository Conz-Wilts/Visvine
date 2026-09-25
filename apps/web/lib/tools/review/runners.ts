/**
 * Where the dynamic run's browser runs. Two runners, one contract: open the
 * review page (signed in through a review ticket), let the Tool run, poke at
 * it, and report what the browser itself saw. Everything the SERVER sees —
 * each bridge call, each door asked for, each CSP report — is already in the
 * run's event log, so a runner that sees nothing still leaves evidence.
 *
 *   local     Playwright's Chromium in this process: every request outside
 *             the app and tools origins is aborted and recorded, every
 *             navigation of the Tool's frame is recorded, CSP violations are
 *             read off the console, and the page's buttons are pressed.
 *   machine   a Visvine machine's browser under an egress policy that allows
 *             the app and tools hosts alone; what it refused is in the
 *             machine's egress log, which is read back as egress attempts.
 *
 * `TOOLS_DYNAMIC_RUNNER` picks (`local` | `machine` | `off`); unset, a
 * production deployment with machines uses them, and anywhere else Playwright
 * when it is installed — never a machine from a laptop, whose edge is
 * production's. With neither the stage says it could not run, and a person
 * reviews without it: a run that did not happen is never reported as clean.
 */
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'

interface RunnerObservation {
  kind: 'egress' | 'navigation' | 'csp' | 'console'
  detail: Record<string, unknown>
}

type RunnerResult =
  | { ok: true; observations: RunnerObservation[]; mounted: boolean }
  | { ok: false; reason: string }

interface RunnerInput {
  /** The ticket URL that signs the browser in and lands on the review page. */
  enterUrl: string
  appOrigin: string
  toolsOrigin: string
  durationMs: number
  honeypotSpaceId: string
  runId: string
}

export interface DynamicRunner {
  kind: 'local' | 'machine'
  run(input: RunnerInput): Promise<RunnerResult>
}

/** How long the Tool is watched once it is up, and the cap on the whole browser session. */
export const RUN_WATCH_MS = 6_000
const RUN_BUDGET_MS = 45_000
/** Controls pressed in the Tool's frame, at most. */
const MAX_PRESSES = 12

const CSP_BLOCKED = /Refused to [^'"]*['"]([^'"]+)['"]/i
const CSP_DIRECTIVE = /directive:?\s*"([^"\s]+)/i

/** A console line → the CSP violation it reports, or null. */
export function cspOfConsole(text: string): { blocked: string; directive: string } | null {
  if (!/Content Security Policy/i.test(text)) return null
  return {
    blocked: CSP_BLOCKED.exec(text)?.[1] ?? 'unknown',
    directive: CSP_DIRECTIVE.exec(text)?.[1] ?? 'content-security-policy',
  }
}

function sameOrigin(url: string, origins: readonly string[]): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'data:' || parsed.protocol === 'blob:' || parsed.protocol === 'about:') return true
    return origins.some((origin) => new URL(origin).origin === parsed.origin)
  } catch {
    return false
  }
}

// ── local ────────────────────────────────────────────────────────────────────

interface PwFrame {
  url(): string
  parentFrame(): PwFrame | null
  locator(selector: string): { count(): Promise<number>; nth(i: number): { click(opts: { timeout: number; noWaitAfter?: boolean; force?: boolean }): Promise<void> } }
  waitForFunction(fn: string, arg?: unknown, opts?: { timeout?: number }): Promise<unknown>
}
interface PwPage {
  on(event: 'console', handler: (msg: { type(): string; text(): string }) => void): void
  on(event: 'pageerror', handler: (err: Error) => void): void
  on(event: 'framenavigated', handler: (frame: PwFrame) => void): void
  goto(url: string, opts: { waitUntil: 'load'; timeout: number }): Promise<unknown>
  frames(): PwFrame[]
  mainFrame(): PwFrame
  waitForSelector(selector: string, opts: { timeout: number; state: 'attached' }): Promise<unknown>
  waitForTimeout(ms: number): Promise<void>
}
interface PwRoute {
  request(): { url(): string }
  abort(code?: string): Promise<void>
  continue(): Promise<void>
}
interface PwContext {
  route(url: string, handler: (route: PwRoute) => Promise<void> | void): Promise<void>
  newPage(): Promise<PwPage>
}
interface PwBrowser {
  newContext(opts: { viewport: { width: number; height: number } }): Promise<PwContext>
  close(): Promise<void>
}
interface Pw {
  chromium: { launch(opts: { headless: boolean }): Promise<PwBrowser> }
}

async function loadPlaywright(): Promise<Pw | null> {
  const specifier = 'playwright'
  try {
    return (await import(/* webpackIgnore: true */ specifier)) as Pw
  } catch {
    return null
  }
}

const FRAME_PATH = '/api/tools/runtime/frame'

const localRunner: DynamicRunner = {
  kind: 'local',
  async run(input) {
    const pw = await loadPlaywright()
    if (!pw) return { ok: false, reason: 'Playwright is not installed here.' }
    const observations: RunnerObservation[] = []
    const origins = [input.appOrigin, input.toolsOrigin]
    const started = Date.now()
    const left = () => Math.max(500, RUN_BUDGET_MS - (Date.now() - started))
    let browser: PwBrowser | null = null
    try {
      browser = await pw.chromium.launch({ headless: true })
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
      // Nothing leaves but to Visvine: every other request is stopped and recorded.
      await context.route('**/*', async (route) => {
        const url = route.request().url()
        if (sameOrigin(url, origins)) return route.continue()
        observations.push({ kind: 'egress', detail: { url: url.slice(0, 2000) } })
        return route.abort('blockedbyclient')
      })
      const page = await context.newPage()
      page.on('console', (msg) => {
        const csp = cspOfConsole(msg.text())
        if (csp) observations.push({ kind: 'csp', detail: csp })
        else if (msg.type() === 'error') observations.push({ kind: 'console', detail: { text: msg.text().slice(0, 500) } })
      })
      page.on('pageerror', (err) => observations.push({ kind: 'console', detail: { text: err.message.slice(0, 500) } }))
      // The Tool's frame loads its document once; any other page in it is the
      // Tool navigating itself.
      const loaded = new Set<PwFrame>()
      page.on('framenavigated', (frame) => {
        const url = frame.url()
        if (frame === page.mainFrame()) {
          if (!sameOrigin(url, [input.appOrigin])) observations.push({ kind: 'navigation', detail: { url, frame: 'page' } })
          return
        }
        if (url.includes(FRAME_PATH) && !loaded.has(frame)) {
          loaded.add(frame)
          return
        }
        if (loaded.has(frame) && url !== 'about:blank') observations.push({ kind: 'navigation', detail: { url: url.slice(0, 2000), frame: 'tool' } })
      })

      await page.goto(input.enterUrl, { waitUntil: 'load', timeout: left() })
      let mounted = false
      try {
        await page.waitForSelector('iframe', { timeout: Math.min(left(), 10_000), state: 'attached' })
        const frame = page.frames().find((f) => f.url().includes(FRAME_PATH))
        if (frame) {
          await frame.waitForFunction(
            '() => { const r = document.getElementById("root"); return !!r && r.childElementCount > 0 }',
            undefined,
            { timeout: Math.min(left(), 10_000) },
          )
          mounted = true
          await page.waitForTimeout(Math.min(left(), 1_000))
          // Press what a person could press, a few at a time.
          const controls = frame.locator('button, [role="button"], a[href], input[type="checkbox"]')
          const count = Math.min(await controls.count().catch(() => 0), MAX_PRESSES)
          for (let at = 0; at < count; at++) {
            await controls.nth(at).click({ timeout: 800, noWaitAfter: true }).catch(() => undefined)
            await page.waitForTimeout(250)
          }
        }
      } catch {
        mounted = false
      }
      await page.waitForTimeout(Math.min(left(), input.durationMs))
      return { ok: true, observations, mounted }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message.slice(0, 300) : 'The browser failed.' }
    } finally {
      await browser?.close().catch(() => undefined)
    }
  },
}

// ── machine ──────────────────────────────────────────────────────────────────

/** The agent name a honeypot's machine is leased under. */
const MACHINE_AGENT = 'tool-review'

const machineRunner: DynamicRunner = {
  kind: 'machine',
  async run(input) {
    const { browseOnMachine } = await import('@/lib/vm/lease')
    const { stop, edgeConfigured } = await import('@/lib/vm/edge')
    const { environment } = await import('@/lib/vm/lease')
    if (!edgeConfigured()) return { ok: false, reason: 'No machines on this deployment.' }
    const allow = [input.appOrigin, input.toolsOrigin].map((origin) => new URL(origin).host)
    const since = new Date()
    try {
      await browseOnMachine(input.honeypotSpaceId, MACHINE_AGENT, input.enterUrl, { taskAllow: allow })
      await new Promise((resolve) => setTimeout(resolve, input.durationMs + 8_000))
      const refused = await prisma.agentEgressLog.findMany({
        where: { spaceId: input.honeypotSpaceId, agentName: MACHINE_AGENT, at: { gte: since }, verdict: { not: 'allow' } },
        select: { host: true, path: true, verdict: true },
        take: 200,
      })
      return {
        ok: true,
        observations: refused.map((row) => ({ kind: 'egress' as const, detail: { url: `https://${row.host}${row.path}`, verdict: row.verdict } })),
        mounted: true,
      }
    } catch (err) {
      logger.warn('tools.review.machine_failed', { err, runId: input.runId })
      return { ok: false, reason: err instanceof Error ? err.message.slice(0, 300) : 'The machine failed.' }
    } finally {
      await stop(environment(), input.honeypotSpaceId, MACHINE_AGENT).catch(() => undefined)
    }
  },
}

/** The runner this deployment uses, or why there is none. */
export async function pickRunner(env: Record<string, string | undefined> = process.env): Promise<DynamicRunner | { unavailable: string }> {
  const wanted = env.TOOLS_DYNAMIC_RUNNER?.trim().toLowerCase()
  if (wanted === 'off') return { unavailable: 'The dynamic run is switched off here.' }
  if (wanted === 'machine') return machineRunner
  if (wanted === 'local') return (await loadPlaywright()) ? localRunner : { unavailable: 'Playwright is not installed here.' }
  if (env.NODE_ENV === 'production') {
    const { edgeConfigured } = await import('@/lib/vm/edge')
    if (edgeConfigured()) return machineRunner
  }
  if (await loadPlaywright()) return localRunner
  return { unavailable: 'Neither a machine nor a local browser is available to run it.' }
}
