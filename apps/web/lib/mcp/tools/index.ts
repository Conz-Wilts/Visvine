/** Registers every MCP tool module onto a server instance. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerIdentityTools } from "@/lib/mcp/tools/identity";
import { registerDirectoryTools } from "@/lib/mcp/tools/directory";
import { registerCrmTools } from "@/lib/mcp/tools/crm";
import { registerEventTools } from "@/lib/mcp/tools/events";
import { registerIntroTools } from "@/lib/mcp/tools/intros";
import { registerMessageTools } from "@/lib/mcp/tools/messages";
import { registerFeedTools } from "@/lib/mcp/tools/feed";
import { registerResourceTools } from "@/lib/mcp/tools/resources";
import { registerBlogTools } from "@/lib/mcp/tools/blog";
import { registerAnalyticsTools } from "@/lib/mcp/tools/analytics";
import { registerProfileTools } from "@/lib/mcp/tools/profile";

export function registerAllTools(server: McpServer): void {
  registerIdentityTools(server);
  registerDirectoryTools(server);
  registerCrmTools(server);
  registerEventTools(server);
  registerIntroTools(server);
  registerMessageTools(server);
  registerFeedTools(server);
  registerResourceTools(server);
  registerBlogTools(server);
  registerAnalyticsTools(server);
  registerProfileTools(server);
}
