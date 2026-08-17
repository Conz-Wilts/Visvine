import type { NextRequest } from 'next/server'
import { bundleHeaders } from '@/lib/tools/csp'
import { ifNoneMatchSatisfied } from '@/lib/tools/runtimeBundle'
import { isVendorFileName, vendorFile } from '@/lib/tools/vendorBundle'

/**
 * The four vendor ESM modules the frame's import map points at: React, the JSX
 * runtime, the DOM client and `@visvine/tool-kit`.
 *
 * Deliberately PUBLIC — no token. There is nothing here that a `<script>` tag
 * on any page could not already fetch from npm, and gating it would mean every
 * Tool frame paying a token check for four files that are byte-identical for
 * every viewer in every space. What is not public is the Tool's own bundle,
 * which is the sibling route.
 *
 * Only the four names resolve; anything else is a 404 rather than an attempt,
 * so this can never become a way to ask the server to build something.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function textResponse(status: number, message: string): Response {
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
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const name = decodeURIComponent((await params).file)
  if (!isVendorFileName(name)) return textResponse(404, 'Unknown Tool runtime file.')

  let built
  try {
    built = await vendorFile(name)
  } catch (e) {
    console.error('[tools] vendor build failed', name, e)
    return textResponse(500, 'The Tool runtime could not be built.')
  }

  // A year of immutable caching only for a URL that names the bytes it wants.
  // A stale or missing `?v=` still resolves — the frame keeps working across a
  // deploy — but must not be cached, or that URL would be pinned to the wrong
  // build forever.
  const versioned = req.nextUrl.searchParams.get('v') === built.etag
  const headers = {
    ...bundleHeaders({ immutable: versioned }),
    ETag: `"${built.etag}"`,
  }
  if (ifNoneMatchSatisfied(req.headers.get('if-none-match'), built.etag)) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(built.code, { status: 200, headers })
}
