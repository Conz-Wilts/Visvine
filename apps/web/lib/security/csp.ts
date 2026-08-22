/**
 * The app's Content-Security-Policy, built per request.
 *
 * WHY PER REQUEST. A nonce is only worth anything if it is unguessable and used
 * once, so the policy cannot be a constant in next.config.ts — it has to be
 * minted alongside the response. That is the whole reason this lives here and
 * is applied from proxy.ts rather than from the static `headers()` config.
 *
 * WHAT THE NONCE BUYS. Without it `script-src` needs `'unsafe-inline'`, because
 * Next injects an inline bootstrap script into every document — and
 * `'unsafe-inline'` on scripts means any injected `<script>` runs, which is
 * precisely the attack CSP exists to stop. With a nonce, Next stamps its own
 * bootstrap and bundles with the value it reads back off the request header, an
 * attacker cannot guess it, and `'unsafe-inline'` goes away.
 *
 * `'strict-dynamic'` then lets those nonce-approved scripts load the chunks they
 * need without every chunk URL being allowlisted. Browsers that understand it
 * ignore the `'self'` beside it; older ones fall back to `'self'`, which is why
 * both are present.
 *
 * The policy is kept pure and string-returning so it can be asserted in tests —
 * a CSP that silently loses a directive is not something to discover in a
 * browser console.
 */

/** Directives that never vary. */
const STATIC_DIRECTIVES = [
  "default-src 'self'",

  // Inline STYLES stay allowed, and that is a deliberate line rather than an
  // oversight. The editor, the charts and the emoji picker all set element
  // styles at runtime, so nonce-ing styles would mean patching third-party
  // render paths. An injected stylesheet can deface and can exfiltrate some
  // form state; an injected script owns the session. The two are not the same
  // risk, and only one of them is cheap to close.
  "style-src 'self' 'unsafe-inline'",

  // https: for Google avatars and GCS-served media.
  "img-src 'self' data: blob: https:",

  // No third-party host: every face the app uses is served from public/fonts/.
  // Keep it that way — a webfont CDN is a render-blocking dependency on someone
  // else's uptime and a place for the policy to leak open.
  "font-src 'self' data:",

  // https: because connectors and the app itself call out over TLS.
  "connect-src 'self' https:",

  "object-src 'none'",
  "base-uri 'self'",
] as const

export interface CspOptions {
  /** The per-request nonce, base64. */
  nonce: string
  /**
   * Development needs `'unsafe-eval'`: React uses `eval` to rebuild server
   * stack traces in the browser. Production does not, and must not have it.
   */
  isDev: boolean
  /**
   * The Tool iframe's origin, when one is configured. A different host from the
   * app on purpose, so the frame carries no cookie — which also means
   * `frame-src 'self'` alone would block the very frame the app renders.
   */
  toolsOrigin?: string | null
  /**
   * `/api/oauth/authorize` only. form-action governs the whole redirect chain a
   * submission takes, and the consent form's approve response is a 303 to the
   * MCP client's callback on another origin. Under `'self'` the browser kills
   * that hop and the flow dies before a code is delivered. The endpoint has
   * already checked the target against the client's registered redirect_uris.
   */
  allowCrossOriginFormPost?: boolean
  /**
   * Whether this request arrived over TLS. `upgrade-insecure-requests` is only
   * sent when it did — keyed on the actual scheme rather than on NODE_ENV,
   * because a production BUILD served over plaintext localhost (`pnpm start`)
   * would otherwise rewrite its own asset URLs to https and fail every one of
   * them. Production behind Cloud Run is always https, so nothing is lost.
   */
  isSecureOrigin?: boolean
}

export function buildCsp({
  nonce,
  isDev,
  toolsOrigin,
  allowCrossOriginFormPost = false,
  isSecureOrigin = false,
}: CspOptions): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(isDev ? ["'unsafe-eval'"] : []),
  ].join(' ')

  const frameSrc = ["'self'", toolsOrigin].filter(Boolean).join(' ')

  return [
    ...STATIC_DIRECTIVES,
    `script-src ${scriptSrc}`,
    // This app is never framed. The Tool runtime routes are the exception and
    // they mint their own policy (lib/tools/csp.ts) — they never reach here.
    "frame-ancestors 'none'",
    `frame-src ${frameSrc}`,
    `form-action ${allowCrossOriginFormPost ? "'self' https:" : "'self'"}`,
    ...(isSecureOrigin ? ['upgrade-insecure-requests'] : []),
  ].join('; ')
}

/**
 * A fresh, unguessable nonce. `randomUUID` is a CSPRNG in both the Node and
 * Edge runtimes, so this needs no polyfill and no dependency.
 */
export function newNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString('base64')
}
