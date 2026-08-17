import type { NextRequest } from 'next/server'
import { bundleHeaders } from '@/lib/tools/csp'
import { verifyFrameToken } from '@/lib/tools/frameToken'
import {
  assetEtag,
  ifNoneMatchSatisfied,
  loadRuntimeBundleCode,
  resolveRuntimeBundle,
} from '@/lib/tools/runtimeBundle'

/**
 * A Tool's compiled ESM, for the module script in the frame document.
 *
 * Same `?token=` as the frame, and the same resolution: the id in the path is
 * compared with the one the token resolves to, never looked up on its own. A
 * token for one Tool cannot read another Tool's code, and a bundle id on its
 * own is worth nothing.
 *
 * `Cross-Origin-Resource-Policy: cross-origin` (from `bundleHeaders`) is what
 * lets the app-origin page's iframe load this at all when the tools host is
 * configured; no cookie is read or set here, on either host.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function deny(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  const token = req.nextUrl.searchParams.get('token')
  const payload = token ? await verifyFrameToken(token) : null
  if (!payload) return deny(403, 'Invalid or expired Tool frame token.')

  const ref = await resolveRuntimeBundle(payload)
  // A build that did not compile has no bundle to serve; the frame document
  // renders its diagnostics instead, and never points a script tag here.
  if (!ref.ok) return deny(ref.status === 200 ? 404 : ref.status, ref.title)
  if (ref.id !== decodeURIComponent(id)) return deny(403, 'This token cannot load that bundle.')

  const code = await loadRuntimeBundleCode(ref)
  if (code === null) return deny(404, 'That Tool bundle is gone.')

  const etag = assetEtag(code)
  const headers = { ...bundleHeaders({ immutable: ref.immutable }), ETag: `"${etag}"` }
  if (ifNoneMatchSatisfied(req.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(code, { status: 200, headers })
}
