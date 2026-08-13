/**
 * Resolving the brain + principal an MCP call targets.
 *
 * The MCP layer never re-implements authorization: it calls `resolveBrain` and
 * `principalOf` — the exact functions the web routes use — so membership checks,
 * grant seeding and the folder-visibility lens behave identically for an agent
 * and for a browser. The only adaptation is turning `resolveBrain`'s
 * ready-to-return error `Response` into a thrown `McpError`, which `withCtx`
 * renders as a tool error.
 */
import prisma from '@/lib/prisma'
import type { SessionPayload } from '@/lib/session'
import { adminSpaceIds } from '@/lib/auth'
import {
  resolveBrain,
  resolvePersonalBrain,
  principalOf,
  type ResolvedBrain,
} from '@/lib/notes/brain'
import { personalPrincipal } from '@/lib/notes/principal'
import { SHARED_OWNER_KEY, type Brain } from '@/lib/notes/store'
import type { BrainPrincipal } from '@/lib/notes/shared/brainTypes'
import { McpError, type McpContext } from '@/lib/mcp/auth'

/** Which brain a call targets. */
export type BrainScope = 'shared' | 'personal'

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
 * Resolve + authorize the space brain a call targets. This is the hard
 * tenant boundary: a caller who is neither an admin nor a member gets a 403,
 * exactly as they would from the HTTP routes.
 */
export async function requireSpaceBrain(
  ctx: McpContext,
  spaceId: string,
): Promise<ResolvedBrain> {
  const resolved = await resolveBrain(sessionOf(ctx), spaceId)
  if (resolved instanceof Response) {
    throw new McpError(resolved.status, await messageOf(resolved))
  }
  return resolved
}

export interface Target {
  principal: BrainPrincipal
  brain: Brain
  /** Present only for `scope: 'shared'` — the write path needs the full record. */
  resolved: ResolvedBrain | null
}

/**
 * The (principal, brain) pair a call targets. `'shared'` is the requested
 * space's brain under that space's principal; `'personal'` is the
 * caller's own personal-space brain (`me:<userId>`, provisioned on demand) —
 * personal context lives there, not in a per-space personal brain.
 *
 * Membership in the requested space is checked either way, so `scope:
 * 'personal'` can't be used to skip the tenant boundary.
 */
export async function resolveTarget(
  ctx: McpContext,
  spaceId: string,
  scope: BrainScope,
): Promise<Target> {
  const resolved = await requireSpaceBrain(ctx, spaceId)
  if (scope === 'shared') {
    return {
      principal: await principalOf(resolved),
      brain: { spaceId, ownerKey: SHARED_OWNER_KEY },
      resolved,
    }
  }
  const identity = { userId: ctx.userId, name: ctx.name || 'Unknown', email: ctx.email }
  return {
    principal: personalPrincipal(identity),
    brain: await resolvePersonalBrain(identity),
    resolved: null,
  }
}

/** The spaces the caller can act in. */
export async function listMySpaces(ctx: McpContext) {
  const rows = await prisma.spaceMember.findMany({
    where: { userId: ctx.userId, status: 'active' },
    select: {
      space: { select: { id: true, name: true, personalOwnerId: true } },
    },
  })
  const spaceIds = rows.map((r) => r.space.id)
  const [held, owns] = await Promise.all([
    prisma.userAlias.findMany({
      where: { userId: ctx.userId, spaceId: { in: spaceIds } },
      select: { spaceId: true, aliasName: true },
    }),
    adminSpaceIds(ctx.userId, spaceIds),
  ])
  const aliasesBySpace = new Map<string, string[]>()
  for (const h of held) {
    aliasesBySpace.set(h.spaceId, [...(aliasesBySpace.get(h.spaceId) ?? []), h.aliasName])
  }
  return rows.map((r) => ({
    id: r.space.id,
    name: r.space.name,
    your_aliases: aliasesBySpace.get(r.space.id) ?? [],
    you_manage_it: owns.has(r.space.id),
    is_personal_space: r.space.personalOwnerId !== null,
  }))
}
