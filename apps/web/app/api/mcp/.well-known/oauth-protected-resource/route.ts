/**
 * Protected Resource Metadata (RFC 9728) at the path `withMcpAuth` advertises in
 * its 401 `WWW-Authenticate` challenge — `<mcp-route>/.well-known/oauth-protected-resource`.
 * `resourceUrl` is pinned to the MCP resource id so it matches the access-token
 * `aud`. (A copy also lives at the site root for clients that probe there.)
 */
import {
  protectedResourceHandler,
  metadataCorsOptionsRequestHandler,
} from "mcp-handler";
import { oauthIssuer, mcpResourceUrl } from "@/lib/mcp/config";

export const runtime = "nodejs";

const handler = protectedResourceHandler({
  authServerUrls: [oauthIssuer()],
  resourceUrl: mcpResourceUrl(),
});

export { handler as GET };
export const OPTIONS = metadataCorsOptionsRequestHandler();
