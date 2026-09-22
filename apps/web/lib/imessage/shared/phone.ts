/**
 * Phone numbers as the iMessage feature stores them: E.164, nothing else.
 *
 * Pure. A number is the key that binds a text to an account, so two spellings
 * of one phone must never make two rows — every number is normalised here
 * before it is stored or compared. Sendblue sends E.164 already; a person
 * typing theirs into Settings does not.
 */

const E164 = /^\+[1-9]\d{6,14}$/

/**
 * `+64 21 123 4567`, `021 123 4567` (with a default country), `(415) 555-0100`
 * → `+6421…`, or null when nothing phone-shaped remains. Digits only survive;
 * a leading `00` is the international prefix; a national number is given the
 * default country code and its trunk `0` dropped.
 */
export function normalizePhone(raw: string, defaultCountry = '1'): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const plus = trimmed.startsWith('+') || trimmed.startsWith('00')
  let digits = trimmed.replace(/\D/g, '')
  if (trimmed.startsWith('00')) digits = digits.slice(2)
  if (!plus) {
    if (digits.startsWith('0')) digits = digits.slice(1)
    if (defaultCountry === '1' && digits.length === 10) digits = `1${digits}`
    else if (defaultCountry !== '1' && !digits.startsWith(defaultCountry)) digits = `${defaultCountry}${digits}`
  }
  const out = `+${digits}`
  return E164.test(out) ? out : null
}

export function isE164(value: string): boolean {
  return E164.test(value)
}

/** `+64211234567` → `+64 ••• •567` — enough to recognise, never enough to dial. */
export function maskPhone(value: string): string {
  if (value.length < 6) return value
  return `${value.slice(0, 3)} ••• •${value.slice(-3)}`
}
