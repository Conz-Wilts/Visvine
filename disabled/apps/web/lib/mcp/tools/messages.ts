/**
 * Messaging tools — read + benign state only. Sending/editing/deleting messages
 * and creating conversations are act-as-you side effects, deferred to a later tier.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callApi } from "@/lib/mcp/apiClient";
import { withCtx } from "@/lib/mcp/tools/_helpers";

export function registerMessageTools(server: McpServer): void {
  server.registerTool(
    "list_conversations",
    {
      description:
        "List the authenticated user's conversations (DMs + groups) with unread counts. Optional text filter.",
      inputSchema: { query: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "messages:read", async (ctx) =>
        callApi(ctx, "/api/messages/conversations", {
          query: { query: args.query },
        }),
      ),
  );

  server.registerTool(
    "get_conversation_messages",
    {
      description:
        "Get a page of messages in a conversation you're a member of (cursor-paginated, newest first).",
      inputSchema: {
        conversation_id: z.string(),
        cursor: z.string().optional(),
        limit: z.number().int().positive().max(100).optional(),
        query: z.string().optional().describe("Filter messages by text"),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "messages:read", async (ctx) =>
        callApi(
          ctx,
          `/api/messages/conversations/${encodeURIComponent(args.conversation_id)}/messages`,
          { query: { cursor: args.cursor, limit: args.limit, query: args.query } },
        ),
      ),
  );

  server.registerTool(
    "search_messages",
    {
      description:
        "Search across the authenticated user's conversations and messages.",
      inputSchema: { query: z.string() },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "messages:read", async (ctx) =>
        callApi(ctx, "/api/messages/search", { query: { query: args.query } }),
      ),
  );

  server.registerTool(
    "mark_conversation_read",
    {
      description:
        "Mark a conversation as read up to now (clears its unread count). Does not message anyone.",
      inputSchema: { conversation_id: z.string() },
    },
    (args, extra) =>
      withCtx(extra, "messages:read", async (ctx) =>
        callApi(
          ctx,
          `/api/messages/conversations/${encodeURIComponent(args.conversation_id)}/read`,
          { method: "POST", body: {} },
        ),
      ),
  );
}
