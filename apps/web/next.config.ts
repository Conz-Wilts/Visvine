import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Workspace packages shipped as TypeScript source, so one implementation can
  // be compiled by both bundlers that need it. @visvine/vm-policy is compiled
  // here and again by wrangler for the edge — the egress decision has to be the
  // same code in both places or it is two decisions. @visvine/tokens is the
  // generated design tokens, the same values every platform is built from, and
  // @visvine/ui the shared components built on them.
  transpilePackages: ["@visvine/tokens", "@visvine/ui", "@visvine/vm-policy"],
  experimental: {
    // The proxy buffers every request body and cuts it off here, silently —
    // at the 10MB default a 20MB Drive upload reached its route truncated. Just
    // above lib/resources/service.ts#MAX_RESOURCE_BYTES, plus multipart framing.
    proxyClientMaxBodySize: "26mb",
    // Dev only: compile routes when first visited instead of every entry at
    // startup. The default preload holds the whole app in the dev server's
    // memory, which is most of what an 8GB machine has to spare.
    preloadEntriesOnStart: false,
  },
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
    // Native: a PDF's first page is drawn server-side (lib/resources/renditions.ts).
    "@napi-rs/canvas",
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
      // Connectors moved into the Space Console; the old path still resolves
      // for anything that bookmarked or linked it.
      {
        source: "/connectors",
        destination: "/admin?section=connectors",
        permanent: false,
      },
    ];
  },
  images: {
    // Next 16 ships `qualities: [75]` and coerces anything else to it. A
    // profile picture is re-encoded by the optimizer on top of the WebP the
    // upload already wrote, and 75 on 75 is what makes a good photograph look
    // grainy in the directory grid. 90 is the allowlist entry avatar surfaces
    // ask for; 75 stays for everything incidental.
    qualities: [75, 90],
    // Next forbids a query string on a LOCAL image by default (its implicit
    // localPatterns is `{ pathname: '**', search: '' }`), and every stored
    // avatar URL carries the `?v=<uploaded-at>` cache-buster the media proxy
    // needs to move off a five-minute-old picture. Without this entry every
    // next/image over /api/media answers 400 "url parameter is not allowed".
    // Defining localPatterns replaces the default, so the second row keeps it.
    localPatterns: [
      { pathname: "/api/media/**" },
      { pathname: "**", search: "" },
    ],
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
