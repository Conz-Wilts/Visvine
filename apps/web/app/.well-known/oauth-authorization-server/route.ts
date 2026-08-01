/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414) — how an MCP client
 * discovers where to authorize and exchange tokens, and which of the three
 * registration mechanisms this server accepts.
 *
 * The document itself is built in lib/mcp/metadata.ts.
 */
import { NextResponse } from 'next/server'
import { authorizationServerMetadata, METADATA_CORS } from '@/lib/mcp/metadata'

export const runtime = 'nodejs'

export function GET() {
  return NextResponse.json(authorizationServerMetadata(), { headers: METADATA_CORS })
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: METADATA_CORS })
}
