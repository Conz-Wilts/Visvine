/**
 * Visvine MCP server endpoint (Streamable HTTP).
 *
 * `withMcpAuth` validates the OAuth Bearer access token (our `mcp_access` JWT)
 * and, on failure, returns 401 with a `WWW-Authenticate` challenge pointing at
 * the protected-resource metadata. Verified identity + scopes flow into each
 * tool via `extra.authInfo`. Tools then call the app's own API routes as the
 * user, so every community-scoping + role check runs in the route layer.
 */
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { registerAllTools } from "@/lib/mcp/tools";
import { verifyMcpBearer } from "@/lib/mcp/auth";
import { mcpResourceUrl } from "@/lib/mcp/config";

export const runtime = "nodejs";
export const maxDuration = 60;

const handler = createMcpHandler(
  (server) => {
    registerAllTools(server);
  },
  {
    serverInfo: { name: "visvine-mcp", version: "0.1.0" },
  },
  {
    // Route lives at /api/mcp; derive the streamable endpoint from this base.
    basePath: "/api",
    disableSse: true,
    verboseLogs: process.env.NODE_ENV !== "production",
    maxDuration: 60,
  },
);

const authHandler = withMcpAuth(handler, verifyMcpBearer, {
  required: true,
  resourceUrl: mcpResourceUrl(),
});

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
