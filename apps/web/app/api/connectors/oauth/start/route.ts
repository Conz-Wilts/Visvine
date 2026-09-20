/**
 * GET /api/connectors/oauth/start?space=…&connector=…
 * GET /api/connectors/oauth/start?account=<recipe> | account_name=<name>
 *
 * The second form signs a person in to an account of their OWN
 * (lib/connectors/accounts.ts): no space, no note, the recipe's `auth:`.
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
import prisma from '@/lib/prisma';
import { encryptSecret, decryptSecret } from '@/lib/crypto/secrets';
import { principalOf, resolveContext } from '@/lib/notes/resolve';
import { describeConnector } from '@/lib/connectors/service';
import { connectionOwner } from '@/lib/connectors/auth';
import { platformClientEnvNames, platformClientRef, resolvePlatformClient } from '@/lib/connectors/platformClients';
import { authorizeUrl, createPkce, randomState, registerClient, resolveEndpoints } from '@/lib/connectors/oauth';
import { oauthRedirectUri, safeReturnTo } from '@/lib/connectors/connectUrl';
import { ConnectorError, findSecretRefs } from '@/lib/connectors/config';
import { signPending, PENDING_COOKIE, PENDING_TTL_SECONDS } from '@/lib/connectors/pending';
import { accountAuth, accountTarget } from '@/lib/connectors/accounts';
import { ACCOUNTS_SETTINGS_PATH } from '@/lib/connectors/accountRecipes';
import type { ConnectorAuth } from '@/lib/connectors/auth';
import { logger } from '@/lib/logger';

function fail(message: string, status = 400): NextResponse {
  return new NextResponse(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (session instanceof Response) return session;

  const accountRecipe = req.nextUrl.searchParams.get('account')?.trim() ?? '';
  const accountName = req.nextUrl.searchParams.get('account_name')?.trim() ?? '';
  if (accountRecipe || accountName) {
    const target = await accountTarget(session.userId, accountName ? { name: accountName } : { recipe: accountRecipe });
    const auth = target ? accountAuth(target.recipe, target.name) : null;
    if (!target || !auth) return fail('That service is not one you connect as an account here.', 404);
    return begin(req, session.userId, auth, { spaceId: '', connector: target.name, accountRecipe: target.recipe });
  }

  const viaSpaceId = req.nextUrl.searchParams.get('space')?.trim() ?? '';
  const connector = req.nextUrl.searchParams.get('connector')?.trim() ?? '';
  if (!viaSpaceId || !connector) return fail('Missing space or connector.');

  // resolveContext + describeConnector apply the same visibility lens the run
  // path does, so someone who cannot see the note cannot start a flow for it —
  // and therefore cannot discover which services a space has configured.
  const resolved = await resolveContext(session, viaSpaceId);
  if (resolved instanceof Response) return resolved;
  const principal = await principalOf(resolved);

  const detail = await describeConnector(principal, resolved, connector);
  if (!detail?.perimeter?.auth) return fail('That connector does not use OAuth.', 404);
  const auth = detail.perimeter.auth;

  // A space connection is one credential the whole space then acts through, so
  // creating it is an admin act. A user connection is only ever the caller's own.
  // `resolved.isAdmin` rather than isAdmin(): it is the same question one query
  // earlier, and it already knows that the owner of a personal space
  // administers it (no aliases live there, and never will).
  if (auth.mode === 'space' && !resolved.isAdmin) {
    return fail('Only a space admin can connect a shared account for this connector.', 403);
  }
  // The parent's shared connector: a person's OWN account is theirs to link
  // wherever they stand, and it lands in the parent's space — the rows a run
  // resolves. A space-wide account is the parent's act, made there.
  if (detail.shared && auth.mode === 'space') {
    return fail(`This connector belongs to ${detail.sharedFrom?.name ?? 'the parent space'}; connect its shared account there.`, 403);
  }
  return begin(req, session.userId, auth, {
    spaceId: detail.ownerSpaceId,
    viaSpaceId: detail.ownerSpaceId === viaSpaceId ? undefined : viaSpaceId,
    connector,
  });
}

/** Whose connection this becomes — a space's, or (with `accountRecipe`) the person's own. */
interface Landing {
  spaceId: string;
  viaSpaceId?: string;
  connector: string;
  accountRecipe?: string;
}

async function begin(req: NextRequest, userId: string, auth: ConnectorAuth, landing: Landing): Promise<NextResponse> {
  const { spaceId } = landing;
  const recipe = landing.accountRecipe;
  try {
    const endpoints = await resolveEndpoints(auth);
    const redirectUri = oauthRedirectUri();

    // A platform client lives in env and never touches the database — rotating
    // it stays one env var, with no per-space encrypted copies to strand.
    const platformRef = platformClientRef(auth.clientId);
    let clientId: string;
    if (platformRef) {
      const platform = resolvePlatformClient(platformRef);
      if (!platform) {
        const names = platformClientEnvNames(platformRef);
        return fail(
          names
            ? `This deployment has no ${platformRef} platform client — set ${names.id} and ${names.secret}, or register your own OAuth app and put its id in the note.`
            : `Unknown platform client "${platformRef}".`,
        );
      }
      clientId = platform.clientId;
    } else {
      // Reuse the client registered for this (space, provider, issuer), or make
      // one. Dynamic registration is what makes adding an MCP server a URL rather
      // than a developer-account signup.
      let record: { clientId: string } | null = recipe
        ? await prisma.connectorAccountClient.findUnique({
            where: { account_client_identity: { userId, recipe, issuer: endpoints.issuer } },
          })
        : await prisma.connectorOAuthClient.findUnique({
            where: { oauth_client_identity: { spaceId, provider: auth.provider, issuer: endpoints.issuer } },
          });

      if (!record) {
        let registeredId: string;
        let clientSecret: string | null = null;

        // An account recipe never names a client of its own: it is a platform
        // client (handled above) or a server that registers one.
        if (auth.clientId && !recipe) {
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
          registeredId = fill(auth.clientId);
          clientSecret = auth.clientSecret ? fill(auth.clientSecret) : null;
        } else {
          const registered = await registerClient(endpoints, redirectUri, auth.scopes);
          registeredId = registered.clientId;
          clientSecret = registered.clientSecret;
        }

        const registered = {
          issuer: endpoints.issuer,
          clientId: registeredId,
          clientSecret: clientSecret ? encryptSecret(clientSecret) : null,
        };
        record = recipe
          ? await prisma.connectorAccountClient.create({ data: { userId, recipe, ...registered } })
          : await prisma.connectorOAuthClient.create({ data: { spaceId, provider: auth.provider, ...registered } });
      }
      clientId = record.clientId;
    }

    const { verifier, challenge } = createPkce();
    const state = randomState();

    const target = authorizeUrl({
      endpoints,
      clientId,
      redirectUri,
      scopes: auth.scopes,
      state,
      challenge,
      resource: auth.discovery.kind === 'discover' ? auth.discovery.url : null,
      params: auth.params,
    });

    const response = NextResponse.redirect(target);
    // The verifier must never reach the provider, and `state` must be tied to
    // this browser — so both live in a signed, httpOnly cookie and the state
    // parameter is only the echo we compare against it.
    response.cookies.set(PENDING_COOKIE, await signPending({
      spaceId,
      viaSpaceId: landing.viaSpaceId,
      connector: landing.connector,
      accountRecipe: recipe,
      provider: auth.provider,
      mode: auth.mode,
      userId: connectionOwner(auth, userId),
      verifier,
      state,
      scopes: auth.scopes,
      returnTo: safeReturnTo(req.nextUrl.searchParams.get('return')) ?? (recipe ? ACCOUNTS_SETTINGS_PATH : undefined),
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
    logger.error('connectors.oauth.start_failed', { err: e });
    return fail('Could not start the connection.', 502);
  }
}
