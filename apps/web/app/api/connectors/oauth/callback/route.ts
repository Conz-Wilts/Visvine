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
import { appOrigin, oauthRedirectUri, safeReturnTo } from '@/lib/connectors/connectUrl';
import { platformClientRef, resolvePlatformClient } from '@/lib/connectors/platformClients';
import { saveConnection } from '@/lib/connectors/connections';
import { ConnectorError } from '@/lib/connectors/config';
import { PENDING_COOKIE, readPending } from '@/lib/connectors/pending';
import { accountAuth, saveAccount } from '@/lib/connectors/accounts';
import type { ConnectorAuth } from '@/lib/connectors/auth';
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

/**
 * Land the browser back where the flow started, with the outcome in the query
 * string rather than on a bare text page: the surface that sent it, when /start
 * was given one, and otherwise the connector's own page. Failures with no
 * pending cookie have nowhere to go back to and keep the page.
 */
function done(pending: { connector: string; returnTo?: string } | null, ok: boolean, message: string): NextResponse {
  if (!pending) return page(message, ok ? 200 : 400);
  // Re-validated even though /start already did: the check is cheap, and a
  // redirect target is not something to trust on the strength of one signature.
  const url = new URL(
    safeReturnTo(pending.returnTo) ?? `/directory/${encodeURIComponent(`connector:${pending.connector}`)}`,
    appOrigin(),
  );
  url.searchParams.set(ok ? 'connected' : 'connect_error', message);
  const response = NextResponse.redirect(url);
  response.cookies.set(PENDING_COOKIE, '', { path: '/api/connectors/oauth', maxAge: 0 });
  return response;
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const params = req.nextUrl.searchParams;
  const pending = await readPending(req.cookies.get(PENDING_COOKIE)?.value);

  // A provider that refuses reports it here rather than by status code.
  const providerError = params.get('error');
  if (providerError) {
    const detail = params.get('error_description');
    return done(pending, false, `The provider refused the connection: ${detail ?? providerError}`);
  }

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
    const recipe = pending.accountRecipe;
    let auth: ConnectorAuth;
    if (recipe) {
      // A person's own account: the recipe is the note.
      if (pending.mode !== 'user') return page('The connection could not be verified. Start it again.', 400);
      const mine = accountAuth(recipe, pending.connector);
      if (!mine || mine.provider !== pending.provider) return page('That service is no longer offered. Start again.', 409);
      auth = mine;
    } else {
      const resolved = await resolveContext(session, pending.viaSpaceId ?? pending.spaceId);
      if (resolved instanceof Response) return page('Space not found.', 404);
      const principal = await principalOf(resolved);

      // Re-read the note rather than trusting the cookie's copy: the connector may
      // have been edited, or the caller's access revoked — or the parent may
      // have stopped sharing it — while the browser was away at the provider.
      const detail = await describeConnector(principal, resolved, pending.connector);
      const theirs = detail?.perimeter?.auth;
      if (!theirs || theirs.provider !== pending.provider || theirs.mode !== pending.mode || detail.ownerSpaceId !== pending.spaceId) {
        return page('That connector changed while you were connecting. Start again.', 409);
      }
      auth = theirs;
    }

    const endpoints = await resolveEndpoints(auth);

    // The note is re-read live, so the platform ref comes from the note as it
    // stands now, the same as every other auth decision here.
    const platformRef = platformClientRef(auth.clientId);
    let clientId: string;
    let clientSecret: string | null;
    if (platformRef) {
      const platform = resolvePlatformClient(platformRef);
      if (!platform) return done(pending, false, 'This deployment has no platform client for that service any more. Start again.');
      clientId = platform.clientId;
      clientSecret = platform.clientSecret;
    } else {
      const client = recipe
        ? await prisma.connectorAccountClient.findUnique({
            where: { account_client_identity: { userId: session.userId, recipe, issuer: endpoints.issuer } },
          })
        : await prisma.connectorOAuthClient.findUnique({
            where: {
              oauth_client_identity: {
                spaceId: pending.spaceId,
                provider: pending.provider,
                issuer: endpoints.issuer,
              },
            },
          });
      if (!client) return done(pending, false, 'The client registration is missing. Start again.');
      clientId = client.clientId;
      clientSecret = client.clientSecret ? decryptSecret(client.clientSecret) : null;
    }

    const tokens = await exchangeCode({
      endpoints,
      clientId,
      clientSecret,
      redirectUri: oauthRedirectUri(),
      code,
      verifier: pending.verifier,
      scopes: pending.scopes,
      resource: auth.discovery.kind === 'discover' ? auth.discovery.url : null,
    });

    if (recipe) {
      await saveAccount({ userId: session.userId, name: pending.connector, recipe, tokens });
      return done(pending, true, `Connected ${tokens.accountLabel ?? 'your account'}.`);
    }

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
    return done(pending, true, who);
  } catch (e) {
    if (e instanceof ConnectorError) return done(pending, false, e.message);
    logger.error('connectors.oauth.callback_failed', { err: e });
    return done(pending, false, 'The connection could not be completed.');
  }
}
