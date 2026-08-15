/**
 * Pure navigation/URL policy for the desktop shell. No Electron imports here so
 * these functions can be unit-tested with plain Node.
 */

export const DEEP_LINK_SCHEME = "visvine-desktop";
export const DESKTOP_UA_TOKEN = "VisvineDesktop";

/** Origins that the sign-in flow legitimately navigates through in-window. */
const AUTH_PROVIDER_HOSTS = new Set([
  "accounts.google.com",
  "accounts.youtube.com",
  "myaccount.google.com",
]);

export type NavigationDecision = "allow" | "external" | "block";

export function safeParse(url: string): URL | null {
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
  let path = target.pathname || "/";
  if (host && host !== "open") path = `/${host}${path === "/" ? "" : path}`;
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/{2,}/g, "/");
  return `${path}${target.search}${target.hash}`;
}

/** Join an in-app path onto the configured app URL. */
export function appPathUrl(appUrl: string, path: string): string {
  return new URL(path, appUrl).toString();
}
