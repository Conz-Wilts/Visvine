/**
 * OAuth 2.0 Dynamic Client Registration (RFC 7591). MCP clients self-register
 * here to obtain a `client_id`. We only support public clients (PKCE, no secret).
 */
import { NextRequest, NextResponse } from "next/server";
import { registerClient } from "@/lib/mcp/oauth";

export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_client_metadata", error_description: "Body must be JSON" },
      { status: 400, headers: CORS },
    );
  }

  const meta = (body ?? {}) as Record<string, unknown>;
  const redirectUris = meta.redirect_uris;
  if (
    !Array.isArray(redirectUris) ||
    redirectUris.length === 0 ||
    !redirectUris.every((u) => typeof u === "string")
  ) {
    return NextResponse.json(
      {
        error: "invalid_redirect_uri",
        error_description: "redirect_uris must be a non-empty array of strings",
      },
      { status: 400, headers: CORS },
    );
  }

  const clientName =
    typeof meta.client_name === "string" ? meta.client_name : null;
  const scope = typeof meta.scope === "string" ? meta.scope : null;

  const client = await registerClient({
    redirectUris: redirectUris as string[],
    clientName,
    scope,
  });

  return NextResponse.json(
    {
      client_id: client.clientId,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      redirect_uris: client.redirectUris,
      client_name: client.clientName ?? undefined,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: client.scope ?? undefined,
    },
    { status: 201, headers: CORS },
  );
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
