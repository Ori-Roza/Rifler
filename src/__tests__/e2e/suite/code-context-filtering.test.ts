import * as assert from 'assert';
import { after, before } from 'mocha';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { testHelpers } from '../../../extension';

suite('Code Context Filtering E2E Tests', () => {
  let testWorkspaceFolder: vscode.WorkspaceFolder;
  let testFilePath: string;

  before(async () => {
    const extension = vscode.extensions.getExtension('Ori-Roza.rifler');
    if (extension && !extension.isActive) {
      await extension.activate();
    }

    const config = vscode.workspace.getConfiguration('rifler');
    await config.update('persistSearchState', false, vscode.ConfigurationTarget.Workspace);
    await new Promise(resolve => setTimeout(resolve, 500));
    await config.update('panelLocation', 'window', vscode.ConfigurationTarget.Workspace);
    await new Promise(resolve => setTimeout(resolve, 500));

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder available');
    }
    testWorkspaceFolder = workspaceFolder;

    testFilePath = path.join(testWorkspaceFolder.uri.fsPath, 'context-filter-test.js');
    const testContent = [
      '// foo in comment',
      'const label = "foo";',
      'function foo() { return "bar"; }'
    ].join('\n');

    fs.writeFileSync(testFilePath, testContent);
  });

  after(async () => {
    const config = vscode.workspace.getConfiguration('rifler');
    await config.update('persistSearchState', undefined, vscode.ConfigurationTarget.Workspace);
    await new Promise(resolve => setTimeout(resolve, 500));
    await config.update('panelLocation', undefined, vscode.ConfigurationTarget.Workspace);
    await new Promise(resolve => setTimeout(resolve, 500));

    try {
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  async function waitForSearchResults(webview: vscode.Webview): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for search results'));
      }, 8000);

      const disposable = webview.onDidReceiveMessage((message: any) => {
        if (message.type === '__test_searchCompleted') {
          clearTimeout(timeout);
          disposable.dispose();
          resolve(message.results || []);
        }
      });
    });
  }

  async function runFilteredSearch(filters: { includeCode: boolean; includeComments: boolean; includeStrings: boolean }) {
    await vscode.commands.executeCommand('rifler._openWindowInternal');
    await new Promise(resolve => setTimeout(resolve, 2000));

    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Panel should be open');

    panel.webview.postMessage({ type: '__test_setScope', scope: 'project' });
    panel.webview.postMessage({ type: '__test_setFileMask', value: 'context-filter-test.js' });
    panel.webview.postMessage({ type: '__test_setContextFilters', ...filters });

    const resultsPromise = waitForSearchResults(panel.webview);
    panel.webview.postMessage({ type: '__test_setSearchInput', value: 'foo' });
    return await resultsPromise;
  }

  test('Code-only filter excludes comments and strings', async function() {
    this.timeout(15000);

    const results = await runFilteredSearch({ includeCode: true, includeComments: false, includeStrings: false });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].line, 2);
  });

  test('Strings-only filter excludes code and comments', async function() {
    this.timeout(15000);

    const results = await runFilteredSearch({ includeCode: false, includeComments: false, includeStrings: true });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].line, 1);
  });

  test('Comments-only filter excludes code and strings', async function() {
    this.timeout(15000);

    const results = await runFilteredSearch({ includeCode: false, includeComments: true, includeStrings: false });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].line, 0);
  });
});
