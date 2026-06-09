/**
 * Unit tests for the MCP token + scope layer. These are pure (no DB / network):
 * they prove that the access-token contract (typ + aud + scope), the
 * verifier→context bridge, and scope negotiation behave as the auth design
 * requires. Run: pnpm --filter @visvine/web exec node --import tsx --test tests/mcp-auth.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";

process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "unit-test-secret-please-override";

import { mintAccessToken, verifyAccessToken } from "@/lib/mcp/tokens";
import { verifyMcpBearer, contextFromAuthInfo } from "@/lib/mcp/auth";
import { negotiateScopes, parseScopes, DEFAULT_SCOPES } from "@/lib/mcp/scopes";
import { mcpResourceUrl } from "@/lib/mcp/config";

const IDENTITY = {
  userId: "user_1",
  name: "Ada Lovelace",
  email: "ada@local.dev",
  personId: "person:ada",
};

function secret() {
  return new TextEncoder().encode(process.env.AUTH_SECRET);
}

test("mint → verify round-trips identity + scopes", async () => {
  const { token } = await mintAccessToken(IDENTITY, ["events:read", "crm:write"], "mcp_client");
  const v = await verifyAccessToken(token);
  assert.ok(v);
  assert.equal(v.userId, "user_1");
  assert.equal(v.email, "ada@local.dev");
  assert.equal(v.personId, "person:ada");
  assert.equal(v.clientId, "mcp_client");
  assert.deepEqual(v.scopes, ["events:read", "crm:write"]);
});

test("verify rejects a non-MCP JWT (wrong typ) even with valid aud + signature", async () => {
  const sessionLike = await new SignJWT({ email: "ada@local.dev" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("user_1")
    .setAudience(mcpResourceUrl())
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret());
  assert.equal(await verifyAccessToken(sessionLike), null);
});

test("verify rejects a token minted for a different resource (aud mismatch)", async () => {
  const wrongAud = await new SignJWT({ typ: "mcp_access", scope: "events:read" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("user_1")
    .setAudience("https://evil.example/api/mcp")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret());
  assert.equal(await verifyAccessToken(wrongAud), null);
});

test("verify rejects garbage", async () => {
  assert.equal(await verifyAccessToken("not-a-jwt"), null);
});

test("verifyMcpBearer yields AuthInfo with identity in extra", async () => {
  const { token } = await mintAccessToken(IDENTITY, ["directory:read"], "mcp_client");
  const req = new Request("http://localhost:3000/api/mcp");
  const info = await verifyMcpBearer(req, token);
  assert.ok(info);
  assert.equal(info.clientId, "mcp_client");
  assert.deepEqual(info.scopes, ["directory:read"]);
  assert.equal((info.extra as { userId?: string }).userId, "user_1");

  // No / bad bearer → undefined (rejected by withMcpAuth).
  assert.equal(await verifyMcpBearer(req, undefined), undefined);
  assert.equal(await verifyMcpBearer(req, "garbage"), undefined);
});

test("contextFromAuthInfo builds context, and rejects missing identity", async () => {
  const { token } = await mintAccessToken(IDENTITY, ["crm:read"], "mcp_client");
  const info = await verifyMcpBearer(new Request("http://localhost/api/mcp"), token);
  const ctx = contextFromAuthInfo(info);
  assert.ok(ctx);
  assert.equal(ctx.userId, "user_1");
  assert.deepEqual(ctx.scopes, ["crm:read"]);

  assert.equal(contextFromAuthInfo(undefined), null);
});

test("scope negotiation: empty → default reads; client allowlist intersects; unknowns dropped", () => {
  // Empty request → default read-only set.
  assert.deepEqual(negotiateScopes(null, null), DEFAULT_SCOPES);

  // Allowlist intersects the request.
  assert.deepEqual(
    negotiateScopes("events:read events:write crm:write", "events:read crm:write"),
    ["events:read", "crm:write"],
  );

  // Unknown scopes are discarded.
  assert.deepEqual(parseScopes("events:read totally:fake crm:write"), [
    "events:read",
    "crm:write",
  ]);
});
