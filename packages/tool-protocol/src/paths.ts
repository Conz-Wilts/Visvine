/**
 * A path-absolute, same-origin reference, or `/` — the one rule for where a
 * Tool may ask the app to go. Restated from the app's lib/redirects.ts so the
 * protocol stays a package with no app imports; tests/tools-protocol pins the
 * two to the same answers.
 */

const UNSAFE = /[\u0000-\u001F\\]/

export function safeRelativePath(raw: string | string[] | null | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string' || value.length === 0) return '/'
  // Must be a path-absolute reference, never protocol-relative ("//host").
  if (!value.startsWith('/') || value.startsWith('//')) return '/'
  if (UNSAFE.test(value)) return '/'
  try {
    const sentinel = 'https://sentinel.invalid'
    if (new URL(value, sentinel).origin !== sentinel) return '/'
  } catch {
    return '/'
  }
  return value
}
