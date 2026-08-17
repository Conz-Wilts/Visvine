/**
 * Resolving the context + principal an MCP call targets.
 *
 * The MCP layer never re-implements authorization: it calls `resolveContext` and
 * `principalOf` — the exact functions the web routes use — so membership checks,
 * grant seeding and the folder-visibility lens behave identically for an agent
 * and for a browser. The only adaptation is turning `resolveContext`'s
 * ready-to-return error `Response` into a thrown `McpError`, which `withCtx`
 * renders as a tool error.
 */
import prisma from '@/lib/prisma'
import type { SessionPayload } from '@/lib/session'
import { adminSpaceIds } from '@/lib/auth'
import {
  resolveContext,
  resolvePersonalContext,
  principalOf,
  type ResolvedContext,
} from '@/lib/notes/resolve'
import { findAliasByRef, personAliases, type SpaceAlias } from '@/lib/types/context'
import { personalPrincipal } from '@/lib/notes/principal'
import { SHARED_OWNER_KEY, type Context } from '@/lib/notes/store'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import { McpError, type McpContext } from '@/lib/mcp/auth'

/** Which context a call targets. */
export type ContextScope = 'shared' | 'personal'

function sessionOf(ctx: McpContext): SessionPayload {
  return {
    userId: ctx.userId,
    name: ctx.name || ctx.email || ctx.userId,
    email: ctx.email,
    personId: ctx.personId,
  }
}

/** The error message inside a route-style JSON Response, best effort. */
async function messageOf(res: Response): Promise<string> {
  try {
    const body = (await res.clone().json()) as { error?: unknown }
    if (typeof body.error === 'string') return body.error
  } catch {
    /* not JSON */
  }
  return `Request failed (${res.status})`
}

/**
 * Resolve + authorize the space context a call targets. This is the hard
 * tenant boundary: a caller who is neither an admin nor a member gets a 403,
 * exactly as they would from the HTTP routes.
 */
export async function requireSpaceContext(
  ctx: McpContext,
  spaceId: string,
): Promise<ResolvedContext> {
  const resolved = await resolveContext(sessionOf(ctx), spaceId)
  if (resolved instanceof Response) {
    throw new McpError(resolved.status, await messageOf(resolved))
  }
  return resolved
}

export interface Target {
  principal: ContextPrincipal
  context: Context
  /** Present only for `scope: 'shared'` — the write path needs the full record. */
  resolved: ResolvedContext | null
}

/**
 * The (principal, context) pair a call targets. `'shared'` is the requested
 * space's context under that space's principal; `'personal'` is the
 * caller's own personal-space context (`me:<userId>`, provisioned on demand) —
 * personal context lives there, not in a per-space personal context.
 *
 * Membership in the requested space is checked either way, so `scope:
 * 'personal'` can't be used to skip the tenant boundary.
 */
export async function resolveTarget(
  ctx: McpContext,
  spaceId: string,
  scope: ContextScope,
): Promise<Target> {
  const resolved = await requireSpaceContext(ctx, spaceId)
  if (scope === 'shared') {
    return {
      principal: await principalOf(resolved),
      context: { spaceId, ownerKey: SHARED_OWNER_KEY },
      resolved,
    }
  }
  const identity = { userId: ctx.userId, name: ctx.name || 'Unknown', email: ctx.email }
  return {
    principal: personalPrincipal(identity),
    context: await resolvePersonalContext(identity),
    resolved: null,
  }
}

/** The spaces the caller can act in. */
export async function listMySpaces(ctx: McpContext) {
  const rows = await prisma.spaceMember.findMany({
    where: { userId: ctx.userId, status: 'active' },
    select: {
      space: { select: { id: true, name: true, personalOwnerId: true, aliases: true } },
    },
  })
  const spaceIds = rows.map((r) => r.space.id)
  const [held, owns] = await Promise.all([
    prisma.userAlias.findMany({
      where: { userId: ctx.userId, spaceId: { in: spaceIds } },
      select: { spaceId: true, aliasId: true },
    }),
    adminSpaceIds(ctx.userId, spaceIds),
  ])
  // The agent is told alias NAMES — that is the vocabulary every other tool
  // takes — so the ids on the holder rows are resolved against each space's own
  // list. An unresolvable one is dropped rather than shown as an opaque id.
  const vocabularyBySpace = new Map(
    rows.map((r) => [r.space.id, personAliases((r.space.aliases ?? []) as unknown as SpaceAlias[])]),
  )
  const aliasesBySpace = new Map<string, string[]>()
  for (const h of held) {
    const name = findAliasByRef(vocabularyBySpace.get(h.spaceId), h.aliasId, 'Person')?.name
    if (!name) continue
    aliasesBySpace.set(h.spaceId, [...(aliasesBySpace.get(h.spaceId) ?? []), name])
  }
  return rows.map((r) => ({
    id: r.space.id,
    name: r.space.name,
    your_aliases: aliasesBySpace.get(r.space.id) ?? [],
    you_manage_it: owns.has(r.space.id),
    is_personal_space: r.space.personalOwnerId !== null,
  }))
}
