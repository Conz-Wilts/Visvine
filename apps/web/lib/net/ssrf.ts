/**
 * The SSRF gate: refuse outbound requests to anything that resolves inside the
 * network we're running in. Shared by the MCP OAuth layer (Client ID Metadata
 * Document fetches) and the connector executors — both fetch attacker- or
 * admin-chosen URLs server-side.
 *
 * DNS can still be re-pointed between this check and the actual connect (TOCTOU);
 * callers close the far larger redirect-based hole with `redirect: 'error'`.
 */
import dns from 'node:dns/promises'
import net from 'node:net'

export class SsrfError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsrfError'
  }
}

/** Private, loopback, link-local and other non-routable space. */
export function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address)
  if (family === 4) {
    const [a, b] = address.split('.').map(Number)
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    if (a >= 224) return true // multicast / reserved
    return false
  }
  if (family === 6) {
    const ip = address.toLowerCase()
    if (ip === '::' || ip === '::1') return true
    if (ip.startsWith('fe80')) return true // link-local
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true // unique-local
    if (ip.startsWith('ff')) return true // multicast
    // IPv4-mapped (::ffff:10.0.0.1) — judge the embedded address.
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateAddress(mapped[1])
    return false
  }
  return true // not an IP at all — treat as unusable
}

export interface RoutableOptions {
  /**
   * Skip the private-address check entirely. Set ONLY from the connector path
   * when CONNECTORS_ALLOW_PRIVATE_HOSTS=true (dev databases, VPC-internal
   * replicas) — the OAuth/CIMD callers must never pass this.
   */
  allowPrivate?: boolean
}

/** Throws SsrfError unless every address the hostname resolves to is public. */
export async function assertPubliclyRoutable(
  hostname: string,
  options: RoutableOptions = {},
): Promise<void> {
  if (options.allowPrivate) return
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new SsrfError(`'${hostname}' is not a publicly routable address`)
    }
    return
  }
  let addresses: { address: string }[]
  try {
    addresses = await dns.lookup(hostname, { all: true })
  } catch {
    throw new SsrfError(`Could not resolve the host '${hostname}'`)
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new SsrfError(`'${hostname}' resolves to a private address`)
  }
}
