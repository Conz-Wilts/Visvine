/**
 * The one auth preamble every space-facing agents route uses: session →
 * member-resolved context → the Agents tool must be reachable by this caller
 * (per-space toggle / admins-only switch) → principal.
 */
import { NextResponse } from 'next/server'
import { featureAccessForbidden } from '@/lib/auth'
import { principalOf, resolveContext, type ResolvedContext } from '@/lib/notes/resolve'
import { requireSession } from '@/lib/session'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'

export interface AgentsRouteContext {
  resolved: ResolvedContext
  principal: ContextPrincipal
}

export async function requireAgentsAccess(spaceId: string): Promise<AgentsRouteContext | Response> {
  const session = await requireSession()
  if (session instanceof Response) return session
  const resolved = await resolveContext(session, spaceId)
  if (resolved instanceof Response) return resolved
  if (await featureAccessForbidden(session.userId, spaceId, 'agents', session.email)) {
    return NextResponse.json({ error: 'The Agents tool is not available to you in this space.' }, { status: 403 })
  }
  const principal = await principalOf(resolved)
  return { resolved, principal }
}

export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })
