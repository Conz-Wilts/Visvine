/**
 * Linking a phone to an account: the code, its life, and what a text has to
 * say to redeem it. Pure.
 *
 * The person texts FIRST — Visvine never sends the code out, it shows it on
 * the screen and waits for it to arrive from the phone being claimed. That
 * proves possession of the phone without a single outbound message, so the
 * pre-reply limits a line has with a stranger never apply.
 */

export const LINK_CODE_TTL_MS = 10 * 60_000
const LINK_CODE_LENGTH = 6

/** Six digits from a cryptographic source; the caller supplies the bytes so this stays pure. */
export function linkCodeFrom(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; out.length < LINK_CODE_LENGTH && i < bytes.length; i++) out += String(bytes[i] % 10)
  return out.padStart(LINK_CODE_LENGTH, '0')
}

/** A text is a code when, stripped of everything but digits, it IS six of them. */
export function codeInText(text: string): string | null {
  const digits = text.replace(/\D/g, '')
  return digits.length === LINK_CODE_LENGTH && /^\D*\d[\d\s-]*\D*$/.test(text.trim()) ? digits : null
}

export function codeIsLive(code: string | null, expiresAt: Date | null, now: Date): code is string {
  return code !== null && expiresAt !== null && expiresAt.getTime() > now.getTime()
}
