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
import { verifyDeployKey } from '@/lib/tools/deployKeys'
import { DEPLOY_KEY_SCOPES, isDeployKey } from '@/lib/tools/shared/deployKeys'

/**
 * The verifier `withMcpAuth` calls on every request.
 *
 * No token at all is an error everywhere except local development, where it
 * means "act as the seeded dev user" (lib/mcp/devIdentity.ts) so `pnpm mcp:dev`
 * needs no auth setup. A token that IS presented is verified either way. A
 * Tool's deploy key (`vvtk_…`, lib/tools/deployKeys.ts) acts as the person who
 * minted it with the Tool actions' scopes, and names the one Tool it may
 * touch — `runAction` holds every call to it.
 */
export function mcpBearerVerifier() {
  return async (_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> => {
    if (!bearerToken) {
      return isDevMcpBypassEnabled() ? devMcpAuthInfo() : undefined
    }
    if (isDeployKey(bearerToken)) {
      const key = await verifyDeployKey(bearerToken)
      if (!key) return undefined
      return {
        token: bearerToken,
        clientId: `deploy-key:${key.id}`,
        scopes: [...DEPLOY_KEY_SCOPES],
        extra: {
          userId: key.user.id,
          name: key.user.name,
          email: key.user.email,
          deployKey: { id: key.id, label: key.label, spaceId: key.spaceId, tool: key.tool },
        },
      }
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
  const key = extra?.deployKey as ActionCaller['deployKey'] | undefined
  return {
    userId,
    name: typeof extra?.name === 'string' ? extra.name : '',
    email: typeof extra?.email === 'string' ? extra.email : '',
    scopes: info?.scopes ?? [],
    via: 'mcp',
    ...(key ? { deployKey: key } : {}),
  }
}

/**
 * The subset of the SDK's tool-handler context we rely on. As of SDK v2 the
 * verified token hangs off `http`, not the context root.
 */
export interface ToolExtra {
  http?: { authInfo?: AuthInfo }
}

const IMAGE_KEYS = { png_base64: 'image/png', jpeg_base64: 'image/jpeg' } as const

/**
 * An action's answer as MCP content. A screenshot (`png_base64` /
 * `jpeg_base64`, preview_tool and try_tool) goes out as an IMAGE block the
 * client's model can look at — as JSON text it is a wall of base64 no model
 * can see and most clients cut off — and the JSON keeps a pointer to it.
 */
export function toContent(value: unknown): CallToolResult['content'] {
  if (typeof value === 'string') return [{ type: 'text', text: value }]
  const images: Array<{ type: 'image'; data: string; mimeType: string }> = []
  const strip = (node: unknown, depth: number): unknown => {
    if (depth > 4 || node === null || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map((n) => strip(n, depth + 1))
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(node)) {
      if (key in IMAGE_KEYS && typeof v === 'string' && v.length > 0) {
        images.push({ type: 'image', data: v, mimeType: IMAGE_KEYS[key as keyof typeof IMAGE_KEYS] })
        out[key] = `[image ${images.length}, attached]`
      } else {
        out[key] = strip(v, depth + 1)
      }
    }
    return out
  }
  const text = JSON.stringify(strip(value, 0), null, 2)
  return [{ type: 'text', text }, ...images]
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
    return { content: toContent(await fn(caller)) }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }
}

function err(message: string): CallToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
}
