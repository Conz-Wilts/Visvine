import { BrowserWindow, net, safeStorage, session, shell } from "electron";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { COOKIE_NAME, authHandoffIn, signInStartUrl } from "./urls";

/**
 * Signing in happens in the SYSTEM BROWSER and comes back over the app's own
 * scheme. Electron reports no platform authenticator
 * (`isUserVerifyingPlatformAuthenticatorAvailable()` is false), so a passkey
 * challenge in-window never resolves — the window sits on "verifying it's
 * you" forever. The browser is also where a saved password, a hardware key and
 * the address bar the person can actually read already are.
 *
 * The exchange is PKCE, and the web half is apps/web/lib/auth/desktopHandoff.ts:
 * the verifier minted here never leaves this process, so the deep link is
 * worthless to anything that intercepts it.
 *
 * What comes back is the ordinary 30-day web session. It is written into the
 * shell's cookie jar — which is what signs the app in — AND kept beside it,
 * encrypted by the OS keychain where there is one, so a cleared jar or a
 * rebuilt profile does not mean signing in again.
 */

const SESSION_FILE = "desktop-session.json";
/** The browser press is good for two minutes (the web half's TTL). */
const FLOW_TTL_MS = 3 * 60 * 1000;

interface StoredSession {
  /** The session JWT, base64 of the keychain's ciphertext when it is available. */
  token: string;
  encrypted: boolean;
  /** Epoch seconds — the cookie's own expiry, so a dead token is never replayed. */
  expiresAt: number;
}

interface PendingFlow {
  verifier: string;
  startedAt: number;
}

let pending: PendingFlow | null = null;

function sessionPath(userData: string): string {
  return path.join(userData, SESSION_FILE);
}

function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Open the browser at the app's desktop sign-in. The verifier stays here; only
 * its hash travels.
 */
export function beginSignIn(appUrl: string): void {
  const verifier = randomBytes(48).toString("base64url");
  pending = { verifier, startedAt: Date.now() };
  void shell.openExternal(signInStartUrl(appUrl, challengeFor(verifier)));
}

/** Write the session cookie the app authenticates with. */
async function applyCookie(appUrl: string, token: string, expiresAt: number): Promise<void> {
  await session.defaultSession.cookies.set({
    url: appUrl,
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: new URL(appUrl).protocol === "https:",
    sameSite: "lax",
    path: "/",
    expirationDate: expiresAt,
  });
  await session.defaultSession.cookies.flushStore();
}

function writeStored(userData: string, token: string, expiresAt: number): void {
  const usable = safeStorage.isEncryptionAvailable();
  const stored: StoredSession = {
    token: usable ? safeStorage.encryptString(token).toString("base64") : token,
    encrypted: usable,
    expiresAt,
  };
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(sessionPath(userData), JSON.stringify(stored), { mode: 0o600 });
}

function readStored(userData: string): { token: string; expiresAt: number } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(sessionPath(userData), "utf8")) as StoredSession;
    if (typeof raw?.token !== "string" || typeof raw?.expiresAt !== "number") return null;
    if (raw.expiresAt * 1000 <= Date.now()) return null;
    const token = raw.encrypted
      ? safeStorage.decryptString(Buffer.from(raw.token, "base64"))
      : raw.token;
    return token ? { token, expiresAt: raw.expiresAt } : null;
  } catch {
    return null;
  }
}

export function forgetStoredSession(userData: string): void {
  fs.rmSync(sessionPath(userData), { force: true });
}

/**
 * Put the kept session back in the jar when the jar has none — a fresh profile,
 * a cleared jar, a Chromium that never flushed. This is what makes the app open
 * signed in every time rather than only usually.
 */
export async function restoreSession(appUrl: string, userData: string): Promise<boolean> {
  const stored = readStored(userData);
  if (!stored) return false;
  const existing = await session.defaultSession.cookies.get({ url: appUrl, name: COOKIE_NAME });
  if (existing.length > 0) return false;
  await applyCookie(appUrl, stored.token, stored.expiresAt);
  return true;
}

/** Keep the jar's session and ours in step — including a sign-out clearing it. */
export function watchSessionCookie(appUrl: string, userData: string): void {
  session.defaultSession.cookies.on("changed", (_event, cookie, _cause, removed) => {
    if (cookie.name !== COOKIE_NAME) return;
    if (removed) {
      // A sign-out (or an expiry) must not be undone by the copy beside it.
      forgetStoredSession(userData);
      return;
    }
    if (!cookie.expirationDate) return;
    writeStored(userData, cookie.value, cookie.expirationDate);
  });
  void appUrl;
}

export type SignInResult = { ok: true } | { ok: false; error: string };

/**
 * Finish a sign-in from `visvine-desktop://auth?handoff=…`. Returns false when
 * the link is not one of ours, so the caller can treat it as an ordinary deep
 * link.
 */
export async function completeSignIn(
  link: string,
  appUrl: string,
  userData: string,
  window: BrowserWindow | null,
): Promise<SignInResult | null> {
  const handoff = authHandoffIn(link);
  if (!handoff) return null;

  const flow = pending;
  pending = null;
  if (!flow || Date.now() - flow.startedAt > FLOW_TTL_MS) {
    return { ok: false, error: "That sign-in took too long. Try again from the app." };
  }

  try {
    const res = await net.fetch(`${appUrl}/api/auth/desktop/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handoff, verifier: flow.verifier }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: body?.error ?? "Sign-in was refused." };
    }
    const body = (await res.json()) as { token?: unknown; maxAgeSeconds?: unknown };
    if (typeof body.token !== "string" || typeof body.maxAgeSeconds !== "number") {
      return { ok: false, error: "Sign-in answered with nothing usable." };
    }
    const expiresAt = Math.floor(Date.now() / 1000) + body.maxAgeSeconds;
    await applyCookie(appUrl, body.token, expiresAt);
    writeStored(userData, body.token, expiresAt);
    if (window && !window.isDestroyed()) void window.loadURL(appUrl);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Sign-in could not reach the app." };
  }
}
