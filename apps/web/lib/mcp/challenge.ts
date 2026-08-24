/**
 * Scope challenges for the MCP transport (RFC 6750 §3, MCP 2026-07-28
 * "Scope Challenge Handling").
 *
 * The point is the step-up flow. A token minted with only `context:read` that
 * hits `edit_context` gets a real `403 insufficient_scope` naming the scope it
 * needs — the signal a spec-compliant client re-authorizes on. A text error
 * inside a successful HTTP 200 would be invisible to the OAuth layer, and the
 * client would fail identically forever.
 *
 * Two wrappers, applied either side of `withMcpAuth`:
 *
 *   withScopeHint( withMcpAuth( withScopeGate(handler) ) )
 *
 * `withScopeGate` runs inside the auth wrapper, where the verified token is
 * available, and inspects the JSON-RPC body before dispatch. `withScopeHint`
 * runs outside it and adds `scope=` to the 401 the auth wrapper emits for an
 * unauthenticated request — mcp-handler builds that header itself and omits it.
 */
import type { AuthInfo } from '@modelcontextprotocol/server'
import { MCP_SCOPES, serializeScopes } from '@/lib/mcp/scopes'
import { scopeForAction } from '@/lib/actions/registry'
import { TOOL_NAME } from '@/lib/mcp/gateway'

type Handler = (req: Request) => Response | Promise<Response>

/** `withMcpAuth` hangs the verified token off the request before calling us. */
type AuthedRequest = Request & { auth?: AuthInfo }

function challengeHeader(params: Record<string, string>): string {
  const parts = Object.entries(params).map(([k, v]) => `${k}="${v.replace(/"/g, '')}"`)
  return `Bearer ${parts.join(', ')}`
}

/**
 * Which required scopes is this token missing, across every `tools/call` in the
 * body? A JSON-RPC batch is a single HTTP request, so all of them are collected
 * and challenged together — the spec is explicit that trickling out one missing
 * scope at a time forces needless round-trips.
 *
 * There is one tool now, so the scope being challenged is the ACTION's, read
 * out of `params.arguments.action`. A call that names no action is the plan or
 * the catalogue — free, read-only, and never challenged; a call that names one
 * but supplies no `input` is asking for its manual, which is equally free. Only
 * a call that would actually RUN something is gated here, which keeps discovery
 * open to a token that cannot yet do the work and lets the client step up once,
 * knowing exactly what to ask for.
 */
export function missingScopesForBody(rawBody: string, granted: readonly string[]): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return [] // not JSON-RPC we understand; let the handler produce the error
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed]
  const missing = new Set<string>()
  for (const message of messages) {
    if (typeof message !== 'object' || message === null) continue
    const m = message as { method?: unknown; params?: unknown }
    if (m.method !== 'tools/call') continue
    const params = m.params as { name?: unknown; arguments?: unknown } | undefined
    if (params?.name !== TOOL_NAME) continue
    const args = params.arguments
    if (typeof args !== 'object' || args === null) continue
    const { action, input, explain } = args as Record<string, unknown>
    if (typeof action !== 'string') continue
    // No `input` (or `explain`) means "tell me about it", not "do it".
    if (input === undefined || input === null || explain === true) continue
    const required = scopeForAction(action)
    // An unknown action name is the handler's error to report, not ours.
    if (required && !granted.includes(required)) missing.add(required)
  }
  return [...missing]
}

/**
 * Gate tool dispatch on the token's scopes. Sits *inside* `withMcpAuth`, so the
 * request is already authenticated by the time it runs.
 */
export function withScopeGate(handler: Handler, resourceMetadataUrl: string): Handler {
  return async (req: Request): Promise<Response> => {
    const auth = (req as AuthedRequest).auth
    // No body to inspect (GET/DELETE), or no token to judge — nothing to do.
    if (req.method !== 'POST' || !auth) return handler(req)

    // Read a clone, so the handler still gets the untouched request — headers,
    // abort signal and all.
    let rawBody: string
    try {
      rawBody = await req.clone().text()
    } catch {
      return handler(req)
    }

    const missing = missingScopesForBody(rawBody, auth.scopes ?? [])
    if (missing.length === 0) return handler(req)

    return new Response(
      JSON.stringify({
        error: 'insufficient_scope',
        error_description: `This token is missing the ${missing.join(' and ')} scope`,
      }),
      {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': challengeHeader({
            error: 'insufficient_scope',
            // All of them at once: the spec calls out incremental challenges as
            // a user-experience failure, not just an inefficiency.
            scope: serializeScopes(missing),
            resource_metadata: resourceMetadataUrl,
            error_description: `Requires ${serializeScopes(missing)}`,
          }),
        },
      },
    )
  }
}

/**
 * Add `scope=` to the 401/403 challenge. A client that has no token yet needs to
 * know what to ask for; without this it falls back to whatever
 * `scopes_supported` says, which is a slower path and one more thing to keep in
 * step. Any `scope` the inner layer already set wins.
 */
export function withScopeHint(handler: Handler): Handler {
  return async (req: Request): Promise<Response> => {
    const res = await handler(req)
    if (res.status !== 401 && res.status !== 403) return res
    const existing = res.headers.get('WWW-Authenticate')
    if (!existing || /(^|[\s,])scope=/.test(existing)) return res

    const headers = new Headers(res.headers)
    headers.set('WWW-Authenticate', `${existing}, scope="${serializeScopes(MCP_SCOPES)}"`)
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  }
}
