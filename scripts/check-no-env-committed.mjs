#!/usr/bin/env node
/**
 * Fails if any real .env file (not *.example) is staged or tracked.
 *
 * Two modes:
 *   default: scans `git ls-files` (catches anything ever committed)
 *   --staged: scans `git diff --cached --name-only` (use as a pre-commit hook)
 *
 * Wire as a pre-commit hook (husky/lefthook/native) or run in CI:
 *   node scripts/check-no-env-committed.mjs --staged
 */

import { execSync } from "node:child_process";

const STAGED = process.argv.includes("--staged");

const cmd = STAGED
  ? "git diff --cached --name-only --diff-filter=AM"
  : "git ls-files";

let files;
try {
  files = execSync(cmd, { encoding: "utf8" })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
} catch (err) {
  console.error(`check-no-env-committed: git command failed — ${err.message}`);
  process.exit(1);
}

const BAD = files.filter((f) => {
  const base = f.split("/").pop() ?? "";
  if (!base.startsWith(".env")) return false;
  if (base.endsWith(".example")) return false;
  if (base === ".env.example") return false;
  return true;
});

if (BAD.length > 0) {
  console.error("check-no-env-committed: FAIL — these env files must not be committed:");
  for (const f of BAD) console.error(`  - ${f}`);
  console.error("\nFix:");
  console.error("  git rm --cached <file>   # untrack but keep on disk");
  console.error("  (rotate any secret that was inside)\n");
  process.exit(1);
}

console.log(`check-no-env-committed: ok (${STAGED ? "staged" : "tracked"} scan, ${files.length} files)`);
