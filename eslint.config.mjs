import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', '.copycat/', 'tests/workspace/**/behaviour.js', 'tests/fixtures/site/app.js'] },
  js.configs.recommended,
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
