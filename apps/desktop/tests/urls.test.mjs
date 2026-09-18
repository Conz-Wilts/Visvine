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
    "https://visvine.com/api/auth/desktop/start?challenge=abc-123_x",
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
