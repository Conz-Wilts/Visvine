/**
 * The machine's browser.
 *
 * One Chromium, headful, on the machine's display, with its profile under
 * `/workspace/.browser` — which is inside the workspace, so it is archived with
 * everything else and a session a human logged in during a takeover is still
 * there on the next wake. That is the whole point of the browser being here
 * rather than a managed one somewhere else.
 *
 * Started detached and left running: the agent drives it with further commands
 * and a human can take the keyboard at any point. Closing it is a decision, not
 * an accident of a command ending.
 */
import { chromium } from 'playwright'

const PROFILE = process.env.BROWSER_PROFILE ?? '/workspace/.browser'
const WIDTH = Number(process.env.SCREEN_WIDTH ?? 1280)
const HEIGHT = Number(process.env.SCREEN_HEIGHT ?? 800)
const url = process.argv[2] ?? 'about:blank'

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: null,
  args: [
    `--window-size=${WIDTH},${HEIGHT}`,
    '--window-position=0,0',
    '--no-first-run',
    '--no-default-browser-check',
    // The machine has one screen and one browser; a crash bubble on top of it
    // is a dialog nobody can dismiss.
    '--disable-session-crashed-bubble',
    '--disable-features=Translate',
  ],
})

const page = context.pages()[0] ?? (await context.newPage())
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch((error) => {
  // A page that would not load is still a browser a human can steer, so this is
  // reported and not fatal.
  console.error(`could not open ${url}: ${error instanceof Error ? error.message : error}`)
})

console.log(JSON.stringify({ opened: page.url(), title: await page.title().catch(() => '') }))

// Detached: the process holds the browser open for the machine's life, and the
// machine's own idle timer is what eventually stops both.
await new Promise(() => {})
