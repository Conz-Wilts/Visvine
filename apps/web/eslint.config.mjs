import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const COMPONENTS_BOUNDARY = {
  group: ["@/components", "@/components/*"],
  message: "Shared UI is @visvine/ui (packages/ui). Domain UI belongs in @/features/<domain>/components.",
};

// We own our icons: every glyph is a file in assets/icons/, codegen'd into
// components by scripts/build-icons.ts. Renting them back from a library is the
// thing this boundary exists to stop — a library bump would silently redraw the
// UI, and there is no way to hand-tune a glyph we don't have the source for.
// See docs/icons.md.
const ICON_LIBRARIES = {
  group: ["lucide-react", "@heroicons/react", "@heroicons/react/*", "react-icons", "react-icons/*"],
  message: "Icons are ours — import from '@/features/shared/icons' (see docs/icons.md).",
};

// The space is part of every in-app URL (/s/<space>/…, lib/spaces/shared/spaceUrl.ts).
// Navigation goes through the wrappers that put it there, so a new link cannot
// quietly drop a person out of the space they are standing in.
const SPACE_URL_PATHS = [
  {
    name: "next/link",
    message: "Import Link from '@/features/shared/components/SpaceLink' — it keeps the space in the URL.",
  },
  {
    name: "next/navigation",
    importNames: ["useRouter"],
    message: "Use useSpaceRouter from '@/features/shared/hooks/useSpaceRouter' — it keeps the space in the URL.",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([
    "node_modules/**",
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Minified third-party bundles written by scripts/build-tool-vendor.ts —
    // build output that happens to live under public/ so `output: standalone`
    // carries it.
    "public/tool-runtime/**",
    // Tool source files the verify scripts feed to the server-side Tool
    // compiler (lib/tools/compile.ts). They are data, not app code — they
    // import `@visvine/tool-kit`, assign to a `handlers` global the isolate
    // provides, and one is a deliberate syntax error.
    "scripts/fixtures/**",
  ]),
  {
    rules: {
      // eslint-config-next 16 pulls in eslint-plugin-react-hooks v6, whose
      // React Compiler-based rules fire on 175 pre-existing call sites (84
      // refs, 80 set-state-in-effect, 11 misc). They flag real patterns worth
      // revisiting — especially before enabling `reactCompiler` — but that is a
      // refactor, not part of the Next 16 upgrade. Off so CI can keep gating on
      // --max-warnings=0; turn them back on one rule at a time.
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
      // Cosmetic in JSX text; high noise, low signal. Raw quotes/apostrophes
      // render identically to their entity forms.
      "react/no-unescaped-entities": "off",
      // Image optimization migration is a Phase 6 performance concern
      // (requires next.config remote patterns + GCS allowlist). Silenced
      // here so CI can gate --max-warnings=0; re-enable when migrating.
      "@next/next/no-img-element": "off",
      // Honor underscore-prefix convention for intentionally-unused bindings
      // (e.g. `_req`, `_nodeType`, destructured rest like `_`).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // components/ now holds only domain-agnostic primitives. Domain UI lives in
    // features/<domain>/components/.
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [COMPONENTS_BOUNDARY, ICON_LIBRARIES], paths: SPACE_URL_PATHS },
      ],
    },
  },
  {
    // The three places that wrap Next's navigation for space URLs.
    files: [
      "features/shared/components/SpaceLink.tsx",
      "features/shared/hooks/useSpaceRouter.ts",
      "features/shared/contexts/SpaceContext.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [COMPONENTS_BOUNDARY, ICON_LIBRARIES] },
      ],
    },
  },
  {
    // lib/ is server + pure domain logic. React providers and hooks belong in
    // features/shared/, so a React import here means something landed in the
    // wrong layer. Repeats the boundary pattern above because a same-named rule
    // in a later block replaces the earlier options rather than merging them.
    files: ["lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [COMPONENTS_BOUNDARY, ICON_LIBRARIES],
          paths: ["react", "react-dom"].map((name) => ({
            name,
            message: "lib/ must stay React-free — put this in features/<domain>/ instead.",
          })),
        },
      ],
    },
  },
]);

export default eslintConfig;
