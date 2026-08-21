/**
 * Fetch a public https page on an agent's behalf — `fetch_url` for Space
 * agents (lib/agents/tools.ts) and the docs probe of the connector-creation
 * loop (agent.ts).
 *
 * The gate is per hop: redirects are followed manually, and every target is
 * judged exactly like the first URL — scheme first, then the SSRF check — so a
 * public URL that 30x-redirects at an internal address gets nowhere. This is
 * the same discipline hostFetch applies to connector runs; this module exists
 * because that one is shaped around a connector perimeter, which a plain
 * "any public host" fetch does not have.
 *
 * The body is streamed against a byte cap rather than buffered whole — an
 * upstream must not be able to make the process allocate gigabytes before the
 * cap is applied.
 */
import { assertPubliclyRoutable, SsrfError } from '@/lib/net/ssrf'
import { allowPrivateHosts } from './config'
import { readCapped } from './hostFetch'

/** Most redirects one fetch may follow; every hop is re-gated. */
const MAX_HOPS = 3
const CAP_CHARS = 60_000
const TIMEOUT_MS = 15_000

/** The seam tests run through: fake fetch + host check, no network, no DNS. */
export interface PublicFetchIo {
  fetchImpl: typeof fetch
  assertHost: (hostname: string) => Promise<void>
}

function defaultIo(): PublicFetchIo {
  return {
    fetchImpl: fetch,
    assertHost: (hostname) => assertPubliclyRoutable(hostname, { allowPrivate: allowPrivateHosts() }),
  }
}

export async function fetchPublicText(rawUrl: string, io: PublicFetchIo = defaultIo()): Promise<string> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return 'error: not an absolute URL'
  }
  for (let hops = 0; ; hops++) {
    const devHttpOk = url.protocol === 'http:' && process.env.NODE_ENV === 'development'
    if (url.protocol !== 'https:' && !devHttpOk) return 'error: only https URLs can be fetched'
    try {
      await io.assertHost(url.hostname)
    } catch (e) {
      return e instanceof SsrfError ? `error: ${e.message}` : 'error: host check failed'
    }
    let res: Response
    try {
      res = await io.fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' })
    } catch (e) {
      return `error: ${e instanceof Error ? e.message : 'fetch failed'}`
    }
    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location !== null) {
      // The body of the 3xx itself is of no interest; drop it before moving on.
      await res.body?.cancel().catch(() => {})
      if (hops >= MAX_HOPS) return `status ${res.status}\n…[too many redirects]`
      try {
        url = new URL(location, url)
      } catch {
        return `error: bad redirect target: ${location}`
      }
      continue
    }
    try {
      const { text, truncated } = await readCapped(res, CAP_CHARS)
      return `status ${res.status}\n${truncated ? text + '\n…[truncated]' : text}`
    } catch (e) {
      return `error: ${e instanceof Error ? e.message : 'fetch failed'}`
    }
  }
}
