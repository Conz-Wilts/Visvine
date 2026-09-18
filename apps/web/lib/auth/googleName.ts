/**
 * The name to store for a Google account, from the userinfo response.
 *
 * Google's `name` is the account's DISPLAY name, which a person may set to
 * "Full name (nickname)" — so it can come back as `Ana Ruiz (Ana Ruiz)`.
 * `given_name` + `family_name` never carry the nickname, so they win; `name`
 * is the fallback for an account with neither, and the email the last resort.
 */
export function googleDisplayName(profile: {
  name?: unknown
  given_name?: unknown
  family_name?: unknown
  email?: unknown
}): string {
  const part = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const parts = [part(profile.given_name), part(profile.family_name)].filter(Boolean)
  if (parts.length > 0) return parts.join(' ')
  return part(profile.name) || part(profile.email)
}
