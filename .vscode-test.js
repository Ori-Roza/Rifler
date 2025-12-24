const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig([
  {
    label: 'e2e-tests',
    files: 'out/__tests__/e2e/suite/**/*.test.js',
    version: 'stable',
    workspaceFolder: './test-fixtures/workspace',
    mocha: {
      ui: 'tdd',
      timeout: 20000,
    },
    launchArgs: [
      '--disable-workspace-trust',
      '--user-data-dir=/tmp/vscode-test'
    ],
  },
  {
    label: 'e2e-tests-visible',
    files: 'out/__tests__/e2e/suite/**/*.test.js',
    version: 'stable',
    workspaceFolder: './test-fixtures/workspace',
    mocha: {
      ui: 'tdd',
      timeout: 20000,
    },
    launchArgs: [
      '--disable-workspace-trust',
      '--user-data-dir=/tmp/vscode-ggg',
      '--new-window',
      '--disable-gpu-sandbox',
    ],
  },
], { concurrency: 1 });