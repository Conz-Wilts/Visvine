#!/usr/bin/env node
// PreToolUse / mcp__playwright__browser_take_screenshot:
// Keep Playwright screenshots out of the repo root.
//
// Why this is needed: this version of @playwright/mcp resolves a *custom*
// relative `filename` against the process cwd (the repo root) and IGNORES the
// server's --output-dir. (--output-dir only governs auto-named artifacts like
// console logs and page snapshots, which is why those land in .playwright-mcp/
// but `filename: "foo.png"` leaks a foo.png into the project root.)
//
// So we fix it at the call site instead of via config:
//   1. create a screenshots/ folder if it doesn't exist (the screenshot call
//      itself will NOT mkdir, so the dir must pre-exist), and
//   2. rewrite the screenshot filename to live inside that folder.
//
// See ./README.md.
import { mkdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { readInput } from './lib/visual-verify.mjs';

const SCREENSHOT_DIR = 'screenshots';

const input = await readInput();
const cwd = input?.cwd || process.cwd();
const toolInput = input?.tool_input || {};

// (1) Ensure the folder exists — covers a fresh clone / the very first screenshot.
mkdirSync(join(cwd, SCREENSHOT_DIR), { recursive: true });

const given = typeof toolInput.filename === 'string' ? toolInput.filename : '';
const norm = given.replace(/\\/g, '/');

// (2) Decide the final filename:
//   - an absolute path or one already inside screenshots/ is honoured as-is
//   - a bare/relative name is moved into screenshots/ (basename only)
//   - a missing name gets a timestamped default inside screenshots/
let filename;
if (given && isAbsolute(given)) {
  filename = given;
} else if (norm === SCREENSHOT_DIR || norm.startsWith(`${SCREENSHOT_DIR}/`)) {
  filename = norm;
} else if (given) {
  filename = `${SCREENSHOT_DIR}/${basename(given)}`;
} else {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  filename = `${SCREENSHOT_DIR}/screenshot-${stamp}.png`;
}

// Make sure the (possibly nested) target directory exists before the tool runs.
const targetDir = isAbsolute(filename) ? dirname(filename) : join(cwd, dirname(filename));
mkdirSync(targetDir, { recursive: true });

// Hand the rewritten input back to Claude Code. permissionDecision:"allow" lets a
// safe, read-only screenshot through without an extra prompt; updatedInput swaps in
// the foldered filename (no-op safe if the MCP filename rewrite isn't honoured —
// the convention documented in CLAUDE.md still routes it correctly).
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: `Routing screenshot to ${filename}`,
      updatedInput: { ...toolInput, filename },
    },
  })
);
process.exit(0);
