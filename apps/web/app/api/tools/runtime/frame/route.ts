import { randomBytes } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { frameCsp, frameHeaders, toolMediaSources } from '@/lib/tools/csp'
import { renderFrameDocument, renderFrameErrorDocument } from '@/lib/tools/frameDocument'
import { verifyFrameToken } from '@/lib/tools/frameToken'
import { appOrigin } from '@/lib/tools/origin'
import { resolveRuntimeBundle } from '@/lib/tools/runtimeBundle'
import { vendorVersions } from '@/lib/tools/vendorBundle'

/**
 * The Tool frame document — the only page the tools host serves.
 *
 * `?token=` is the whole of the authentication here: this host is cookie-less
 * by construction (lib/tools/origin.ts splits it off in proxy.ts) so there is
 * no session to read, and the token says only WHICH bundle to serve. Every
 * actual read or write a Tool attempts goes back to the app origin through the
 * bridge, under the viewer's own grants.
 *
 * Every answer is HTML, including the failures, because whatever comes back
 * lands inside an iframe in a Visvine page. A JSON error there would render as
 * a wall of text where the Tool should be; an error card reads as part of the
 * app. A working copy that does not compile answers 200 with the author's own
 * diagnostics — that is the "compile error in-pane" surface, not a fault.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The origin this document was requested on, which is the origin its own
 * bundle and vendor URLs must be built from. Taken from the forwarded headers
 * (Cloud Run terminates TLS, so `nextUrl.protocol` is http there) and never
 * from `TOOLS_ORIGIN`: the same routes answer on the app host too, as the
 * documented same-origin fallback, and must stay self-consistent on both.
 */
function requestOrigin(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (!host) return req.nextUrl.origin
  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const proto = forwardedProto || req.nextUrl.protocol.replace(/:$/, '') || 'https'
  return `${proto}://${host}`
}

function htmlResponse(html: string, status: number, csp: string): Response {
  return new Response(html, { status, headers: frameHeaders(csp) })
}

export async function GET(req: NextRequest): Promise<Response> {
  const selfOrigin = requestOrigin(req)
  const app = appOrigin()

  const token = req.nextUrl.searchParams.get('token')
  const payload = token ? await verifyFrameToken(token) : null
  if (!payload || !token) {
    return htmlResponse(
      renderFrameErrorDocument({
        title: 'This Tool frame link is not valid',
        message: 'It may have expired. Reload the page to start it again.',
      }),
      403,
      frameCsp({ appOrigin: app, selfOrigin }),
    )
  }

  const bundle = await resolveRuntimeBundle(payload)
  if (!bundle.ok) {
    return htmlResponse(
      renderFrameErrorDocument({
        title: bundle.title,
        message: bundle.message,
        details: bundle.details,
      }),
      bundle.status,
      frameCsp({ appOrigin: app, selfOrigin }),
    )
  }

  // The vendor build is memoised per process, so this is a hash lookup after
  // the first frame load of the process's life.
  const versions = await vendorVersions()
  // base64url: `+` and `/` are legal in a CSP nonce but need no thought about
  // quoting, and this value goes into both a header and an attribute.
  const nonce = randomBytes(18).toString('base64url')

  const html = renderFrameDocument({
    selfOrigin,
    appOrigin: app,
    bundleUrl: `${selfOrigin}/api/tools/runtime/bundle/${bundle.id}?token=${encodeURIComponent(token)}`,
    vendorBase: `${selfOrigin}/api/tools/runtime/vendor`,
    vendorVersions: versions,
    nonce,
    kit: bundle.kit,
  })
  // Violations go to the sink on this same origin, carrying the token that
  // says which install they came from (app/api/tools/runtime/report).
  const reportUrl = `${selfOrigin}/api/tools/runtime/report?token=${encodeURIComponent(token)}`
  const csp = frameCsp({
    appOrigin: app,
    selfOrigin,
    nonce,
    mediaSources: toolMediaSources(app, process.env.GCS_CDN_BASE_URL),
    reportUrl,
  })
  return htmlResponse(html, 200, csp)
}
