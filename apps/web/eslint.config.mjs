import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  {
    rules: {
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
];

export default eslintConfig;
