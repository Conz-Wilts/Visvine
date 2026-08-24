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
    // TRANSPORT headers only. The Content-Security-Policy is NOT here, and that
    // is the point: it carries a per-request nonce, so it is built and applied
    // in proxy.ts (lib/security/csp.ts). Setting it in both places would emit
    // two CSP headers, which browsers enforce as the INTERSECTION of the two —
    // the nonce'd policy and a static one would cancel each other out and leave
    // the app with no working scripts.
    //
    // Cloud Run adds none of these; the app is responsible for its own transport
    // hardening and clickjacking defence.
    const transport = [
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
    ];

    // The Tool runtime is the carve-out, and for a sharp reason: headers set
    // HERE win over anything a route handler sets under the same name — they do
    // not merge. `X-Frame-Options: DENY` would stop the Tool iframe rendering at
    // all, and it has no origin-list form, so the runtime routes mint their own
    // framing headers (lib/tools/csp.ts) and only the non-colliding transport
    // headers ride along here.
    const TOOL_RUNTIME = 'api/tools/runtime/';
    return [
      {
        source: `/${TOOL_RUNTIME}:path*`,
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
        ],
      },
      {
        source: `/:path((?!${TOOL_RUNTIME}).*)`,
        headers: transport,
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
      // Connectors moved into the Space Console. Notifications written before
      // the move still carry the old path (lib/connectors/connections.ts).
      {
        source: "/connectors",
        destination: "/admin?section=connectors",
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
