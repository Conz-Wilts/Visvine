/**
 * Where someone is sent to connect an account.
 *
 * Its own module because the run path needs the URL from contexts that have no
 * request — the agent tick, a scheduled job — so it cannot be derived from
 * headers. `NEXT_PUBLIC_APP_URL` is the same origin the OAuth layer already
 * treats as the issuer (lib/mcp/config.ts), so the redirect URI a provider has
 * registered and the link a member clicks can never drift apart.
 */

export function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
}

/**
 * The link a step-up error hands the caller.
 *
 * `returnTo` is where the browser lands once the provider is done. Without it
 * the callback goes to the connector's own page, which is right when the flow
 * started from the directory and wrong everywhere else — a connector in your
 * personal space has no page in the space you are looking at, and someone who
 * pressed Connect in a settings panel expects that panel back.
 */
export function connectorConnectUrl(spaceId: string, connector: string, returnTo?: string | null): string {
  return appOrigin() + connectorConnectPath(spaceId, connector, returnTo)
}

/**
 * The same link, as a path on this app — what a browser already sitting on it
 * should be sent to.
 *
 * `appOrigin()` reads a NEXT_PUBLIC_ variable, and those are inlined into the
 * client bundle when the image is BUILT, not when the container is run. The
 * deployment sets the origin at run time, so a component that builds an
 * absolute URL in the browser gets the `http://localhost:3000` fallback and
 * sends the person to their own machine. A relative path cannot drift from the
 * page it was clicked on, so every client surface uses this one and the
 * absolute form is left to the contexts that have no page — an agent's
 * step-up message, a scheduled run's error.
 */
export function connectorConnectPath(spaceId: string, connector: string, returnTo?: string | null): string {
  const params = new URLSearchParams({ space: spaceId, connector })
  const safe = safeReturnTo(returnTo)
  if (safe) params.set('return', safe)
  return `/api/connectors/oauth/start?${params.toString()}`
}

/**
 * A return path we are willing to send a browser to after the provider: a
 * relative path on this app, and nothing else.
 *
 * The value rides the query string, so it is attacker-supplied by
 * construction. Anything absolute (`https://elsewhere`), protocol-relative
 * (`//elsewhere`) or backslash-smuggled is an open redirect off the back of an
 * authenticated flow, so the rule is a whitelist of shape rather than a
 * blacklist of hosts: one leading slash, no second one, no scheme.
 */
export function safeReturnTo(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim()
  if (!value.startsWith('/')) return null
  if (value.startsWith('//') || value.startsWith('/\\')) return null
  // A newline or a control character in a Location header is header injection,
  // and whitespace is never part of a path we wrote.
  if (/[\s\u0000-\u001f]/.test(value)) return null
  return value
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
