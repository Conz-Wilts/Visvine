/** Resource-library tools (list, comment, propose/review changes, create record). */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callApi } from "@/lib/mcp/apiClient";
import { withCtx, assertMember } from "@/lib/mcp/tools/_helpers";

export function registerResourceTools(server: McpServer): void {
  server.registerTool(
    "list_resources",
    {
      description:
        "List a community's resource files (with fresh signed download URLs). Requires a community you belong to.",
      inputSchema: { community_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "resources:read", async (ctx) => {
        await assertMember(ctx, args.community_id);
        return callApi(ctx, "/api/resources", {
          query: { community_id: args.community_id },
        });
      }),
  );

  server.registerTool(
    "get_resource_comments",
    {
      description:
        "List comments on a resource (optionally for a specific cell reference). Members only.",
      inputSchema: {
        resource_id: z.string(),
        cell_ref: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "resources:read", async (ctx) =>
        callApi(
          ctx,
          `/api/resources/${encodeURIComponent(args.resource_id)}/comments`,
          { query: { cellRef: args.cell_ref } },
        ),
      ),
  );

  server.registerTool(
    "list_resource_changes",
    {
      description:
        "List proposed changes on a resource (optionally filtered by status). Members only.",
      inputSchema: {
        resource_id: z.string(),
        status: z.string().optional().describe("pending | approved | rejected"),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "resources:read", async (ctx) =>
        callApi(
          ctx,
          `/api/resources/${encodeURIComponent(args.resource_id)}/changes`,
          { query: { status: args.status } },
        ),
      ),
  );

  server.registerTool(
    "create_resource",
    {
      description:
        "Create a resource record pointing at an already-uploaded file URL. Requires a community you belong to.",
      inputSchema: {
        community_id: z.string(),
        name: z.string(),
        file_type: z.string(),
        file_url: z.string().url(),
        file_size: z.number().int().positive().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      },
    },
    (args, extra) =>
      withCtx(extra, "resources:write", async (ctx) => {
        await assertMember(ctx, args.community_id);
        return callApi(ctx, "/api/resources", {
          method: "POST",
          body: {
            communityId: args.community_id,
            name: args.name,
            fileType: args.file_type,
            fileUrl: args.file_url,
            fileSize: args.file_size,
            metadata: args.metadata,
          },
        });
      }),
  );

  server.registerTool(
    "comment_on_resource",
    {
      description:
        "Add a comment to a resource (optionally anchored to a spreadsheet cell). Members only.",
      inputSchema: {
        resource_id: z.string(),
        content: z.string(),
        cell_ref: z.string().optional(),
      },
    },
    (args, extra) =>
      withCtx(extra, "resources:write", async (ctx) =>
        callApi(
          ctx,
          `/api/resources/${encodeURIComponent(args.resource_id)}/comments`,
          {
            method: "POST",
            body: { content: args.content, cellRef: args.cell_ref },
          },
        ),
      ),
  );

  server.registerTool(
    "propose_resource_change",
    {
      description:
        "Propose a change to a resource cell (queued for owner/admin review). Members only.",
      inputSchema: {
        resource_id: z.string(),
        cell_ref: z.string(),
        proposed_value: z.string(),
        original_value: z.string().optional(),
        reason: z.string().optional(),
      },
    },
    (args, extra) =>
      withCtx(extra, "resources:write", async (ctx) =>
        callApi(
          ctx,
          `/api/resources/${encodeURIComponent(args.resource_id)}/changes`,
          {
            method: "POST",
            body: {
              cellRef: args.cell_ref,
              proposedValue: args.proposed_value,
              originalValue: args.original_value,
              reason: args.reason,
            },
          },
        ),
      ),
  );

  server.registerTool(
    "review_resource_change",
    {
      description:
        "Approve or reject a proposed resource change. Requires admin (manage_members) in the resource's community.",
      inputSchema: {
        resource_id: z.string(),
        change_id: z.string(),
        status: z.enum(["approved", "rejected"]),
      },
    },
    (args, extra) =>
      withCtx(extra, "resources:write", async (ctx) =>
        callApi(
          ctx,
          `/api/resources/${encodeURIComponent(args.resource_id)}/changes/${encodeURIComponent(args.change_id)}`,
          { method: "PUT", body: { status: args.status } },
        ),
      ),
  );
}
