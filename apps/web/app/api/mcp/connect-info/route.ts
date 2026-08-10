/**
 * What a person needs in order to point an MCP client at this deployment.
 *
 * The URL is derived server-side rather than rebuilt in the browser, because
 * `mcpResourceUrl()` is the same value the protected-resource metadata
 * advertises and the token `aud` is checked against — a URL the settings page
 * assembled from `window.location` would drift the moment MCP_RESOURCE_URL is
 * set. Session-gated: none of this is secret, but it is only ever shown to
 * someone who is signed in.
 */

import { NextResponse } from 'next/server';
import { mcpResourceUrl, oauthIssuer } from '@/lib/mcp/config';
import { MCP_SCOPES, SCOPE_DESCRIPTIONS } from '@/lib/mcp/scopes';
import { requireSession } from '@/lib/session';

export async function GET() {
  const session = await requireSession();
  if (session instanceof Response) return session;

  return NextResponse.json({
    url: mcpResourceUrl(),
    issuer: oauthIssuer(),
    scopes: MCP_SCOPES.map((scope) => ({ scope, description: SCOPE_DESCRIPTIONS[scope] })),
  });
}
