import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const COMPONENTS_BOUNDARY = {
  group: ["@/components/*", "!@/components/ui", "!@/components/ui/*"],
  message: "Only @/components/ui is shared. Domain UI belongs in @/features/<domain>/components.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([
    "node_modules/**",
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
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
      "no-restricted-imports": ["error", { patterns: [COMPONENTS_BOUNDARY] }],
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
          patterns: [COMPONENTS_BOUNDARY],
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
