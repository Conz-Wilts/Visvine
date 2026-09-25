import type { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { takeToken } from '@/lib/rateLimit'
import { verifyFrameToken } from '@/lib/tools/frameToken'
import { originOnly } from '@/lib/tools/incidents'
import { raiseIncident } from '@/lib/tools/monitor'
import { countEvent } from '@/lib/tools/telemetry'
import { recordReviewEvent } from '@/lib/tools/review/events'

/**
 * Where a Tool frame's CSP violations are sent — by the BROWSER, not the
 * Tool: `report-uri` in the frame's policy (lib/tools/csp.ts)
 * name this route with the frame token, so a report is attributed to the
 * install whose frame broke the rule. A frame's sandbox already blocked the
 * request; this is how a person hears that it tried.
 *
 * Served on the tools origin like the rest of the runtime. A report can land
 * well after the token's five minutes, so the token is read with an hour's
 * tolerance — it names an install, it grants nothing here. What is stored is
 * the directive and the blocked URL's ORIGIN: a Tool leaking data puts it in
 * that URL, and an incident never keeps it.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 16_000
/** Reports kept per request: a page can batch many; a few say what happened. */
const MAX_REPORTS = 5

interface Violation {
  directive: string | null
  blocked: string | null
  disposition: string | null
}

function readViolations(body: unknown): Violation[] {
  const out: Violation[] = []
  const push = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return
    const r = raw as Record<string, unknown>
    const str = (v: unknown) => (typeof v === 'string' ? v : null)
    out.push({
      directive: (str(r['effective-directive']) ?? str(r.effectiveDirective) ?? str(r['violated-directive']))?.slice(0, 64) ?? null,
      blocked: originOnly(r['blocked-uri'] ?? r.blockedURL),
      disposition: str(r.disposition)?.slice(0, 16) ?? null,
    })
  }
  if (Array.isArray(body)) {
    // The Reporting API: a batch of `{ type, body }`.
    for (const item of body) {
      if (item && typeof item === 'object' && (item as { type?: unknown }).type === 'csp-violation') {
        push((item as { body?: unknown }).body)
      }
    }
  } else if (body && typeof body === 'object') {
    // `report-uri`: one `{ "csp-report": {…} }`.
    push((body as Record<string, unknown>)['csp-report'])
  }
  return out.slice(0, MAX_REPORTS)
}

function noContent(): Response {
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.nextUrl.searchParams.get('token')
  const payload = token ? await verifyFrameToken(token, { toleranceSec: 3600 }) : null
  // Never an error a browser would retry: an unattributable report is dropped.
  if (!payload) return noContent()

  const raw = await req.text()
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return noContent()
  let body: unknown
  try {
    body = JSON.parse(raw) as unknown
  } catch {
    return noContent()
  }
  const violations = readViolations(body)
  if (violations.length === 0) return noContent()

  // A frame under Visvine's dynamic run reports into its run's evidence, not
  // the incident queue: the run exists to catch exactly this.
  if (payload.kind === 'review') {
    for (const violation of violations) {
      await recordReviewEvent(payload.runId, 'csp', null, { directive: violation.directive, blocked: violation.blocked })
    }
    return noContent()
  }

  const scope = payload.kind === 'install' ? payload.installId : `preview:${payload.spaceId}/${payload.name}`
  const limit = await takeToken(`tools:csp:${scope}:${payload.viewerId}`, { capacity: 10, refillPerSec: 0.05 })
  if (!limit.ok) return noContent()

  let subject: { key: string; versionId: string | null; installId: string | null; listingId: string | null }
  if (payload.kind === 'install') {
    const install = await prisma.appToolInstall.findUnique({
      where: { id: payload.installId },
      select: { key: true, versionId: true, listingId: true },
    })
    if (!install) return noContent()
    subject = { key: install.key, versionId: install.versionId, installId: payload.installId, listingId: install.listingId }
    countEvent({ installId: payload.installId, versionId: install.versionId, kind: 'csp' })
  } else {
    subject = { key: `${payload.spaceId}/${payload.name}`, versionId: null, installId: null, listingId: null }
  }

  // A flag from one viewer; the same from a second holds the listing (lib/tools/monitor.ts).
  await raiseIncident({
    kind: 'csp',
    severity: 'flag',
    source: 'viewer',
    ...subject,
    spaceId: payload.spaceId,
    viewerId: payload.viewerId,
    detail: { violations },
  })
  return noContent()
}
