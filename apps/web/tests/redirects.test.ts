import test from "node:test";
import assert from "node:assert/strict";
import { safeRelativePath } from "../lib/redirects";

const ORIGIN = "https://app.example.com";

/** Mirrors how callers use the result: resolve it against the app origin. */
function resolved(input: string): string {
  return new URL(safeRelativePath(input), ORIGIN).href;
}

test("safeRelativePath keeps legitimate same-origin paths intact", () => {
  assert.equal(safeRelativePath("/directory"), "/directory");
  assert.equal(safeRelativePath("/notes/abc-123?tab=context"), "/notes/abc-123?tab=context");
  assert.equal(safeRelativePath("/profile/x#section"), "/profile/x#section");
  // Encoded slashes are a legitimate single-segment same-origin path.
  assert.equal(safeRelativePath("/%2Fnot-a-host"), "/%2Fnot-a-host");
});

test("safeRelativePath collapses empty / non-string / non-absolute input to /", () => {
  assert.equal(safeRelativePath(null), "/");
  assert.equal(safeRelativePath(undefined), "/");
  assert.equal(safeRelativePath(""), "/");
  assert.equal(safeRelativePath("relative/path"), "/");
  assert.equal(safeRelativePath("directory"), "/");
});

test("safeRelativePath rejects absolute and protocol-relative URLs", () => {
  assert.equal(safeRelativePath("https://evil.com"), "/");
  assert.equal(safeRelativePath("http://evil.com"), "/");
  assert.equal(safeRelativePath("//evil.com"), "/");
});

test("safeRelativePath rejects backslash and control-char open-redirect smuggling", () => {
  // Each of these, if returned verbatim, resolves to an off-site origin because
  // the WHATWG URL parser rewrites "\" -> "/" and strips tab/newline/CR.
  const attacks = [
    "/\\evil.com",
    "/\\\\evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r/evil.com",
    String.fromCharCode(47, 9) + "/evil.com", // "/" + TAB + "/evil.com"
  ];
  for (const a of attacks) {
    assert.equal(safeRelativePath(a), "/", `expected "/" for ${JSON.stringify(a)}`);
    assert.ok(
      resolved(a).startsWith(ORIGIN + "/"),
      `${JSON.stringify(a)} resolved off-site to ${resolved(a)}`
    );
  }
});

test("safeRelativePath: array input uses the first element", () => {
  assert.equal(safeRelativePath(["/ok", "/second"]), "/ok");
  assert.equal(safeRelativePath(["//evil.com"]), "/");
});
