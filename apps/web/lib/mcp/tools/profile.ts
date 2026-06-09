/** Profile tools — read any person profile, update your own. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callApi, ApiError } from "@/lib/mcp/apiClient";
import { withCtx } from "@/lib/mcp/tools/_helpers";

export function registerProfileTools(server: McpServer): void {
  server.registerTool(
    "get_profile",
    {
      description: "Get a person's full profile by their person node id (person:...).",
      inputSchema: { person_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "profile:read", async (ctx) =>
        callApi(ctx, `/api/profile/${encodeURIComponent(args.person_id)}`),
      ),
  );

  server.registerTool(
    "update_my_profile",
    {
      description:
        "Update your own profile. Only the fields you pass change. Targets your linked person profile.",
      inputSchema: {
        person_id: z
          .string()
          .optional()
          .describe("Defaults to your own personId from the session"),
        name: z.string().optional(),
        subtitle: z.string().optional(),
        bio: z.string().optional(),
        location: z.string().optional(),
        website: z.string().optional(),
        linkedinUrl: z.string().optional(),
        twitterUrl: z.string().optional(),
        phone: z.string().optional(),
        pronouns: z.string().optional(),
        openToWork: z.boolean().optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    (args, extra) =>
      withCtx(extra, "profile:write", async (ctx) => {
        const personId = args.person_id ?? ctx.personId;
        if (!personId) {
          throw new ApiError(
            400,
            "No personId for the current user; pass person_id explicitly (the route enforces ownership).",
          );
        }
        const body: Record<string, unknown> = {};
        for (const k of [
          "name",
          "subtitle",
          "bio",
          "location",
          "website",
          "linkedinUrl",
          "twitterUrl",
          "phone",
          "pronouns",
          "openToWork",
          "tags",
        ] as const) {
          if (args[k] !== undefined) body[k] = args[k];
        }
        return callApi(ctx, `/api/profile/${encodeURIComponent(personId)}`, {
          method: "PATCH",
          body,
        });
      }),
  );
}
