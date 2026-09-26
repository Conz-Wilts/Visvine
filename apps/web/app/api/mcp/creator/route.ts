/**
 * Where the Tool authoring loop used to have its endpoint.
 *
 * Authoring is Visvine Tools now (`/api/mcp/tools`), so this redirects there —
 * permanently, and with the method and body preserved (308), so a client
 * configured with this URL keeps working through the redirect rather than
 * failing at connect. Its existing token also keeps verifying:
 * `verifyAccessToken` accepts the audience this endpoint used to mint for.
 *
 * Deletable once nothing is configured this way.
 */
import { NextRequest, NextResponse } from 'next/server'
import { mcpResourceUrl } from '@/lib/mcp/config'

export const runtime = 'nodejs'

function redirect(_req: NextRequest) {
  return NextResponse.redirect(mcpResourceUrl('tools'), 308)
}

export { redirect as GET, redirect as POST, redirect as DELETE }
