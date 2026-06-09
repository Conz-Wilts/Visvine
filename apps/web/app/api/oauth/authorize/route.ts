/**
 * OAuth 2.1 Authorization Endpoint (authorization-code + PKCE).
 *
 * GET  → validate the request, ensure the user has a Visvine session (else bounce
 *        to /signin), then render a consent screen listing the requested scopes.
 * POST → the user's approve/deny decision. On approve, mint a short-lived auth
 *        code bound to {user, client, redirect_uri, scope, code_challenge} and
 *        redirect back to the client.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getClient, createAuthCode } from "@/lib/mcp/oauth";
import { oauthIssuer } from "@/lib/mcp/config";
import { negotiateScopes, serializeScopes } from "@/lib/mcp/scopes";

export const runtime = "nodejs";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlError(message: string, status = 400): NextResponse {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Authorization error</title>` +
      `<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">` +
      `<h1>Authorization error</h1><p>${esc(message)}</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function redirectError(
  redirectUri: string,
  error: string,
  state: string | null,
): NextResponse {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (state) url.searchParams.set("state", state);
  return NextResponse.redirect(url);
}

interface AuthzParams {
  clientId: string;
  redirectUri: string;
  responseType: string;
  scope: string | null;
  state: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
}

function readParams(sp: URLSearchParams): AuthzParams {
  return {
    clientId: sp.get("client_id") ?? "",
    redirectUri: sp.get("redirect_uri") ?? "",
    responseType: sp.get("response_type") ?? "",
    scope: sp.get("scope"),
    state: sp.get("state"),
    codeChallenge: sp.get("code_challenge"),
    codeChallengeMethod: sp.get("code_challenge_method"),
  };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const p = readParams(url.searchParams);

  const client = await getClient(p.clientId);
  if (!client) return htmlError("Unknown client_id.");
  // Never redirect to an unregistered URI — that would be an open redirector.
  if (!client.redirectUris.includes(p.redirectUri)) {
    return htmlError("Invalid redirect_uri for this client.");
  }
  if (p.responseType !== "code") {
    return redirectError(p.redirectUri, "unsupported_response_type", p.state);
  }
  if (!p.codeChallenge || p.codeChallengeMethod !== "S256") {
    return redirectError(p.redirectUri, "invalid_request", p.state);
  }

  // The user must be signed in to Visvine to grant access as themselves.
  const session = await getSession();
  if (!session) {
    const signin = new URL("/signin", oauthIssuer());
    signin.searchParams.set("callbackUrl", url.pathname + url.search);
    return NextResponse.redirect(signin);
  }

  const scopes = negotiateScopes(p.scope, client.scope);
  const clientName = client.clientName || p.clientId;

  const hidden = (name: string, value: string) =>
    `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`;

  const page = `<!doctype html><meta charset="utf-8"><title>Authorize ${esc(clientName)}</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#14342b">
  <h1 style="font-size:1.4rem">Authorize access</h1>
  <p><strong>${esc(clientName)}</strong> wants to access Visvine as
     <strong>${esc(session.email)}</strong>.</p>
  <p>It will be able to:</p>
  <ul>${scopes.map((s) => `<li><code>${esc(s)}</code></li>`).join("")}</ul>
  <p style="color:#555;font-size:.9rem">Every action is still limited to the communities you belong to and your role in each.</p>
  <form method="post" action="/api/oauth/authorize" style="display:flex;gap:.75rem;margin-top:1.5rem">
    ${hidden("client_id", p.clientId)}
    ${hidden("redirect_uri", p.redirectUri)}
    ${hidden("scope", serializeScopes(scopes))}
    ${hidden("state", p.state ?? "")}
    ${hidden("code_challenge", p.codeChallenge)}
    ${hidden("code_challenge_method", p.codeChallengeMethod)}
    <button name="decision" value="approve" type="submit"
      style="background:#1f6f54;color:#fff;border:0;border-radius:8px;padding:.6rem 1.2rem;font-size:1rem;cursor:pointer">Approve</button>
    <button name="decision" value="deny" type="submit"
      style="background:#eee;color:#333;border:0;border-radius:8px;padding:.6rem 1.2rem;font-size:1rem;cursor:pointer">Deny</button>
  </form>
</body>`;

  return new NextResponse(page, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const get = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : null;
  };

  const clientId = get("client_id") ?? "";
  const redirectUri = get("redirect_uri") ?? "";
  const scope = get("scope");
  const state = get("state");
  const codeChallenge = get("code_challenge");
  const decision = get("decision");

  const client = await getClient(clientId);
  if (!client || !client.redirectUris.includes(redirectUri)) {
    return htmlError("Invalid client or redirect_uri.");
  }
  if (!codeChallenge) return redirectError(redirectUri, "invalid_request", state);

  const session = await getSession();
  if (!session) return htmlError("Your session expired. Please retry.", 401);

  if (decision !== "approve") {
    return redirectError(redirectUri, "access_denied", state);
  }

  const scopes = negotiateScopes(scope, client.scope);
  const code = await createAuthCode({
    clientId,
    userId: session.userId,
    redirectUri,
    scope: serializeScopes(scopes),
    codeChallenge,
  });

  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  return NextResponse.redirect(url);
}
