/** Event management tools (create/list/get/update + host-only attendee ops). */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callApi, callApiText } from "@/lib/mcp/apiClient";
import { withCtx } from "@/lib/mcp/tools/_helpers";

const VISIBILITY = z.enum(["public", "community", "private"]);
const STATUS = z.enum(["draft", "published"]);

export function registerEventTools(server: McpServer): void {
  server.registerTool(
    "list_events",
    {
      description:
        "List published events for a community you belong to, each with attendance stats.",
      inputSchema: { community_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "events:read", async (ctx) =>
        callApi(ctx, "/api/events", { query: { communityId: args.community_id } }),
      ),
  );

  server.registerTool(
    "get_event",
    {
      description:
        "Get one event with attendance stats. Set include_attendees=true to also get the guest list (hosts/admins only).",
      inputSchema: {
        community_id: z.string(),
        event_id: z.string(),
        include_attendees: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "events:read", async (ctx) =>
        callApi(ctx, `/api/events/${encodeURIComponent(args.event_id)}`, {
          query: {
            communityId: args.community_id,
            includeAttendees: args.include_attendees ? "true" : undefined,
          },
        }),
      ),
  );

  server.registerTool(
    "create_event",
    {
      description:
        "Create an event in a community you belong to (you become a host). Defaults to a published, community-visible event.",
      inputSchema: {
        community_id: z.string(),
        title: z.string(),
        start_at: z.string().describe("ISO 8601 datetime, e.g. 2026-07-01T18:00:00Z"),
        end_at: z.string().optional().describe("ISO 8601 datetime"),
        timezone: z.string().optional(),
        location: z.string().optional().describe("Human-readable location label"),
        description: z.string().optional(),
        visibility: VISIBILITY.optional(),
        capacity: z.number().int().positive().optional(),
        status: STATUS.optional().describe("draft or published (default published)"),
        hosts: z.array(z.string()).optional().describe("Additional host personIds"),
        cover_image_url: z.string().optional(),
      },
    },
    (args, extra) =>
      withCtx(extra, "events:write", async (ctx) => {
        const body: Record<string, unknown> = {
          communityId: args.community_id,
          title: args.title,
          startAt: args.start_at,
        };
        if (args.end_at !== undefined) body.endAt = args.end_at;
        if (args.timezone !== undefined) body.timezone = args.timezone;
        if (args.location !== undefined) body.location = { label: args.location };
        if (args.description !== undefined) body.description = args.description;
        if (args.visibility !== undefined) body.visibility = args.visibility;
        if (args.capacity !== undefined) body.capacity = args.capacity;
        if (args.status !== undefined) body.status = args.status;
        if (args.hosts !== undefined) body.hosts = args.hosts;
        if (args.cover_image_url !== undefined) body.coverImageUrl = args.cover_image_url;
        return callApi(ctx, "/api/events", { method: "POST", body });
      }),
  );

  server.registerTool(
    "update_event",
    {
      description:
        "Update an event's details. Only the fields you pass change. Requires being a host of the event or a community admin.",
      inputSchema: {
        community_id: z.string(),
        event_id: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        start_at: z.string().optional(),
        end_at: z.string().optional(),
        timezone: z.string().optional(),
        location: z.string().optional(),
        capacity: z.number().int().positive().optional(),
        visibility: VISIBILITY.optional(),
        status: STATUS.optional(),
      },
    },
    (args, extra) =>
      withCtx(extra, "events:write", async (ctx) => {
        const body: Record<string, unknown> = {};
        if (args.title !== undefined) body.title = args.title;
        if (args.description !== undefined) body.description = args.description;
        if (args.start_at !== undefined) body.startAt = args.start_at;
        if (args.end_at !== undefined) body.endAt = args.end_at;
        if (args.timezone !== undefined) body.timezone = args.timezone;
        if (args.location !== undefined) body.location = { label: args.location };
        if (args.capacity !== undefined) body.capacity = args.capacity;
        if (args.visibility !== undefined) body.visibility = args.visibility;
        if (args.status !== undefined) body.status = args.status;
        return callApi(ctx, `/api/events/${encodeURIComponent(args.event_id)}`, {
          method: "PATCH",
          query: { communityId: args.community_id },
          body,
        });
      }),
  );

  server.registerTool(
    "list_attendees",
    {
      description:
        "List an event's attendees/guest list (PII). Requires being a host of the event or a community admin.",
      inputSchema: { community_id: z.string(), event_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "events:manage", async (ctx) =>
        callApi(
          ctx,
          `/api/events/${encodeURIComponent(args.event_id)}/attendees`,
          { query: { communityId: args.community_id } },
        ),
      ),
  );

  server.registerTool(
    "update_attendee",
    {
      description:
        "Change one attendee's status (approve, promote from waitlist, check in, mark no-show, waitlist, or decline). Host/admin only.",
      inputSchema: {
        community_id: z.string(),
        event_id: z.string(),
        attendee_id: z.string(),
        action: z.enum([
          "approve",
          "promote",
          "waitlist",
          "checkin",
          "uncheckin",
          "no_show",
          "decline",
        ]),
      },
    },
    (args, extra) =>
      withCtx(extra, "events:manage", async (ctx) =>
        callApi(
          ctx,
          `/api/events/${encodeURIComponent(args.event_id)}/attendees/${encodeURIComponent(args.attendee_id)}`,
          {
            method: "PATCH",
            query: { communityId: args.community_id },
            body: { action: args.action },
          },
        ),
      ),
  );

  server.registerTool(
    "bulk_update_attendees",
    {
      description:
        "Apply a status action to many attendees at once — either an explicit attendee_ids list or a status scope. Host/admin only. (Removal is intentionally not exposed here.)",
      inputSchema: {
        community_id: z.string(),
        event_id: z.string(),
        action: z.enum(["approve", "promote", "decline", "checkin", "no_show"]),
        attendee_ids: z.array(z.string()).optional(),
        scope: z
          .enum(["pending", "waitlisted", "going", "maybe", "checked_in"])
          .optional()
          .describe("Target all attendees in this status group"),
      },
    },
    (args, extra) =>
      withCtx(extra, "events:manage", async (ctx) =>
        callApi(
          ctx,
          `/api/events/${encodeURIComponent(args.event_id)}/attendees/bulk`,
          {
            method: "POST",
            query: { communityId: args.community_id },
            body: {
              action: args.action,
              attendeeIds: args.attendee_ids,
              scope: args.scope,
            },
          },
        ),
      ),
  );

  server.registerTool(
    "export_attendees_csv",
    {
      description: "Export an event's attendee list as CSV text. Host/admin only.",
      inputSchema: { community_id: z.string(), event_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "events:manage", async (ctx) =>
        callApiText(
          ctx,
          `/api/events/${encodeURIComponent(args.event_id)}/export.csv`,
          { query: { communityId: args.community_id } },
        ),
      ),
  );

  server.registerTool(
    "get_event_ics",
    {
      description: "Get an event as an iCalendar (.ics) text document.",
      inputSchema: { community_id: z.string(), event_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      withCtx(extra, "events:read", async (ctx) =>
        callApiText(ctx, `/api/events/${encodeURIComponent(args.event_id)}/ics`, {
          query: { communityId: args.community_id },
        }),
      ),
  );
}
