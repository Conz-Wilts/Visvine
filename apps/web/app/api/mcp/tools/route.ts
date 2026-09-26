/**
 * Where Tool authoring briefly had a server of its own.
 *
 * Tools are planned and built on the one Visvine server (`/api/mcp`), where
 * the model can read the space it is building for, so this redirects there —
 * permanently, method and body preserved (308) — and its tokens still verify
 * (`legacyResourceUrls`). Deletable once nothing is configured this way.
 */
import { NextRequest, NextResponse } from 'next/server'
import { mcpResourceUrl } from '@/lib/mcp/config'

export const runtime = 'nodejs'

function redirect(_req: NextRequest) {
  return NextResponse.redirect(mcpResourceUrl(), 308)
}

export { redirect as GET, redirect as POST, redirect as DELETE }
