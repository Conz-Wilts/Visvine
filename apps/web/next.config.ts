import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Native/CJS packages the bundler must leave alone. The QuickJS build is the
  // load-bearing one: the singlefile variant base64-inlines its wasm into a CJS
  // module precisely so `output: "standalone"` has a file to trace. Bundling it
  // is what breaks that, and it breaks in the image, not in dev.
  //
  // esbuild is the other one: it does its work in a child process it locates by
  // resolving @esbuild/<platform> at runtime, so a bundled copy has no binary to
  // spawn. It compiles Tool sources (lib/tools/compile.ts) on the server only.
  serverExternalPackages: [
    "@jitl/quickjs-singlefile-cjs-release-sync",
    "esbuild",
    "pg",
    "mysql2",
  ],
  async headers() {
    // Global security headers. Cloud Run does not add these — the app is
    // responsible for its own transport hardening and clickjacking/CSP defense.
    //
    // The CSP keeps `unsafe-inline`/`unsafe-eval` on scripts because Next injects
    // inline bootstrap without a nonce; tightening that to nonces is a tracked
    // follow-up. What it DOES enforce today is meaningful: no external script
    // origins beyond 'self', no framing of this app (clickjacking), no plugin
    // objects, a pinned <base>, and same-origin form posts. `img-src`/`connect-src`
    // stay broad (https:) so GCS/Google avatars and API calls keep working.
    const directives = (formAction: string) =>
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        "connect-src 'self' https:",
        "frame-ancestors 'none'",
        "frame-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        `form-action ${formAction}`,
      ].join('; ');

    const otherHeaders = [
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
    ];

    // form-action governs the whole redirect chain a form submission takes, not
    // just the action URL. The OAuth consent form posts same-origin, but the
    // approve response is a 303 to the MCP client's callback on another origin —
    // under `form-action 'self'` the browser blocks that hop and the flow dies
    // before a code is delivered. The endpoint has already checked the target
    // against the client's registered redirect_uris, so widening it to https
    // here costs nothing; the rest of the app keeps the strict policy. The
    // negative lookahead is what keeps the two from stacking into an
    // intersection, since duplicate CSP headers are enforced as both.
    const AUTHORIZE = '/api/oauth/authorize';
    return [
      {
        source: AUTHORIZE,
        headers: [
          { key: 'Content-Security-Policy', value: directives("'self' https:") },
          ...otherHeaders,
        ],
      },
      {
        source: '/:path((?!api/oauth/authorize).*)',
        headers: [
          { key: 'Content-Security-Policy', value: directives("'self'") },
          ...otherHeaders,
        ],
      },
    ];
  },
  async redirects() {
    return [
      // ?view=graph on the directory belongs to the standalone Context tool.
      {
        source: "/directory",
        has: [{ type: "query", key: "view", value: "graph" }],
        destination: "/context",
        permanent: false,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      // Legacy DB rows still hold direct GCS URLs (see lib/mediaUrl.ts) that
      // are not always routed through normalizeImageUrl before rendering.
      {
        protocol: "https",
        hostname: "storage.googleapis.com",
      },
      // Cloud CDN / custom domain for GCS media, used by next/image.
      // Set GCS_CDN_HOSTNAME (bare host, e.g. cdn.example.com) to enable.
      ...(process.env.GCS_CDN_HOSTNAME
        ? [{ protocol: "https" as const, hostname: process.env.GCS_CDN_HOSTNAME }]
        : []),
    ],
  },
};

export default nextConfig;
