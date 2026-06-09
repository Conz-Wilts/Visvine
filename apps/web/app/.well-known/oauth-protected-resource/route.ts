/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728). Tells MCP clients which
 * Authorization Server issues tokens for this resource. Served via mcp-handler's
 * helper so the shape matches what its `withMcpAuth` challenge points clients to.
 */
import {
  protectedResourceHandler,
  metadataCorsOptionsRequestHandler,
} from "mcp-handler";
import { oauthIssuer } from "@/lib/mcp/config";

export const runtime = "nodejs";

const handler = protectedResourceHandler({ authServerUrls: [oauthIssuer()] });

export { handler as GET };
export const OPTIONS = metadataCorsOptionsRequestHandler();
