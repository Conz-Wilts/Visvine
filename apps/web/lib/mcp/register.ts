/**
 * What each MCP server registers: the `visvine` router, then one tool per
 * action — Visvine over the space's context, connectors, agents and events,
 * Visvine Tools over building and installing Tools (`actionsOn`). Every action is ALSO its own named tool, from the same registry, so a
 * client can permit, deny and log each by name. What an action costs is
 * enforced by the scope on its definition either way, checked before dispatch
 * and again in `runAction`, so a connection that never asked for
 * `tools:author` still cannot write executable code into a space.
 */
import type { McpServer } from '@modelcontextprotocol/server'
import { registerActionTools, registerGateway } from '@/lib/mcp/gateway'

export function registerTools(server: McpServer): void {
  registerGateway(server, 'visvine')
  registerActionTools(server, 'visvine')
}

/** Visvine Tools: the same router and named tools, over the Tool actions alone. */
export function registerToolTools(server: McpServer): void {
  registerGateway(server, 'tools')
  registerActionTools(server, 'tools')
}
