/** Community social-feed tools — read only (posting/commenting is deferred). */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callApi } from "@/lib/mcp/apiClient";
import { withCtx, assertMember } from "@/lib/mcp/tools/_helpers";

export function registerFeedTools(server: McpServer): void {
  server.registerTool(
    "list_feed",
    {
      description:
        "List recent posts in a community's social feed (cursor-paginated). Requires a community you belong to.",
      inputSchema: {
        community_id: z.string(),
        cursor: z.string().optional(),
        limit: z.number().int().positive().max(50).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "feed:read", async (ctx) => {
        await assertMember(ctx, args.community_id);
        return callApi(ctx, "/api/feed", {
          query: {
            communityId: args.community_id,
            cursor: args.cursor,
            limit: args.limit,
          },
        });
      }),
  );
}
