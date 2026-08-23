-- Refresh tokens are gone. An MCP grant is now exactly one stateless one-hour
-- access token (lib/mcp/tokens.ts); a client that wants another runs the
-- authorization flow again, and locally there is no token at all
-- (lib/mcp/devIdentity.ts). Nothing reads this table any more.
--
-- Dropping it invalidates every outstanding refresh token, which is the point:
-- the grant type they belonged to no longer exists, so leaving the rows behind
-- would only preserve credentials no endpoint would honour.
DROP TABLE IF EXISTS "oauth_refresh_tokens";
