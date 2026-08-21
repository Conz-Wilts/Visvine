/**
 * GET /api/connectors/oauth/callback
 *
 * Where the provider sends the browser back. Swaps the authorization code for
 * tokens and stores them against whoever started the flow.
 *
 * Everything that decides WHOSE connection this becomes — space, connector,
 * mode, user id — comes out of the signed pending cookie, never out of the
 * query string. The provider echoes back only `code` and `state`; treating
 * anything else it sent as instruction would let a crafted callback URL write a
 * connection into a space the caller never touched.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import prisma from '@/lib/prisma';
import { decryptSecret } from '@/lib/crypto/secrets';
import { principalOf, resolveContext } from '@/lib/notes/resolve';
import { describeConnector } from '@/lib/connectors/service';
import { exchangeCode, resolveEndpoints, statesMatch } from '@/lib/connectors/oauth';
import { oauthRedirectUri } from '@/lib/connectors/connectUrl';
import { saveConnection } from '@/lib/connectors/connections';
import { ConnectorError } from '@/lib/connectors/config';
import { PENDING_COOKIE, readPending } from '@/lib/connectors/pending';
import { logger } from '@/lib/logger';

function page(message: string, status = 200): NextResponse {
  const response = new NextResponse(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
  // One-shot by construction: the pending cookie is spent whatever the outcome,
  // so a replayed callback finds nothing to act on.
  response.cookies.set(PENDING_COOKIE, '', { path: '/api/connectors/oauth', maxAge: 0 });
  return response;
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const params = req.nextUrl.searchParams;

  // A provider that refuses reports it here rather than by status code.
  const providerError = params.get('error');
  if (providerError) {
    const detail = params.get('error_description');
    return page(`The provider refused the connection: ${detail ?? providerError}`, 400);
  }

  const pending = await readPending(req.cookies.get(PENDING_COOKIE)?.value);
  if (!pending) return page('This connection attempt expired. Start it again.', 400);

  const state = params.get('state') ?? '';
  if (!statesMatch(state, pending.state)) {
    return page('The connection could not be verified. Start it again.', 400);
  }

  const code = params.get('code');
  if (!code) return page('The provider returned no authorization code.', 400);

  // The session at callback time must be the one that began the flow. Without
  // this, finishing someone else's half-open flow in your own browser would
  // store THEIR tokens under YOUR name, or vice versa.
  if (pending.mode === 'user' && pending.userId !== session.userId) {
    return page('This connection was started by a different account.', 403);
  }

  try {
    const resolved = await resolveContext(session, pending.spaceId);
    if (resolved instanceof Response) return page('Space not found.', 404);
    const principal = await principalOf(resolved);

    // Re-read the note rather than trusting the cookie's copy: the connector may
    // have been edited, or the caller's access revoked, while the browser was
    // away at the provider.
    const detail = await describeConnector(principal, resolved, pending.connector);
    const auth = detail?.perimeter?.auth;
    if (!auth || auth.provider !== pending.provider || auth.mode !== pending.mode) {
      return page('That connector changed while you were connecting. Start again.', 409);
    }

    const endpoints = await resolveEndpoints(auth);
    const client = await prisma.connectorOAuthClient.findUnique({
      where: {
        oauth_client_identity: {
          spaceId: pending.spaceId,
          provider: pending.provider,
          issuer: endpoints.issuer,
        },
      },
    });
    if (!client) return page('The client registration is missing. Start again.', 409);

    const tokens = await exchangeCode({
      endpoints,
      clientId: client.clientId,
      clientSecret: client.clientSecret ? decryptSecret(client.clientSecret) : null,
      redirectUri: oauthRedirectUri(),
      code,
      verifier: pending.verifier,
      scopes: pending.scopes,
      resource: auth.discovery.kind === 'discover' ? auth.discovery.url : null,
    });

    await saveConnection({
      spaceId: pending.spaceId,
      provider: pending.provider,
      mode: pending.mode,
      userId: pending.userId,
      tokens,
      connectedBy: session.email || session.userId,
    });

    const who =
      pending.mode === 'space'
        ? `This space now acts as ${tokens.accountLabel ?? 'the connected account'} for ${pending.provider}.`
        : `Connected ${tokens.accountLabel ?? 'your account'} for ${pending.provider}.`;
    return page(`${who}\n\nYou can close this tab and retry what you were doing.`);
  } catch (e) {
    if (e instanceof ConnectorError) return page(e.message, 400);
    logger.error('connectors.oauth.callback_failed', { err: e });
    return page('The connection could not be completed.', 502);
  }
}
