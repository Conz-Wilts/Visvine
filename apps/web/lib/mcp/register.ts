/**
 * What the MCP server registers: one tool, `visvine`.
 *
 * Every action is behind it — context, Drive, events, connectors, agents, and
 * the Tool authoring loop — because which one a request needs is a question the
 * action notes answer better than a client picking an endpoint could. What an
 * action costs is still enforced by the scope on its definition, checked before
 * dispatch and again in `runAction`, so a connection that never asked for
 * `tools:author` still cannot write executable code into a space.
 */
import type { McpServer } from '@modelcontextprotocol/server'
import { registerGateway } from '@/lib/mcp/gateway'

export function registerTools(server: McpServer): void {
  registerGateway(server)
}
