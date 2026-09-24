/**
 * The gate the MCP transport runs behind: bearer verification for the
 * connection, and `withCaller` — identity resolution plus uniform error
 * mapping — for every tool's body.
 *
 * There is no scope check here: a scope belongs to the ACTION, whichever tool
 * reached it, and `runAction` (lib/actions/run.ts) enforces
 * it for both doors. The transport challenges before dispatch as well
 * (lib/mcp/challenge.ts) so a client gets an RFC 6750 `insufficient_scope` it
 * can step up from; both read the same `scopeForAction`.
 */
import type { AuthInfo, CallToolResult } from '@modelcontextprotocol/server'
import { verifyAccessToken } from '@/lib/mcp/tokens'
import { devMcpAuthInfo, isDevMcpBypassEnabled } from '@/lib/mcp/devIdentity'
import type { ActionCaller } from '@/lib/actions/types'

/**
 * The verifier `withMcpAuth` calls on every request.
 *
 * No token at all is an error everywhere except local development, where it
 * means "act as the seeded dev user" (lib/mcp/devIdentity.ts) so `pnpm mcp:dev`
 * needs no auth setup. A token that IS presented is verified either way.
 */
export function mcpBearerVerifier() {
  return async (_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> => {
    if (!bearerToken) {
      return isDevMcpBypassEnabled() ? devMcpAuthInfo() : undefined
    }
    const v = await verifyAccessToken(bearerToken)
    if (!v) return undefined
    return {
      token: bearerToken,
      clientId: v.clientId,
      scopes: v.scopes,
      expiresAt: v.expiresAt,
      extra: { userId: v.userId, name: v.name, email: v.email },
    }
  }
}

function callerFromAuthInfo(info: AuthInfo | undefined): ActionCaller | null {
  const extra = info?.extra as Record<string, unknown> | undefined
  const userId = typeof extra?.userId === 'string' ? extra.userId : null
  if (!userId) return null
  return {
    userId,
    name: typeof extra?.name === 'string' ? extra.name : '',
    email: typeof extra?.email === 'string' ? extra.email : '',
    scopes: info?.scopes ?? [],
    via: 'mcp',
  }
}

/**
 * The subset of the SDK's tool-handler context we rely on. As of SDK v2 the
 * verified token hangs off `http`, not the context root.
 */
export interface ToolExtra {
  http?: { authInfo?: AuthInfo }
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

/**
 * Resolve the caller from the verified token, run `fn`, and turn any thrown
 * error into a tool error rather than a protocol-level failure — an agent can
 * read and react to "you don't have write access to that folder", but not to a
 * 500.
 */
export async function withCaller(
  extra: ToolExtra,
  fn: (caller: ActionCaller) => Promise<unknown>,
): Promise<CallToolResult> {
  const caller = callerFromAuthInfo(extra.http?.authInfo)
  if (!caller) return err('Unauthorized: no valid MCP access token')
  try {
    return { content: [{ type: 'text', text: toText(await fn(caller)) }] }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }
}

function err(message: string): CallToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
}
