/**
 * CRM tools: member directory (admin), community custom columns + values,
 * per-user private columns + values, column/value-share requests, settings,
 * import, and audit. Directory reads/writes are admin-gated by the routes
 * (`assertCrmPermission`); membership-only routes get an explicit `assertMember`.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callApi, callApiText, callApiForm } from "@/lib/mcp/apiClient";
import { withCtx, assertMember } from "@/lib/mcp/tools/_helpers";

const REVIEW_STATUS = z.enum(["approved", "rejected"]);
const ROLE = z.enum(["admin", "member"]);

export function registerCrmTools(server: McpServer): void {
  // ── Member directory (admin) ──
  server.registerTool(
    "list_members",
    {
      description:
        "List a community's members with their CRM data (public + private fields). Admin role required. Supports pagination + search.",
      inputSchema: {
        community_id: z.string(),
        page: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(200).optional(),
        search: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "crm:read", async (ctx) =>
        callApi(ctx, `/api/crm/${encodeURIComponent(args.community_id)}/members`, {
          query: { page: args.page, limit: args.limit, search: args.search },
        }),
      ),
  );

  server.registerTool(
    "get_member",
    {
      description: "Get one community member's full CRM record. Admin role required.",
      inputSchema: { community_id: z.string(), user_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "crm:read", async (ctx) =>
        callApi(
          ctx,
          `/api/crm/${encodeURIComponent(args.community_id)}/members/${encodeURIComponent(args.user_id)}`,
        ),
      ),
  );

  server.registerTool(
    "export_members_csv",
    {
      description:
        "Export a community's full member list (with custom fields) as CSV text. Admin role required.",
      inputSchema: { community_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "crm:read", async (ctx) =>
        callApiText(
          ctx,
          `/api/crm/${encodeURIComponent(args.community_id)}/members/export`,
        ),
      ),
  );

  server.registerTool(
    "create_shadow_member",
    {
      description:
        "Add a member to a community by email (creates a shadow user if they haven't signed up yet). Admin role required.",
      inputSchema: {
        community_id: z.string(),
        email: z.string(),
        name: z.string(),
        headline: z.string().optional(),
        private_meta: z.record(z.string(), z.unknown()).optional(),
      },
    },
    (args, extra) =>
      withCtx(extra, "crm:write", async (ctx) =>
        callApi(ctx, `/api/crm/${encodeURIComponent(args.community_id)}/members`, {
          method: "POST",
          body: {
            email: args.email,
            name: args.name,
            headline: args.headline,
            private_meta: args.private_meta,
          },
        }),
      ),
  );

  server.registerTool(
    "update_member_field",
    {
      description:
        "Set one private CRM field on a member (field must be defined in CRM settings). Admin role required.",
      inputSchema: {
        community_id: z.string(),
        user_id: z.string(),
        field: z.string(),
        value: z.unknown(),
      },
    },
    (args, extra) =>
      withCtx(extra, "crm:write", async (ctx) =>
        callApi(
          ctx,
          `/api/crm/${encodeURIComponent(args.community_id)}/members/${encodeURIComponent(args.user_id)}/private`,
          { method: "PATCH", body: { field: args.field, value: args.value } },
        ),
      ),
  );

  server.registerTool(
    "bulk_update_member_field",
    {
      description:
        "Set one private CRM field on many members at once. Admin role required.",
      inputSchema: {
        community_id: z.string(),
        user_ids: z.array(z.string()).min(1).max(200),
        field: z.string(),
        value: z.unknown(),
      },
    },
    (args, extra) =>
      withCtx(extra, "crm:write", async (ctx) =>
        callApi(
          ctx,
          `/api/crm/${encodeURIComponent(args.community_id)}/members/bulk`,
          {
            method: "POST",
            body: {
              action: "update_private",
              user_ids: args.user_ids,
              field: args.field,
              value: args.value,
            },
          },
        ),
      ),
  );

  server.registerTool(
    "update_member_role",
    {
      description:
        "Change a member's role (admin/member). The last admin is protected and cannot be demoted. Admin role required.",
      inputSchema: {
        community_id: z.string(),
        user_id: z.string(),
        role: ROLE,
      },
    },
    (args, extra) =>
      withCtx(extra, "crm:write", async (ctx) =>
        callApi(
          ctx,
          `/api/crm/${encodeURIComponent(args.community_id)}/members/${encodeURIComponent(args.user_id)}/role`,
          { method: "PATCH", body: { role: args.role } },
        ),
      ),
  );

  server.registerTool(
    "import_members_csv",
    {
      description:
        "Bulk-import members from CSV content (creates shadow users + populates private fields). Admin role required. Max 1000 rows.",
      inputSchema: {
        community_id: z.string(),
        csv: z.string().describe("Raw CSV text with a header row"),
      },
    },
    (args, extra) =>
      withCtx(extra, "crm:write", async (ctx) => {
        const form = new FormData();
        form.append(
          "file",
          new Blob([args.csv], { type: "text/csv" }),
          "import.csv",
        );
        return callApiForm(
          ctx,
          `/api/crm/${encodeURIComponent(args.community_id)}/import`,
          form,
        );
      }),
  );

  server.registerTool(
    "get_crm_settings",
    {
      description: "Get a community's CRM field definitions (schema). Admin role required.",
      inputSchema: { community_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "crm:read", async (ctx) =>
        callApi(ctx, `/api/crm/${encodeURIComponent(args.community_id)}/settings`),
      ),
  );

  server.registerTool(
    "update_crm_settings",
    {
      description:
        "Replace a community's CRM field definitions. Admin role required. `fields` is the full field-definition array.",
      inputSchema: {
        community_id: z.string(),
        fields: z.array(z.record(z.string(), z.unknown())),
      },
    },
    (args, extra) =>
      withCtx(extra, "crm:write", async (ctx) =>
        callApi(ctx, `/api/crm/${encodeURIComponent(args.community_id)}/settings`, {
          method: "PUT",
          body: { fields: args.fields },
        }),
      ),
  );

  server.registerTool(
    "get_crm_audit",
    {
      description: "Get the CRM audit log for a community. Admin role required.",
      inputSchema: { community_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "crm:read", async (ctx) =>
        callApi(ctx, `/api/crm/${encodeURIComponent(args.community_id)}/audit`),
      ),
  );

  // ── Community custom columns + values (shared) ──
  server.registerTool(
    "list_community_columns",
    {
      description: "List the shared CRM column definitions for a community you belong to.",
      inputSchema: { community_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "crm:read", async (ctx) => {
        await assertMember(ctx, args.community_id);
        return callApi(ctx, "/api/crm/community-columns", {
          query: { community_id: args.community_id },
        });
      }),
  );

  server.registerTool(
    "get_community_values",
    {
      description:
        "Get shared CRM column values for a set of nodes in a community you belong to.",
      inputSchema: {
        community_id: z.string(),
        node_ids: z.array(z.string()),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "crm:read", async (ctx) => {
        await assertMember(ctx, args.community_id);
        return callApi(ctx, "/api/crm/community-values", {
          method: "POST",
          body: { community_id: args.community_id, node_ids: args.node_ids },
        });
      }),
  );

  server.registerTool(
    "set_community_value",
    {
      description:
        "Set a shared CRM column value on a node in a community you belong to.",
      inputSchema: {
        community_id: z.string(),
        node_id: z.string(),
        column_key: z.string(),
        column_id: z.string(),
        value: z.string().nullable().optional(),
      },
    },
    (args, extra) =>
      withCtx(extra, "crm:write", async (ctx) => {
        await assertMember(ctx, args.community_id);
        return callApi(ctx, "/api/crm/community-values", {
          method: "PUT",
          body: {
            community_id: args.community_id,
            node_id: args.node_id,
            column_key: args.column_key,
            column_id: args.column_id,
            value: args.value ?? null,
          },
        });
      }),
  );

  // ── Column + value-share requests (member proposes, admin reviews) ──
  server.registerTool(
    "request_community_column",
    {
      description:
        "Propose a new shared CRM column for a community you belong to (admins review and approve).",
      inputSchema: {
        community_id: z.string(),
        column_name: z.string(),
        column_type: z.string().describe("e.g. 'text', 'select', 'number'"),
        options: z.array(z.string()).optional(),
        description: z.string().optional(),
      },
    },
    (args, extra) =>
      withCtx(extra, "crm:write", async (ctx) => {
        await assertMember(ctx, args.community_id);
        return callApi(ctx, "/api/crm/column-requests", {
          method: "POST",
          body: {
            community_id: args.community_id,
            column_name: args.column_name,
            column_type: args.column_type,
            options: args.options,
            description: args.description,
          },
        });
      }),
  );

  server.registerTool(
    "list_column_requests",
    {
      description:
        "List CRM column requests for a community you belong to (your own, or all of them if you're an admin).",
      inputSchema: { community_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "crm:read", async (ctx) => {
        await assertMember(ctx, args.community_id);
        return callApi(ctx, "/api/crm/column-requests", {
          query: { community_id: args.community_id },
        });
      }),
  );

  server.registerTool(
    "review_column_request",
    {
      description: "Approve or reject a CRM column request. Admin role required.",
      inputSchema: {
        id: z.string(),
        status: REVIEW_STATUS,
        reviewer_note: z.string().optional(),
      },
    },
    (args, extra) =>
      withCtx(extra, "crm:write", async (ctx) =>
        callApi(ctx, "/api/crm/column-requests", {
          method: "PUT",
          body: { id: args.id, status: args.status, reviewer_note: args.reviewer_note },
        }),
      ),
  );

  server.registerTool(
    "request_value_share",
    {
      description:
        "Propose a value for a shared CRM column on a node (admins review and apply it). For a community you belong to.",
      inputSchema: {
        community_id: z.string(),
        node_id: z.string(),
        column_key: z.string(),
        column_name: z.string(),
        column_type: z.string(),
        value: z.string().nullable().optional(),
      },
    },
    (args, extra) =>
      withCtx(extra, "crm:write", async (ctx) => {
        await assertMember(ctx, args.community_id);
        return callApi(ctx, "/api/crm/value-share-requests", {
          method: "POST",
          body: {
            community_id: args.community_id,
            node_id: args.node_id,
            column_key: args.column_key,
            column_name: args.column_name,
            column_type: args.column_type,
            value: args.value ?? null,
          },
        });
      }),
  );

  server.registerTool(
    "list_value_share_requests",
    {
      description:
        "List value-share requests for a community you belong to (your own, or all if admin).",
      inputSchema: { community_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "crm:read", async (ctx) => {
        await assertMember(ctx, args.community_id);
        return callApi(ctx, "/api/crm/value-share-requests", {
          query: { community_id: args.community_id },
        });
      }),
  );

  server.registerTool(
    "review_value_share",
    {
      description: "Approve or reject a value-share request. Admin role required.",
      inputSchema: {
        id: z.string(),
        status: REVIEW_STATUS,
        reviewer_note: z.string().optional(),
      },
    },
    (args, extra) =>
      withCtx(extra, "crm:write", async (ctx) =>
        callApi(ctx, "/api/crm/value-share-requests", {
          method: "PUT",
          body: { id: args.id, status: args.status, reviewer_note: args.reviewer_note },
        }),
      ),
  );

  // ── Private columns + values (per-user, never shared) ──
  server.registerTool(
    "list_my_private_columns",
    {
      description: "List your personal (private) CRM columns.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    (_args, extra) =>
      withCtx(extra, "crm:read", async (ctx) =>
        callApi(ctx, "/api/crm/private-columns"),
      ),
  );

  server.registerTool(
    "create_private_column",
    {
      description: "Create a personal (private) CRM column only you can see.",
      inputSchema: {
        column_name: z.string(),
        column_type: z.string(),
        options: z.array(z.string()).optional(),
        community_id: z.string().optional(),
      },
    },
    (args, extra) =>
      withCtx(extra, "crm:write", async (ctx) =>
        callApi(ctx, "/api/crm/private-columns", {
          method: "POST",
          body: {
            column_name: args.column_name,
            column_type: args.column_type,
            options: args.options,
            community_id: args.community_id,
          },
        }),
      ),
  );

  server.registerTool(
    "update_private_column",
    {
      description: "Rename or change options on one of your private CRM columns.",
      inputSchema: {
        id: z.string(),
        column_name: z.string().optional(),
        options: z.array(z.string()).optional(),
      },
    },
    (args, extra) =>
      withCtx(extra, "crm:write", async (ctx) =>
        callApi(ctx, "/api/crm/private-columns", {
          method: "PATCH",
          body: { id: args.id, column_name: args.column_name, options: args.options },
        }),
      ),
  );

  server.registerTool(
    "get_private_values",
    {
      description: "Get your private CRM column values for a set of nodes.",
      inputSchema: { node_ids: z.array(z.string()) },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "crm:read", async (ctx) =>
        callApi(ctx, "/api/crm/private-values", {
          method: "POST",
          body: { node_ids: args.node_ids },
        }),
      ),
  );

  server.registerTool(
    "set_private_value",
    {
      description: "Set one of your private CRM column values on a node.",
      inputSchema: {
        node_id: z.string(),
        column_id: z.string(),
        value: z.string().nullable().optional(),
      },
    },
    (args, extra) =>
      withCtx(extra, "crm:write", async (ctx) =>
        callApi(ctx, "/api/crm/private-values", {
          method: "PUT",
          body: { node_id: args.node_id, column_id: args.column_id, value: args.value ?? null },
        }),
      ),
  );
}
