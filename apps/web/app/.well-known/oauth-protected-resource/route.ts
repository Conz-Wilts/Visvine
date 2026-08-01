/**
 * Root copy of the Protected Resource Metadata (RFC 9728), for clients that
 * probe the origin root instead of following the MCP endpoint's 401 challenge
 * to /api/mcp/.well-known/oauth-protected-resource. Both paths serve the same
 * document from lib/mcp/metadata.ts.
 */
import { NextResponse } from 'next/server'
import { protectedResourceMetadata, METADATA_CORS } from '@/lib/mcp/metadata'

export const runtime = 'nodejs'

export function GET() {
  return NextResponse.json(protectedResourceMetadata(), { headers: METADATA_CORS })
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: METADATA_CORS })
}
