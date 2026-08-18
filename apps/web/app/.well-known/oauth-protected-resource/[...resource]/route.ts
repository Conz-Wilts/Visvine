/**
 * RFC 9728 §3.1 path-suffixed Protected Resource Metadata: for a resource at
 * `https://host/api/mcp/creator` a client may probe
 * `https://host/.well-known/oauth-protected-resource/api/mcp/creator`. Serves
 * whichever of our two servers the suffix names (from lib/mcp/metadata.ts,
 * byte-identical to the endpoint's own sub-path copy) and 404s for any other.
 * Matched on path alone, so it keeps working when MCP_RESOURCE_URL moves the
 * servers to another origin.
 */
import { NextRequest, NextResponse } from 'next/server'
import { MCP_SERVER_KINDS, mcpResourceUrl } from '@/lib/mcp/config'
import { protectedResourceMetadata, METADATA_CORS } from '@/lib/mcp/metadata'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ resource: string[] }> }) {
  const { resource } = await ctx.params
  const path = `/${resource.join('/')}`.replace(/\/$/, '').toLowerCase()
  const kind = MCP_SERVER_KINDS.find((k) => new URL(mcpResourceUrl(k)).pathname.toLowerCase() === path)
  if (!kind) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: METADATA_CORS })
  return NextResponse.json(protectedResourceMetadata(kind), { headers: METADATA_CORS })
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: METADATA_CORS })
}
