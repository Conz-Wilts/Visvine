/**
 * Fetch a public https page or file on an agent's behalf — `fetch_url` for Space
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
import { readableText } from '@/lib/links/shared/readable'

/** Most redirects one fetch may follow; every hop is re-gated. */
const MAX_HOPS = 3
const CAP_CHARS = 60_000
/** What is read off the wire before the page is made readable — markup is most of a page's bytes. */
const RAW_CAP_BYTES = 1_000_000
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

/**
 * Follow a public URL to its final response, every hop gated. The one loop
 * both readers share, so the text read and the byte read cannot gate
 * differently.
 */
async function openPublic(
  rawUrl: string,
  io: PublicFetchIo,
): Promise<{ ok: true; res: Response; url: URL } | { ok: false; error: string; status?: number }> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, error: 'not an absolute URL' }
  }
  for (let hops = 0; ; hops++) {
    const devHttpOk = url.protocol === 'http:' && process.env.NODE_ENV === 'development'
    if (url.protocol !== 'https:' && !devHttpOk) return { ok: false, error: 'only https URLs can be fetched' }
    try {
      await io.assertHost(url.hostname)
    } catch (e) {
      return { ok: false, error: e instanceof SsrfError ? e.message : 'host check failed' }
    }
    let res: Response
    try {
      res = await io.fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' })
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'fetch failed' }
    }
    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location !== null) {
      // The body of the 3xx itself is of no interest; drop it before moving on.
      await res.body?.cancel().catch(() => {})
      if (hops >= MAX_HOPS) return { ok: false, error: 'too many redirects', status: res.status }
      try {
        url = new URL(location, url)
      } catch {
        return { ok: false, error: `bad redirect target: ${location}` }
      }
      continue
    }
    return { ok: true, res, url }
  }
}

/**
 * A public page as text a model reads well: HTML and JSON made readable
 * (lib/links/shared/readable.ts), then capped. The first line is the status,
 * and says so when the text is a readable form of a larger body.
 */
export async function fetchPublicText(rawUrl: string, io: PublicFetchIo = defaultIo()): Promise<string> {
  const opened = await openPublic(rawUrl, io)
  if (!opened.ok) {
    return opened.status ? `status ${opened.status}\n…[${opened.error}]` : `error: ${opened.error}`
  }
  try {
    const { text: raw, truncated: cutOnWire } = await readCapped(opened.res, RAW_CAP_BYTES)
    const readable = readableText(raw, opened.res.headers.get('content-type'), opened.url.href)
    const text = readable.length > CAP_CHARS ? readable.slice(0, CAP_CHARS) : readable
    const truncated = cutOnWire || readable.length > CAP_CHARS
    const note = readable !== raw ? ` · readable text, ${readable.length.toLocaleString('en-US')} of ${raw.length.toLocaleString('en-US')} chars` : ''
    return `status ${opened.res.status}${note}\n${truncated ? text + '\n…[truncated]' : text}`
  } catch (e) {
    return `error: ${e instanceof Error ? e.message : 'fetch failed'}`
  }
}

export type PublicFile =
  | { ok: true; bytes: Buffer; contentType: string | null; filename: string | null }
  | { ok: false; error: string }

/**
 * Fetch a public file's bytes — an image or a PDF a person pointed at, or the
 * download link a chat client hands a tool for a file attached to the
 * conversation. Same per-hop gate as the text read; the body is streamed
 * against `maxBytes` and refused, not truncated, past it, because half a file
 * is not a file.
 */
export async function fetchPublicBytes(
  rawUrl: string,
  maxBytes: number,
  io: PublicFetchIo = defaultIo(),
): Promise<PublicFile> {
  const opened = await openPublic(rawUrl, io)
  if (!opened.ok) return { ok: false, error: opened.error }
  const { res, url } = opened
  if (!res.ok) {
    await res.body?.cancel().catch(() => {})
    return { ok: false, error: `the server answered ${res.status}` }
  }
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {})
    return { ok: false, error: `the file is larger than ${Math.floor(maxBytes / 1024 / 1024)}MB` }
  }
  const chunks: Uint8Array[] = []
  let total = 0
  if (res.body) {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        return { ok: false, error: `the file is larger than ${Math.floor(maxBytes / 1024 / 1024)}MB` }
      }
      chunks.push(value)
    }
  }
  const contentType = res.headers.get('content-type')?.split(';')[0].trim() || null
  return {
    ok: true,
    bytes: Buffer.concat(chunks),
    contentType,
    filename: filenameOf(res.headers.get('content-disposition'), url),
  }
}

/** The name a download says it has, else the URL's last segment. */
function filenameOf(disposition: string | null, url: URL): string | null {
  const star = disposition?.match(/filename\*=(?:UTF-8'')?([^;]+)/i)
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''))
    } catch {
      /* fall through */
    }
  }
  const plain = disposition?.match(/filename="?([^";]+)"?/i)
  if (plain) return plain[1].trim()
  const last = url.pathname.split('/').filter(Boolean).pop()
  if (!last) return null
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}
