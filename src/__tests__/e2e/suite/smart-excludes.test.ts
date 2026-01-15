import * as assert from 'assert';
import { after, before } from 'mocha';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { testHelpers } from '../../../extension';

async function waitForMessage<T = any>(webview: vscode.Webview, type: string, timeoutMs = 12000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      disposable.dispose();
      reject(new Error(`Timeout waiting for message ${type}`));
    }, timeoutMs);

    const disposable = webview.onDidReceiveMessage((message: any) => {
      if (message?.type === type) {
        clearTimeout(timer);
        disposable.dispose();
        resolve(message as T);
      }
    });
  });
}

suite('Rifler Smart Excludes E2E', () => {
  let workspaceRoot: string;
  let nodeModulesDir: string;
  let nodeModulesFile: string;
  let regularFile: string;

  const searchToken = 'smart_exclude_test_token_xyz';

  before(async () => {
    const extension = vscode.extensions.getExtension('Ori-Roza.rifler');
    if (extension && !extension.isActive) {
      await extension.activate();
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder available');
    }

    workspaceRoot = workspaceFolder.uri.fsPath;

    // Disable persistence for deterministic tests
    const config = vscode.workspace.getConfiguration('rifler');
    await config.update('persistSearchState', false, vscode.ConfigurationTarget.Workspace);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await config.update('panelLocation', 'window', vscode.ConfigurationTarget.Workspace);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Create node_modules directory and file with search token
    nodeModulesDir = path.join(workspaceRoot, 'node_modules', 'test-package');
    fs.mkdirSync(nodeModulesDir, { recursive: true });
    nodeModulesFile = path.join(nodeModulesDir, 'index.js');
    fs.writeFileSync(nodeModulesFile, `// This file should be excluded by smart excludes\nconst token = "${searchToken}";\n`);

    // Create regular file with same search token
    regularFile = path.join(workspaceRoot, 'regular-file.ts');
    fs.writeFileSync(regularFile, `// This file should always appear\nexport const token = "${searchToken}";\n`);

    // Wait for file system to update
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  after(async () => {
    // Restore settings
    const config = vscode.workspace.getConfiguration('rifler');
    await config.update('persistSearchState', undefined, vscode.ConfigurationTarget.Workspace);
    await config.update('panelLocation', undefined, vscode.ConfigurationTarget.Workspace);

    // Cleanup test files
    try {
      if (fs.existsSync(regularFile)) {
        fs.unlinkSync(regularFile);
      }
      const nodeModulesRoot = path.join(workspaceRoot, 'node_modules');
      if (fs.existsSync(nodeModulesRoot)) {
        fs.rmSync(nodeModulesRoot, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup errors
    }
  });

  test('Smart excludes ON should exclude node_modules files', async function () {
    this.timeout(25000);

    await vscode.commands.executeCommand('rifler._openWindowInternal');
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Panel should be open');

    // Enable smart excludes checkbox
    panel.webview.postMessage({ type: '__test_setSmartExcludes', enabled: true });
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Run search
    const searchDone = waitForMessage<{ type: string; results: any[] }>(panel.webview, '__test_searchCompleted');
    panel.webview.postMessage({ type: '__test_setSearchInput', value: searchToken });

    const msg = await searchDone;
    const results = Array.isArray(msg.results) ? msg.results : [];

    // Should find the regular file but NOT the node_modules file
    assert.ok(results.length >= 1, 'Expected at least one result (regular file)');

    const regularFileHit = results.some((r) => {
      const fsPath = vscode.Uri.parse(r.uri).fsPath;
      return path.resolve(fsPath) === path.resolve(regularFile);
    });
    assert.ok(regularFileHit, 'Expected regular file to be included in results');

    const nodeModulesHit = results.some((r) => {
      const fsPath = vscode.Uri.parse(r.uri).fsPath;
      return fsPath.includes('node_modules');
    });
    assert.strictEqual(nodeModulesHit, false, 'Expected node_modules file to be excluded when smart excludes is ON');
  });

  test('Smart excludes OFF should include node_modules files', async function () {
    this.timeout(25000);

    await vscode.commands.executeCommand('rifler._openWindowInternal');
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Panel should be open');

    // Disable smart excludes checkbox
    panel.webview.postMessage({ type: '__test_setSmartExcludes', enabled: false });
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Run search
    const searchDone = waitForMessage<{ type: string; results: any[] }>(panel.webview, '__test_searchCompleted');
    panel.webview.postMessage({ type: '__test_setSearchInput', value: searchToken });

    const msg = await searchDone;
    const results = Array.isArray(msg.results) ? msg.results : [];

    // Should find BOTH files (regular and node_modules)
    assert.ok(results.length >= 2, 'Expected at least two results (regular file + node_modules file)');

    const regularFileHit = results.some((r) => {
      const fsPath = vscode.Uri.parse(r.uri).fsPath;
      return path.resolve(fsPath) === path.resolve(regularFile);
    });
    assert.ok(regularFileHit, 'Expected regular file to be included in results');

    const nodeModulesHit = results.some((r) => {
      const fsPath = vscode.Uri.parse(r.uri).fsPath;
      return fsPath.includes('node_modules');
    });
    assert.ok(nodeModulesHit, 'Expected node_modules file to be included when smart excludes is OFF');
  });
});
