-- The MCP surface is now two servers (lib/mcp/config.ts): the CONTEXT server
-- at /api/mcp and the CREATOR server (Tool authoring) at /api/mcp/creator.
-- Each is its own OAuth protected resource, and an access token is minted for
-- exactly one of them (its `aud`). Access tokens are stateless JWTs, but the
-- grant that mints them — the authorization code, and every refresh token
-- rotated from it — has to remember which server it was authorized for, so a
-- refresh cannot quietly re-mint the token for the other one.
--
-- Backfill: every existing grant predates the split and was for the one
-- server that existed, which is now the context server.

ALTER TABLE "oauth_auth_codes"
  ADD COLUMN "resource" TEXT NOT NULL DEFAULT 'context';

ALTER TABLE "oauth_refresh_tokens"
  ADD COLUMN "resource" TEXT NOT NULL DEFAULT 'context';

-- Only the two known servers may ever be stored: an unexpected value would
-- otherwise have to be interpreted at read time, and any interpretation other
-- than "refuse" risks minting a token for the wrong server. The application
-- side (lib/mcp/oauth.ts kindFromStored) refuses too; this keeps the data
-- honest even for writers that bypass it. Safe on existing rows: the DEFAULT
-- above backfilled every one of them with 'context'.
ALTER TABLE "oauth_auth_codes"
  ADD CONSTRAINT "oauth_auth_codes_resource_check" CHECK ("resource" IN ('context', 'creator'));

ALTER TABLE "oauth_refresh_tokens"
  ADD CONSTRAINT "oauth_refresh_tokens_resource_check" CHECK ("resource" IN ('context', 'creator'));
