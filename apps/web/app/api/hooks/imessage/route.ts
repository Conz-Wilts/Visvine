import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { handleInbound, IMESSAGE_AWAIT_MS } from '@/lib/imessage/service'
import { sendblueConfigured, webhookSecretMatches } from '@/lib/imessage/sendblue'
import { inboundPayloadSchema } from '@/lib/imessage/shared/inbound'

export const dynamic = 'force-dynamic'
// Sendblue waits 45 s; the handler waits IMESSAGE_AWAIT_MS for the run and
// answers, and the run-end hook sends the reply whenever the run ends.
export const maxDuration = 60

/**
 * Sendblue's one webhook, for every line on the account (docs/imessage.md).
 *
 * Under /api/hooks/, which proxy.ts serves without a session: the route
 * authenticates the PROVIDER with the account's signing secret
 * (`sb-signing-secret`, compared in constant time) and the SENDER by their
 * verified phone link, inside `handleInbound`. Anything the provider sends
 * that is not a text to a line we know is answered 200 with nothing done —
 * a 5xx would only make Sendblue retry it.
 */
export async function POST(req: NextRequest) {
  if (!sendblueConfigured()) return NextResponse.json({ error: 'iMessage is not configured' }, { status: 503 })
  if (!webhookSecretMatches(req.headers)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const parsed = inboundPayloadSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, reason: 'malformed' }, { status: 400 })

  try {
    const outcome = await handleInbound(parsed.data)
    if (outcome.kind === 'refused' || outcome.kind === 'ignored') {
      logger.info('imessage.inbound', { outcome: outcome.kind, reason: outcome.reason })
    }
    return NextResponse.json({ ok: true, ...outcome })
  } catch (err) {
    // 200 anyway: the message is recorded as seen, so a retry would be deduped
    // and do nothing; letting Sendblue retry only repeats the failure.
    logger.error('imessage.inbound.failed', { err, handle: parsed.data.message_handle })
    return NextResponse.json({ ok: false, reason: 'failed' })
  }
}

export function GET() {
  return NextResponse.json({ error: 'method not allowed', waits_ms: IMESSAGE_AWAIT_MS }, { status: 405 })
}
