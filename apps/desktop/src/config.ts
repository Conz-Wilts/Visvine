import fs from "node:fs";
import path from "node:path";

export const DEV_APP_URL = "http://localhost:3000";
export const PROD_APP_URL = "https://visvine.com";
const SETTINGS_FILE = "desktop-settings.json";

export type DesktopSettings = { appUrl?: string };

export function isDevMode(env: NodeJS.ProcessEnv = process.env, isPackaged = false): boolean {
  if (env.VISVINE_DESKTOP_DEV === "1") return true;
  if (env.VISVINE_DESKTOP_DEV === "0") return false;
  return !isPackaged;
}

export function readSettings(userDataDir: string): DesktopSettings {
  try {
    const raw = fs.readFileSync(path.join(userDataDir, SETTINGS_FILE), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as DesktopSettings) : {};
  } catch {
    return {};
  }
}

export function writeSettings(userDataDir: string, settings: DesktopSettings): void {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(path.join(userDataDir, SETTINGS_FILE), JSON.stringify(settings, null, 2));
}

function normalizeUrl(candidate: string | undefined | null): string | null {
  if (!candidate) return null;
  try {
    const url = new URL(candidate.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // Keep origin + base path only; the shell always starts at the app root.
    return url.origin + (url.pathname === "/" ? "" : url.pathname.replace(/\/$/, ""));
  } catch {
    return null;
  }
}

/**
 * Where the shell should load the app from, in precedence order:
 *   1. `--url=<origin>` CLI flag
 *   2. `VISVINE_DESKTOP_URL` env var
 *   3. persisted user setting (desktop-settings.json in userData)
 *   4. http://localhost:3000 in dev, https://visvine.com when packaged
 */
export function resolveAppUrl(opts: {
  argv: string[];
  env: NodeJS.ProcessEnv;
  settings: DesktopSettings;
  dev: boolean;
}): string {
  const flag = opts.argv.find((a) => a.startsWith("--url="))?.slice("--url=".length);
  return (
    normalizeUrl(flag) ??
    normalizeUrl(opts.env.VISVINE_DESKTOP_URL) ??
    normalizeUrl(opts.settings.appUrl) ??
    (opts.dev ? DEV_APP_URL : PROD_APP_URL)
  );
}
