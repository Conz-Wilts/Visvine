/**
 * Keeping what a person typed out of what the machine records.
 *
 * A browser writes what you type into its window title, and the demonstration
 * recorder reads titles to say what a step was about. That makes the title a
 * side channel for exactly the thing a takeover exists to protect: a password
 * typed where the model cannot see it would otherwise arrive in the trace, and
 * from there in a skill note that anyone in the space can read.
 *
 * Pure and dependency-free so it can be tested directly — this is the seam
 * where a leak would be silent.
 */

/**
 * Shorter than this is not worth scrubbing out of a title — a single character
 * would redact half of every page name, and a secret that short is not one.
 */
export const MIN_REDACTED_CHARS = 4

/**
 * Remove anything the human typed from a string the machine is about to record.
 *
 * A browser writes what you type into its window title, so the title is a
 * side channel for exactly the secret a takeover exists to protect. Partial
 * prefixes are removed too: a title captured mid-word holds part of it.
 */
export function scrub(text: string, typed: readonly string[]): string {
  let out = text
  for (const secret of typed) {
    for (let length = secret.length; length >= MIN_REDACTED_CHARS; length--) {
      const prefix = secret.slice(0, length)
      while (out.includes(prefix)) out = out.replace(prefix, '[redacted]')
    }
  }
  return out
}
