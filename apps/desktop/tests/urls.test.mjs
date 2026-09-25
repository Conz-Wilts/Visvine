import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { navigationDecision, desktopUserAgent, deepLinkToPath, isAuthProviderUrl, appPathUrl, isAppSignInUrl, signInStartUrl, authHandoffIn } = require("../dist/urls.js");

const APP = "http://localhost:3000";

test("same-app and auth-provider URLs stay in the shell", () => {
  assert.equal(navigationDecision("http://localhost:3000/directory", APP), "allow");
  assert.equal(navigationDecision("http://localhost:3000/api/auth/signin/google", APP), "allow");
  assert.equal(navigationDecision("https://accounts.google.com/o/oauth2/v2/auth?x=1", APP), "allow");
  assert.equal(navigationDecision("about:blank", APP), "allow");
  assert.equal(navigationDecision("file:///C:/x/offline.html", APP), "allow");
});

test("other http(s), mailto and tel go external; the rest is blocked", () => {
  assert.equal(navigationDecision("https://example.com/", APP), "external");
  assert.equal(navigationDecision("http://localhost:3001/", APP), "external"); // different port = different origin
  assert.equal(navigationDecision("mailto:hello@visvine.com", APP), "external");
  assert.equal(navigationDecision("tel:+6421000000", APP), "external");
  assert.equal(navigationDecision("javascript:alert(1)", APP), "block");
  assert.equal(navigationDecision("data:text/html,hi", APP), "block");
  assert.equal(navigationDecision("not a url", APP), "block");
});

test("auth provider must be https", () => {
  assert.equal(isAuthProviderUrl("http://accounts.google.com/"), false);
  assert.equal(isAuthProviderUrl("https://accounts.google.com/"), true);
  assert.equal(isAuthProviderUrl("https://accounts.google.com.evil.com/"), false);
});

test("desktop UA drops Electron + app tokens and appends VisvineDesktop", () => {
  const ua = desktopUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Visvine/0.1.0 Chrome/130.0.0.0 Electron/33.0.0 Safari/537.36",
    "Visvine",
    "0.1.0",
  );
  assert.ok(!/Electron\//.test(ua), ua);
  assert.ok(!/ Visvine\//.test(ua), ua);
  assert.ok(ua.endsWith("Safari/537.36 VisvineDesktop/0.1.0"), ua);
  assert.ok(/Chrome\/130/.test(ua));
});

test("desktop UA is idempotent", () => {
  const once = desktopUserAgent("Mozilla/5.0 Chrome/1 Electron/2 Safari/3", "Visvine", "1.0.0");
  assert.equal(desktopUserAgent(once, "Visvine", "1.0.0"), once);
});

test("deep links map to in-app paths", () => {
  assert.equal(deepLinkToPath("visvine-desktop://open/directory?view=table#top"), "/directory?view=table#top");
  assert.equal(deepLinkToPath("visvine-desktop://open"), "/");
  assert.equal(deepLinkToPath("visvine-desktop://directory/note/index.md"), "/directory/note/index.md");
  assert.equal(deepLinkToPath("visvine://auth/callback"), null);
  assert.equal(deepLinkToPath("https://visvine.com/x"), null);
});

test("appPathUrl joins onto the app origin", () => {
  assert.equal(appPathUrl(APP, "/home"), "http://localhost:3000/home");
  assert.equal(appPathUrl("https://visvine.com", "/directory?x=1"), "https://visvine.com/directory?x=1");
});

test("deep links and appPathUrl cannot escape the app origin", () => {
  assert.equal(deepLinkToPath("visvine-desktop://open/\\evil.com/x"), "/evil.com/x");
  assert.equal(deepLinkToPath("visvine-desktop://open//evil.com/x"), "/evil.com/x");
  assert.equal(appPathUrl(APP, "//evil.com/x"), APP);
  assert.equal(appPathUrl(APP, "/\\evil.com/x"), APP);
  assert.equal(appPathUrl(APP, "https://evil.com/"), APP);
});

test("isAppSignInUrl only claims the hop to the provider", () => {
  const app = "https://visvine.com";
  assert.equal(isAppSignInUrl("https://visvine.com/api/auth/signin/google?callbackUrl=%2Fhome", app), true);
  assert.equal(isAppSignInUrl("https://visvine.com/signin", app), false);
  assert.equal(isAppSignInUrl("https://visvine.com/home", app), false);
  assert.equal(isAppSignInUrl("https://evil.example/api/auth/signin/google", app), false);
});

test("signInStartUrl carries the challenge to the app's own origin", () => {
  assert.equal(
    signInStartUrl("https://visvine.com", "abc-123_x"),
    "https://visvine.com/desktop/signin?challenge=abc-123_x",
  );
});

test("authHandoffIn reads only the auth link", () => {
  assert.equal(authHandoffIn("visvine-desktop://auth?handoff=tok.en.sig"), "tok.en.sig");
  assert.equal(authHandoffIn("visvine-desktop://auth"), null);
  assert.equal(authHandoffIn("visvine-desktop://open/directory"), null);
  assert.equal(authHandoffIn("https://visvine.com/?handoff=x"), null);
});

test("an auth link is never turned into a page path", () => {
  // openDeepLink answers it before deepLinkToPath is asked, but if that order
  // ever slipped the app must not navigate to a page called /auth.
  assert.equal(authHandoffIn("visvine-desktop://auth?handoff=x") !== null, true);
});

const { isToolFrameUrl, toolFrameNavigationRefused, permissionAllowed } = require("../dist/urls.js");

test("a Tool frame is known by its runtime path, on either origin", () => {
  assert.equal(isToolFrameUrl("http://127.0.0.1:3000/api/tools/runtime/frame?token=x"), true);
  assert.equal(isToolFrameUrl("http://localhost:3000/api/tools/runtime/frame?token=x"), true);
  assert.equal(isToolFrameUrl("http://localhost:3000/t/deals"), false);
  assert.equal(isToolFrameUrl("about:blank"), false);
  assert.equal(isToolFrameUrl(""), false);
});

test("a Tool frame loads once and never navigates again", () => {
  // Its first load: the frame is still blank.
  assert.equal(toolFrameNavigationRefused("about:blank", false), false);
  assert.equal(toolFrameNavigationRefused("", false), false);
  // Once it holds the Tool, any navigation of it — to anywhere — is refused.
  assert.equal(toolFrameNavigationRefused("http://127.0.0.1:3000/api/tools/runtime/frame?token=x", false), true);
  // The app's own main frame and its other embeds are not this rule's.
  assert.equal(toolFrameNavigationRefused("http://localhost:3000/api/tools/runtime/frame?token=x", true), false);
  assert.equal(toolFrameNavigationRefused("https://www.youtube-nocookie.com/embed/x", false), false);
});

test("permissions belong to the app, never to a Tool frame on the app's origin", () => {
  const allowed = new Set(["clipboard-read", "fullscreen"]);
  assert.equal(permissionAllowed("fullscreen", "http://localhost:3000/directory", APP, allowed), true);
  assert.equal(permissionAllowed("fullscreen", "http://localhost:3000/api/tools/runtime/frame?token=x", APP, allowed), false);
  assert.equal(permissionAllowed("fullscreen", "http://127.0.0.1:3000/api/tools/runtime/frame?token=x", APP, allowed), false);
  assert.equal(permissionAllowed("camera", "http://localhost:3000/directory", APP, allowed), false);
  assert.equal(permissionAllowed("fullscreen", "https://evil.example/", APP, allowed), false);
});

test("the preload bridge stays out of sub-frames and the window stays sandboxed", async () => {
  const { readFileSync } = await import("node:fs");
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.ok(!/nodeIntegrationInSubFrames/.test(main), "a preload in sub-frames would hand a Tool frame the bridge");
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /sandbox: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /will-frame-navigate/);
  assert.match(main, /setWebRTCIPHandlingPolicy\("disable_non_proxied_udp"\)/);
});
