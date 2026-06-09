/** Identity & community-context tools — the discovery root for every other tool. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callApi, ApiError } from "@/lib/mcp/apiClient";
import { withCtx } from "@/lib/mcp/tools/_helpers";

interface Community {
  id: string;
  name?: string;
  role?: string;
}

export function registerIdentityTools(server: McpServer): void {
  server.registerTool(
    "whoami",
    {
      description:
        "Return the identity of the authenticated MCP user (userId, email, name, personId) and the scopes granted to this connection.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    (_args, extra) =>
      withCtx(extra, "communities:read", async (ctx) => ({
        userId: ctx.userId,
        email: ctx.email,
        name: ctx.name,
        personId: ctx.personId,
        scopes: ctx.scopes,
      })),
  );

  server.registerTool(
    "list_my_communities",
    {
      description:
        "List every community the authenticated user belongs to, with their role (admin/member) in each. Call this first — its community ids gate every community-scoped tool.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    (_args, extra) =>
      withCtx(extra, "communities:read", async (ctx) =>
        callApi(ctx, "/api/user/communities"),
      ),
  );

  server.registerTool(
    "get_community",
    {
      description:
        "Get a single community's summary (name, role, node types, design config) — only for a community the user is a member of.",
      inputSchema: {
        community_id: z.string().describe("The community id"),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "communities:read", async (ctx) => {
        const data = await callApi<{ communities?: Community[] }>(
          ctx,
          "/api/user/communities",
        );
        const found = (data.communities ?? []).find(
          (c) => c.id === args.community_id,
        );
        if (!found) {
          throw new ApiError(
            403,
            `Community '${args.community_id}' not found among your memberships`,
          );
        }
        return found;
      }),
  );
}
