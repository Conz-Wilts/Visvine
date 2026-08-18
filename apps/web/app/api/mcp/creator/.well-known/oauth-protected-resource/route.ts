/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) for the CREATOR MCP server,
 * at the path its 401 challenge advertises. `resource` is pinned to
 * `mcpResourceUrl('creator')` — the `aud` its access tokens carry, and the
 * RFC 8707 `resource` a client must send to be issued one.
 */
import { NextResponse } from 'next/server'
import { protectedResourceMetadata, METADATA_CORS } from '@/lib/mcp/metadata'

export const runtime = 'nodejs'

export function GET() {
  return NextResponse.json(protectedResourceMetadata('creator'), { headers: METADATA_CORS })
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: METADATA_CORS })
}
