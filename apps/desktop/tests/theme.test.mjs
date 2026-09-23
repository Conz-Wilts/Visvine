import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { WINDOW_BACKGROUND } = require("../dist/theme.js");
const { VV_COLOR } = require("../dist/tokens.generated.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const offline = fs.readFileSync(path.join(root, "resources", "offline.html"), "utf8");

const START = "/* vv-tokens:start";
const END = "/* vv-tokens:end */";
const tokenBlock = offline.slice(offline.indexOf(START), offline.indexOf(END));
const ownRules = offline.replace(tokenBlock, "");

// offline.html cannot import anything, so `pnpm tokens:build` writes the tokens
// into a marked block of it (and `pnpm tokens:check` fails if that block is
// stale). These assertions keep the rest of the page reading from it.
test("the offline page carries the generated tokens", () => {
  assert.ok(offline.includes(START) && offline.includes(END), "vv-tokens block missing");
  assert.ok(tokenBlock.includes(`--vv-color-surface: ${VV_COLOR.surface};`), "token block is not the generated one");
});

test("the offline page paints with the tokens, not literals of its own", () => {
  const stray = ownRules.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? [];
  assert.deepEqual(stray, [], `literal colours outside the token block: ${stray.join(", ")}`);
  for (const role of ["surface", "fg", "fg-muted", "brand"]) {
    assert.ok(ownRules.includes(`var(--vv-color-${role})`), `offline.html no longer paints with --vv-color-${role}`);
  }
});

test("the window background is the page backdrop", () => {
  assert.equal(WINDOW_BACKGROUND, VV_COLOR.surfaceBackdrop);
});

test("the offline page has no dark variant — the app is light-only", () => {
  assert.ok(!/prefers-color-scheme/.test(offline), "prefers-color-scheme block found");
  assert.ok(/color-scheme: light/.test(offline), "color-scheme: light missing");
});

test("the window chrome is pinned to the app's theme, not the OS appearance", () => {
  const { WINDOW_THEME } = require("../dist/theme.js");
  assert.equal(WINDOW_THEME, "light");
  const main = fs.readFileSync(path.join(root, "src", "main.ts"), "utf8");
  assert.ok(/nativeTheme\.themeSource = WINDOW_THEME/.test(main), "main.ts must set nativeTheme.themeSource");
});
