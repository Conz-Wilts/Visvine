/**
 * Signing an agent's machine into a website with a login the space holds.
 *
 * The vault is the connector store: a `website-login` connector is a note with
 * a `login:` block (the page) and an account in its env, the password a
 * `{{secret:…}}` like any other. What this module adds is the one path that
 * password takes to a browser: the control plane decrypts it, hands it to ONE
 * command on the agent's machine as that command's environment, and the
 * command — Playwright, attached to the machine's own browser over CDP — fills
 * the form and submits. The credential is never on the command line (the
 * timeline records that), never on the disk (the workspace is archived), never
 * in the model's context, the trace or a note; the edge scrubs it out of
 * whatever the command prints, and the process is gone in seconds. An agent's
 * tool calls are sequential, so nothing of the agent's runs beside it.
 *
 * The session that results lives in the browser's profile under the
 * workspace, exactly as one a person established during a takeover does — so
 * `open_page` and CDP scripts after this are signed in, and the next wake
 * still is.
 *
 * Who may sign in: whoever may run the connector (it is loaded through the
 * same visibility lens `run_connector` uses), on a machine the space has. The
 * site's host is already on the machine's egress policy because it is one of
 * the connector's hosts — that is why the login lives on a connector.
 */
import { loadConnector, loginCredentialsOf } from '@/lib/connectors/service'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import type { Context } from '@/lib/notes/store'
import { browseOnMachine, runOnMachine } from './lease'

export type SignInResult =
  | { ok: true; url: string; title: string; user: string }
  | { ok: false; reason: 'no_login' | 'no_form' | 'still_signed_out' | 'failed'; message: string; url?: string }

/** The script the machine runs. The account comes in as env; the JSON line out is all it says. */
const SIGN_IN_SCRIPT = `
import { chromium } from '/usr/local/lib/node_modules/playwright/index.mjs'
const url = process.argv[1]
const user = process.env.LOGIN_USER ?? ''
const password = process.env.LOGIN_PASSWORD ?? ''
const say = (o) => { console.log(JSON.stringify(o)); process.exit(0) }
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const context = browser.contexts()[0] ?? (await browser.newContext())
const origin = new URL(url).origin
const page = context.pages().find((p) => p.url().startsWith(origin)) ?? context.pages()[0] ?? (await context.newPage())
await page.bringToFront().catch(() => {})
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
const userSel = 'input[type=email], input[autocomplete=username], input[autocomplete=email], input[name*=user i], input[name*=email i], input[id*=user i], input[id*=email i], input[name*=login i], input[type=text]'
const passSel = 'input[type=password]'
const visible = async (sel) => { const l = page.locator(sel).filter({ visible: true }); return (await l.count()) ? l.first() : null }
let userField = await visible(userSel)
let passField = await visible(passSel)
if (!userField && !passField) say({ ok: false, reason: 'no_form', url: page.url(), title: await page.title() })
if (userField) { await userField.click(); await userField.fill(user) }
// Two-step forms ask for the account first and show the password after.
if (!passField) {
  await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => null), userField.press('Enter')])
  await page.waitForTimeout(1500)
  passField = await visible(passSel)
  if (!passField) say({ ok: false, reason: 'no_form', url: page.url(), title: await page.title() })
}
await passField.click(); await passField.fill(password)
await Promise.all([page.waitForNavigation({ timeout: 20000 }).catch(() => null), passField.press('Enter')])
await page.waitForTimeout(1500)
const stillOut = (await page.locator(passSel).filter({ visible: true }).count()) > 0
say({ ok: !stillOut, reason: stillOut ? 'still_signed_out' : undefined, url: page.url(), title: await page.title() })
`.trim()

/** Sign the agent's machine into the site a connector holds a login for. */
export async function signInOnMachine(input: {
  principal: ContextPrincipal
  context: Context
  spaceId: string
  agentName: string
  connectorName: string
  runId?: string | null
  /** The run's machine reach — the same narrowing its other commands carry. */
  taskAllow?: readonly string[]
}): Promise<SignInResult> {
  const loaded = await loadConnector(input.principal, input.context, input.connectorName)
  if (!loaded) return { ok: false, reason: 'no_login', message: `No connector called ${input.connectorName} here (or it is not visible to you).` }
  const login = await loginCredentialsOf(loaded)
  if (!login) return { ok: false, reason: 'no_login', message: `${input.connectorName} holds no website login — it is not a Website login connector.` }
  if (!login.user || !login.password) return { ok: false, reason: 'no_login', message: `${input.connectorName} has no account set.` }

  // The browser has to be up for CDP to have something to attach to; opening
  // the page here also puts it on screen for whoever is watching.
  await browseOnMachine(input.spaceId, input.agentName, login.url, { taskAllow: input.taskAllow })
  const result = await runOnMachine(
    input.spaceId,
    input.agentName,
    // The page rides the command line — it is not a secret, and the edge
    // scrubs every env value out of the output, URL included. The account is
    // what must never be printed, so the account is what goes in env.
    ['node', '--input-type=module', '-e', SIGN_IN_SCRIPT, login.url],
    {
      timeoutSeconds: 120,
      runId: input.runId ?? null,
      taskAllow: input.taskAllow,
      env: { LOGIN_USER: login.user, LOGIN_PASSWORD: login.password },
    },
  )
  const line = result.stdout.trim().split('\n').filter(Boolean).pop() ?? ''
  interface Said { ok?: boolean; reason?: string; url?: string; title?: string }
  let parsed: Said | null = null
  try {
    parsed = line ? (JSON.parse(line) as Said) : null
  } catch {
    parsed = null
  }
  if (!parsed) {
    return { ok: false, reason: 'failed', message: `The sign-in script did not finish: ${(result.stderr || result.stdout).trim().slice(0, 300) || `exit ${result.exitCode}`}` }
  }
  if (parsed.ok) return { ok: true, url: parsed.url ?? login.url, title: parsed.title ?? '', user: login.user }
  const reason = parsed.reason === 'no_form' ? 'no_form' : parsed.reason === 'still_signed_out' ? 'still_signed_out' : 'failed'
  return {
    ok: false,
    reason,
    url: parsed.url,
    message:
      reason === 'no_form'
        ? `No sign-in form on ${parsed.url ?? login.url} — the page may already be signed in, or the form is not a plain one.`
        : `Submitted the form but ${parsed.url ?? 'the page'} still asks for a password — the account may be wrong, or the site wants a second factor.`,
  }
}
