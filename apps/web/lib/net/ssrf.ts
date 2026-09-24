/**
 * The SSRF gate: refuse outbound requests to anything that resolves inside the
 * network we're running in. Shared by the MCP OAuth layer (Client ID Metadata
 * Document fetches) and the connector executors — both fetch attacker- or
 * admin-chosen URLs server-side.
 *
 * A name can still be re-pointed between this check and the actual connect
 * (DNS rebinding). `publicDispatcher` closes that for the callers that use it:
 * it asks the same question of the address the socket actually connects to.
 * Callers close the redirect-based hole with `redirect: 'manual'` / 'error'.
 */
import dns from 'node:dns/promises'
import { lookup as dnsLookup } from 'node:dns'
import net from 'node:net'
import { Agent } from 'undici'

export class SsrfError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsrfError'
  }
}

/** An IPv6 address as its eight 16-bit groups, or null when it is not one. */
function ipv6Groups(address: string): number[] | null {
  let ip = address.toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '')
  // A dotted IPv4 tail (::ffff:10.0.0.1) becomes its two groups.
  const tail = ip.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number)
    ip = ip.slice(0, tail.index) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const halves = ip.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : []
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0
  const groups = [...head, ...Array(Math.max(fill, 0)).fill('0'), ...rest].map((g) => parseInt(g, 16))
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null
}

/** The IPv4 address an IPv6 one carries inside it, when it carries one. */
function embeddedIpv4(groups: number[]): string | null {
  const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`
  const zero = (n: number) => groups.slice(0, n).every((g) => g === 0)
  if (zero(5) && groups[5] === 0xffff) return v4(groups[6], groups[7]) // ::ffff:a.b.c.d (mapped)
  if (zero(6)) return v4(groups[6], groups[7]) // ::a.b.c.d (compatible)
  if (zero(4) && groups[4] === 0xffff && groups[5] === 0) return v4(groups[6], groups[7]) // ::ffff:0:a.b.c.d
  if (groups[0] === 0x64 && groups[1] === 0xff9b) return v4(groups[6], groups[7]) // NAT64 64:ff9b::/96
  if (groups[0] === 0x2002) return v4(groups[1], groups[2]) // 6to4 2002:aabb:ccdd::
  return null
}

/** Private, loopback, link-local and other non-routable space. */
export function isPrivateAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, '')
  const family = net.isIP(bare)
  if (family === 4) {
    const [a, b, c] = bare.split('.').map(Number)
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    if (a === 192 && b === 0 && c === 0) return true // IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
    if (a >= 224) return true // multicast / reserved / broadcast
    return false
  }
  if (family === 6) {
    const groups = ipv6Groups(bare)
    if (!groups) return true
    if (groups.every((g) => g === 0)) return true // ::
    if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true // ::1
    const embedded = embeddedIpv4(groups)
    if (embedded) return isPrivateAddress(embedded)
    const first = groups[0]
    if ((first & 0xffc0) === 0xfe80) return true // link-local fe80::/10
    if ((first & 0xfe00) === 0xfc00) return true // unique-local fc00::/7
    if ((first & 0xff00) === 0xff00) return true // multicast
    if (first === 0x2001 && groups[1] === 0x0db8) return true // documentation
    if (first === 0x0100 && groups.slice(1, 4).every((g) => g === 0)) return true // discard 100::/64
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
  const bare = hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(bare)) {
    if (isPrivateAddress(bare)) {
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

/**
 * An HTTP dispatcher whose sockets can only reach public addresses: the check
 * above, asked again of the address DNS returns at connect time, so a name
 * re-pointed at 127.0.0.1 between the check and the connect is refused.
 */
let dispatcher: Agent | null = null
export function publicDispatcher(): Agent {
  dispatcher ??= new Agent({
    connect: {
      lookup(hostname, options, callback) {
        dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
          if (err) return callback(err, '', 0)
          const list = addresses as unknown as { address: string; family: number }[]
          const blocked = list.find((a) => isPrivateAddress(a.address))
          if (blocked || list.length === 0) {
            return callback(new SsrfError(`'${hostname}' resolves to a private address`), '', 0)
          }
          if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list)
          callback(null, list[0].address, list[0].family)
        })
      },
    },
  })
  return dispatcher
}
