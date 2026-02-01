const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');

module.exports = [
  // Ignore patterns
  {
    ignores: [
      '**/node_modules/**',
      '**/out/**',
      '**/dist/**',
      '**/*.d.ts',
      '**/coverage/**',
      '**/coverage-e2e/**',
      '**/.vscode-test/**',
      '**/test-fixtures/**',
    ],
  },
  
  // Base config for all files
  eslint.configs.recommended,
  
  // TypeScript files
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
        },
      ],
    },
  },
  
  // JavaScript files - Node.js context with CommonJS
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  
  // Webview script.js - has browser globals and specific patterns
  {
    files: ['src/webview/script.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.browser,
        // Webview specific
        acquireVsCodeApi: 'readonly',
        hljs: 'readonly',
        // Module defined in the file
        toggleReplaceBtn: 'readonly',
        renderResults: 'readonly',
        saveTimeout: 'writable',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
      'no-undef': 'error',
      'no-case-declarations': 'off',
      'no-empty': 'warn',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
  
  // Test files - more lenient rules
  {
    files: [
      '**/__tests__/**/*.ts',
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/__mocks__/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
];
