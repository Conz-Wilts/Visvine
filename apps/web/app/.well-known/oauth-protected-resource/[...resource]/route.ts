/**
 * RFC 9728 §3.1 path-suffixed Protected Resource Metadata: for a resource at
 * `https://host/api/mcp` a client may probe
 * `https://host/.well-known/oauth-protected-resource/api/mcp`. Serves the same
 * document as the endpoint's own sub-path copy (from lib/mcp/metadata.ts, so
 * they are byte-identical) and 404s for anything else. Matched on path alone,
 * so it keeps working when MCP_RESOURCE_URL moves the server to another origin.
 *
 * The old authoring suffixes (`/api/mcp/creator`, `/api/mcp/tools`) are
 * answered too, with the same document — whose `resource` names the one
 * server — so a client that probed an old address learns the current
 * identifier rather than a 404 it cannot act on.
 */
import { NextRequest, NextResponse } from 'next/server'
import { legacyResourceUrls, mcpResourceUrl } from '@/lib/mcp/config'
import { protectedResourceMetadata, METADATA_CORS } from '@/lib/mcp/metadata'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ resource: string[] }> }) {
  const { resource } = await ctx.params
  const path = `/${resource.join('/')}`.replace(/\/$/, '').toLowerCase()
  const known = [mcpResourceUrl(), ...legacyResourceUrls()].map((u) => new URL(u).pathname.toLowerCase())
  if (!known.includes(path)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: METADATA_CORS })
  }
  return NextResponse.json(protectedResourceMetadata(), { headers: METADATA_CORS })
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: METADATA_CORS })
}
