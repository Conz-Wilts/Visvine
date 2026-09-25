// POST /api/tools/frame-token — mint the one credential a Tool iframe is given.
//
// The frame is served from a cookie-less origin, so it cannot authenticate with
// a session; the HOST page, which does have one, asks here for a short-lived
// token naming what the frame may load. The token authorises nothing beyond
// "serve me this bundle" — every read and write the Tool then attempts goes back
// through /api/tools/bridge under the viewer's own grants.
//
// It answers with the handshake facts too (install, degraded, viewer), because
// they are all server-derived and the alternative is a second round trip that
// asks the same questions. See FrameTokenResponse.

import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/session'
import { TOOL_NAME_RE } from '@/lib/tools/config'
import { mintFrameToken } from '@/lib/tools/frameToken'
import { frameUrl } from '@/lib/tools/origin'
import { resolveBridgeTarget } from '@/lib/tools/target'
import type { BridgeError, BridgeTarget } from '@/lib/tools/protocol'
// Type-only, and pointing at the single consumer of this route on purpose: the
// mint response IS three fifths of the bridge's init payload, and declaring it
// twice is how the two drift.
import type { FrameTokenResponse } from '@/features/tools/lib/hostBridge'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The target off the wire, or null. Shape only — authorisation is below. */
function parseTarget(value: unknown): BridgeTarget | null {
  if (!isRecord(value)) return null
  if (value.kind === 'install' && typeof value.installId === 'string' && value.installId) {
    return { kind: 'install', installId: value.installId }
  }
  if (
    value.kind === 'preview' &&
    typeof value.spaceId === 'string' &&
    value.spaceId &&
    typeof value.name === 'string' &&
    TOOL_NAME_RE.test(value.name)
  ) {
    return { kind: 'preview', spaceId: value.spaceId, name: value.name }
  }
  return null
}

function fail(status: number, error: string, code?: string): NextResponse {
  return NextResponse.json(code ? { error, code } : { error }, { status })
}

/** A bridge refusal → this route's status code. */
function statusOf(error: BridgeError): number {
  if (error.code === 'not_found') return 404
  if (error.code === 'forbidden' || error.code === 'revoked') return 403
  return 400
}

export async function POST(req: NextRequest) {
  const session = await requireSession()
  if (session instanceof Response) return session

  const body: unknown = await req.json().catch(() => null)
  const target = parseTarget(isRecord(body) ? body.target : null)
  if (!target) return fail(400, 'A valid target is required')

  // The one door: membership, the `tools` feature key, an install's `enabled`
  // flag and (for a preview) read access to the working copy are all decided
  // here, not re-asked in this route — see lib/tools/target.ts.
  const resolved = await resolveBridgeTarget(session, target)
  if ('code' in resolved) return fail(statusOf(resolved), resolved.message, resolved.code)

  const token = await mintFrameToken(
    resolved.installId !== null
      ? { kind: 'install', viewerId: session.userId, spaceId: resolved.spaceId, installId: resolved.installId }
      : { kind: 'preview', viewerId: session.userId, spaceId: resolved.spaceId, name: resolved.config.name },
  )
  const response: FrameTokenResponse = {
    token,
    frameUrl: frameUrl({ token }),
    install: resolved.install,
    degraded: resolved.degraded,
    viewer: { id: session.userId, name: session.name, isAdmin: resolved.isAdmin },
  }
  return NextResponse.json(response)
}
