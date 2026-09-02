/**
 * The `mcp` capability: talk streamable-HTTP JSON-RPC to an MCP server.
 *
 * Rebuilt on hostFetch rather than on `fetch` directly, so an MCP endpoint is
 * gated by exactly the same `hosts:` perimeter as any other call — there is no
 * second way out of the isolate. That also means every response has already
 * been secret-redacted and size-capped before this module parses it.
 *
 * No MCP SDK: the wire format is a POST with a JSON body, and hand-rolling it
 * keeps the dependency surface at zero. The handshake is redone per session
 * because there is no isolate-side state worth keeping — which is also why
 * `mcp(url)` hands back a namespace of independent calls rather than a
 * stateful client object (see isolate.ts on why host objects never cross).
 */
import { ConnectorError } from './config'
import { hostFetch, type HostContext } from './hostFetch'
import { toolPolicyOf } from './perimeter'
import { callableTools, refuseTool } from './toolPolicy'

const PROTOCOL_VERSION = '2025-06-18'
const CLIENT_INFO = { name: 'visvine-connector', version: '2.0.0' }

export interface McpToolInfo {
  name: string
  description: string | null
  input_schema: unknown
  /**
   * The server's own hints about the tool — `readOnlyHint`, `destructiveHint`
   * and friends. Passed through untouched: it is the server's word, used to
   * sort the permissions screen, never to decide anything.
   */
  annotations: unknown
  /** `annotations.title`, when the server gives the tool a human name. */
  title: string | null
}

interface RpcSession {
  url: string
  headers: Record<string, string>
  sessionId: string | null
}

/** One JSON-RPC round trip. `id === null` sends a notification and expects no reply. */
async function rpc(
  ctx: HostContext,
  session: RpcSession,
  method: string,
  params: unknown,
  id: number | null,
): Promise<unknown> {
  const headers: Record<string, string> = {
    ...session.headers,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': PROTOCOL_VERSION,
  }
  if (session.sessionId) headers['mcp-session-id'] = session.sessionId

  const res = await hostFetch(ctx, session.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', method, params, ...(id === null ? {} : { id }) }),
  })

  const newSession = res.headers['mcp-session-id']
  if (newSession) session.sessionId = newSession

  if (!res.ok) {
    throw new ConnectorError('upstream', `MCP server answered ${res.status}: ${res.body.slice(0, 500)}`)
  }
  if (id === null) return null // notification — 202/204, no body to parse

  // Streamable HTTP answers either plain JSON or an SSE stream of messages;
  // in the latter case the response we want is the event whose id matches.
  const contentType = res.headers['content-type'] ?? ''
  const messages: unknown[] = []
  if (contentType.includes('text/event-stream')) {
    for (const event of res.body.split(/\n\n/)) {
      const data = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n')
      if (!data) continue
      try {
        messages.push(JSON.parse(data))
      } catch {
        /* keep-alives and non-JSON events are fine to skip */
      }
    }
  } else {
    try {
      messages.push(JSON.parse(res.body))
    } catch {
      throw new ConnectorError('upstream', 'MCP server returned a response that is not JSON')
    }
  }

  const reply = messages.find(
    (m): m is { id: unknown; result?: unknown; error?: { code?: number; message?: string } } =>
      typeof m === 'object' && m !== null && (m as { id?: unknown }).id === id,
  )
  if (!reply) throw new ConnectorError('upstream', `MCP server sent no response to ${method}`)
  if (reply.error) {
    throw new ConnectorError(
      'upstream',
      `MCP ${method} failed: ${reply.error.message ?? `code ${reply.error.code}`}`,
    )
  }
  return reply.result
}

function requireUrl(rawUrl: unknown): string {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    throw new ConnectorError('config', 'mcp needs the server URL as a string')
  }
  return rawUrl
}

function requireHeaders(raw: unknown): Record<string, string> {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object') throw new ConnectorError('config', 'mcp headers must be an object')
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) out[k] = String(v)
  return out
}

/** A fresh initialized session. Cheap enough to redo per call; nothing is cached. */
async function openSession(ctx: HostContext, url: string, headers: Record<string, string>): Promise<RpcSession> {
  const session: RpcSession = { url, headers, sessionId: null }
  await rpc(ctx, session, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: CLIENT_INFO,
  }, 1)
  await rpc(ctx, session, 'notifications/initialized', {}, null)
  return session
}

/**
 * The MCP server's advertised tools.
 *
 * What comes back is what the caller could actually CALL: a tool the
 * connector's policy would refuse right now is dropped rather than listed and
 * then denied. Advertising a tool the gate will refuse teaches a model to keep
 * asking for it, and a run has better things to spend turns on. The
 * permissions screen reads the unfiltered list through {@link mcpAllTools},
 * because a person deciding what to allow has to see what there is.
 */
export async function mcpListTools(ctx: HostContext, rawUrl: unknown, rawHeaders?: unknown): Promise<McpToolInfo[]> {
  const policy = toolPolicyOf(ctx.perimeter)
  const all = await mcpAllTools(ctx, rawUrl, rawHeaders)
  return callableTools(policy, all, ctx.attended === true)
}

/** Every tool the server advertises, before the connector's policy is applied. */
export async function mcpAllTools(ctx: HostContext, rawUrl: unknown, rawHeaders?: unknown): Promise<McpToolInfo[]> {
  const session = await openSession(ctx, requireUrl(rawUrl), requireHeaders(rawHeaders))
  const result = (await rpc(ctx, session, 'tools/list', {}, 2)) as { tools?: unknown[] } | null
  const tools = Array.isArray(result?.tools) ? result.tools : []
  return tools.flatMap((raw) => {
    const t = raw as { name?: unknown; description?: unknown; inputSchema?: unknown; annotations?: unknown; title?: unknown }
    if (typeof t?.name !== 'string') return []
    const annotations = t.annotations ?? null
    const title = (annotations as { title?: unknown } | null)?.title
    return [{
      name: t.name,
      description: typeof t.description === 'string' ? t.description : null,
      input_schema: t.inputSchema ?? null,
      annotations,
      title: typeof title === 'string' && title.trim() ? title.trim() : (typeof t.title === 'string' ? t.title : null),
    }]
  })
}

/** Call one tool. Arguments come from isolate code and are already marshalled. */
export async function mcpCallTool(
  ctx: HostContext,
  rawUrl: unknown,
  rawTool: unknown,
  args: unknown,
  rawHeaders?: unknown,
): Promise<{ content: unknown; is_error: boolean }> {
  if (typeof rawTool !== 'string' || rawTool.length === 0) {
    throw new ConnectorError('config', 'mcp.callTool needs a tool name')
  }
  // The tool gate, before the session is opened — the same order the host and
  // path gates keep: a call that was never going to be allowed does not reach
  // the upstream at all, so an `ask` tool leaves no trace of having been tried
  // in someone else's audit log.
  const refusal = refuseTool(toolPolicyOf(ctx.perimeter), rawTool, ctx.attended === true)
  if (refusal) throw new ConnectorError('denied', ctx.deny(refusal))
  const session = await openSession(ctx, requireUrl(rawUrl), requireHeaders(rawHeaders))
  const result = (await rpc(ctx, session, 'tools/call', {
    name: rawTool,
    arguments: args && typeof args === 'object' ? args : {},
  }, 3)) as { content?: unknown; isError?: unknown } | null
  return { content: result?.content ?? [], is_error: result?.isError === true }
}
