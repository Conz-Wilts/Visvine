/**
 * Registers MCP tool modules onto a server instance.
 *
 * NOTE: The MCP surface is intentionally reduced to the **event tools only** for now —
 * the full set of 72 tools across 11 modules was too large for clients to reason about.
 * The other modules' code is intact; we drip-feed them back by uncommenting their import
 * + register call below, one module at a time. See `docs/mcp-tools-inventory.md` for the
 * full catalogue of parked tools and the suggested re-introduction order.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerEventTools } from "@/lib/mcp/tools/events";
import { registerBrainTools } from "@/lib/mcp/tools/brain";
import { registerMessageTools } from "@/lib/mcp/tools/messages";
import { registerFeedTools } from "@/lib/mcp/tools/feed";

// ── Parked modules (uncomment to drip-feed back; see docs/mcp-tools-inventory.md) ──
// import { registerIdentityTools } from "@/lib/mcp/tools/identity";
// import { registerDirectoryTools } from "@/lib/mcp/tools/directory";
// import { registerCrmTools } from "@/lib/mcp/tools/crm";
// import { registerResourceTools } from "@/lib/mcp/tools/resources";
// import { registerBlogTools } from "@/lib/mcp/tools/blog";
// import { registerAnalyticsTools } from "@/lib/mcp/tools/analytics";
// import { registerProfileTools } from "@/lib/mcp/tools/profile";

export function registerAllTools(server: McpServer): void {
  registerEventTools(server);
  registerBrainTools(server);
  registerMessageTools(server);
  registerFeedTools(server);

  // ── Parked modules (uncomment to drip-feed back; see docs/mcp-tools-inventory.md) ──
  // registerIdentityTools(server);
  // registerDirectoryTools(server);
  // registerCrmTools(server);
  // registerResourceTools(server);
  // registerBlogTools(server);
  // registerAnalyticsTools(server);
  // registerProfileTools(server);
}
