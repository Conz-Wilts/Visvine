/**
 * Connector identity — letting a connector tell an upstream WHO the run is for,
 * without letting the connector's own code decide the answer.
 *
 * The problem this closes: a connector run reaches an upstream as one shared
 * robot. If that upstream has per-user permissions — Blackbird Data's
 * information walls, an Attio or Drive ACL, anything — it has no choice but to
 * serve the most restrictive view for everyone, because nothing in the request
 * names a person. The obvious fix, having the connector's code send an
 * "on behalf of" header, is worthless: isolate code writes its own headers, so
 * whoever can run the connector could claim to be anyone.
 *
 * So the runtime signs it instead. A note DECLARES an identity block; the host
 * side mints a short-lived assertion from the principal who actually triggered
 * the run and stamps it on outbound requests. The isolate cannot read the
 * signing key (it never enters `env`), cannot set the header (hostFetch strips
 * it from caller-supplied headers), and cannot see the assertion it produced.
 *
 * This is the same posture as `hosts:` and `allow:`: declared in the note,
 * enforced outside the isolate. It follows the precedent already set by the
 * `auth:` OAuth2 block, where the executor exchanges credentials server-side
 * and the model never sees the token.
 *
 * WHAT THIS IS NOT. It is not authentication to the upstream — the connector's
 * own credential still does that job, and an assertion alone opens nothing. It
 * is an attested claim about which person the call is for, useful only to an
 * upstream that already trusts this deployment and shares the signing key.
 */
import { SignJWT } from 'jose'
import { ConnectorError, hostAllowed } from './config'

/** Default header, matching the name the Blackbird Data verifier reads. */
const DEFAULT_HEADER = 'x-actor-assertion'

/** Assertions are per-request statements, not sessions. */
const TTL_DEFAULT_SECONDS = 120
const TTL_MIN_SECONDS = 30
const TTL_MAX_SECONDS = 600

const HEADER_NAME_RE = /^[a-z0-9!#$%&'*+.^_`|~-]+$/
const SECRET_REF_ONLY_RE = /^\{\{\s*secret:([A-Z][A-Z0-9_]{0,63})\s*\}\}$/

/**
 * The identity block as DECLARED in a note's frontmatter. Carries a secret
 * reference, never a secret value — the same rule `env:` follows.
 */
export interface ConnectorIdentity {
  /** Lowercased header name the assertion is stamped on. */
  header: string
  /** The `aud` claim. An upstream that checks it cannot be handed someone else's assertion. */
  audience: string
  /** Always exactly one `{{secret:NAME}}` reference. */
  secretRef: string
  ttlSeconds: number
  /**
   * Hosts the assertion may be sent to. Empty means every host in the
   * perimeter — fine for a single-vendor connector, but narrow it when a note
   * reaches more than one upstream, so a user's email is not handed to a vendor
   * that has no business knowing it.
   */
  hosts: string[]
}

/** An identity ready to mint against, assembled server-side at run time. */
export interface ResolvedIdentity {
  header: string
  audience: string
  /** Plaintext signing key. Never placed in `env`; always added to the redact list. */
  secret: string
  ttlSeconds: number
  hosts: readonly string[]
  /** The person the run is for. Empty means "nobody" — nothing is stamped. */
  actorEmail: string
}

export type ParseIdentityResult =
  | { ok: true; identity: ConnectorIdentity | null }
  | { ok: false; error: string }

/**
 * Parse the optional `identity:` frontmatter block.
 *
 * Absent is the normal case and parses to null. Present-but-wrong is an error
 * rather than a silent skip: a note that means to attest identity and quietly
 * does not would send a shared-robot request that looks per-user.
 */
export function parseConnectorIdentity(raw: unknown): ParseIdentityResult {
  if (raw === undefined || raw === null) return { ok: true, identity: null }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '`identity` must be a mapping with `audience` and `secret`' }
  }

  const block = raw as Record<string, unknown>

  const audience = typeof block.audience === 'string' ? block.audience.trim() : ''
  if (!audience) {
    return { ok: false, error: '`identity.audience` is required — the `aud` the upstream verifies' }
  }
  if (audience.length > 200) {
    return { ok: false, error: '`identity.audience` is too long' }
  }

  const secretRaw = typeof block.secret === 'string' ? block.secret.trim() : ''
  // A literal key here would be a credential written into a note, which is the
  // one thing the whole secret-reference scheme exists to prevent.
  if (!SECRET_REF_ONLY_RE.test(secretRaw)) {
    return {
      ok: false,
      error:
        '`identity.secret` must be exactly one {{secret:NAME}} reference (UPPER_SNAKE), never a literal key',
    }
  }

  const headerRaw = typeof block.header === 'string' ? block.header.trim().toLowerCase() : ''
  const header = headerRaw || DEFAULT_HEADER
  if (!HEADER_NAME_RE.test(header)) {
    return { ok: false, error: `\`identity.header\` is not a valid header name: ${header}` }
  }

  const ttlRaw = block.ttl_s
  let ttlSeconds = TTL_DEFAULT_SECONDS
  if (ttlRaw !== undefined && ttlRaw !== null) {
    if (typeof ttlRaw !== 'number' || !Number.isFinite(ttlRaw)) {
      return { ok: false, error: '`identity.ttl_s` must be a number of seconds' }
    }
    ttlSeconds = Math.floor(ttlRaw)
    if (ttlSeconds < TTL_MIN_SECONDS || ttlSeconds > TTL_MAX_SECONDS) {
      return {
        ok: false,
        error: `\`identity.ttl_s\` must be between ${TTL_MIN_SECONDS} and ${TTL_MAX_SECONDS}`,
      }
    }
  }

  const hostsRaw = block.hosts
  const hosts: string[] = []
  if (hostsRaw !== undefined && hostsRaw !== null) {
    if (!Array.isArray(hostsRaw)) {
      return { ok: false, error: '`identity.hosts` must be a list of host or host:port entries' }
    }
    for (const entry of hostsRaw) {
      const value = typeof entry === 'string' ? entry.trim().toLowerCase().replace(/\.$/, '') : ''
      if (!value) {
        return { ok: false, error: `Bad identity.hosts entry ${JSON.stringify(entry)}` }
      }
      hosts.push(value)
    }
  }

  return { ok: true, identity: { header, audience, secretRef: secretRaw, ttlSeconds, hosts } }
}

/** The secret NAME an identity block references, for the run's secret resolution. */
export function identitySecretName(identity: ConnectorIdentity): string {
  const match = SECRET_REF_ONLY_RE.exec(identity.secretRef)
  if (!match?.[1]) {
    // parseConnectorIdentity guarantees the shape, so this is a wiring bug.
    throw new ConnectorError('config', 'identity.secret is not a well-formed secret reference')
  }
  return match[1]
}

/**
 * Should this request carry the assertion?
 *
 * Two ways to say no, both silent and both safe: no actor to name, or a host
 * the identity block does not cover. An upstream that receives no assertion
 * falls back to whatever it does for an anonymous caller, which is by
 * construction the more restrictive path.
 */
export function identityAppliesTo(
  identity: ResolvedIdentity,
  hostname: string,
  port: number,
  defaultPort: number,
): boolean {
  if (!identity.actorEmail) return false
  if (identity.hosts.length === 0) return true
  return hostAllowed(identity.hosts, hostname, port, defaultPort)
}

/**
 * Mint one assertion. HS256 over the shared secret, `aud`-bound and
 * short-lived, so a copy that escapes is useless within minutes and useless
 * anywhere else immediately.
 */
export async function mintActorAssertion(identity: ResolvedIdentity): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(identity.actorEmail)
    .setAudience(identity.audience)
    .setIssuedAt()
    .setExpirationTime(`${identity.ttlSeconds}s`)
    .sign(new TextEncoder().encode(identity.secret))
}
