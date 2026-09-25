/**
 * The review ticket — how the dynamic run's browser signs in.
 *
 * The run's browser may be a Visvine machine, which takes a URL and nothing
 * else: no cookie can be handed to it. So the runner opens
 * `/api/tools/review-run/enter?ticket=…`, and that route trades the ticket for
 * a short session as the REVIEW RUNNER — a system account whose only
 * membership is the run's own honeypot — then sends the browser to the review
 * page. The ticket names one run, lives two minutes, and is signed like the
 * session with its own audience, so neither can stand in for the other. It is
 * redeemed only while its run is running and only for the runner that run
 * names (app/api/tools/review-run/enter/route.ts).
 */
import { SignJWT, jwtVerify } from 'jose'

const TICKET_AUDIENCE = 'visvine-tool-review'
const TICKET_TTL_SEC = 120

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET
  if (!value || value.length < 32) throw new Error('AUTH_SECRET must be set (32+ characters)')
  return new TextEncoder().encode(value)
}

export async function mintReviewTicket(runId: string, runnerUserId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ runId, runnerUserId })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(TICKET_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + TICKET_TTL_SEC)
    .sign(secret())
}

export async function verifyReviewTicket(ticket: string): Promise<{ runId: string; runnerUserId: string } | null> {
  try {
    const { payload } = await jwtVerify(ticket, secret(), { algorithms: ['HS256'], audience: TICKET_AUDIENCE })
    const { runId, runnerUserId } = payload as Record<string, unknown>
    if (typeof runId !== 'string' || !runId || typeof runnerUserId !== 'string' || !runnerUserId) return null
    return { runId, runnerUserId }
  } catch {
    return null
  }
}
