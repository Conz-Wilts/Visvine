/** Analytics / reporting tools. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callApi } from "@/lib/mcp/apiClient";
import { withCtx, assertMember } from "@/lib/mcp/tools/_helpers";

export function registerAnalyticsTools(server: McpServer): void {
  server.registerTool(
    "get_community_analytics",
    {
      description:
        "Get growth + composition analytics for a community you belong to: member/node/link totals, new counts over a window, node-type breakdown, and weekly growth series.",
      inputSchema: {
        community_id: z.string(),
        days: z.number().int().positive().max(365).optional().describe("Lookback window (default 30)"),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "analytics:read", async (ctx) => {
        await assertMember(ctx, args.community_id);
        return callApi(ctx, `/api/analytics/${encodeURIComponent(args.community_id)}`, {
          query: { days: args.days },
        });
      }),
  );

  server.registerTool(
    "get_community_activity",
    {
      description:
        "Get the recent activity log for a community. Admin role required. (Activity logging may be empty in the current backend.)",
      inputSchema: { community_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "analytics:read", async (ctx) =>
        callApi(
          ctx,
          `/api/communities/${encodeURIComponent(args.community_id)}/activity`,
        ),
      ),
  );
}
