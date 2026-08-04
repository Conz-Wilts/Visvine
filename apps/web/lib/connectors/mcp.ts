/**
 * The MCP connector executor: a deliberately small streamable-HTTP JSON-RPC
 * client, not a dependency on an MCP client SDK. A connector only ever needs
 * three requests — initialize, tools/list, tools/call — and doing them with
 * fetch keeps the same security posture as the http executor: SSRF check on
 * the host the admin wrote, no redirects, bounded timeouts, capped bodies,
 * and secret values redacted from everything that leaves.
 *
 * Every execution performs a fresh initialize handshake. That is one extra
 * round-trip per call, but it works against both stateless servers and
 * session-keyed ones (the `mcp-session-id` header is carried through), and it
 * means no session state lives in this process.
 */
import { assertPubliclyRoutable, SsrfError } from '@/lib/net/ssrf'
import {
  allowPrivateHosts,
  ConnectorError,
  interpolateSecrets,
  matchToolAllowlist,
  redactSecrets,
  type McpConnectorConfig,
} from './config'
import { readCapped } from './http'

const BODY_CAP_BYTES = 256 * 1024
const PROTOCOL_VERSION = '2025-06-18'
const CLIENT_INFO = { name: 'visvine-connector', version: '1.0.0' }

export interface McpToolInfo {
  name: string
  description: string | null
  input_schema: unknown
}

export interface McpCallResult {
  /** The tool result's content blocks, text flattened; JSON stays JSON. */
  content: unknown
  is_error: boolean
}

interface RpcSession {
  url: URL
  headers: Record<string, string>
  timeoutMs: number
  sensitive: string[]
  sessionId: string | null
}

/** One JSON-RPC request over streamable HTTP; unwraps SSE when the server streams. */
async function rpc(session: RpcSession, method: string, params: unknown, id: number | null): Promise<unknown> {
  const headers: Record<string, string> = {
    ...session.headers,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': PROTOCOL_VERSION,
  }
  if (session.sessionId) headers['mcp-session-id'] = session.sessionId

  let res: Response
  try {
    res = await fetch(session.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method, params, ...(id === null ? {} : { id }) }),
      redirect: 'error',
      signal: AbortSignal.timeout(session.timeoutMs),
      cache: 'no-store',
    })
  } catch (e) {
    const name = e instanceof Error ? e.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new ConnectorError('timeout', `MCP request timed out after ${session.timeoutMs}ms`)
    }
    const message = e instanceof Error ? e.message : String(e)
    throw new ConnectorError('upstream', redactSecrets(message, session.sensitive))
  }

  const newSession = res.headers.get('mcp-session-id')
  if (newSession) session.sessionId = newSession

  const { text } = await readCapped(res, BODY_CAP_BYTES)
  if (!res.ok) {
    throw new ConnectorError(
      'upstream',
      `MCP server answered ${res.status}: ${redactSecrets(text.slice(0, 500), session.sensitive)}`,
    )
  }
  if (id === null) return null // notification — 202/204, no body to parse

  // Streamable HTTP answers either plain JSON or an SSE stream of messages;
  // in the latter case the response we want is the event whose id matches.
  const contentType = res.headers.get('content-type') ?? ''
  const messages: unknown[] = []
  if (contentType.includes('text/event-stream')) {
    for (const event of text.split(/\n\n/)) {
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
      messages.push(JSON.parse(text))
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
      `MCP ${method} failed: ${redactSecrets(reply.error.message ?? `code ${reply.error.code}`, session.sensitive)}`,
    )
  }
  return reply.result
}

async function openSession(
  config: McpConnectorConfig,
  secrets: ReadonlyMap<string, string>,
): Promise<RpcSession> {
  const headers: Record<string, string> = {}
  for (const [key, template] of Object.entries(config.headers)) {
    const result = interpolateSecrets(template, secrets)
    if (!result.ok) {
      throw new ConnectorError(
        'missing_secret',
        `Secret${result.missing.length > 1 ? 's' : ''} ${result.missing.join(', ')} not set for this community — an admin must add ${result.missing.length > 1 ? 'them' : 'it'} on the connector's page`,
      )
    }
    headers[key] = result.value
  }

  const url = new URL(config.url)
  try {
    await assertPubliclyRoutable(url.hostname, { allowPrivate: allowPrivateHosts() })
  } catch (e) {
    if (e instanceof SsrfError) throw new ConnectorError('ssrf', e.message)
    throw e
  }

  const session: RpcSession = {
    url,
    headers,
    timeoutMs: config.timeoutMs,
    sensitive: [...secrets.values()].filter((v) => v.length > 0),
    sessionId: null,
  }
  await rpc(session, 'initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO }, 1)
  await rpc(session, 'notifications/initialized', {}, null)
  return session
}

/** The server's tools, flagged with whether this connector's allowlist permits each. */
export async function listMcpTools(
  config: McpConnectorConfig,
  secrets: ReadonlyMap<string, string>,
): Promise<Array<McpToolInfo & { allowed: boolean }>> {
  const session = await openSession(config, secrets)
  const result = (await rpc(session, 'tools/list', {}, 2)) as { tools?: unknown[] } | null
  const tools = Array.isArray(result?.tools) ? result.tools : []
  return tools.flatMap((raw) => {
    const t = raw as { name?: unknown; description?: unknown; inputSchema?: unknown }
    if (typeof t.name !== 'string') return []
    return [
      {
        name: t.name,
        description: typeof t.description === 'string' ? redactSecrets(t.description, session.sensitive) : null,
        input_schema: t.inputSchema ?? null,
        allowed: matchToolAllowlist(config.allow, t.name),
      },
    ]
  })
}

/** Call one allowed tool. The allowlist is judged here, before any handshake. */
export async function callMcpTool(
  config: McpConnectorConfig,
  secrets: ReadonlyMap<string, string>,
  tool: string,
  args: Record<string, unknown>,
): Promise<McpCallResult> {
  if (!matchToolAllowlist(config.allow, tool)) {
    throw new ConnectorError(
      'denied',
      config.allow.length === 0
        ? 'This connector has no allow list — it is discovery-only'
        : `This connector does not allow the tool '${tool}'. Allowed: ${config.allow.join(', ')}`,
    )
  }
  const session = await openSession(config, secrets)
  const result = (await rpc(session, 'tools/call', { name: tool, arguments: args }, 2)) as {
    content?: unknown
    isError?: unknown
  } | null

  // Redact through a JSON round-trip so secret values echoed anywhere in the
  // result — nested text blocks included — never reach the model. A secret
  // containing quotes or backslashes appears JSON-escaped in the serialized
  // text, so its escaped form is redacted too.
  const variants = [...new Set(session.sensitive.flatMap((v) => [v, JSON.stringify(v).slice(1, -1)]))]
  const clean = JSON.parse(redactSecrets(JSON.stringify(result?.content ?? []), variants))
  return { content: clean, is_error: result?.isError === true }
}
