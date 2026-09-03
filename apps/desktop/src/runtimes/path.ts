import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

/**
 * A GUI app on macOS (and some Linux launchers) starts with a PATH that has
 * never seen the user's shell profile, so `claude` — installed to
 * ~/.local/bin or a node version manager's shim — is not on it. Ask the
 * login shell once for the PATH it would give a terminal, and merge.
 */
export function mergePaths(current: string | undefined, fromShell: string | undefined, extra: string[] = []): string {
  const sep = path.delimiter;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of [...(fromShell ?? "").split(sep), ...(current ?? "").split(sep), ...extra]) {
    const p = part.trim();
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out.join(sep);
}

/** The places a per-user CLI install lands, whatever the shell says. */
export function userBinDirs(home = os.homedir()): string[] {
  return [
    path.join(home, ".local", "bin"),
    path.join(home, ".claude", "local"),
    path.join(home, ".codex", "bin"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
}

let resolved: Promise<string> | null = null;

/** The PATH child processes get: the login shell's, then ours, then the usual per-user dirs. Cached. */
export function shellPath(): Promise<string> {
  if (resolved) return resolved;
  resolved = new Promise((resolve) => {
    if (process.platform === "win32") return resolve(mergePaths(process.env.PATH, undefined, userBinDirs()));
    const shell = process.env.SHELL || "/bin/sh";
    execFile(shell, ["-ilc", "echo __PATH__$PATH"], { timeout: 4000, env: { ...process.env, DISABLE_AUTO_UPDATE: "true" } }, (err, stdout) => {
      const line = err ? "" : stdout.split("\n").find((l) => l.startsWith("__PATH__"))?.slice("__PATH__".length);
      resolve(mergePaths(process.env.PATH, line, userBinDirs()));
    });
  });
  return resolved;
}
