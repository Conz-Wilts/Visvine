/**
 * GET /api/connectors/oauth/start?space=…&connector=…
 *
 * The link a step-up error hands someone. Loads the connector note, works out
 * which authorization server it points at, registers a client if this is the
 * first time, and redirects the browser to the provider.
 *
 * This is a browser navigation, not an API call: it is reached by clicking a
 * link out of an MCP client or the console, so it answers in redirects and
 * plain text rather than JSON.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { isAdmin } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { encryptSecret, decryptSecret } from '@/lib/crypto/secrets';
import { principalOf, resolveContext } from '@/lib/notes/resolve';
import { describeConnector } from '@/lib/connectors/service';
import { connectionOwner } from '@/lib/connectors/auth';
import { authorizeUrl, createPkce, randomState, registerClient, resolveEndpoints } from '@/lib/connectors/oauth';
import { oauthRedirectUri } from '@/lib/connectors/connectUrl';
import { ConnectorError, findSecretRefs } from '@/lib/connectors/config';
import { signPending, PENDING_COOKIE, PENDING_TTL_SECONDS } from '@/lib/connectors/pending';

function fail(message: string, status = 400): NextResponse {
  return new NextResponse(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const spaceId = req.nextUrl.searchParams.get('space')?.trim() ?? '';
  const connector = req.nextUrl.searchParams.get('connector')?.trim() ?? '';
  if (!spaceId || !connector) return fail('Missing space or connector.');

  // resolveContext + describeConnector apply the same visibility lens the run
  // path does, so someone who cannot see the note cannot start a flow for it —
  // and therefore cannot discover which services a space has configured.
  const resolved = await resolveContext(session, spaceId);
  if (resolved instanceof Response) return resolved;
  const principal = await principalOf(resolved);

  const detail = await describeConnector(principal, resolved, connector);
  if (!detail?.perimeter?.auth) return fail('That connector does not use OAuth.', 404);
  const auth = detail.perimeter.auth;

  // A space connection is one credential the whole space then acts through, so
  // creating it is an admin act. A user connection is only ever the caller's own.
  if (auth.mode === 'space' && !(await isAdmin(session.userId, spaceId, session.email))) {
    return fail('Only a space admin can connect a shared account for this connector.', 403);
  }

  try {
    const endpoints = await resolveEndpoints(auth);
    const redirectUri = oauthRedirectUri();

    // Reuse the client registered for this (space, provider, issuer), or make
    // one. Dynamic registration is what makes adding an MCP server a URL rather
    // than a developer-account signup.
    let record = await prisma.connectorOAuthClient.findUnique({
      where: { oauth_client_identity: { spaceId, provider: auth.provider, issuer: endpoints.issuer } },
    });

    if (!record) {
      let clientId: string;
      let clientSecret: string | null = null;

      if (auth.clientId) {
        // A hand-registered client. Both fields may be secret references, since
        // a client secret must never be legible in a note.
        const refs = [...findSecretRefs(auth.clientId), ...(auth.clientSecret ? findSecretRefs(auth.clientSecret) : [])];
        const stored = refs.length
          ? await prisma.connectorSecret.findMany({ where: { spaceId, name: { in: refs } } })
          : [];
        const values = new Map(stored.map((row) => [row.name, decryptSecret(row.ciphertext)]));
        const missing = refs.filter((name) => !values.has(name));
        if (missing.length) return fail(`Store these secrets first: ${missing.join(', ')}`);

        const fill = (template: string) =>
          template.replace(/\{\{\s*secret:([A-Za-z0-9_]+)\s*\}\}/g, (_, name: string) => values.get(name) ?? '');
        clientId = fill(auth.clientId);
        clientSecret = auth.clientSecret ? fill(auth.clientSecret) : null;
      } else {
        const registered = await registerClient(endpoints, redirectUri, auth.scopes);
        clientId = registered.clientId;
        clientSecret = registered.clientSecret;
      }

      record = await prisma.connectorOAuthClient.create({
        data: {
          spaceId,
          provider: auth.provider,
          issuer: endpoints.issuer,
          clientId,
          clientSecret: clientSecret ? encryptSecret(clientSecret) : null,
        },
      });
    }

    const { verifier, challenge } = createPkce();
    const state = randomState();

    const target = authorizeUrl({
      endpoints,
      clientId: record.clientId,
      redirectUri,
      scopes: auth.scopes,
      state,
      challenge,
      resource: auth.discovery.kind === 'discover' ? auth.discovery.url : null,
    });

    const response = NextResponse.redirect(target);
    // The verifier must never reach the provider, and `state` must be tied to
    // this browser — so both live in a signed, httpOnly cookie and the state
    // parameter is only the echo we compare against it.
    response.cookies.set(PENDING_COOKIE, await signPending({
      spaceId,
      connector,
      provider: auth.provider,
      mode: auth.mode,
      userId: connectionOwner(auth, session.userId),
      verifier,
      state,
      scopes: auth.scopes,
    }), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/api/connectors/oauth',
      maxAge: PENDING_TTL_SECONDS,
    });
    return response;
  } catch (e) {
    if (e instanceof ConnectorError) return fail(e.message);
    console.error('[connectors/oauth/start]', e);
    return fail('Could not start the connection.', 502);
  }
}
