/** Warm-introduction tools (double opt-in). */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callApi } from "@/lib/mcp/apiClient";
import { withCtx, assertMember } from "@/lib/mcp/tools/_helpers";

export function registerIntroTools(server: McpServer): void {
  server.registerTool(
    "list_intros",
    {
      description:
        "Get the viewer's warm-intro inbox: { incoming } awaiting your endorsement as introducer, { received } awaiting your accept as target, and { sent } you requested.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    (_args, extra) =>
      withCtx(extra, "intros:read", async (ctx) => callApi(ctx, "/api/intros")),
  );

  server.registerTool(
    "count_pending_intros",
    {
      description: "Count intro requests awaiting your action (drives the bell badge).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    (_args, extra) =>
      withCtx(extra, "intros:read", async (ctx) =>
        callApi(ctx, "/api/intros/count"),
      ),
  );

  server.registerTool(
    "find_mutual_introducers",
    {
      description:
        "Find people you and a target both know — candidate introducers for a warm intro to that target.",
      inputSchema: {
        target_id: z.string().describe("The target person's node id"),
        community_id: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "intros:read", async (ctx) =>
        callApi(ctx, "/api/intros/mutuals", {
          query: { targetId: args.target_id, communityId: args.community_id },
        }),
      ),
  );

  server.registerTool(
    "create_intro_request",
    {
      description:
        "Request a warm introduction: ask an introducer (who knows both of you) to connect you with a target. Double opt-in — the introducer must endorse and the target must accept.",
      inputSchema: {
        community_id: z.string(),
        introducer_node_id: z.string(),
        target_node_id: z.string(),
        message_to_introducer: z.string().max(600),
        message_to_target: z.string().max(600),
      },
    },
    (args, extra) =>
      withCtx(extra, "intros:write", async (ctx) => {
        await assertMember(ctx, args.community_id);
        return callApi(ctx, "/api/intros", {
          method: "POST",
          body: {
            communityId: args.community_id,
            introducerNodeId: args.introducer_node_id,
            targetNodeId: args.target_node_id,
            messageToIntroducer: args.message_to_introducer,
            messageToTarget: args.message_to_target,
          },
        });
      }),
  );

  server.registerTool(
    "respond_to_intro",
    {
      description:
        "Respond to an intro request you're party to: 'approve' (introducer endorses), 'decline', or 'accept' (target accepts — NOTE: accepting seeds a direct message between the two people).",
      inputSchema: {
        id: z.string().describe("The intro request id"),
        action: z.enum(["approve", "decline", "accept"]),
        endorsement: z
          .string()
          .max(600)
          .optional()
          .describe("Required when approving as the introducer"),
      },
    },
    (args, extra) =>
      withCtx(extra, "intros:write", async (ctx) =>
        callApi(ctx, `/api/intros/${encodeURIComponent(args.id)}`, {
          method: "PATCH",
          body: { action: args.action, endorsement: args.endorsement },
        }),
      ),
  );
}
