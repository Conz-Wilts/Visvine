/**
 * The CLI's one door to a Visvine server: its MCP endpoint, `/api/mcp`, and
 * the named tool of each action (`visvine_push_tool` …) — the same actions,
 * gates and scopes an AI coding agent reaches.
 *
 * Who it is, in order: a deploy key (`--key`, or `VISVINE_TOOL_KEY` — CI's
 * way in, one Tool's actions only), the account `visvine-tool login` signed
 * in with, or nobody — which a local development server answers as its seeded
 * dev user and every other server refuses.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { readCredentials } from './credentials'

export const CLI_VERSION = '0.1.0'

export class RemoteError extends Error {
  constructor(
    message: string,
    readonly kind: 'refused' | 'unauthorized' | 'unreachable',
  ) {
    super(message)
  }
}

export type Identity = { kind: 'key'; token: string } | { kind: 'account'; token: string } | { kind: 'none' }

export interface Remote {
  server: string
  identity: Identity['kind']
  call<T = Record<string, unknown>>(action: string, input: Record<string, unknown>): Promise<T>
  close(): Promise<void>
}

export function identityFor(server: string, key?: string | null): Identity {
  const deployKey = key ?? process.env.VISVINE_TOOL_KEY
  if (deployKey) return { kind: 'key', token: deployKey }
  const saved = readCredentials(server)
  return saved ? { kind: 'account', token: saved.accessToken } : { kind: 'none' }
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? []
  return content.map((part) => part.text ?? '').join('\n')
}

export async function connect(server: string, key?: string | null): Promise<Remote> {
  const identity = identityFor(server, key)
  const token = identity.kind === 'none' ? undefined : identity.token
  const transport = new StreamableHTTPClientTransport(new URL('/api/mcp', server), {
    authProvider: { token: async () => token },
  })
  const client = new Client({ name: 'visvine-tool', version: CLI_VERSION })
  try {
    await client.connect(transport)
  } catch (err) {
    throw explain(err, server, identity)
  }
  return {
    server,
    identity: identity.kind,
    async call<T>(action: string, input: Record<string, unknown>): Promise<T> {
      let result
      try {
        result = await client.callTool({ name: `visvine_${action}`, arguments: input })
      } catch (err) {
        throw explain(err, server, identity)
      }
      const text = textOf(result)
      if ((result as { isError?: boolean }).isError) throw new RemoteError(text || `${action} failed`, 'refused')
      try {
        return JSON.parse(text) as T
      } catch {
        return { text } as T
      }
    },
    close: () => client.close(),
  }
}

function explain(err: unknown, server: string, identity: Identity): RemoteError {
  const message = err instanceof Error ? err.message : String(err)
  if (/401|unauthori[sz]ed/i.test(message) || (err as { name?: string })?.name === 'UnauthorizedError') {
    return new RemoteError(
      identity.kind === 'key'
        ? `${server} refused the deploy key — it may have been revoked. Make a new one on the tool's page.`
        : identity.kind === 'account'
          ? `Your sign-in to ${server} has expired. Run \`visvine-tool login\` again.`
          : `${server} needs you signed in. Run \`visvine-tool login${server === 'https://visvine.com' ? '' : ` --server ${server}`}\`.`,
      'unauthorized',
    )
  }
  if (/insufficient_scope|403/.test(message)) return new RemoteError(message, 'refused')
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|EAI_AGAIN/i.test(message)) {
    return new RemoteError(`Could not reach ${server} — is it running, and is the address right?`, 'unreachable')
  }
  return new RemoteError(message, 'refused')
}
