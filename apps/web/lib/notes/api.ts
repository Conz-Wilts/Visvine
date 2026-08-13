// Shared helpers for the notes REST routes. Every handler authenticates with
// requireSession() then resolves + authorizes the target context; requireContext
// folds both into one call, reading spaceId/scope from the JSON body (for
// mutations) or the query string (for reads), mirroring requireSession's
// "value-or-Response" return so routes can early-return.

import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/session'
import { resolveContext, type ResolvedContext } from './resolve'

function pick(body: Record<string, unknown> | undefined, key: string): string | null {
  const value = body?.[key]
  return typeof value === 'string' ? value : null
}

export async function requireContext(
  req: NextRequest,
  body?: Record<string, unknown>,
): Promise<ResolvedContext | Response> {
  const session = await requireSession()
  if (session instanceof Response) return session
  const url = new URL(req.url)
  const spaceId = pick(body, 'spaceId') ?? url.searchParams.get('spaceId')
  const scope = pick(body, 'scope') ?? url.searchParams.get('scope')
  return resolveContext(session, spaceId, scope)
}

export function fail(error: string, status = 400): NextResponse {
  return NextResponse.json({ error }, { status })
}

// Map an unexpected thrown error to a JSON 400 (store helpers throw on bad input
// like "note not found" / "already exists"), logging server-side.
export function failFromError(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : 'Request failed'
  return NextResponse.json({ error: message }, { status: 400 })
}
