/**
 * Local development: no token at all.
 *
 * In production both MCP servers require a Bearer token from our own OAuth 2.1
 * server, and that is the only way in. Locally the whole dance buys nothing —
 * the client, the server and the database are all on one laptop — so a request
 * to `localhost:3000/api/mcp` with no Authorization header is simply treated as
 * a seeded dev user, with every scope that server can grant.
 *
 * The guard is `isDevAuthEnabled()`: NODE_ENV must be `development` AND
 * ENABLE_DEV_AUTH must be `true`. `next build` bakes NODE_ENV=production, so no
 * deployed artifact can reach this even if the flag leaks into its environment
 * — the same guard, and the same argument, as the rest of `/api/dev`.
 *
 * A request that DOES carry a token is verified normally, bypass or not. That
 * keeps the real path testable locally: mint a narrow token, watch a tool answer
 * `insufficient_scope`.
 */
import type { AuthInfo } from '@modelcontextprotocol/server'
import prisma from '@/lib/prisma'
import { isDevAuthEnabled } from '@/lib/dev-auth'
import { MCP_SCOPES } from '@/lib/mcp/scopes'

/** Recorded as `clientId`, so a bypassed request is identifiable in logs. */
const DEV_MCP_CLIENT_ID = 'visvine-local-dev'

/** Who an unauthenticated local request acts as. Override in apps/web/.env. */
const DEFAULT_DEV_MCP_USER = 'admin@local.dev'

/** True when an MCP request may skip the token entirely. */
export function isDevMcpBypassEnabled(): boolean {
  return isDevAuthEnabled()
}

/**
 * The seeded user to act as: `DEV_MCP_USER` (an email or a user id) if set,
 * otherwise the seeded admin, otherwise any `@local.dev` user — a database
 * seeded under different names should still work rather than fail on a string.
 */
async function resolveDevUser() {
  const wanted = process.env.DEV_MCP_USER?.trim() || DEFAULT_DEV_MCP_USER
  return (
    (await prisma.user.findFirst({
      where: { OR: [{ email: wanted }, { id: wanted }] },
    })) ??
    (await prisma.user.findFirst({
      where: { email: { endsWith: '@local.dev' } },
      orderBy: { email: 'asc' },
    }))
  )
}

/**
 * The `AuthInfo` a tokenless local request runs as, or undefined when there is
 * no seeded user to be (an unseeded database) — which surfaces as the ordinary
 * 401 rather than a confusing half-authenticated state.
 */
export async function devMcpAuthInfo(): Promise<AuthInfo | undefined> {
  const user = await resolveDevUser()
  if (!user) return undefined
  return {
    // `withMcpAuth` wants a token string; nothing downstream reads it, since
    // this identity never came from one.
    token: 'local-dev',
    clientId: DEV_MCP_CLIENT_ID,
    scopes: [...MCP_SCOPES],
    extra: {
      userId: user.id,
      name: user.name ?? '',
      email: user.email ?? '',
    },
  }
}
