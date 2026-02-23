const { defineConfig } = require('@vscode/test-cli');
const os = require('os');
const path = require('path');

const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE_PATH;
const useInstallation = vscodeExecutablePath
  ? { fromPath: vscodeExecutablePath }
  : undefined;

const userDataDir = path.join(os.tmpdir(), 'rifler-vscode-test');
const extensionsDir = path.join(os.tmpdir(), 'rifler-vscode-test-extensions');

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
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`
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
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
      '--new-window',
      '--disable-gpu-sandbox',
    ],
  },
], { concurrency: 1 });
