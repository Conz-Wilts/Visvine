/**
 * Directory / graph / companies / search tools.
 *
 * Companies & organizations are `Node`s of type "organization" — there is no
 * separate model, so they're covered by the node tools plus a typed convenience
 * wrapper. Several backing routes are only session-gated, so we `assertMember`
 * (or filter to the caller's communities) to keep the tenant boundary intact.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callApi, ApiError } from "@/lib/mcp/apiClient";
import { withCtx, assertMember, getMyCommunities } from "@/lib/mcp/tools/_helpers";

interface NodeShape {
  id?: string;
  type?: string;
  name?: string;
  community_id?: string;
}

export function registerDirectoryTools(server: McpServer): void {
  server.registerTool(
    "list_directory",
    {
      description:
        "List the directory nodes (people, organizations, events, groups) for a community you belong to. Optionally filter by node type.",
      inputSchema: {
        community_id: z.string(),
        type: z.string().optional().describe("Filter by node type, e.g. 'person' or 'organization'"),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "directory:read", async (ctx) => {
        await assertMember(ctx, args.community_id);
        const data = await callApi<{ nodes?: NodeShape[] }>(
          ctx,
          `/api/communities/${encodeURIComponent(args.community_id)}/directory`,
        );
        let nodes = data.nodes ?? [];
        if (args.type) {
          const t = args.type.toLowerCase();
          nodes = nodes.filter((n) => (n.type ?? "").toLowerCase() === t);
        }
        return { nodes, count: nodes.length };
      }),
  );

  server.registerTool(
    "list_organizations",
    {
      description:
        "List the organization/company nodes for a community you belong to (companies are nodes of type 'organization').",
      inputSchema: { community_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "directory:read", async (ctx) => {
        await assertMember(ctx, args.community_id);
        const data = await callApi<{ nodes?: NodeShape[] }>(
          ctx,
          `/api/communities/${encodeURIComponent(args.community_id)}/directory`,
        );
        const orgs = (data.nodes ?? []).filter((n) => {
          const t = (n.type ?? "").toLowerCase();
          return t === "organization" || t === "company" || t === "org" || t === "group";
        });
        return { organizations: orgs, count: orgs.length };
      }),
  );

  server.registerTool(
    "get_graph",
    {
      description:
        "Get the full relationship graph (nodes + links) for a community you belong to.",
      inputSchema: { community_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "directory:read", async (ctx) => {
        await assertMember(ctx, args.community_id);
        return callApi(
          ctx,
          `/api/communities/${encodeURIComponent(args.community_id)}/graph`,
        );
      }),
  );

  server.registerTool(
    "get_node",
    {
      description:
        "Get a single node (person/organization/event) with its connections and connection count. Only nodes in a community you belong to are returned.",
      inputSchema: { node_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "directory:read", async (ctx) => {
        const data = await callApi<{ node?: NodeShape }>(
          ctx,
          `/api/nodes/${encodeURIComponent(args.node_id)}`,
        );
        const cid = data.node?.community_id;
        if (cid) await assertMember(ctx, cid);
        return data;
      }),
  );

  server.registerTool(
    "search_nodes",
    {
      description:
        "Fuzzy keyword search for nodes by name (or email, for people) across your communities. Results are restricted to communities you belong to.",
      inputSchema: {
        q: z.string().min(2).describe("Search text (min 2 chars)"),
        type: z.enum(["person", "resource", "event"]).optional(),
        field: z.enum(["name", "email"]).optional(),
        community_id: z.string().optional().describe("Restrict to this community"),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "directory:read", async (ctx) => {
        const { communities, isSuperAdmin } = await getMyCommunities(ctx);
        if (args.community_id && !isSuperAdmin && !communities.has(args.community_id)) {
          throw new ApiError(403, `You are not a member of '${args.community_id}'`);
        }
        const data = await callApi<{ results?: NodeShape[] }>(ctx, "/api/nodes/search", {
          query: { q: args.q, type: args.type, field: args.field },
        });
        const results = (data.results ?? []).filter((r) => {
          if (args.community_id) return r.community_id === args.community_id;
          if (isSuperAdmin) return true; // super-admins search every community
          return r.community_id != null && communities.has(r.community_id);
        });
        return { results, count: results.length };
      }),
  );

  // ── Safe writes (admin-gated by the underlying route) ──

  server.registerTool(
    "create_node",
    {
      description:
        "Create a directory node (person, organization, event, etc.) in a community. Requires admin role in that community. An id is generated unless you supply one.",
      inputSchema: {
        community_id: z.string(),
        type: z.string().describe("Node type, e.g. 'person', 'organization'"),
        name: z.string(),
        id: z.string().optional().describe("Optional explicit node id (else generated as type:uuid)"),
        subtitle: z.string().optional(),
        location: z.string().optional(),
        url: z.string().optional(),
        tags: z.array(z.string()).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      },
    },
    (args, extra) =>
      withCtx(extra, "directory:write", async (ctx) => {
        await assertMember(ctx, args.community_id);
        const id =
          args.id ?? `${args.type.toLowerCase()}:${crypto.randomUUID()}`;
        const node = {
          id,
          type: args.type,
          name: args.name,
          subtitle: args.subtitle ?? null,
          location: args.location ?? null,
          url: args.url ?? null,
          tags: args.tags ?? [],
          metadata: args.metadata ?? {},
        };
        return callApi(ctx, "/api/data/nodes", {
          method: "POST",
          body: { node, community_id: args.community_id },
        });
      }),
  );

  server.registerTool(
    "update_node",
    {
      description:
        "Update fields on an existing node (only the fields you pass change). Requires admin role in the node's community.",
      inputSchema: {
        community_id: z.string(),
        node_id: z.string(),
        name: z.string().optional(),
        subtitle: z.string().optional(),
        location: z.string().optional(),
        url: z.string().optional(),
        image_url: z.string().optional(),
        tags: z.array(z.string()).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      },
    },
    (args, extra) =>
      withCtx(extra, "directory:write", async (ctx) => {
        await assertMember(ctx, args.community_id);
        // The PUT route requires type + name; fetch current node to preserve them.
        const current = await callApi<{ node?: NodeShape }>(
          ctx,
          `/api/nodes/${encodeURIComponent(args.node_id)}`,
        );
        if (!current.node) throw new ApiError(404, "Node not found");
        const node: Record<string, unknown> = {
          id: args.node_id,
          type: current.node.type,
          name: args.name ?? current.node.name,
        };
        if (args.subtitle !== undefined) node.subtitle = args.subtitle;
        if (args.location !== undefined) node.location = args.location;
        if (args.url !== undefined) node.url = args.url;
        if (args.image_url !== undefined) node.image_url = args.image_url;
        if (args.tags !== undefined) node.tags = args.tags;
        if (args.metadata !== undefined) node.metadata = args.metadata;
        return callApi(ctx, "/api/data/nodes", {
          method: "PUT",
          body: { node, community_id: args.community_id },
        });
      }),
  );

  server.registerTool(
    "create_link",
    {
      description:
        "Create a directed relationship (link) between two nodes (e.g. person 'works at' organization). Requires admin role in the community.",
      inputSchema: {
        community_id: z.string(),
        source_id: z.string(),
        target_id: z.string(),
        relationship: z.string().describe("e.g. 'works at', 'founder', 'advisor'"),
        since: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      },
    },
    (args, extra) =>
      withCtx(extra, "directory:write", async (ctx) => {
        await assertMember(ctx, args.community_id);
        return callApi(ctx, "/api/data/links", {
          method: "POST",
          body: {
            link: {
              source: args.source_id,
              target: args.target_id,
              relationship: args.relationship,
              since: args.since ?? null,
              metadata: args.metadata ?? {},
            },
            community_id: args.community_id,
          },
        });
      }),
  );

  server.registerTool(
    "update_link",
    {
      description:
        "Update the relationship/since/metadata of an existing link between two nodes. Requires admin role in the community.",
      inputSchema: {
        community_id: z.string(),
        source_id: z.string(),
        target_id: z.string(),
        relationship: z.string(),
        since: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      },
    },
    (args, extra) =>
      withCtx(extra, "directory:write", async (ctx) => {
        await assertMember(ctx, args.community_id);
        return callApi(ctx, "/api/data/links", {
          method: "PUT",
          body: {
            link: {
              source: args.source_id,
              target: args.target_id,
              relationship: args.relationship,
              since: args.since ?? null,
              metadata: args.metadata ?? {},
            },
            community_id: args.community_id,
            originalSource: args.source_id,
            originalTarget: args.target_id,
          },
        });
      }),
  );

}
