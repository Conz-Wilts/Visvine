/**
 * The deployment's own OAuth clients, referenced from a note as
 * `client_id: platform:<name>`.
 *
 * A `mode: user` connector to Google needs an OAuth client, and making every
 * space register its own Google Cloud app is the per-vendor developer-account
 * tax dynamic registration exists to remove — except Google offers no dynamic
 * registration. So the platform carries one client of its own: the same
 * GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET Visvine's sign-in uses, extended in
 * the provider's console with the connector redirect URI and scopes.
 *
 * The credential lives in env and nowhere else — never in a note, a
 * ConnectorSecret row, a ConnectorOAuthClient row, or the isolate. Rotating it
 * is rotating one env var. A space that wants its own app still pastes a
 * `client_id` + `{{secret:…}}` client secret the ordinary way.
 */

const PLATFORM_RE = /^platform:([a-z0-9][a-z0-9-]{0,31})$/

/** Platform name → the env vars holding its credentials. Pure data. */
const PLATFORM_CLIENTS: Readonly<Record<string, { id: string; secret: string }>> = {
  google: { id: 'GOOGLE_CLIENT_ID', secret: 'GOOGLE_CLIENT_SECRET' },
}

/** `'platform:google'` → `'google'`; anything else → null. */
export function platformClientRef(clientId: string | null): string | null {
  if (!clientId) return null
  const match = PLATFORM_RE.exec(clientId)
  return match ? match[1] : null
}

/**
 * Resolve a ref to live credentials. Null when the ref names no known platform
 * client or its env vars are unset — the caller turns that into a message
 * naming the vars, because "this deployment has no Google client" is an
 * operator problem, not a member one.
 */
export function resolvePlatformClient(
  ref: string,
  env: Record<string, string | undefined> = process.env,
): { clientId: string; clientSecret: string | null } | null {
  const names = PLATFORM_CLIENTS[ref]
  if (!names) return null
  const clientId = env[names.id]?.trim()
  if (!clientId) return null
  const clientSecret = env[names.secret]?.trim()
  return { clientId, clientSecret: clientSecret || null }
}

/**
 * Which platform clients this deployment actually holds — the names, never the
 * credentials. The console asks so a Connect button can be one click where the
 * deployment can complete the dance and a form where it cannot; sending a name
 * is safe precisely because the id and secret stay here.
 */
export function availablePlatformClients(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return Object.keys(PLATFORM_CLIENTS).filter((ref) => resolvePlatformClient(ref, env) !== null)
}

/** The env vars a ref would read, for error messages. */
export function platformClientEnvNames(ref: string): { id: string; secret: string } | null {
  return PLATFORM_CLIENTS[ref] ?? null
}
