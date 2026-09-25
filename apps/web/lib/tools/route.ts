/**
 * The auth preamble every space-facing Tools route uses: session →
 * member-resolved context → the Tools feature must be reachable by this caller
 * (per-space toggle / admins-only switch) → principal.
 *
 * The same shape as lib/agents/route.ts#requireAgentsAccess, and the same
 * reason: a space that switched Tools off must refuse here too, not only in the
 * navbar that stopped showing the icon. lib/tools/target.ts already enforces the
 * key on the bridge and the frame token; this is that gate for the REST side.
 */
import { NextResponse } from 'next/server'
import { featureAccessForbidden } from '@/lib/auth'
import { principalOf, resolveContext, type ResolvedContext } from '@/lib/notes/resolve'
import { getSessionInfo, requireSession, type SessionPayload } from '@/lib/session'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import { toolClientOf, type ToolClient } from './clientClass'

export interface ToolsRouteContext {
  resolved: ResolvedContext
  principal: ContextPrincipal
}

export async function requireToolsAccess(spaceId: string): Promise<ToolsRouteContext | Response> {
  const session = await requireSession()
  if (session instanceof Response) return session
  const resolved = await resolveContext(session, spaceId)
  if (resolved instanceof Response) return resolved
  if (await featureAccessForbidden(session.userId, spaceId, 'directory', session.email)) {
    return NextResponse.json({ error: 'Tools are not available to you in this space.' }, { status: 403 })
  }
  const principal = await principalOf(resolved)
  return { resolved, principal }
}

export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

/**
 * The session behind a request that RUNS a Tool (frame token, bridge, changes,
 * status), with the client class the run doors judge
 * (lib/tools/clientClass.ts). The same liveness check as requireSession.
 */
export async function requireToolSession(): Promise<{ session: SessionPayload; client: ToolClient } | Response> {
  const session = await requireSession()
  if (session instanceof Response) return session
  const info = await getSessionInfo()
  return { session, client: info ? toolClientOf(info) : 'app' }
}
