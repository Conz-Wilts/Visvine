import expoConfig from 'eslint-config-expo/flat.js';

export default [
  ...expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'node_modules/*', 'android/*', 'ios/*'],
  },
  {
    rules: {
      // Expo preset's no-unused-vars flags function args in type definitions
      // and destructured context values — noisy. Enforce with _ escape hatch.
      'no-unused-vars': [
        'warn',
        {
          args: 'none',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      // api module re-exports a named `api` const and provides it as default —
      // idiomatic for this codebase.
      'import/no-named-as-default': 'off',
    },
  },
];
