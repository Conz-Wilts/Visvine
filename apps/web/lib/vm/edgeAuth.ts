/**
 * The boundary between the two halves of the runtime.
 *
 * The control plane and the edge (apps/agent-edge) run on different providers,
 * so the only thing standing between them is a shared token. It authenticates
 * the CHANNEL and nothing else: what an agent may do is re-resolved from the
 * database on every call, exactly as it is for a human or an MCP client. A
 * caller holding this token can report egress records and be handed policy —
 * it can never be an agent, a person, or a grant.
 *
 * Set the same value on both sides:
 *   Cloud Run   EDGE_SERVICE_TOKEN=<secret>
 *   edge        pnpm --filter @visvine/agent-edge exec wrangler secret put EDGE_SERVICE_TOKEN
 */
import { timingSafeEqual } from 'node:crypto'

function bearer(req: Request): string | null {
  const header = req.headers.get('authorization') ?? ''
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null
}

/** Null when the caller is the edge; otherwise the reason, which is also the 401 body. */
export function verifyEdgeCaller(req: Request): string | null {
  const expected = process.env.EDGE_SERVICE_TOKEN
  // Absent configuration closes the door rather than opening it: an edge that
  // cannot be authenticated is an edge that does not get in.
  if (!expected || expected.length < 32) return 'EDGE_SERVICE_TOKEN is not configured'

  const token = bearer(req)
  if (!token) return 'missing bearer token'

  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return 'token is not the edge service token'
  return timingSafeEqual(a, b) ? null : 'token is not the edge service token'
}
