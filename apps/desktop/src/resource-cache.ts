import fs from "node:fs";
import path from "node:path";

/**
 * Where a resource opened in the computer's own app lives on disk:
 * `<userData>/resource-cache/<id>/<name>`. Pure over its inputs apart from the
 * directory walk, so the checks that keep a download inside the cache — a
 * resource id is a UUID, a name is one path segment — are tested without
 * Electron. The renderer only ever names an id; every path is built here.
 */

export const CACHE_DIR = "resource-cache";
/** What the cache may hold before the least recently used files go. */
export const CACHE_BUDGET_BYTES = 1024 * 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isResourceId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/**
 * A file name safe to be one path segment on every OS: no separators, no
 * control or reserved characters, no leading dots, not a device name, and not
 * longer than a file system takes. What is left is the name the person sees in
 * their app's title bar, so it keeps its extension.
 */
export function safeFileName(raw: string | null | undefined, fallback: string): string {
  let name = (raw ?? "").normalize("NFC").replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_").trim();
  name = name.replace(/^\.+/, "").replace(/[. ]+$/, "");
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(name)) name = `_${name}`;
  if (!name) name = fallback;
  if (Buffer.byteLength(name) > 200) {
    const ext = path.extname(name).slice(0, 16);
    let stem = name.slice(0, name.length - ext.length);
    while (Buffer.byteLength(stem + ext) > 200) stem = stem.slice(0, -1);
    name = stem + ext;
  }
  return name;
}

/** The name a download carries in its Content-Disposition, if any. */
export function dispositionFileName(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* fall through to the plain form */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(header);
  return plain ? plain[1].trim() : null;
}

/**
 * The file for a resource, asserted to sit inside the cache. Throws on an id
 * that is not a UUID or a path that resolves anywhere else — the second can
 * only happen if the first check were wrong, which is exactly when it matters.
 */
export function cachePathFor(userData: string, resourceId: string, name: string): string {
  if (!isResourceId(resourceId)) throw new Error("Not a resource id");
  const root = path.resolve(userData, CACHE_DIR);
  const file = path.resolve(root, resourceId.toLowerCase(), safeFileName(name, resourceId));
  if (path.dirname(path.dirname(file)) !== root) throw new Error("Path escapes the cache");
  return file;
}

export interface CacheEntry {
  dir: string;
  bytes: number;
  usedMs: number;
}

/** Which entries go, oldest use first, until what stays fits the budget. Pure. */
export function evictions(entries: CacheEntry[], budget: number): string[] {
  let total = entries.reduce((sum, e) => sum + e.bytes, 0);
  const out: string[] = [];
  for (const entry of [...entries].sort((a, b) => a.usedMs - b.usedMs)) {
    if (total <= budget) break;
    out.push(entry.dir);
    total -= entry.bytes;
  }
  return out;
}

/** The cache's entries: one per resource folder, sized, with when it was last opened. */
export function cacheEntries(userData: string): CacheEntry[] {
  const root = path.join(userData, CACHE_DIR);
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const entries: CacheEntry[] = [];
  for (const dir of dirs) {
    if (!dir.isDirectory() || !isResourceId(dir.name)) continue;
    const full = path.join(root, dir.name);
    let bytes = 0;
    let usedMs = 0;
    for (const file of fs.readdirSync(full)) {
      const stat = fs.statSync(path.join(full, file));
      bytes += stat.size;
      usedMs = Math.max(usedMs, stat.mtimeMs);
    }
    entries.push({ dir: full, bytes, usedMs });
  }
  return entries;
}

/** Keep the cache under its budget, the least recently opened going first. */
export function pruneCache(userData: string, budget = CACHE_BUDGET_BYTES): void {
  for (const dir of evictions(cacheEntries(userData), budget)) fs.rmSync(dir, { recursive: true, force: true });
}

export function clearCache(userData: string): void {
  fs.rmSync(path.join(userData, CACHE_DIR), { recursive: true, force: true });
}

/** A path in `dir` that does not exist yet: `name`, then `name (1)`, `name (2)`… */
export function freePath(dir: string, name: string, exists: (p: string) => boolean = fs.existsSync): string {
  const safe = safeFileName(name, "download");
  const ext = path.extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);
  let candidate = path.join(dir, safe);
  for (let i = 1; exists(candidate) && i < 1000; i++) candidate = path.join(dir, `${stem} (${i})${ext}`);
  return candidate;
}
