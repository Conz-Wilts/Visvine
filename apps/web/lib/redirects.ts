// Validates a caller-supplied "where to go next" value (OAuth `state`, a
// `callbackUrl` query param, etc.) so it can only ever point back into this app.
// Anything that doesn't resolve to a same-origin, path-absolute reference is
// collapsed to "/".
//
// The naive check (startsWith("/") && !startsWith("//")) is NOT enough: the
// WHATWG URL parser rewrites backslashes to slashes and strips tab/newline/CR
// before parsing, so "/\evil.com" and "/<TAB>/evil.com" both resolve to the
// off-site origin "http://evil.com". We therefore also reject backslashes and
// C0 control characters, and confirm same-origin resolution as a safety net.

// True if the path contains a backslash (the URL parser rewrites it to "/") or
// any C0 control char < U+0020 (the parser strips tab/newline/CR). Either can
// smuggle a "//host" past the protocol-relative check below. Char-code loop
// rather than a regex so no control bytes need to live in this source file.
function hasUnsafeChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x5c /* backslash */) return true;
  }
  return false;
}

export function safeRelativePath(raw: string | string[] | null | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.length === 0) return "/";

  // Must be a path-absolute reference, never protocol-relative ("//host").
  if (!value.startsWith("/") || value.startsWith("//")) return "/";

  if (hasUnsafeChars(value)) return "/";

  // Safety net: confirm it resolves to the sentinel origin and stays a
  // same-origin reference. Anything else (parser quirks we didn't enumerate)
  // is rejected rather than trusted.
  try {
    const sentinel = "https://sentinel.invalid";
    if (new URL(value, sentinel).origin !== sentinel) return "/";
  } catch {
    return "/";
  }

  return value;
}
