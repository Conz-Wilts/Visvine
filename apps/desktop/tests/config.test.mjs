import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveAppUrl, isDevMode, readSettings, writeSettings, DEV_APP_URL, PROD_APP_URL } = require("../dist/config.js");

test("resolveAppUrl precedence: flag > env > settings > default", () => {
  const base = { argv: [], env: {}, settings: {}, dev: true };
  assert.equal(resolveAppUrl(base), DEV_APP_URL);
  assert.equal(resolveAppUrl({ ...base, dev: false }), PROD_APP_URL);
  assert.equal(resolveAppUrl({ ...base, settings: { appUrl: "https://staging.visvine.com/" } }), "https://staging.visvine.com");
  assert.equal(
    resolveAppUrl({ ...base, settings: { appUrl: "https://staging.visvine.com" }, env: { VISVINE_DESKTOP_URL: "http://127.0.0.1:4000" } }),
    "http://127.0.0.1:4000",
  );
  assert.equal(
    resolveAppUrl({ ...base, env: { VISVINE_DESKTOP_URL: "http://127.0.0.1:4000" }, argv: ["electron", ".", "--url=https://visvine.com/"] }),
    "https://visvine.com",
  );
});

test("resolveAppUrl ignores junk values", () => {
  assert.equal(resolveAppUrl({ argv: ["--url=ftp://x"], env: { VISVINE_DESKTOP_URL: "nope" }, settings: { appUrl: "javascript:1" }, dev: true }), DEV_APP_URL);
});

test("isDevMode honours the env override and packaging state", () => {
  assert.equal(isDevMode({}, false), true);
  assert.equal(isDevMode({}, true), false);
  assert.equal(isDevMode({ VISVINE_DESKTOP_DEV: "1" }, true), true);
  assert.equal(isDevMode({ VISVINE_DESKTOP_DEV: "0" }, false), false);
});

test("settings round-trip and tolerate a missing/corrupt file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "visvine-desktop-"));
  assert.deepEqual(readSettings(dir), {});
  writeSettings(dir, { appUrl: "https://visvine.com" });
  assert.deepEqual(readSettings(dir), { appUrl: "https://visvine.com" });
  fs.writeFileSync(path.join(dir, "desktop-settings.json"), "{not json");
  assert.deepEqual(readSettings(dir), {});
});
