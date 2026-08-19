/**
 * Where someone is sent to connect an account.
 *
 * Its own module because the run path needs the URL from contexts that have no
 * request — the agent tick, a scheduled job — so it cannot be derived from
 * headers. `NEXT_PUBLIC_APP_URL` is the same origin the OAuth layer already
 * treats as the issuer (lib/mcp/config.ts), so the redirect URI a provider has
 * registered and the link a member clicks can never drift apart.
 */

function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
}

/** The link a step-up error hands the caller. */
export function connectorConnectUrl(spaceId: string, connector: string): string {
  const url = new URL(`${appOrigin()}/api/connectors/oauth/start`)
  url.searchParams.set('space', spaceId)
  url.searchParams.set('connector', connector)
  return url.toString()
}

/**
 * The redirect URI registered with every provider. One fixed path for all of
 * them: the pending-authorization cookie carries which connector this is, so
 * the URI never needs to vary — and a provider that pins an exact redirect URI
 * (most do) keeps working when connectors are added.
 */
export function oauthRedirectUri(): string {
  return `${appOrigin()}/api/connectors/oauth/callback`
}
