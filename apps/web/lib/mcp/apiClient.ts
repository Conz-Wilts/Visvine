/**
 * Internal API client used by every MCP tool.
 *
 * Each tool calls the app's OWN API route as the MCP user: we mint a short-lived
 * web-session JWT from the token identity and send it as a Bearer header, so the
 * existing route handlers run their real authorization + community-scoping logic
 * (`isAdmin`, `assertCrmPermission`, `requireCommunityMember`, …) unchanged. The
 * MCP layer therefore NEVER re-implements authz — it delegates to the routes
 * that already own it, guaranteeing parity with the web/mobile clients.
 */
import { createSession } from "@/lib/session";
import { appBaseUrl } from "@/lib/mcp/config";
import type { McpContext } from "@/lib/mcp/auth";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type QueryValue = string | number | boolean | undefined | null;

interface CallOpts {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, QueryValue>;
  body?: unknown;
}

async function mintInternalSession(ctx: McpContext): Promise<string> {
  return createSession({
    userId: ctx.userId,
    name: ctx.name || ctx.email || ctx.userId,
    email: ctx.email,
    personId: ctx.personId,
  });
}

function buildUrl(path: string, query?: Record<string, QueryValue>): URL {
  const url = new URL(`${appBaseUrl()}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url;
}

async function send(ctx: McpContext, path: string, opts: CallOpts): Promise<Response> {
  const jwt = await mintInternalSession(ctx);
  const res = await fetch(buildUrl(path, opts.query), {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${jwt}`,
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 600);
    } catch {
      /* ignore */
    }
    throw new ApiError(
      res.status,
      `${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`,
    );
  }
  return res;
}

/** Call an internal API route and parse the JSON body. */
export async function callApi<T = unknown>(
  ctx: McpContext,
  path: string,
  opts: CallOpts = {},
): Promise<T> {
  const res = await send(ctx, path, opts);
  return (await res.json()) as T;
}

/** Call an internal API route that returns text (CSV / ICS). */
export async function callApiText(
  ctx: McpContext,
  path: string,
  opts: CallOpts = {},
): Promise<string> {
  const res = await send(ctx, path, opts);
  return res.text();
}

/**
 * POST a multipart/form-data body (e.g. CSV import) to an internal route.
 * @public used by the parked MCP tool modules (lib/mcp/tools/crm.ts)
 */
export async function callApiForm<T = unknown>(
  ctx: McpContext,
  path: string,
  form: FormData,
): Promise<T> {
  const jwt = await mintInternalSession(ctx);
  const res = await fetch(buildUrl(path), {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` }, // let fetch set the multipart boundary
    body: form,
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 600);
    } catch {
      /* ignore */
    }
    throw new ApiError(
      res.status,
      `${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`,
    );
  }
  return (await res.json()) as T;
}
