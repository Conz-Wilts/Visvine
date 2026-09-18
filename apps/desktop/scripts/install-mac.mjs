// Put the built app in /Applications, where Spotlight can find it.
//
//   pnpm desktop:install
//
// This is the real shell, not `electron .` against source: it carries the app's
// own bundle, so it has the Visvine icon, its own Dock entry and its own
// userData. It loads whatever `resolveAppUrl` decides — the production app by
// default; point it at a local server by launching it once with
// `--url=http://localhost:3000`, which it then remembers.
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const arch = process.arch === "arm64" ? "mac-arm64" : "mac";
const built = path.join(root, "release", arch, "Visvine.app");
const installed = "/Applications/Visvine.app";

if (process.platform !== "darwin") {
  console.error("install-mac: macOS only.");
  process.exit(1);
}
if (!existsSync(built)) {
  console.error(`install-mac: ${built} is missing — run \`pnpm desktop:pack\` first.`);
  process.exit(1);
}

// A running copy holds its own bundle open; quit it before it is replaced.
try {
  execFileSync("osascript", ["-e", 'tell application "Visvine" to quit'], { stdio: "ignore" });
} catch {
  // Not running.
}
rmSync(installed, { recursive: true, force: true });
execFileSync("ditto", [built, installed]);
// Spotlight indexes on write, but a replaced bundle keeps the old record until
// it is told; this is what makes the new build searchable straight away.
try {
  execFileSync("mdimport", [installed], { stdio: "ignore" });
} catch {
  // mdimport is best-effort — the app is installed either way.
}

console.log(`install-mac: ${installed} — search "Visvine" in Spotlight.`);
