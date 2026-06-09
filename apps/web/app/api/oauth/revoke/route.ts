/**
 * OAuth 2.0 Token Revocation (RFC 7009). Revokes a refresh token so a user can
 * disconnect an MCP client. Always returns 200 (per spec, even for unknown tokens).
 */
import { NextRequest, NextResponse } from "next/server";
import { revokeRefreshToken } from "@/lib/mcp/oauth";

export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function POST(req: NextRequest) {
  let token: string | null = null;
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      const body = (await req.json()) as { token?: unknown };
      token = typeof body.token === "string" ? body.token : null;
    } else {
      const form = await req.formData();
      const v = form.get("token");
      token = typeof v === "string" ? v : null;
    }
  } catch {
    /* ignore malformed body — still 200 per spec */
  }

  if (token) await revokeRefreshToken(token);
  return new NextResponse(null, { status: 200, headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
