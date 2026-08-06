/**
 * The perimeter gate — the pure half of "which hosts and paths may this
 * connector reach", with no transport attached.
 *
 * It lives apart from whatever does the reaching so that the same decision, and
 * the same words for refusing, are shared by every capability a connector run
 * gets. `hosts:` and `allow:` are written literally in the note by an admin and
 * are never interpolated from a secret, so a denial may quote them back; the
 * thing being judged is whatever the run asked for, which may not be.
 *
 * Nothing here does I/O except the SSRF lookup, and nothing here knows about
 * the isolate. Callers supply the scheme's default port, because "listed
 * without a port" means 443 for an HTTPS call and 5432 for a Postgres DSN.
 */
import { assertPubliclyRoutable, SsrfError } from '@/lib/net/ssrf'
import { matchAllowlist, normalizeRequestPath, type AllowRule } from './config'

export interface GatePerimeter {
  /** `host` or `host:port` entries. Empty means no network at all. */
  hosts: readonly string[]
  /** Optional method+path rules. Empty means host-gated only, not deny-all. */
  allow: readonly AllowRule[]
  /** Dev/VPC escape hatch — mirrors CONNECTORS_ALLOW_PRIVATE_HOSTS semantics. */
  allowPrivate: boolean
}

/** The most denials one run will collect before it stops recording them. */
export const MAX_DENIALS = 50

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '')
}

/**
 * Does the perimeter list this host+port? An entry without a port pins the
 * caller's default; an explicit `host:port` entry allows exactly that port.
 */
export function hostAllowed(
  hosts: readonly string[],
  hostname: string,
  port: number,
  defaultPort: number,
): boolean {
  const wanted = normalizeHost(hostname)
  return hosts.some((entry) => {
    const [entryHost, entryPort] = splitHostPort(entry)
    if (normalizeHost(entryHost) !== wanted) return false
    return entryPort === null ? port === defaultPort : port === entryPort
  })
}

/** `host[:port]` → parts; a bad port reads as null (host-only entry). */
function splitHostPort(entry: string): [string, number | null] {
  const m = entry.match(/^(.*):(\d{1,5})$/)
  if (!m) return [entry, null]
  const port = Number(m[2])
  return port >= 1 && port <= 65535 ? [m[1], port] : [entry, null]
}

/**
 * The host gate: listed, then publicly routable. Returns null when allowed and
 * the refusal text otherwise.
 *
 * `subject` is what the denial calls the thing being refused. It defaults to
 * the hostname because for an outbound HTTP call the model supplied that host
 * and naming it back is the whole point. A caller whose host came out of a
 * decrypted secret — a database DSN — must pass something opaque instead, or
 * the denial hands the model a piece of the credential.
 */
export async function refuseHost(
  perimeter: GatePerimeter,
  hostname: string,
  port: number,
  defaultPort: number,
  subject?: string,
): Promise<string | null> {
  if (!hostAllowed(perimeter.hosts, hostname, port, defaultPort)) {
    const suffix = port === defaultPort ? '' : `:${port}`
    const named = subject ?? `${hostname}${suffix}`
    return perimeter.hosts.length === 0
      ? `egress denied: this connector lists no hosts`
      : `egress denied: ${named} is not in this connector's hosts (${perimeter.hosts.join(', ')})`
  }
  try {
    await assertPubliclyRoutable(hostname, { allowPrivate: perimeter.allowPrivate })
  } catch (e) {
    if (e instanceof SsrfError) return `egress denied: ${subject ? `${subject}: ${e.message}` : e.message}`
    throw e
  }
  return null
}

/**
 * The method+path gate. An empty `allow` list means the connector is gated on
 * hosts alone — NOT deny-all. That is the v2 reading, and it has to stay: every
 * note written since v2 declares `hosts:` without `allow:`, and flipping the
 * empty case to deny-all would silently mute all of them.
 *
 * Returns null when allowed, the refusal text otherwise.
 */
export function refusePath(
  perimeter: GatePerimeter,
  method: string,
  pathname: string,
): string | null {
  const path = normalizeRequestPath(pathname)
  if (path === null) return `egress denied: ${pathname} is not a well-formed request path`
  if (perimeter.allow.length === 0) return null
  if (matchAllowlist(perimeter.allow, method, path)) return null
  return `egress denied: ${method.toUpperCase()} ${path} is not in this connector's allow rules`
}
