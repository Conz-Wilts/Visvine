/**
 * How a browser is let onto a machine's socket.
 *
 * The control plane authorizes the person — session, space, admin — and mints a
 * short-lived ticket naming exactly one machine. The edge verifies the
 * signature and the name, and nothing else: it never learns who the viewer is,
 * because it has no way to check and no business deciding.
 *
 * A ticket is used instead of the service token because a browser cannot be
 * given that token — it would be a key to every machine, readable in devtools.
 * Sixty seconds is enough to open a socket and useless to keep.
 */

const encoder = new TextEncoder()

interface TicketClaims {
  /** The machine this ticket is for: `${spaceId}/${agentName}`. */
  machine: string
  /** Seconds since the epoch. */
  exp: number
}

function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

// Verify only: the control plane signs (lib/vm/watch.ts), the edge never does.
async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'verify',
  ])
}

/**
 * Verify a ticket for one machine. Returns null when it is good and the reason
 * when it is not — expiry and machine are both checked, because a valid ticket
 * for someone else's machine is exactly the thing this is here to refuse.
 */
export async function verifyTicket(token: string, machine: string, secret: string): Promise<string | null> {
  const [body, signature] = token.split('.')
  if (!body || !signature) return 'malformed ticket'

  let ok = false
  try {
    ok = await crypto.subtle.verify('HMAC', await key(secret), fromBase64url(signature), encoder.encode(body))
  } catch {
    return 'malformed ticket'
  }
  if (!ok) return 'the ticket is not signed by this platform'

  let claims: TicketClaims
  try {
    claims = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as TicketClaims
  } catch {
    return 'malformed ticket'
  }
  if (claims.machine !== machine) return 'the ticket is for a different machine'
  if (!Number.isFinite(claims.exp) || claims.exp * 1000 < Date.now()) return 'the ticket has expired'
  return null
}
