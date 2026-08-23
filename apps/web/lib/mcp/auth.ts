/**
 * The gate every MCP tool runs behind: bearer verification for the transport,
 * and `withCtx` — auth + scope check + uniform error mapping — for tool bodies.
 */
import type { AuthInfo, CallToolResult } from '@modelcontextprotocol/server'
import { verifyAccessToken } from '@/lib/mcp/tokens'
import { devMcpAuthInfo, isDevMcpBypassEnabled } from '@/lib/mcp/devIdentity'
import type { McpServerKind } from '@/lib/mcp/config'
import { TOOL_SCOPES, type McpToolName } from '@/lib/mcp/scopes'

/** The caller behind a verified token — the identity every tool acts as. */
export interface McpContext {
  userId: string
  name: string
  email: string
  personId: string | null
  scopes: string[]
}

/** An expected failure with an HTTP-ish status, surfaced as a clean tool error. */
export class McpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'McpError'
    this.status = status
  }
}

/**
 * The verifier `withMcpAuth` calls on every request, bound to one server: a
 * token minted for the creator server is not a token for the context server,
 * and vice versa (its `aud` says which).
 *
 * No token at all is an error everywhere except local development, where it
 * means "act as the seeded dev user" (lib/mcp/devIdentity.ts) so `pnpm mcp:dev`
 * needs no auth setup. A token that IS presented is verified either way.
 */
export function mcpBearerVerifier(kind: McpServerKind) {
  return async (_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> => {
    if (!bearerToken) {
      return isDevMcpBypassEnabled() ? devMcpAuthInfo(kind) : undefined
    }
    const v = await verifyAccessToken(bearerToken, kind)
    if (!v) return undefined
    return {
      token: bearerToken,
      clientId: v.clientId,
      scopes: v.scopes,
      expiresAt: v.expiresAt,
      extra: { userId: v.userId, name: v.name, email: v.email, personId: v.personId },
    }
  }
}

function contextFromAuthInfo(info: AuthInfo | undefined): McpContext | null {
  const extra = info?.extra as Record<string, unknown> | undefined
  const userId = typeof extra?.userId === 'string' ? extra.userId : null
  if (!userId) return null
  return {
    userId,
    name: typeof extra?.name === 'string' ? extra.name : '',
    email: typeof extra?.email === 'string' ? extra.email : '',
    personId: typeof extra?.personId === 'string' ? extra.personId : null,
    scopes: info?.scopes ?? [],
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
 * Auth + scope gate around a tool body. Resolves the caller from the verified
 * token, checks the tool's scope, runs `fn`, and turns any thrown error into a
 * tool error rather than a protocol-level failure — an agent can read and react
 * to "you don't have write access to that folder", but not to a 500.
 *
 * The scope check here is defence in depth: the transport already refused the
 * request with an RFC 6750 `insufficient_scope` challenge (lib/mcp/challenge.ts)
 * before dispatch, which is the form a client can actually step up from. Both
 * read the scope from `TOOL_SCOPES`, so they cannot drift apart.
 */
export async function withCtx(
  extra: ToolExtra,
  tool: McpToolName,
  fn: (ctx: McpContext) => Promise<unknown>,
): Promise<CallToolResult> {
  const scope = TOOL_SCOPES[tool]
  const ctx = contextFromAuthInfo(extra.http?.authInfo)
  if (!ctx) return err('Unauthorized: no valid MCP access token')
  if (!ctx.scopes.includes(scope)) {
    return err(`Forbidden: this tool requires the '${scope}' scope`)
  }
  try {
    return { content: [{ type: 'text', text: toText(await fn(ctx)) }] }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }
}

function err(message: string): CallToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
}
