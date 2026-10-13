'use strict';

module.exports = {
  root: true,
  env: { es2022: true, node: true },
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  globals: {
    AbortSignal: 'readonly',
    fetch: 'readonly',
    structuredClone: 'readonly',
  },
  ignorePatterns: ['**/fixtures/**', '**/workflows/**', '**/deploy/workflows/**'],
  rules: {
    'no-undef': 'error',
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  },
  overrides: [
    { files: ['*.cjs', '**/*.cjs'], parserOptions: { sourceType: 'script' } },
    { files: ['**/static/*.js'], env: { browser: true, node: false }, parserOptions: { sourceType: 'script' } },
  ],
};
