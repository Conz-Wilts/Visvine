/**
 * Blog / marketing content tools. The backend exposes no JSON read API for blog
 * posts (they're rendered server-side), so only the super-admin authoring writes
 * are wrapped here.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callApi } from "@/lib/mcp/apiClient";
import { withCtx } from "@/lib/mcp/tools/_helpers";

export function registerBlogTools(server: McpServer): void {
  server.registerTool(
    "create_blog_post",
    {
      description:
        "Create a new draft blog post and return its id + slug. Super-admin only.",
      inputSchema: {
        title: z.string().optional().describe("Defaults to 'Untitled post'"),
      },
    },
    (args, extra) =>
      withCtx(extra, "content:write", async (ctx) =>
        callApi(ctx, "/api/blog/posts", {
          method: "POST",
          body: { title: args.title },
        }),
      ),
  );

  server.registerTool(
    "update_blog_post",
    {
      description:
        "Update a blog post's title/excerpt/cover/content or publish state. Set published=true to publish. Super-admin only. `content` is a TipTap JSON document.",
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        excerpt: z.string().nullable().optional(),
        cover_image: z.string().nullable().optional(),
        content: z.record(z.string(), z.unknown()).optional(),
        published: z.boolean().optional(),
      },
    },
    (args, extra) =>
      withCtx(extra, "content:write", async (ctx) => {
        const body: Record<string, unknown> = {};
        if (args.title !== undefined) body.title = args.title;
        if (args.excerpt !== undefined) body.excerpt = args.excerpt;
        if (args.cover_image !== undefined) body.coverImage = args.cover_image;
        if (args.content !== undefined) body.content = args.content;
        if (args.published !== undefined) body.published = args.published;
        return callApi(ctx, `/api/blog/posts/${encodeURIComponent(args.id)}`, {
          method: "PATCH",
          body,
        });
      }),
  );
}
