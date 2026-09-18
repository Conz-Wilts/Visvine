import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, screen, session, shell, type WebContents } from "electron";
import path from "node:path";
import { isDevMode, readSettings, resolveAppUrl } from "./config";
import { buildMenu } from "./menu";
import { WINDOW_BACKGROUND, WINDOW_THEME } from "./theme";
import {
  appPathUrl,
  deepLinkToPath,
  DEEP_LINK_SCHEME,
  desktopUserAgent,
  isAppSignInUrl,
  isAuthProviderUrl,
  isSameApp,
  navigationDecision,
} from "./urls";
import { beginSignIn, completeSignIn, restoreSession, watchSessionCookie } from "./auth";
import { loadWindowState, saveWindowState } from "./window-state";
import { cancelRun, isRuntimeId, listRuntimes, loginRuntime, startRun, type RunInput } from "./runtimes";

const APP_NAME = "Visvine";
const OFFLINE_PAGE = path.join(__dirname, "..", "resources", "offline.html");
const SERVER_POLL_MS = 2500;
const COOKIE_FLUSH_MS = 750;
const ALLOWED_PERMISSIONS = new Set(["clipboard-read", "clipboard-sanitized-write", "fullscreen"]);

app.setName(APP_NAME);
if (process.env.VISVINE_DESKTOP_USER_DATA) {
  app.setPath("userData", process.env.VISVINE_DESKTOP_USER_DATA);
}

const dev = isDevMode(process.env, app.isPackaged);
const userData = app.getPath("userData");
const appUrl = resolveAppUrl({ argv: process.argv, env: process.env, settings: readSettings(userData), dev });

let mainWindow: BrowserWindow | null = null;
let pendingDeepLink: string | null = null;
let offlinePoll: NodeJS.Timeout | null = null;

// ---------------------------------------------------------------------------
// Deep links (visvine-desktop://open/<path>)
// ---------------------------------------------------------------------------

const deepLinkIn = (argv: string[]) => argv.find((a) => a.startsWith(`${DEEP_LINK_SCHEME}://`));
const authLink = (link: string) => link.startsWith(`${DEEP_LINK_SCHEME}://auth`);

function openDeepLink(link: string) {
  // A sign-in coming back from the browser is not a page of the app; it is
  // answered here and never navigated to (src/auth.ts).
  void completeSignIn(link, appUrl, userData, mainWindow).then((result) => {
    if (!result || result.ok) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      void dialog.showMessageBox(mainWindow, { type: "warning", message: "Sign-in did not finish", detail: result.error });
    }
  });
  if (authLink(link)) return;
  const target = deepLinkToPath(link);
  if (!target) return;
  if (mainWindow) void mainWindow.loadURL(appPathUrl(appUrl, target));
  else pendingDeepLink = target;
}

function startUrl(): string {
  const target = pendingDeepLink;
  pendingDeepLink = null;
  return target ? appPathUrl(appUrl, target) : appUrl;
}

// ---------------------------------------------------------------------------
// Offline fallback
// ---------------------------------------------------------------------------

async function serverReachable(): Promise<boolean> {
  try {
    // Follow redirects: with `redirect: "manual"` a 30x comes back as an opaque
    // response with status 0 and a server whose "/" forwards (signed-in → /home)
    // would read as offline forever. Any HTTP answer at all means it is up.
    const res = await net.fetch(appUrl, { method: "HEAD", redirect: "follow", cache: "no-store" });
    return res.status > 0;
  } catch {
    return false;
  }
}

function stopOfflinePoll() {
  if (offlinePoll) clearInterval(offlinePoll);
  offlinePoll = null;
}

function showOffline(win: BrowserWindow) {
  void win.loadFile(OFFLINE_PAGE, { query: { url: appUrl } });
  stopOfflinePoll();
  offlinePoll = setInterval(() => {
    void serverReachable().then((up) => {
      if (!up || win.isDestroyed()) return;
      stopOfflinePoll();
      void win.loadURL(startUrl());
    });
  }, SERVER_POLL_MS);
}

// ---------------------------------------------------------------------------
// Staying signed in
// ---------------------------------------------------------------------------

/**
 * Keeps the session cookie across restarts. The web session is a 30-day
 * persistent cookie, but Chromium writes its jar to disk lazily — sign in and
 * quit within the same minute and the cookie was only ever in memory, so the
 * next launch lands on the sign-in wall. Flush shortly after any persistent
 * cookie changes, and again on the way out.
 *
 * Only persistent cookies are worth a flush: a session cookie is not written to
 * disk at all, so flushing for one is pure I/O.
 */
function keepSessionOnDisk() {
  const cookies = session.defaultSession.cookies;
  let flushTimer: NodeJS.Timeout | null = null;
  const flush = () => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    void cookies.flushStore();
  };
  cookies.on("changed", (_event, cookie) => {
    if (cookie.session) return;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, COOKIE_FLUSH_MS);
  });
  // `before-quit` cannot be awaited, so this is a best-effort last chance; the
  // debounced flush above is what actually makes the session durable.
  app.on("before-quit", flush);
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

/**
 * Same navigation policy for every WebContents the shell owns (main window and
 * any auth popup): same-app + auth providers stay in, other http(s)/mailto go
 * to the OS, the rest is dropped. `will-redirect` matters as much as
 * `will-navigate` — a server-side 30x to another origin (the MCP OAuth consent
 * flow legitimately does this) would otherwise load that origin in-window.
 */
function applyNavigationPolicy(contents: WebContents) {
  const guard = (event: Electron.Event, url: string) => {
    // The app's own sign-in leaves for the system browser and comes back over
    // the deep link: Electron has no platform authenticator, so a passkey
    // challenge in-window never resolves.
    if (isAppSignInUrl(url, appUrl)) {
      event.preventDefault();
      beginSignIn(appUrl);
      return;
    }
    const decision = navigationDecision(url, appUrl);
    if (decision === "allow") return;
    event.preventDefault();
    if (decision === "external") void shell.openExternal(url);
  };
  contents.on("will-navigate", guard);
  contents.on("will-redirect", guard);
  contents.setWindowOpenHandler(({ url }) => {
    if (isAppSignInUrl(url, appUrl)) {
      beginSignIn(appUrl);
      return { action: "deny" };
    }
    const decision = navigationDecision(url, appUrl);
    if (decision === "external") void shell.openExternal(url);
    else if (isSameApp(url, appUrl)) void contents.loadURL(url);
    // Only an auth provider may open as a child window; it inherits this policy
    // via did-create-window. about:/file: popups have no business in the shell.
    else if (isAuthProviderUrl(url)) return { action: "allow" };
    return { action: "deny" };
  });
  contents.on("did-create-window", (child) => applyNavigationPolicy(child.webContents));
}

/** Drop saved coordinates that no longer land on a connected display. */
function onScreen(state: { x?: number; y?: number; width: number; height: number }) {
  if (state.x === undefined || state.y === undefined) return false;
  const bounds = { x: state.x, y: state.y, width: state.width, height: state.height };
  const display = screen.getDisplayMatching(bounds).workArea;
  const visibleX = state.x + 100 <= display.x + display.width && state.x + state.width - 100 >= display.x;
  const visibleY = state.y + 40 <= display.y + display.height && state.y >= display.y - 10;
  return visibleX && visibleY;
}

function createWindow(): BrowserWindow {
  const saved = loadWindowState(userData);
  const state = onScreen(saved) ? saved : { ...saved, x: undefined, y: undefined };
  const win = new BrowserWindow({
    title: APP_NAME,
    // macOS: no title bar of its own. The app's own top band runs to the top
    // of the window, so the frame draws neither the app's name nor a hairline
    // across it — only the traffic lights, dropped into the rail's top strip
    // (reserved by the web shell: features/desktop/lib/chrome.ts).
    //
    // 14/14 stands the group Slack's way: 14pt of air above and either side
    // of it, over a rail the web shell widens to 14 + 60 + 14 = 88 so every
    // glyph's centre falls under the middle light.
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 14, y: 14 } }
      : {}),
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: WINDOW_BACKGROUND,
    autoHideMenuBar: process.platform !== "darwin",
    icon: path.join(__dirname, "..", "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
      additionalArguments: [`--visvine-desktop-version=${app.getVersion()}`],
    },
  });
  if (state.isMaximized) win.maximize();
  win.once("ready-to-show", () => win.show());

  const persist = () => {
    if (!win.isDestroyed()) saveWindowState(userData, { ...win.getNormalBounds(), isMaximized: win.isMaximized() });
  };
  // resize/move fire per pixel — coalesce; close persists synchronously.
  let persistTimer: NodeJS.Timeout | null = null;
  const persistSoon = () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, 250);
  };
  win.on("resize", persistSoon);
  win.on("move", persistSoon);
  win.on("close", () => {
    if (persistTimer) clearTimeout(persistTimer);
    persist();
  });

  applyNavigationPolicy(win.webContents);

  // The app is loaded optimistically; an unreachable server surfaces here.
  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
    // -3 = ERR_ABORTED (navigation superseded) — not a real failure.
    if (isMainFrame && code !== -3 && isSameApp(url, appUrl)) showOffline(win);
  });
  win.on("closed", () => {
    stopOfflinePoll();
    mainWindow = null;
  });
  return win;
}

// ---------------------------------------------------------------------------
// Local runtimes (the member's own Claude / ChatGPT plan)
// ---------------------------------------------------------------------------

/**
 * The bridge the web app reaches the runtimes through (src/runtimes). Only
 * the app itself may call it: a request from any other origin — an auth
 * provider page, the offline page — is refused before it is looked at, so
 * nothing loaded in the shell but Visvine can spawn a process here.
 */
function fromApp(event: Electron.IpcMainInvokeEvent): boolean {
  return isSameApp(event.senderFrame?.url ?? event.sender.getURL(), appUrl);
}

function registerRuntimeIpc() {
  ipcMain.handle("runtimes:list", (event) => (fromApp(event) ? listRuntimes() : []));
  ipcMain.handle("runtimes:login", (event, id: unknown) => {
    if (!fromApp(event) || !isRuntimeId(id)) return { ok: false, detail: "Refused." };
    return loginRuntime(id);
  });
  ipcMain.handle("runtimes:run", (event, raw: unknown) => {
    if (!fromApp(event)) return { error: "Refused." };
    const input = raw as Partial<RunInput> | null;
    if (!input || !isRuntimeId(input.runtime) || typeof input.prompt !== "string" || !input.prompt.trim()) return { error: "A runtime and a prompt are required." };
    const mcp = input.mcp && typeof input.mcp.url === "string" && isSameApp(input.mcp.url, appUrl) && /^[a-z][a-z0-9_-]{0,31}$/i.test(String(input.mcp.name)) ? { name: String(input.mcp.name), url: input.mcp.url } : null;
    const sender = event.sender;
    const started = startRun(
      { runtime: input.runtime, prompt: input.prompt, mcp, maxTurns: typeof input.maxTurns === "number" ? Math.min(50, Math.max(1, Math.floor(input.maxTurns))) : undefined },
      (runId, e) => {
        if (!sender.isDestroyed()) sender.send("runtimes:event", { runId, event: e });
      },
    );
    return "error" in started ? { error: started.error } : { runId: started.runId };
  });
  ipcMain.handle("runtimes:cancel", (event, runId: unknown) => fromApp(event) && typeof runId === "string" && cancelRun(runId));
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

// If another instance already owns this profile, hand it our argv (deep link)
// and leave. Everything below is skipped so we never race it to a window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const link = deepLinkIn(argv);
    if (link) openDeepLink(link);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    openDeepLink(url);
  });
  if (dev && process.platform === "win32" && process.defaultApp) {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  }

  app.userAgentFallback = desktopUserAgent(app.userAgentFallback, app.name, app.getVersion());

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  // Renderer crash → reload the shell rather than leaving a blank window.
  app.on("render-process-gone", (_e, _wc, details) => {
    if (details.reason !== "clean-exit" && mainWindow && !mainWindow.isDestroyed()) {
      void mainWindow.loadURL(appUrl);
    }
  });

  void app.whenReady().then(() => {
    // The frame follows the app's theme, never the OS appearance: a dark
    // system setting must not put a dark title bar around a light page.
    nativeTheme.themeSource = WINDOW_THEME;
    // macOS takes the Dock icon from the bundle, and ignores BrowserWindow's
    // `icon` entirely. Packaged, that bundle is ours (electron-builder's
    // icon.icns); run from source it is Electron's own, so the mark is set by
    // hand — otherwise the Dock and Cmd-Tab show the default Electron atom.
    if (process.platform === "darwin" && !app.isPackaged) {
      app.dock?.setIcon(path.join(__dirname, "..", "assets", "icon-mac.png"));
    }
    // Only the app itself may hold a permission; auth-provider pages and the
    // offline page get nothing. Checks and requests answer from the same list.
    const permitted = (permission: string, origin: string) =>
      ALLOWED_PERMISSIONS.has(permission) && isSameApp(origin, appUrl);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
      callback(permitted(permission, details.requestingUrl));
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => permitted(permission, origin));

    keepSessionOnDisk();

    Menu.setApplicationMenu(buildMenu({ appUrl, getWindow: () => mainWindow }));
    registerRuntimeIpc();

    watchSessionCookie(appUrl, userData);

    const initialLink = deepLinkIn(process.argv);
    if (initialLink && !authLink(initialLink)) pendingDeepLink = deepLinkToPath(initialLink);

    mainWindow = createWindow();
    // The session the app was last signed in with goes back into the jar before
    // the first page asks for it — otherwise a cleared jar means signing in
    // again, in a window that cannot run a passkey.
    void restoreSession(appUrl, userData).finally(() => {
      if (mainWindow && !mainWindow.isDestroyed()) void mainWindow.loadURL(startUrl());
      if (initialLink && authLink(initialLink)) openDeepLink(initialLink);
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
        void mainWindow.loadURL(startUrl());
      }
    });
  });
}
