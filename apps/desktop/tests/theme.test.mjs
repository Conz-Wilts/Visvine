import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { SHELL_COLORS, WINDOW_BACKGROUND } = require("../dist/theme.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const offline = fs.readFileSync(path.join(root, "resources", "offline.html"), "utf8");

// offline.html is standalone — it repeats the palette as literals because it has
// no way to import it. These assertions are what keeps the copy honest.
test("the offline page paints the shell palette, not its own", () => {
  for (const [name, value] of Object.entries(SHELL_COLORS)) {
    if (name === "border") continue; // the offline page draws no hairline
    assert.ok(
      offline.includes(value),
      `offline.html no longer uses ${name} (${value}) — update it or drop the token`,
    );
  }
  assert.ok(offline.includes(`background: ${WINDOW_BACKGROUND}`), "offline body must match the window background");
});

test("the offline page has no dark variant — the app is light-only", () => {
  assert.ok(!/prefers-color-scheme/.test(offline), "prefers-color-scheme block found");
  assert.ok(/color-scheme: light/.test(offline), "color-scheme: light missing");
});

test("no hex colour in the offline page is outside the shell palette", () => {
  const palette = new Set(Object.values(SHELL_COLORS).map((c) => c.toLowerCase()));
  const used = offline.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  const stray = [...new Set(used.map((c) => c.toLowerCase()))].filter((c) => !palette.has(c));
  assert.deepEqual(stray, [], `stray colours in offline.html: ${stray.join(", ")}`);
});
