/**
 * The caller behind a web or mobile session, as an action sees it.
 *
 * A session carries EVERY scope. That is not a loophole: a scope is a statement
 * about what a third-party client was granted on someone's behalf, and there is
 * no third party here — this is the person themselves, signed in, with exactly
 * the powers the rest of the app already gives them. Every action still
 * re-derives their membership and grants live, so `/api/actions/*` can do
 * neither more nor less than the routes it sits beside.
 */
import { MCP_SCOPES } from '@/lib/mcp/scopes'
import type { SessionPayload } from '@/lib/session'
import type { ActionCaller } from '@/lib/actions/types'

export function callerFromSession(session: SessionPayload): ActionCaller {
  return {
    userId: session.userId,
    name: session.name,
    email: session.email,
    scopes: [...MCP_SCOPES],
  }
}
