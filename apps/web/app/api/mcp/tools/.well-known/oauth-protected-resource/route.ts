/**
 * Protected Resource Metadata (RFC 9728) for Visvine Tools, at the endpoint's
 * own sub-path — the same document the path-suffixed well-known route serves
 * for `/api/mcp/tools`.
 */
import { NextResponse } from 'next/server'
import { protectedResourceMetadata, METADATA_CORS } from '@/lib/mcp/metadata'

export const runtime = 'nodejs'

export function GET() {
  return NextResponse.json(protectedResourceMetadata('tools'), { headers: METADATA_CORS })
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: METADATA_CORS })
}
