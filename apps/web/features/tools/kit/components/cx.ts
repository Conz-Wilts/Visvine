/**
 * `clsx` in three lines. The kit bundle may only import `react`, so it brings
 * its own rather than pulling a dependency into every Tool's payload.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
