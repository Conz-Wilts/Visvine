/**
 * Pure navigation/URL policy for the desktop shell. No Electron imports here so
 * these functions can be unit-tested with plain Node.
 */

export const DEEP_LINK_SCHEME = "visvine-desktop";
/** The web app's session cookie (apps/web/lib/session.ts#COOKIE_NAME). */
export const COOKIE_NAME = "auth_session";
const DESKTOP_UA_TOKEN = "VisvineDesktop";

/** Origins that the sign-in flow legitimately navigates through in-window. */
const AUTH_PROVIDER_HOSTS = new Set([
  "accounts.google.com",
  "accounts.youtube.com",
  "myaccount.google.com",
]);

export type NavigationDecision = "allow" | "external" | "block";

function safeParse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function isSameApp(url: string, appUrl: string): boolean {
  const target = safeParse(url);
  const app = safeParse(appUrl);
  if (!target || !app) return false;
  return target.origin === app.origin;
}

export function isAuthProviderUrl(url: string): boolean {
  const target = safeParse(url);
  if (!target || target.protocol !== "https:") return false;
  return AUTH_PROVIDER_HOSTS.has(target.hostname);
}

/**
 * Decide what a top-level navigation / window.open should do:
 *  - allow    → load inside the shell (the app itself, its auth providers, our
 *               bundled offline page)
 *  - external → hand to the OS default browser / mail client
 *  - block    → drop it (javascript:, data:, unknown schemes)
 */
export function navigationDecision(url: string, appUrl: string): NavigationDecision {
  const target = safeParse(url);
  if (!target) return "block";
  if (target.protocol === "about:" || target.protocol === "file:") return "allow";
  if (isSameApp(url, appUrl) || isAuthProviderUrl(url)) return "allow";
  if (target.protocol === "http:" || target.protocol === "https:") return "external";
  if (target.protocol === "mailto:" || target.protocol === "tel:") return "external";
  return "block";
}

/**
 * Electron's default UA carries `<appName>/<v>` and `Electron/<v>` tokens.
 * Google's OAuth endpoints reject "embedded" user agents (disallowed_useragent),
 * so strip those and append our own token so the web app can still detect us.
 */
export function desktopUserAgent(defaultUa: string, appName: string, version: string): string {
  const escaped = appName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let ua = defaultUa
    .replace(new RegExp(`\\s*${escaped}/\\S+`, "i"), "")
    .replace(/\s*Electron\/\S+/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!ua.includes(`${DESKTOP_UA_TOKEN}/`)) ua = `${ua} ${DESKTOP_UA_TOKEN}/${version}`;
  return ua;
}

/**
 * Map a `visvine-desktop://open/<path>?<query>` deep link (or the shorthand
 * `visvine-desktop://<path>`) onto an in-app path. Returns null when the link
 * cannot be turned into a same-app path.
 */
export function deepLinkToPath(link: string): string | null {
  const target = safeParse(link);
  if (!target || target.protocol !== `${DEEP_LINK_SCHEME}:`) return null;
  // `visvine-desktop://open/directory` parses as host=open, pathname=/directory.
  const host = target.hostname;
  // Backslashes become slashes once resolved against an http(s) base, so
  // `/\\evil.com` would otherwise turn into an authority; normalise them first.
  let path = (target.pathname || "/").replace(/\\/g, "/");
  if (host && host !== "open") path = `/${host}${path === "/" ? "" : path}`;
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/{2,}/g, "/");
  return `${path}${target.search}${target.hash}`;
}

/**
 * Join an in-app path onto the configured app URL. A path that resolves off the
 * app origin (`//host`, an absolute URL) falls back to the app root — callers
 * hand the result to `loadURL`, which no navigation guard sees.
 */
export function appPathUrl(appUrl: string, path: string): string {
  const url = new URL(path, appUrl).toString();
  return isSameApp(url, appUrl) ? url : appUrl;
}

/**
 * The press that hands the person to Google, as opposed to any other page of
 * the app: the shell takes this one over and runs it in the system browser
 * instead (src/auth.ts). Electron has no platform authenticator, so a passkey
 * challenge in-window never resolves — the sign-in PAGE itself still draws
 * here, it is only the hop to the provider that leaves.
 */
export function isAppSignInUrl(url: string, appUrl: string): boolean {
  if (!isSameApp(url, appUrl)) return false;
  const target = safeParse(url);
  if (!target) return false;
  return target.pathname === "/api/auth/signin/google";
}

/** The browser page that begins a desktop sign-in for this challenge. */
export function signInStartUrl(appUrl: string, challenge: string): string {
  const url = new URL(`${appUrl}/api/auth/desktop/start`);
  url.searchParams.set("challenge", challenge);
  return url.toString();
}

/**
 * The handoff carried by `visvine-desktop://auth?handoff=…`, or null when the
 * link is anything else. Read BEFORE `deepLinkToPath`, which would otherwise
 * try to open `/auth` as a page of the app.
 */
export function authHandoffIn(link: string): string | null {
  const target = safeParse(link);
  if (!target || target.protocol !== `${DEEP_LINK_SCHEME}:`) return null;
  if (target.hostname !== "auth") return null;
  const handoff = target.searchParams.get("handoff");
  return handoff && handoff.length > 0 && handoff.length < 4096 ? handoff : null;
}
