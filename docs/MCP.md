# Visvine MCP Server

A custom [Model Context Protocol](https://modelcontextprotocol.io) server that lets AI
clients (Claude, etc.) drive Visvine **as the signed-in user**, with a self-hosted OAuth 2.1
authorization layer. Every tool is gated twice: by an OAuth **scope** on the token, and by the
user's **community role**, re-checked live on every call.

## Endpoints

| Path | Purpose |
|---|---|
| `POST/GET/DELETE /api/mcp` | The MCP server (Streamable HTTP), wrapped in `withMcpAuth`. |
| `/.well-known/oauth-protected-resource` | RFC 9728 resource metadata → points clients at the AS. |
| `/.well-known/oauth-authorization-server` | RFC 8414 AS metadata (endpoints, scopes, PKCE). |
| `POST /api/oauth/register` | RFC 7591 Dynamic Client Registration (public/PKCE clients). |
| `GET/POST /api/oauth/authorize` | Auth-code + PKCE, with a sign-in bounce + consent screen. |
| `POST /api/oauth/token` | `authorization_code` + rotating `refresh_token` grants. |
| `POST /api/oauth/revoke` | RFC 7009 refresh-token revocation. |

All are listed in `middleware.ts` `PUBLIC_PATHS` so they bypass the HTML redirect and
authenticate themselves.

## How auth works

1. The client discovers the AS via the well-known metadata, dynamically registers, and starts
   an authorization-code + PKCE flow at `/api/oauth/authorize`.
2. `/authorize` requires a Visvine session (Google or, in dev, `/dev/login`); it bounces to
   `/signin?callbackUrl=…` if needed, then shows a consent screen listing the requested scopes.
3. On approval it issues a single-use auth code; `/token` exchanges it (verifying PKCE) for an
   **access token** (`mcp_access` JWT, ~1h, `aud` = the MCP resource URL, with a `scope` claim)
   and a rotating **refresh token** (stored hashed).
4. `/api/mcp` validates the Bearer access token (`verifyMcpBearer` → `verifyAccessToken`). The
   identity + scopes reach each tool via `extra.authInfo`.

### Two-layer enforcement (the tenant guarantee)
Every tool runs `withCtx(extra, scope, …)`:
- **Scope gate** — the tool's required scope must be in the token.
- **Community/role gate** — tools call the app's existing API routes **as the user** (a
  short-lived session JWT minted from the token identity in `lib/mcp/apiClient.ts`), so
  `isAdmin` / `assertCrmPermission` / `requireCommunityMember` / `requireEventManager` run
  unchanged. For routes that are only session-gated (context/CRM-value/feed/analytics reads), the
  tool additionally calls `assertMember(ctx, communityId)` so cross-community data can't leak.
  The client-supplied `community_id` is always paired with a live membership lookup keyed on the
  token's `userId`.

## Scopes

`communities:read`, `profile:read|write`, `directory:read|write`, `crm:read|write`,
`events:read|write|manage`, `messages:read`, `feed:read`,
`resources:read|write`, `content:read|write`, `analytics:read`. An empty request grants the
read-only subset. Destructive ops (delete, member removal) and act-as-you social side effects
(send DM, post to feed, RSVP) are intentionally **not** exposed in v1 — they belong behind
distinct elevated scopes.

## Config

| Env | Meaning |
|---|---|
| `AUTH_SECRET` | Reused to sign MCP access tokens (HS256). |
| `NEXT_PUBLIC_APP_URL` | Public origin = OAuth issuer. |
| `MCP_RESOURCE_URL` | Optional override of the resource id (default `${issuer}/api/mcp`). |
| `MCP_INTERNAL_BASE_URL` | Optional origin the server uses to call its own API routes. |

## Local testing

```
pnpm dev                                   # http://localhost:3000
curl localhost:3000/.well-known/oauth-authorization-server
pnpm --filter @visvine/web exec node --import tsx --test tests/mcp-auth.test.ts
npx @modelcontextprotocol/inspector        # point at http://localhost:3000/api/mcp, authenticate
```

Use `/dev/login` (admin@local.dev / member@local.dev) to satisfy `/authorize` without Google.
Exercise role gating: `set_community_value` should 403 as a `member` and 200 as an `admin`;
`get_member` for a community you don't belong to should 403.

## Code map

- `lib/mcp/` — `config.ts`, `scopes.ts`, `tokens.ts`, `auth.ts`, `apiClient.ts`, `result.ts`,
  `oauth.ts` (AS persistence + PKCE crypto), `tools/*` (one module per domain).
- `app/api/oauth/*`, `app/.well-known/oauth-*`, `app/api/mcp/route.ts`.
- Prisma models `OAuthClient`, `OAuthAuthCode`, `OAuthRefreshToken` in `prisma/schema.prisma`.
