/**
 * The bytes the unfurler brings home — a page's image, its favicon — through
 * the same gated fetch as the page itself (lib/linkPreview.ts#ssrfSafeFetch):
 * every hop's host checked, every socket's address checked, a hard time limit,
 * and a byte ceiling that stops reading rather than trusting Content-Length.
 */
import { ssrfSafeFetch } from '@/lib/linkPreview'

const IMAGE_TIMEOUT_MS = 6_000

/** Up to `maxBytes` of a body, or null when it is larger — never a truncated file. */
export async function readBounded(res: Response, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {})
    return null
  }
  const reader = res.body?.getReader()
  if (!reader) return null
  const parts: Uint8Array[] = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.length
    if (received > maxBytes) {
      await reader.cancel().catch(() => {})
      return null
    }
    parts.push(value)
  }
  return Buffer.concat(parts)
}

/** An image from the open web, or null when it is not one, too large, or unreachable. */
export async function fetchPublicImage(url: string, maxBytes: number): Promise<Buffer | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS)
  try {
    const res = await ssrfSafeFetch(url, controller.signal)
    if (!res || !res.ok) return null
    const type = (res.headers.get('content-type') ?? '').toLowerCase()
    if (!type.startsWith('image/') && !type.includes('icon') && type !== 'application/octet-stream') {
      await res.body?.cancel().catch(() => {})
      return null
    }
    return await readBounded(res, maxBytes)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
