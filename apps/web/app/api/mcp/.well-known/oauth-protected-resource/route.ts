/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) at the path the MCP
 * endpoint's 401 challenge advertises.
 *
 * `resource` is pinned to `mcpResourceUrl()` — the same value access tokens
 * carry as their `aud`, and the value clients must send as the RFC 8707
 * `resource` parameter — so a client that reads this document requests a token
 * for exactly the audience verification will accept.
 */
import { NextResponse } from 'next/server'
import { protectedResourceMetadata, METADATA_CORS } from '@/lib/mcp/metadata'

export const runtime = 'nodejs'

export function GET() {
  return NextResponse.json(protectedResourceMetadata('context'), { headers: METADATA_CORS })
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: METADATA_CORS })
}
