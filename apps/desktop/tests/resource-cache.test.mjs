import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  isResourceId,
  safeFileName,
  dispositionFileName,
  cachePathFor,
  evictions,
  pruneCache,
  freePath,
  CACHE_DIR,
} = require("../dist/resource-cache.js");

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

test("only a UUID names a resource", () => {
  assert.equal(isResourceId(ID), true);
  assert.equal(isResourceId(ID.toUpperCase()), true);
  for (const bad of ["", "../etc", `${ID}/..`, `${ID}\n`, "0f8fad5b", 42, null, undefined, { id: ID }]) {
    assert.equal(isResourceId(bad), false, String(bad));
  }
});

test("a file name is one safe path segment that keeps its extension", () => {
  assert.equal(safeFileName("Launch plan.pdf", "x"), "Launch plan.pdf");
  assert.equal(safeFileName("../../.ssh/id_rsa", "x"), "_.._.ssh_id_rsa");
  assert.equal(safeFileName("..\\..\\boot.ini", "x"), "_.._boot.ini");
  assert.equal(safeFileName(".hidden", "x"), "hidden");
  assert.equal(safeFileName("CON.txt", "x"), "_CON.txt");
  assert.equal(safeFileName("a\u0000b:c?.png", "x"), "a_b_c_.png");
  assert.equal(safeFileName("", "fallback"), "fallback");
  assert.equal(safeFileName("...", "fallback"), "fallback");
  const long = safeFileName(`${"é".repeat(300)}.docx`, "x");
  assert.ok(Buffer.byteLength(long) <= 200);
  assert.ok(long.endsWith(".docx"));
});

test("the download's own name is read from Content-Disposition", () => {
  assert.equal(dispositionFileName(`attachment; filename="plan.pdf"; filename*=UTF-8''Pl%C3%A4n%20v2.pdf`), "Plän v2.pdf");
  assert.equal(dispositionFileName('attachment; filename="plan.pdf"'), "plan.pdf");
  assert.equal(dispositionFileName(null), null);
});

test("every cache path sits inside the cache, under the resource's own folder", () => {
  const root = "/tmp/userdata";
  assert.equal(cachePathFor(root, ID, "logo.png"), path.join(root, CACHE_DIR, ID, "logo.png"));
  assert.equal(cachePathFor(root, ID, "../../../evil.sh"), path.join(root, CACHE_DIR, ID, "_.._.._evil.sh"));
  assert.throws(() => cachePathFor(root, "../escape", "x"), /Not a resource id/);
});

test("eviction goes least recently opened first, until the rest fits", () => {
  const entries = [
    { dir: "a", bytes: 400, usedMs: 3 },
    { dir: "b", bytes: 400, usedMs: 1 },
    { dir: "c", bytes: 400, usedMs: 2 },
  ];
  assert.deepEqual(evictions(entries, 1000), ["b"]);
  assert.deepEqual(evictions(entries, 400), ["b", "c"]);
  assert.deepEqual(evictions(entries, 5000), []);
});

test("pruning removes whole resource folders from disk", () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "vv-cache-"));
  try {
    const old = cachePathFor(userData, ID, "old.bin");
    const fresh = cachePathFor(userData, "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", "new.bin");
    for (const [file, when] of [[old, 1_000], [fresh, 2_000]]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.alloc(600));
      fs.utimesSync(file, when, when);
    }
    pruneCache(userData, 1000);
    assert.equal(fs.existsSync(path.dirname(old)), false);
    assert.equal(fs.existsSync(fresh), true);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test("a download never lands on a file already there", () => {
  const taken = new Set(["/d/plan.pdf", "/d/plan (1).pdf"]);
  assert.equal(freePath("/d", "plan.pdf", (p) => taken.has(p)), "/d/plan (2).pdf");
  assert.equal(freePath("/d", "../x.pdf", () => false), "/d/_x.pdf");
});
