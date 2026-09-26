import { NextRequest, NextResponse } from 'next/server'
import { requireToolSession } from '@/lib/tools/route'
import { toolRunDenial } from '@/lib/tools/clientClass'
import { handleBridgeCall } from '@/lib/tools/bridge'
import { bridgeRateKey, takeBridgeCallShared } from '@/lib/tools/limits'
import { resolveBridgeTarget, targetKey } from '@/lib/tools/target'
import { appOrigin } from '@/lib/tools/origin'
import { BRIDGE_LIMITS, isBridgeMethod, type BridgeResponse } from '@/lib/tools/protocol'
import { stagedRate } from '@/lib/tools/shared/listing'
import { countCall, maybeFlushTelemetry } from '@/lib/tools/telemetry'

/**
 * The bridge endpoint — every Tool's only way to Visvine data.
 *
 * Called by the HOST page (features/tools ToolFrame) on the frame's behalf, with
 * the viewer's own session cookie. The frame itself must never reach this route:
 * it runs sandboxed without `allow-same-origin` on a separate, cookie-less
 * origin, so its fetches carry no session and land cross-site. The header check
 * below is the second lock on that door — if the sandbox or the origin split
 * ever fails, a direct call from the frame is still refused here.
 *
 * Status codes are deliberately few. A REFUSAL is not a transport failure: a
 * perimeter denial, a missing note, a rate limit and a bad param all come back
 * 200 carrying `{ ok: false, error }`, because the SDK branches on the code and
 * a Tool must be able to handle its own failures. Only four things are not
 * bridge answers at all — no session (401), a body too big to parse safely
 * (413), a request that did not come from the app (403), and a phone app,
 * which runs no Tools (403, lib/tools/clientClass.ts).
 */

/** Room for the envelope (`target`, `method`) around the params budget. */
const ENVELOPE_SLACK_BYTES = 4_096

function json(body: BridgeResponse, status = 200): NextResponse {
  return NextResponse.json(body, { status })
}

/**
 * Did this request come from the Visvine app itself?
 *
 * `Sec-Fetch-Site` is set by the browser and cannot be forged by page script:
 * `same-origin` is the host page's own fetch, and `none` is a user-initiated
 * navigation. A sandboxed frame's fetch is `cross-site` with an `Origin` of
 * `null`, so it fails both halves. The `Origin` fallback covers clients that
 * send it without the fetch-metadata headers.
 */
function fromApp(req: NextRequest): boolean {
  const site = req.headers.get('sec-fetch-site')
  if (site === 'same-origin' || site === 'none') return true
  const origin = req.headers.get('origin')
  return origin !== null && origin.trim().replace(/\/+$/, '').toLowerCase() === appOrigin().toLowerCase()
}

/**
 * A file travels as a base64 data URL, a third larger than its bytes — the one
 * call whose params may run past `maxParamsBytes`, and only to the upload cap.
 */
const UPLOAD_PARAMS_BYTES = Math.ceil((BRIDGE_LIMITS.maxUploadBytes * 4) / 3) + 1_024

export async function POST(req: NextRequest) {
  const caller = await requireToolSession()
  if (caller instanceof Response) return caller
  const { session, client } = caller
  // Not a refusal a Tool handles but a client that runs no Tools at all.
  const phone = toolRunDenial(client)
  if (phone) return json({ ok: false, error: phone }, 403)

  if (!fromApp(req)) {
    return json({ ok: false, error: { code: 'forbidden', message: 'Not a request from Visvine.' } }, 403)
  }

  // Read the body as text first so an oversized one is refused by SIZE rather
  // than by whatever JSON.parse does with it.
  const raw = await req.text()
  if (Buffer.byteLength(raw, 'utf8') > UPLOAD_PARAMS_BYTES + ENVELOPE_SLACK_BYTES) {
    return json(
      { ok: false, error: { code: 'too_large', message: 'That call is too big for the bridge.' } },
      413,
    )
  }

  let body: unknown
  try {
    body = JSON.parse(raw) as unknown
  } catch {
    return json({ ok: false, error: { code: 'invalid', message: 'Body must be JSON.' } })
  }
  if (!body || typeof body !== 'object') {
    return json({ ok: false, error: { code: 'invalid', message: 'Body must be a bridge request.' } })
  }
  const { target, method, params } = body as { target?: unknown; method?: unknown; params?: unknown }
  if (!isBridgeMethod(method)) {
    return json({ ok: false, error: { code: 'invalid', message: `Unknown method ${String(method)}.` } })
  }
  // The params budget is its own cap so a Tool learns which limit it hit, and so
  // the envelope can never be used to smuggle a large payload past it.
  const paramsCap = method === 'resources.upload' ? UPLOAD_PARAMS_BYTES : BRIDGE_LIMITS.maxParamsBytes
  if (params !== undefined && Buffer.byteLength(JSON.stringify(params) ?? '', 'utf8') > paramsCap) {
    return json(
      {
        ok: false,
        error: {
          code: 'too_large',
          message: `Params are over the ${paramsCap} byte limit.`,
        },
      },
      413,
    )
  }

  const resolved = await resolveBridgeTarget(session, target, undefined, client)
  if ('code' in resolved) return json({ ok: false, error: resolved })

  // Rate limited AFTER resolution, so the budget is per resolved TARGET rather
  // than per unauthenticated guess, and a viewer's two Tools — two installs, or
  // two drafts being previewed — cannot starve each other. A listing still in
  // its stage runs at half the rate.
  const decision = await takeBridgeCallShared(
    bridgeRateKey(session.userId, targetKey(resolved)),
    stagedRate(BRIDGE_LIMITS.callsPerMinute, resolved.staged === true),
  )
  if (!decision.ok) {
    return json({
      ok: false,
      error: {
        code: 'rate_limited',
        message: `Too many calls — try again in ${Math.ceil(decision.retryAfterMs / 1000)}s.`,
      },
    })
  }

  const started = Date.now()
  const response = await handleBridgeCall(resolved, method, params)
  // What an install did, as counts (lib/tools/telemetry.ts); flushed on the
  // request path once a minute has passed, never on a timer.
  if (resolved.installId && resolved.versionId) {
    const path = params && typeof params === 'object' && typeof (params as { path?: unknown }).path === 'string' ? (params as { path: string }).path : null
    countCall({
      installId: resolved.installId,
      versionId: resolved.versionId,
      viewerId: session.userId,
      method,
      refused: response.ok ? null : response.error.code,
      bytesIn: raw.length,
      bytesOut: response.ok ? (JSON.stringify(response.value) ?? '').length : 0,
      path: method === 'context.read' ? path : null,
      dataMs: method === 'data.call' ? Date.now() - started : 0,
    })
    await maybeFlushTelemetry()
  }
  return json(response)
}
