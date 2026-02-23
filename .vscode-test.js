const { defineConfig } = require('@vscode/test-cli');
const fs = require('fs');
const os = require('os');
const path = require('path');

const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE_PATH;
const useInstallation = vscodeExecutablePath
  ? { fromPath: vscodeExecutablePath }
  : undefined;
const extensionDevelopmentPath = __dirname;

function resolveTempDir(envVarName, prefix) {
  const envValue = process.env[envVarName];
  if (envValue) {
    return envValue;
  }
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const userDataDir = resolveTempDir('VSCODE_TEST_USER_DATA_DIR', 'rifler-vscode-test-');
const extensionsDir = resolveTempDir('VSCODE_TEST_EXTENSIONS_DIR', 'rifler-vscode-test-extensions-');

module.exports = defineConfig([
  {
    label: 'e2e-tests',
    files: 'out/__tests__/e2e/suite/**/*.test.js',
    version: 'stable',
    useInstallation,
    extensionDevelopmentPath,
    workspaceFolder: './test-fixtures/workspace',
    mocha: {
      ui: 'tdd',
      timeout: 20000,
      reporter: 'spec',
    },
    launchArgs: [
      '--disable-workspace-trust',
      '--disable-extensions',
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`
    ],
  },
  {
    label: 'e2e-tests-visible',
    files: 'out/__tests__/e2e/suite/**/*.test.js',
    version: 'stable',
    useInstallation,
    extensionDevelopmentPath,
    workspaceFolder: './test-fixtures/workspace',
    mocha: {
      ui: 'tdd',
      timeout: 20000,
      reporter: 'spec',
    },
    launchArgs: [
      '--disable-workspace-trust',
      '--disable-extensions',
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
      '--new-window',
      '--disable-gpu-sandbox',
    ],
  },
], { concurrency: 1 });
