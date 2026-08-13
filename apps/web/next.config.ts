import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Native/CJS packages the bundler must leave alone. The QuickJS build is the
  // load-bearing one: the singlefile variant base64-inlines its wasm into a CJS
  // module precisely so `output: "standalone"` has a file to trace. Bundling it
  // is what breaks that, and it breaks in the image, not in dev.
  serverExternalPackages: [
    "@jitl/quickjs-singlefile-cjs-release-sync",
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
    const csp = [
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
      "form-action 'self'",
    ].join('; ');
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
        ],
      },
    ];
  },
  async redirects() {
    return [
      // The directory's old graph view mode is the standalone Context tool now.
      // (The old ?view=table mode was removed; the param is simply ignored.)
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
