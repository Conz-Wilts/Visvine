/**
 * The one auth preamble every space-facing agents route uses: session →
 * member-resolved context → principal. There is no feature gate: an agent is
 * a note under `agents/`, part of Context, and Context is always on. What a
 * caller may do with it is decided by the note's own grants and the
 * author-or-admin rules in lib/agents/service.ts.
 */
import { NextResponse } from 'next/server'
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
  const principal = await principalOf(resolved)
  return { resolved, principal }
}

export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })
