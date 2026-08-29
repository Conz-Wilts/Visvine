/**
 * Letting a person watch a machine.
 *
 * The control plane authorizes the human — session, space, admin — and mints a
 * ticket naming exactly one machine for sixty seconds. The edge verifies the
 * signature and the name and nothing else: it never learns who the viewer is,
 * because it has no way to check and no business deciding.
 *
 * The browser is never given `EDGE_SERVICE_TOKEN`. That token is a key to every
 * machine on the platform, and a key that reaches a browser is a key in
 * devtools, in a screen share and in a bug report.
 *
 * The signing implementation is mirrored in apps/agent-edge/src/ticket.ts — the
 * only thing shared between the two halves is the secret, so keep the two in
 * step and let the round-trip test say when they are not.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

/** Long enough to open a socket, useless to keep. */
export const TICKET_TTL_SECONDS = 60

interface TicketClaims {
  machine: string
  exp: number
}

function base64url(value: Buffer): string {
  return value.toString('base64url')
}

function sign(body: string, secret: string): string {
  return base64url(createHmac('sha256', secret).update(body).digest())
}

/** The name a ticket is bound to. Same shape on both sides of the boundary. */
export function machineRef(spaceId: string, agentName: string): string {
  return `${spaceId}/${agentName}`
}

export function mintWatchTicket(spaceId: string, agentName: string, secret: string, now = Date.now()): string {
  const claims: TicketClaims = {
    machine: machineRef(spaceId, agentName),
    exp: Math.floor(now / 1000) + TICKET_TTL_SECONDS,
  }
  const body = base64url(Buffer.from(JSON.stringify(claims)))
  return `${body}.${sign(body, secret)}`
}

/** Null when the ticket is good for that machine, else the reason. Used by the tests. */
export function verifyWatchTicket(token: string, machine: string, secret: string, now = Date.now()): string | null {
  const [body, signature] = token.split('.')
  if (!body || !signature) return 'malformed ticket'
  const expected = sign(body, secret)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return 'the ticket is not signed by this platform'

  let claims: TicketClaims
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TicketClaims
  } catch {
    return 'malformed ticket'
  }
  if (claims.machine !== machine) return 'the ticket is for a different machine'
  if (!Number.isFinite(claims.exp) || claims.exp * 1000 < now) return 'the ticket has expired'
  return null
}

/** Where the browser opens its socket, ticket attached. */
export function watchUrl(edgeUrl: string, spaceId: string, agentName: string, ticket: string): string {
  const base = edgeUrl.replace(/^http/, 'ws').replace(/\/+$/, '')
  const params = new URLSearchParams({ space: spaceId, agent: agentName, ticket })
  return `${base}/watch?${params.toString()}`
}
