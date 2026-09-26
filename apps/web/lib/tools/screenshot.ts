/**
 * A headless render of a Tool's working copy, for the authoring agent that
 * cannot open a browser: `preview_tool { screenshot: true }` and
 * `check_tool { render: true }` (lib/mcp/appTools.ts).
 *
 * The render is the REAL preview page — `${appOrigin}/tools/preview/<name>` —
 * driven through Playwright's bundled Chromium as the calling principal, not
 * the bare frame document. The frame renders nothing until the host page's
 * handshake lands (`visvine:init`, features/tools/kit/runtime.ts) and every
 * read a Tool makes goes back through the host to the bridge, so a screenshot
 * of the frame URL alone would be an error card, and a fake host would be a
 * second bridge to keep honest. Instead this mints an ordinary session for the
 * caller (lib/session.ts — same JWT the login flow sets), drops it into a
 * throwaway browser context as the `auth_session` cookie, points the space
 * switcher at the target space, and reads back exactly what that person would
 * see: same grants, same perimeter, same refusals.
 *
 * Availability, not failure, is the contract. Playwright is a devDependency and
 * Chromium is a separate download, so this returns `{ available: false, reason }`
 * whenever it cannot run — module missing, browser not installed, production
 * without `TOOLS_SCREENSHOT=on` — and the MCP tools fall back to link-only, as
 * they were before this existed. `import('playwright')` is deliberately dynamic
 * (through a variable, so the bundler leaves it alone): a production image built
 * without the package must still boot.
 *
 * The session is the caller's, but it is minted SHORT (`PREVIEW_SESSION_TTL_S`)
 * and the page is PINNED to the preview URL: a Tool's own code can ask the host
 * to navigate (`visvine.navigate`, features/tools/lib/hostBridge.ts honours any
 * in-app path), and `preview_tool` needs only `tools:author` — so without the
 * pin a narrow-scope token could screenshot any page the caller's session can
 * see. Main-frame navigation requests to anything but the preview URL are
 * aborted at the network layer (`page.route`), and if the main frame still ends
 * up elsewhere the capture answers `navigated_away` rather than an image.
 * Sub-resources, `/api/*` and the Tool's frame (which lives on the tools origin)
 * are untouched — the predicate is `previewNavigationAllowed`, tested on its own.
 *
 * Budget: one wall-clock allowance covers launch, navigation, the frame's mount
 * and the capture. Console errors and uncaught page errors are collected from
 * every frame — the Tool's frame included — because a Tool that mounts and then
 * throws in an effect is what an author most needs told.
 */

/** Viewport the capture is taken at — a laptop pane, not a phone. */
export const SCREENSHOT_WIDTH = 1024
export const SCREENSHOT_HEIGHT = 768

/** Wall clock for the whole capture, launch to close. */
export const SCREENSHOT_BUDGET_MS = 20_000

/** Past this the PNG is retaken as a JPEG — the answer rides in an MCP result. */
export const SCREENSHOT_MAX_BYTES = 300_000
const JPEG_QUALITY = 70

/**
 * How long the minted preview session lives. The whole capture is bounded by
 * `SCREENSHOT_BUDGET_MS`, so anything past a couple of minutes is a token that
 * outlives its only job.
 */
export const PREVIEW_SESSION_TTL_S = 120

/** How many console lines come back, and how long each may be. */
const MAX_CONSOLE_ERRORS = 50
const MAX_CONSOLE_LINE = 500

/** The localStorage key the space switcher reads (features/shared/contexts/SpaceContext.tsx). */
const CURRENT_SPACE_KEY = 'nb_current_space'

interface ScreenshotViewer {
  userId: string
  name: string
  email: string
  personId?: string | null
}

export interface ScreenshotRequest {
  appOrigin: string
  spaceId: string
  name: string
  viewer: ScreenshotViewer
  /** Skip the image and just collect console errors — `check_tool { render }`. */
  image?: boolean
  /** Open this one of the Tool's sections (`surfaces.nav`) before capturing. */
  section?: string
  /** Press this band button (`surfaces.actions` id) before capturing — the dialog it opens is what is shot. */
  action?: string
  budgetMs?: number
  /** Act on the Tool as a person would, in order, before the capture (`try_tool`). */
  steps?: ToolStep[]
  /** Return the frame's accessibility outline — what is on the page, as text. */
  outline?: boolean
  /** Capture the Tool's whole scrolled height, not only the first screen. */
  fullPage?: boolean
}

/**
 * Where a step lands, as a person names it — never a selector. `role` + `name`
 * is a button, a link, a combobox; `label` a field by its label; `text` any
 * visible text; `placeholder` an empty input. The first match is used.
 */
interface StepTarget {
  role?: string
  name?: string
  label?: string
  text?: string
  placeholder?: string
}

export type ToolStep =
  | { do: 'click'; target: StepTarget }
  | { do: 'hover'; target: StepTarget }
  | { do: 'fill'; target: StepTarget; value: string }
  /** Open a Select by its label (or target) and press the option named `value`. */
  | { do: 'choose'; target: StepTarget; value: string }
  | { do: 'press'; key: string; target?: StepTarget }
  /** Scroll the Tool's page by `pixels` (down when positive), or bring `target` into view. */
  | { do: 'scroll'; pixels?: number; target?: StepTarget }
  | { do: 'wait'; ms: number }
  /** Press one of the Tool's band buttons (`surfaces.actions`) — it sits on the app's band, outside the frame. */
  | { do: 'band'; action: string }

interface StepOutcome {
  step: number
  do: ToolStep['do']
  ok: boolean
  /** Why it failed — the target was not found, not visible, disabled. */
  error?: string
}

/** A step may wait this long for its target to be there and actionable. */
const STEP_TIMEOUT_MS = 2500
/** After an act, a beat for the Tool's state and reads to settle and paint. */
const STEP_SETTLE_MS = 400
export const MAX_TOOL_STEPS = 20
/** Longest the capture waits for a mounted Tool to finish loading. */
const SETTLE_MAX_MS = 8000
/** What "still loading" looks like, and how much there is to read. */
const LOAD_STATE = `() => {
  const busy = document.querySelectorAll('.animate-spin, [aria-busy="true"], .animate-pulse').length
  return busy + ':' + (document.body ? document.body.innerText.length : 0)
}`

/**
 * Wait until the frame shows no spinner or skeleton and its text has held
 * still for two looks in a row — at least 600ms, at most \`maxMs\`.
 */
async function settle(page: PageLike, frame: FrameLike, maxMs: number): Promise<void> {
  const until = Date.now() + Math.max(600, maxMs)
  let last = ''
  let still = 0
  while (Date.now() < until) {
    await page.waitForTimeout(300)
    let state = ''
    try {
      state = String(await frame.evaluate(LOAD_STATE))
    } catch {
      return
    }
    still = state === last && state.startsWith('0:') ? still + 1 : 0
    last = state
    if (still >= 2) return
  }
}
const MAX_OUTLINE_CHARS = 12_000
/** A full-page capture stops at this height. */
const MAX_FULL_PAGE_HEIGHT = 4000

export type ScreenshotResult =
  | { available: false; reason: string }
  /** The page left the preview URL (a Tool called `visvine.navigate`, say) — no image is taken. */
  | { available: true; navigated_away: true; url: string; console_errors: string[] }
  | {
      available: true
      navigated_away?: false
      /** Base64 image, or null when `image: false` was asked for. */
      image_base64: string | null
      mime: 'image/png' | 'image/jpeg' | null
      width: number
      height: number
      /** Whether the Tool's frame mounted something into its root before the budget ran out. */
      rendered: boolean
      /** `console.error` lines and uncaught errors from the page and every frame, in order. */
      console_errors: string[]
      /** The named band button was not on the band — the Tool does not declare it. */
      action_missing?: boolean
      /** The Tool's content is wider than its frame: something is cut off or scrolls sideways. */
      horizontal_overflow?: boolean
      /** The Tool is taller than its frame and scrolls — `height` of `scroll_height`. */
      scroll_height?: number
      /** One per step asked for, in order; steps after a failure are not run. */
      steps?: StepOutcome[]
      /** The frame's accessibility outline (YAML, Playwright's aria snapshot). */
      outline?: string
    }

/**
 * Whether a capture may even be attempted here. Dev is always allowed; a
 * production deployment opts in with `TOOLS_SCREENSHOT=on`, because launching
 * a browser per call is a cost an operator should choose.
 */
export function screenshotEnabled(env: NodeJS.ProcessEnv = process.env): { ok: true } | { ok: false; reason: string } {
  if (env.NODE_ENV === 'production' && env.TOOLS_SCREENSHOT !== 'on') {
    return { ok: false, reason: 'Headless rendering is off in this deployment (set TOOLS_SCREENSHOT=on to enable it).' }
  }
  return { ok: true }
}

/**
 * The URL of the preview page for one Tool — what the browser is pointed at
 * and the only main-frame destination it may reach.
 */
export function previewPageUrl(appOrigin: string, name: string, section?: string, spaceId?: string): string {
  // Addressed in its space, as every page inside one is: the unprefixed path is
  // answered with a redirect under the space, which the pin would refuse.
  const space = spaceId ? `/s/${encodeURIComponent(spaceId)}` : ''
  const base = `${appOrigin.replace(/\/+$/, '')}${space}/tools/preview/${encodeURIComponent(name)}`
  return section ? `${base}?section=${encodeURIComponent(section)}` : base
}

/**
 * Whether the main frame may load `requestUrl` while capturing `previewUrl`.
 * Pure: same origin and same path (query and hash are the page's own business —
 * a reload with `?x` is still the preview). Anything else — another route on
 * the app, another host, a scheme that is not http(s) — is refused. Only ever
 * asked about MAIN-FRAME NAVIGATIONS; sub-resources and child frames never
 * come here.
 */
export function previewNavigationAllowed(previewUrl: string, requestUrl: string): boolean {
  let want: URL
  let got: URL
  try {
    want = new URL(previewUrl)
    got = new URL(requestUrl)
  } catch {
    return false
  }
  if (got.protocol !== 'http:' && got.protocol !== 'https:') return false
  const strip = (p: string) => p.replace(/\/+$/, '') || '/'
  if (want.origin !== got.origin) return false
  const w = strip(want.pathname)
  const g = strip(got.pathname)
  if (w === g) return true
  // A room is re-addressed under its house: `/s/<room>/…` → `/s/<house>/<room>/…`.
  const room = /^\/s\/([^/]+)(\/tools\/preview\/[^/]+)$/.exec(w)
  return !!room && new RegExp(`^/s/[^/.]+/${room[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${room[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`).test(g)
}

/** The slice of Playwright this file touches — typed locally so the package stays optional. */
interface PlaywrightLike {
  chromium: {
    launch(opts: { headless: boolean }): Promise<BrowserLike>
  }
}
interface BrowserLike {
  newContext(opts: { viewport: { width: number; height: number }; ignoreHTTPSErrors?: boolean }): Promise<ContextLike>
  close(): Promise<void>
}
interface ContextLike {
  addCookies(cookies: Array<{ name: string; value: string; url: string; httpOnly?: boolean; sameSite?: 'Lax' | 'Strict' | 'None' }>): Promise<void>
  addInitScript(script: string): Promise<void>
  newPage(): Promise<PageLike>
}
interface LocatorLike {
  first(): LocatorLike
  click(opts: { timeout: number }): Promise<void>
  hover(opts: { timeout: number }): Promise<void>
  fill(value: string, opts: { timeout: number }): Promise<void>
  press(key: string, opts: { timeout: number }): Promise<void>
  scrollIntoViewIfNeeded(opts: { timeout: number }): Promise<void>
  ariaSnapshot(opts: { timeout: number }): Promise<string>
}
interface FrameLike {
  url(): string
  waitForFunction(fn: string, arg?: unknown, opts?: { timeout?: number }): Promise<unknown>
  evaluate(fn: string, arg?: unknown): Promise<unknown>
  getByRole(role: string, opts?: { name?: string; exact?: boolean }): LocatorLike
  getByLabel(text: string, opts?: { exact?: boolean }): LocatorLike
  getByText(text: string, opts?: { exact?: boolean }): LocatorLike
  getByPlaceholder(text: string, opts?: { exact?: boolean }): LocatorLike
  locator(selector: string): LocatorLike
}
interface RouteLike {
  request(): { url(): string; isNavigationRequest(): boolean; frame(): FrameLike }
  abort(errorCode?: string): Promise<void>
  continue(): Promise<void>
}
interface PageLike {
  on(event: 'console', handler: (msg: { type(): string; text(): string }) => void): void
  on(event: 'pageerror', handler: (err: Error) => void): void
  on(event: 'framenavigated', handler: (frame: FrameLike) => void): void
  route(url: string, handler: (route: RouteLike) => Promise<void> | void): Promise<void>
  mainFrame(): FrameLike
  goto(url: string, opts: { waitUntil: 'load' | 'domcontentloaded'; timeout: number }): Promise<unknown>
  frames(): FrameLike[]
  waitForSelector(selector: string, opts: { timeout: number; state?: 'attached' }): Promise<unknown>
  waitForTimeout(ms: number): Promise<void>
  click(selector: string, opts: { timeout: number }): Promise<void>
  screenshot(opts: ({ type: 'png' } | { type: 'jpeg'; quality: number }) & { fullPage?: boolean }): Promise<Buffer>
  setViewportSize(size: { width: number; height: number }): Promise<void>
  keyboard: { press(key: string): Promise<void> }
}

async function loadPlaywright(): Promise<PlaywrightLike | null> {
  // A variable specifier keeps Turbopack/webpack from bundling or tracing the
  // package: this must resolve at runtime or not at all.
  const specifier = 'playwright'
  try {
    return (await import(/* webpackIgnore: true */ specifier)) as PlaywrightLike
  } catch {
    return null
  }
}

function clip(text: string): string {
  return text.length > MAX_CONSOLE_LINE ? `${text.slice(0, MAX_CONSOLE_LINE)}…` : text
}

/** The locator a step names, inside the Tool's frame. Null when it names nothing. */
function locate(frame: FrameLike, t: StepTarget): LocatorLike | null {
  if (t.role) return frame.getByRole(t.role, t.name ? { name: t.name } : undefined).first()
  if (t.label) return frame.getByLabel(t.label).first()
  if (t.placeholder) return frame.getByPlaceholder(t.placeholder).first()
  if (t.text) return frame.getByText(t.text).first()
  if (t.name) return frame.getByRole('button', { name: t.name }).first()
  return null
}

function describe(t: StepTarget | undefined): string {
  if (!t) return 'the page'
  return t.role ? `${t.role} "${t.name ?? ''}"` : t.label ? `field "${t.label}"` : t.placeholder ? `input "${t.placeholder}"` : `"${t.text ?? t.name ?? ''}"`
}

/** Run one step in the Tool's frame. Returns the reason on failure, null on success. */
async function runStep(page: PageLike, frame: FrameLike, step: ToolStep, timeout: number): Promise<string | null> {
  const need = (t: StepTarget | undefined) => {
    const l = t ? locate(frame, t) : null
    if (!l) throw new Error('the step names no target — give role+name, label, text or placeholder')
    return l
  }
  try {
    switch (step.do) {
      case 'click': await need(step.target).click({ timeout }); break
      case 'hover': await need(step.target).hover({ timeout }); break
      case 'fill': await need(step.target).fill(step.value, { timeout }); break
      case 'choose': {
        // The kit's Select is a combobox that opens the app's menu: press it,
        // then the option by its name. A label names the combobox.
        const t = step.target
        const box = t.label ? frame.getByRole('combobox', { name: t.label }).first() : need(t)
        await box.click({ timeout })
        await frame.getByRole('option', { name: step.value, exact: true }).first().click({ timeout })
        break
      }
      case 'press':
        if (step.target) await need(step.target).press(step.key, { timeout })
        else await page.keyboard.press(step.key)
        break
      case 'scroll':
        if (step.target) await need(step.target).scrollIntoViewIfNeeded({ timeout })
        else await frame.evaluate('(dy) => { (document.scrollingElement || document.body).scrollBy(0, dy); document.body.scrollBy(0, dy) }', step.pixels ?? 600)
        break
      case 'wait': await page.waitForTimeout(Math.min(step.ms, 3000)); break
      // The band is the host page's, so its buttons are pressed there, by the
      // id the Tool declared — quoted, so nothing passed becomes a selector.
      case 'band': await page.click(`[data-tool-action=${JSON.stringify(step.action)}]`, { timeout }); break
    }
    return null
  } catch (err) {
    const message = err instanceof Error ? err.message.split('\n')[0] : String(err)
    return /timeout/i.test(message) ? `${describe('target' in step ? step.target : undefined)} was not found or not actionable in time` : clip(message)
  }
}

/**
 * Render one Tool preview and read back what a person would see. Never
 * throws: a browser that will not launch, a page that never loads, a frame that
 * never mounts all come back as a result an agent can read.
 */
export async function captureToolPreview(req: ScreenshotRequest): Promise<ScreenshotResult> {
  const enabled = screenshotEnabled()
  if (!enabled.ok) return { available: false, reason: enabled.reason }
  const playwright = await loadPlaywright()
  if (!playwright) {
    return {
      available: false,
      reason: 'Playwright is not installed here — `pnpm add -D playwright` and `playwright install chromium` to enable headless previews.',
    }
  }

  const budgetMs = Math.max(2000, req.budgetMs ?? SCREENSHOT_BUDGET_MS)
  const started = Date.now()
  const remaining = () => Math.max(250, budgetMs - (Date.now() - started))
  const wantImage = req.image !== false

  const consoleErrors: string[] = []
  const record = (line: string) => {
    if (consoleErrors.length < MAX_CONSOLE_ERRORS) consoleErrors.push(clip(line))
  }

  let browser: BrowserLike | null = null
  try {
    browser = await playwright.chromium.launch({ headless: true })
    const context = await browser.newContext({
      viewport: { width: SCREENSHOT_WIDTH, height: SCREENSHOT_HEIGHT },
      ignoreHTTPSErrors: true,
    })

    // The caller's own session, exactly as the login flow would set it — the
    // preview then renders under their grants and nobody else's. Imported lazily:
    // lib/session pulls in next/headers, which the tests that import this
    // module's callers (lib/mcp/appTools.ts) have no request scope for.
    const { COOKIE_NAME, createSession } = await import('@/lib/session')
    // Short-lived on purpose: this token exists for one capture and nothing
    // else — see the header. Never the 30-day default.
    const token = await createSession(
      {
        userId: req.viewer.userId,
        name: req.viewer.name,
        email: req.viewer.email,
      },
      { maxAgeSeconds: PREVIEW_SESSION_TTL_S },
    )
    await context.addCookies([{ name: COOKIE_NAME, value: token, url: req.appOrigin, httpOnly: true, sameSite: 'Lax' }])
    // The space switcher remembers its choice in localStorage; seed it so the
    // preview page resolves the right space instead of the user's last one.
    await context.addInitScript(
      `try { localStorage.setItem(${JSON.stringify(CURRENT_SPACE_KEY)}, ${JSON.stringify(req.spaceId)}) } catch {}`,
    )

    const page = await context.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') record(`console.error: ${msg.text()}`)
    })
    page.on('pageerror', (err) => record(`uncaught: ${err.message}`))

    const url = previewPageUrl(req.appOrigin, req.name, req.section, req.spaceId)

    // Pin the top-level document to the preview URL. Only main-frame
    // navigations are judged; every sub-resource, /api/* call and child frame
    // (the Tool's frame on the tools origin included) continues untouched.
    let navigatedAway: string | null = null
    const main = page.mainFrame()
    await page.route('**/*', async (route) => {
      const request = route.request()
      if (request.isNavigationRequest() && request.frame() === main && !previewNavigationAllowed(url, request.url())) {
        navigatedAway = request.url()
        await route.abort('blockedbyclient')
        return
      }
      await route.continue()
    })
    // Belt and braces: an aborted request leaves the page where it was, but a
    // navigation that slipped past the route (a same-document route change, a
    // race with the handler) is caught here.
    page.on('framenavigated', (frame) => {
      if (frame === main && !previewNavigationAllowed(url, frame.url())) navigatedAway = frame.url()
    })

    await page.goto(url, { waitUntil: 'load', timeout: remaining() })

    // Wait for the Tool's frame to appear, then for it to mount something.
    // Both are best-effort within the budget: an unmounted frame is a finding
    // (rendered: false), not a failure of the capture.
    let rendered = false
    let toolFrame: FrameLike | undefined
    try {
      await page.waitForSelector('iframe', { timeout: Math.min(remaining(), 12000), state: 'attached' })
      const frame = page.frames().find((f) => f.url().includes('/api/tools/runtime/frame'))
      toolFrame = frame
      if (frame) {
        await frame.waitForFunction(
          '() => { const r = document.getElementById("root"); return !!r && r.childElementCount > 0 }',
          undefined,
          { timeout: Math.min(remaining(), 8000) },
        )
        rendered = true
        // Then until it settles: the first reads land, spinners go, the text
        // stops changing — a capture taken mid-load shows an empty page the
        // author would then "fix".
        await settle(page, frame, Math.min(remaining() - 1500, SETTLE_MAX_MS))
      }
    } catch {
      rendered = false
    }

    // Press the band button the author named, as a person would, and give the
    // dialog it opens a beat to draw. The selector is built from the id, which
    // is quoted, so nothing the caller passes becomes a selector of its own.
    let actionMissing = false
    if (rendered && req.action) {
      try {
        await page.click(`[data-tool-action=${JSON.stringify(req.action)}]`, { timeout: Math.min(remaining(), 2000) })
        await page.waitForTimeout(Math.min(remaining(), 600))
      } catch {
        actionMissing = true
      }
    }

    let stepOutcomes: StepOutcome[] | undefined
    if (req.steps?.length) {
      stepOutcomes = []
      if (!rendered || !toolFrame) {
        stepOutcomes.push({ step: 0, do: req.steps[0].do, ok: false, error: 'The Tool did not mount, so nothing could be pressed.' })
      } else {
        for (const [i, step] of req.steps.slice(0, MAX_TOOL_STEPS).entries()) {
          const error = await runStep(page, toolFrame, step, Math.min(remaining(), STEP_TIMEOUT_MS))
          stepOutcomes.push({ step: i, do: step.do, ok: error === null, ...(error ? { error } : {}) })
          if (error) break
          await page.waitForTimeout(Math.min(remaining(), STEP_SETTLE_MS))
          if (navigatedAway !== null) break
        }
      }
    }

    let outline: string | undefined
    if (req.outline && rendered && toolFrame) {
      try {
        const text = await toolFrame.locator('body').ariaSnapshot({ timeout: Math.min(remaining(), 2000) })
        outline = text.length > MAX_OUTLINE_CHARS ? `${text.slice(0, MAX_OUTLINE_CHARS)}\n… (cut)` : text
      } catch {
        outline = undefined
      }
    }

    // A Tool taller than its frame scrolls inside it — say so, so an author
    // knows the first screen is not all there is.
    let scrollHeight: number | undefined
    if (rendered && toolFrame) {
      try {
        const h = (await toolFrame.evaluate('() => [document.documentElement.scrollHeight, window.innerHeight]')) as [number, number]
        if (h[0] > h[1] + 1) scrollHeight = h[0]
      } catch {
        scrollHeight = undefined
      }
    }

    // Content wider than the frame is cut off or scrolls sideways — a layout
    // fault the author may not spot in a small capture.
    let horizontalOverflow = false
    if (rendered && toolFrame) {
      try {
        horizontalOverflow = (await toolFrame.evaluate(
          '() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1',
        )) === true
      } catch {
        horizontalOverflow = false
      }
    }

    if (navigatedAway !== null || !previewNavigationAllowed(url, main.url())) {
      return { available: true, navigated_away: true, url: navigatedAway ?? main.url(), console_errors: consoleErrors }
    }

    let image: Buffer | null = null
    let mime: 'image/png' | 'image/jpeg' | null = null
    let capturedHeight = SCREENSHOT_HEIGHT
    if (wantImage && req.fullPage && scrollHeight) {
      // The host grows the frame to the pane, so a taller window is a taller
      // frame: the whole Tool, laid out as a person scrolling would meet it.
      capturedHeight = Math.min(MAX_FULL_PAGE_HEIGHT, SCREENSHOT_HEIGHT + scrollHeight)
      await page.setViewportSize({ width: SCREENSHOT_WIDTH, height: capturedHeight })
      await page.waitForTimeout(Math.min(remaining(), 500))
    }
    if (wantImage) {
      image = await page.screenshot({ type: 'png' })
      mime = 'image/png'
      if (image.byteLength > SCREENSHOT_MAX_BYTES) {
        image = await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY })
        mime = 'image/jpeg'
      }
    }

    return {
      available: true,
      image_base64: image ? image.toString('base64') : null,
      mime,
      width: SCREENSHOT_WIDTH,
      height: capturedHeight,
      rendered,
      console_errors: consoleErrors,
      ...(scrollHeight ? { scroll_height: scrollHeight } : {}),
      ...(stepOutcomes ? { steps: stepOutcomes } : {}),
      ...(outline !== undefined ? { outline } : {}),
      ...(actionMissing ? { action_missing: true } : {}),
      ...(horizontalOverflow ? { horizontal_overflow: true } : {}),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // A missing browser binary is the common first-run failure; say what to do.
    const hint = /executable doesn't exist|browserType.launch/i.test(message)
      ? ' Run `pnpm --filter @visvine/web exec playwright install chromium`.'
      : ''
    return { available: false, reason: `Headless render failed: ${clip(message)}.${hint}` }
  } finally {
    await browser?.close().catch(() => undefined)
  }
}
