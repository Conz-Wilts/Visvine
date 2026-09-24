// End-to-end smoke test for the desktop shell, driven by Playwright's Electron
// launcher against the LOCAL web dev server (`pnpm dev` must already be running;
// the script exits 2 with a hint if it isn't).
//
// Covers: window boots → app loads → dev login → authenticated shell renders →
// bridge/UA are exposed → the files bridge is gated → external links leave the shell → the session survives a
// quit → deep links resolve → offline fallback when the server is unreachable.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_URL = process.env.VISVINE_DESKTOP_URL ?? "http://localhost:3000";
const DEAD_URL = "http://127.0.0.1:59999";
const ADMIN_EMAIL = "admin@local.dev";

let failures = 0;
const results = [];
async function step(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push(`  ✓ ${name} (${Date.now() - started}ms)`);
  } catch (err) {
    failures++;
    results.push(`  ✗ ${name}\n      ${String(err?.stack ?? err).split("\n").join("\n      ")}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

async function launch({ url, args = [], userData: reuse }) {
  const userData = reuse ?? fs.mkdtempSync(path.join(os.tmpdir(), "visvine-desktop-e2e-"));
  const app = await electron.launch({
    cwd: root,
    args: [".", ...args],
    env: {
      ...process.env,
      VISVINE_DESKTOP_DEV: "1",
      VISVINE_DESKTOP_URL: url,
      VISVINE_DESKTOP_USER_DATA: userData,
    },
    timeout: 60_000,
  });
  const page = await app.firstWindow({ timeout: 60_000 });
  const visited = [page.url()];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) visited.push(frame.url());
  });
  return { app, page, userData, visited };
}

// Next's dev error overlay lives in a <nextjs-portal> shadow root, so also
// probe it directly — body.innerText alone can miss a server-side crash.
async function assertNoRuntimeError(page, label) {
  const bodyText = await page.locator("body").innerText();
  assert(!/Cannot destructure|Application error|Unhandled Runtime Error|Runtime TypeError/i.test(bodyText), `runtime error text on ${label}`);
  const overlay = await page.evaluate(() => {
    const portal = document.querySelector("nextjs-portal");
    const text = portal?.shadowRoot?.textContent ?? "";
    return /Runtime (Type)?Error|Server Error|Unhandled Runtime Error/i.test(text) ? text.slice(0, 300) : null;
  });
  assert(!overlay, `Next error overlay on ${label}: ${overlay}`);
  const main = await page.locator("main, [role=main]").count();
  assert(main > 0, `no <main> content on ${label}`);
}

async function serverUp(url) {
  try {
    const res = await fetch(url, { redirect: "manual" });
    return res.status > 0;
  } catch {
    return false;
  }
}

if (!(await serverUp(APP_URL))) {
  console.error(`[desktop e2e] web server not reachable at ${APP_URL} — start it with \`pnpm dev\` first.`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Main flow against the live dev server
// ---------------------------------------------------------------------------
{
  const { app, page } = await launch({ url: APP_URL });
  try {
    await step("window opens and loads the app origin", async () => {
      await page.waitForLoadState("domcontentloaded", { timeout: 60_000 });
      const url = page.url();
      assert(url.startsWith(APP_URL), `expected ${APP_URL}, got ${url}`);
      // Next streams <title> after the first chunk; wait for it rather than sampling once.
      await page.waitForFunction(() => document.title.length > 0, null, { timeout: 15_000 });
    });

    await step("preload bridge + desktop user agent are present", async () => {
      const info = await page.evaluate(() => ({
        bridge: window.visvineDesktop,
        ua: navigator.userAgent,
      }));
      assert(info.bridge?.isDesktop === true, `bridge missing: ${JSON.stringify(info.bridge)}`);
      assert(typeof info.bridge.version === "string" && info.bridge.version !== "0.0.0", `version not wired: ${info.bridge.version}`);
      assert(/VisvineDesktop\//.test(info.ua), `UA lacks VisvineDesktop token: ${info.ua}`);
      assert(!/Electron\//.test(info.ua), `UA still advertises Electron: ${info.ua}`);
    });

    await step("protected route bounces to sign-in while logged out", async () => {
      await page.goto(`${APP_URL}/home`, { waitUntil: "domcontentloaded" });
      // The web app answers /signin, which then lands on the marketing home
      // with ?signin=1 (sign-in modal). Either shape means "not authenticated".
      const u = new URL(page.url());
      const onSignin = u.pathname === "/signin" || u.searchParams.get("signin") === "1";
      assert(onSignin, `expected a sign-in surface, got ${page.url()}`);
    });

    await step("dev login as admin@local.dev lands on an authenticated page", async () => {
      await page.goto(`${APP_URL}/dev/login?callbackUrl=%2Fhome`, { waitUntil: "domcontentloaded" });
      const button = page.locator("form button", { hasText: ADMIN_EMAIL });
      await button.first().waitFor({ timeout: 30_000 });
      await Promise.all([
        page.waitForURL((u) => !u.pathname.startsWith("/dev") && !u.pathname.startsWith("/api"), { timeout: 60_000 }),
        button.first().click(),
      ]);
      await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
      const landed = new URL(page.url());
      assert(landed.pathname !== "/signin" && landed.searchParams.get("signin") !== "1", `still on signin: ${page.url()}`);
      const cookies = await page.context().cookies(APP_URL);
      assert(cookies.some((c) => c.name === "auth_session"), "auth_session cookie not set in the shell session");
    });

    await step("authenticated shell renders (nav + main content)", async () => {
      await page.goto(`${APP_URL}/home`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
      // /home may forward to the space's landing surface (e.g. /directory);
      // what matters is that we stayed on the app origin and off the sign-in wall.
      const landed = new URL(page.url());
      assert(landed.origin === new URL(APP_URL).origin, `left the app origin: ${page.url()}`);
      assert(landed.pathname !== "/signin" && landed.searchParams.get("signin") !== "1", `bounced to sign-in: ${page.url()}`);
      const hasNav = await page.locator("nav, aside, [role=navigation]").count();
      assert(hasNav > 0, "no navigation chrome found on /home");
      await assertNoRuntimeError(page, "/home");
    });

    await step("directory page loads inside the shell", async () => {
      await page.goto(`${APP_URL}/directory`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
      // A page inside a space is addressed under it: /s/<space>/directory.
      const { pathname } = new URL(page.url());
      assert(/^(\/s\/[^/]+)?\/directory/.test(pathname), `expected /directory, got ${page.url()}`);
      const bodyText = await page.locator("body").innerText();
      assert(bodyText.trim().length > 0, "directory rendered empty");
      await assertNoRuntimeError(page, "/directory");
    });

    // Opening natively goes through the main process with the window's own
    // session. A path-shaped id is refused before any fetch; an id the server
    // does not know is asked of the gated door and answered as not available —
    // so the check proves the bridge, the gate and the signed-in fetch without
    // opening an app on the machine running it.
    await step("files bridge refuses a bad id and asks the server for a real-shaped one", async () => {
      const [refused, missing] = await page.evaluate(async () => [
        await window.visvineDesktop.files.open("../../etc/passwd"),
        await window.visvineDesktop.files.open("00000000-0000-4000-8000-000000000000"),
      ]);
      assert(refused.ok === false && refused.error === "Refused.", `bad id not refused: ${JSON.stringify(refused)}`);
      assert(missing.ok === false && /not available/.test(missing.error), `unknown id not a 404: ${JSON.stringify(missing)}`);
    });

    await step("external links open in the system browser, not the shell", async () => {
      await app.evaluate(({ shell }) => {
        globalThis.__opened = [];
        shell.openExternal = async (u) => {
          globalThis.__opened.push(u);
        };
      });
      await page.evaluate(() => window.open("https://example.com/from-window-open", "_blank"));
      // Anchor-driven top-level navigation off-origin must also be intercepted.
      await page.evaluate(() => {
        const a = document.createElement("a");
        a.href = "https://example.com/from-anchor";
        a.textContent = "x";
        document.body.appendChild(a);
        a.click();
      });
      await page.waitForTimeout(750);
      const opened = await app.evaluate(() => globalThis.__opened);
      assert(opened.includes("https://example.com/from-window-open"), `window.open not routed externally: ${JSON.stringify(opened)}`);
      assert(opened.includes("https://example.com/from-anchor"), `anchor nav not routed externally: ${JSON.stringify(opened)}`);
      // The web app may itself route between features meanwhile; what matters is
      // that the shell never left the app origin.
      assert(page.url().startsWith(APP_URL), `shell navigated away: ${page.url()}`);
      const windows = app.windows().length;
      assert(windows === 1, `expected 1 window, found ${windows}`);
    });

    await step("server-side redirects off-origin are handed to the system browser", async () => {
      // Intercept a same-origin URL and answer with a 30x to another origin —
      // the shape of the MCP OAuth consent hop. Must NOT load in the shell.
      await page.route("**/__desktop-e2e-redirect", (route) =>
        route.fulfill({ status: 302, headers: { location: "https://example.com/from-redirect" } }),
      );
      await app.evaluate(({ shell }) => {
        globalThis.__opened = [];
      });
      const before = page.url();
      await page.evaluate((u) => {
        location.href = u;
      }, `${APP_URL}/__desktop-e2e-redirect`);
      await page.waitForTimeout(1000);
      const opened = await app.evaluate(() => globalThis.__opened);
      assert(opened.includes("https://example.com/from-redirect"), `redirect not routed externally: ${JSON.stringify(opened)}`);
      assert(!page.url().startsWith("https://example.com"), `shell followed the redirect: ${page.url()}`);
      await page.unroute("**/__desktop-e2e-redirect");
      if (page.url() !== before) await page.goto(before, { waitUntil: "domcontentloaded" });
    });

    await step("window state is persisted to userData", async () => {
      // Persistence is debounced (250ms) behind resize/move; nudge the window
      // and give it a moment.
      await app.evaluate(({ BrowserWindow }) => {
        const [w] = BrowserWindow.getAllWindows();
        const b = w.getBounds();
        w.setBounds({ ...b, width: b.width + 1 });
      });
      await page.waitForTimeout(1000);
      const userData = await app.evaluate(({ app: a }) => a.getPath("userData"));
      const stateFile = path.join(userData, "window-state.json");
      assert(fs.existsSync(stateFile), `missing ${stateFile}`);
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      assert(state.width > 0 && state.height > 0, `bad state ${JSON.stringify(state)}`);
    });
  } finally {
    await app.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// The session survives a quit (Chromium flushes its cookie jar on the way out)
// ---------------------------------------------------------------------------
{
  let userData = null;
  {
    const { app, page, userData: dir } = await launch({ url: APP_URL });
    userData = dir;
    try {
      await step("sign in, then quit the app", async () => {
        await page.goto(`${APP_URL}/dev/login?callbackUrl=%2Fhome`, { waitUntil: "domcontentloaded" });
        const button = page.locator("form button", { hasText: ADMIN_EMAIL });
        await button.first().waitFor({ timeout: 30_000 });
        await Promise.all([
          page.waitForURL((u) => !u.pathname.startsWith("/dev") && !u.pathname.startsWith("/api"), { timeout: 60_000 }),
          button.first().click(),
        ]);
        const cookies = await page.context().cookies(APP_URL);
        assert(cookies.some((c) => c.name === "auth_session"), "auth_session cookie not set");
      });
    } finally {
      await app.close().catch(() => {});
    }
  }
  {
    const { app, page } = await launch({ url: APP_URL, userData });
    try {
      await step("relaunching the same profile is still signed in", async () => {
        await page.waitForLoadState("domcontentloaded", { timeout: 60_000 });
        await page.goto(`${APP_URL}/home`, { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
        const landed = new URL(page.url());
        assert(
          landed.pathname !== "/signin" && landed.searchParams.get("signin") !== "1",
          `signed out after restart: ${page.url()}`,
        );
      });
    } finally {
      await app.close().catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Deep link on cold start (fresh session → protected path → signin w/ callback)
// ---------------------------------------------------------------------------
{
  const { app, page, visited } = await launch({ url: APP_URL, args: ["visvine-desktop://open/directory"] });
  try {
    await step("cold-start deep link targets /directory (bounced to sign-in with callbackUrl=/directory)", async () => {
      await page.waitForLoadState("domcontentloaded", { timeout: 60_000 });
      const deadline = Date.now() + 30_000;
      const hit = () =>
        visited.some((v) => {
          try {
            const u = new URL(v);
            return u.pathname.startsWith("/directory") || u.searchParams.get("callbackUrl") === "/directory";
          } catch {
            return false;
          }
        });
      while (!hit() && Date.now() < deadline) await page.waitForTimeout(250);
      assert(hit(), `deep link not honoured; visited: ${JSON.stringify(visited)}`);
    });
  } finally {
    await app.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Offline fallback
// ---------------------------------------------------------------------------
{
  const { app, page } = await launch({ url: DEAD_URL });
  try {
    await step("unreachable server shows the offline page with the target URL", async () => {
      await page.waitForSelector("[data-testid=offline]", { timeout: 30_000 });
      const shown = await page.locator("#url").innerText();
      assert(shown === DEAD_URL, `offline page shows ${shown}`);
    });
  } finally {
    await app.close().catch(() => {});
  }
}

console.log(`\nVisvine desktop e2e against ${APP_URL}\n${results.join("\n")}\n`);
if (failures) {
  console.error(`${failures} step(s) failed`);
  process.exit(1);
}
console.log("all steps passed");
