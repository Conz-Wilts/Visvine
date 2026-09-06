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
 *
 * It listens for DevTools on loopback (CDP_PORT, 9222), which is how the agent
 * READS what it opened: a run_command script does
 * `chromium.connectOverCDP('http://127.0.0.1:9222')` and gets THIS browser —
 * the logged-in profile, the rendered DOM, the page a human left it on. A
 * second Playwright launch cannot do that: the profile is locked by this
 * process, and a fresh one would be a different browser with no session. The
 * port is loopback-only and never routed: the container's egress goes through
 * the edge's outbound handler, which refuses localhost outright (PLATFORM_DENY),
 * so nothing outside the machine can reach it.
 *
 * Chromium is started as a plain process rather than through Playwright's
 * launcher: the launcher talks to it over a pipe and drops the port flag, so
 * a browser launched that way listens for nobody. This script attaches to the
 * one it started the same way every later command does — over CDP — which is
 * also what proves the port is up before anything else is told it is.
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PROFILE = process.env.BROWSER_PROFILE ?? '/workspace/.browser'
const WIDTH = Number(process.env.SCREEN_WIDTH ?? 1280)
const HEIGHT = Number(process.env.SCREEN_HEIGHT ?? 800)
const url = process.argv[2] ?? 'about:blank'
const CDP_PORT = Number(process.env.CDP_PORT ?? 9222)
const CDP = `http://127.0.0.1:${CDP_PORT}`

const child = spawn(
  chromium.executablePath(),
  [
    `--remote-debugging-port=${CDP_PORT}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${PROFILE}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    '--window-position=0,0',
    '--no-first-run',
    '--no-default-browser-check',
    // Not root, but no user namespaces in this container either.
    '--no-sandbox',
    // Flags Playwright's launcher adds for a container: there is no /dev/shm
    // here, and a crash reporter would only ever write somewhere it cannot.
    '--disable-dev-shm-usage',
    '--disable-breakpad',
    // An automated browser: no "save password?" bubble over a form sign_in
    // just filled, no keyring, no infobars over the page a person is watching.
    '--enable-automation',
    '--password-store=basic',
    '--disable-infobars',
    // The machine has one screen and one browser; a crash bubble on top of it
    // is a dialog nobody can dismiss.
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    '--disable-features=Translate,PasswordManagerOnboarding,PasswordLeakDetection,AutofillServerCommunication',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'], env: process.env },
)
child.stderr.on('data', (d) => process.stderr.write(d))
child.on('exit', (code) => {
  console.error(`chromium exited (${code})`)
  process.exit(code ?? 1)
})

// Wait for DevTools to answer — that is the moment the browser exists for
// every later command.
const deadline = Date.now() + 30_000
let ready = false
while (Date.now() < deadline && !ready) {
  ready = await fetch(`${CDP}/json/version`).then((r) => r.ok).catch(() => false)
  if (!ready) await new Promise((r) => setTimeout(r, 250))
}
if (!ready) {
  console.error('chromium did not open its DevTools port')
  process.exit(1)
}

const browser = await chromium.connectOverCDP(CDP)
const context = browser.contexts()[0] ?? (await browser.newContext())
const page = context.pages()[0] ?? (await context.newPage())
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch((error) => {
  // A page that would not load is still a browser a human can steer, so this is
  // reported and not fatal.
  console.error(`could not open ${url}: ${error instanceof Error ? error.message : error}`)
})

console.log(JSON.stringify({ opened: page.url(), title: await page.title().catch(() => ''), cdp: CDP }))

// Detached: this process holds the browser open for the machine's life, and
// the machine's own idle timer is what eventually stops both. The CDP client
// is let go so later commands are the only ones attached.
await browser.close().catch(() => {})
await new Promise(() => {})
