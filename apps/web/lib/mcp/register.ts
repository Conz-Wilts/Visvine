/**
 * What the MCP server registers: the `visvine` router, then one tool per action.
 *
 * Every action is behind the router — context, Drive, events, connectors,
 * agents, and planning and building Tools — on ONE server, so a Tool is planned
 * by a model that can read the space it is for: its types, records, folders and
 * files are one call away from `plan_tool`. Every action is ALSO its own named tool, from the same registry, so a
 * client can permit, deny and log each by name. What an action costs is
 * enforced by the scope on its definition either way, checked before dispatch
 * and again in `runAction`, so a connection that never asked for
 * `tools:author` still cannot write executable code into a space.
 */
import type { McpServer } from '@modelcontextprotocol/server'
import { registerActionTools, registerGateway } from '@/lib/mcp/gateway'

export function registerTools(server: McpServer): void {
  registerGateway(server)
  registerActionTools(server)
}
