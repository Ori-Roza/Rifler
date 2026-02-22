const { defineConfig } = require('@vscode/test-cli');

const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE_PATH;
const useInstallation = vscodeExecutablePath
  ? { fromPath: vscodeExecutablePath }
  : undefined;

module.exports = defineConfig([
  {
    label: 'e2e-tests',
    files: 'out/__tests__/e2e/suite/**/*.test.js',
    version: 'stable',
    useInstallation,
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
    useInstallation,
    workspaceFolder: './test-fixtures/workspace',
    mocha: {
      ui: 'tdd',
      timeout: 20000,
    },
    launchArgs: [
      '--disable-workspace-trust',
      '--user-data-dir=/tmp/vscode-test',
      '--new-window',
      '--disable-gpu-sandbox',
    ],
  },
], { concurrency: 1 });
