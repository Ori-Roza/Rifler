import * as assert from 'assert';
import { after, before } from 'mocha';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { testHelpers } from '../../../extension';

suite('Rifler UI Visibility & Responsiveness E2E Tests', () => {
  let testWorkspaceFolder: vscode.WorkspaceFolder;
  let testFilePath: string;

  before(async () => {
    const extension = vscode.extensions.getExtension('Ori-Roza.rifler');
    if (extension && !extension.isActive) {
      await extension.activate();
    }

    // Disable persistence and force window mode for these tests
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

    testFilePath = path.join(testWorkspaceFolder.uri.fsPath, 'ui-test-file.ts');
    fs.writeFileSync(testFilePath, 'export const test = "visibility-check";\n'.repeat(10));
  });

  after(async () => {
    // Restore settings
    const config = vscode.workspace.getConfiguration('rifler');
    await config.update('persistSearchState', undefined, vscode.ConfigurationTarget.Workspace);
    await new Promise(resolve => setTimeout(resolve, 500));
    await config.update('panelLocation', undefined, vscode.ConfigurationTarget.Workspace);
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  async function getUiStatus(webview: vscode.Webview): Promise<any> {
    return new Promise((resolve) => {
      const disposable = webview.onDidReceiveMessage((message) => {
        if (message.type === '__test_uiStatus') {
          disposable.dispose();
          resolve(message);
        }
      });
      webview.postMessage({ type: '__test_getUiStatus' });
      
      // Timeout after 2 seconds
      setTimeout(() => {
        disposable.dispose();
        resolve(null);
      }, 2000);
    });
  }

  test('Summary bar should be visible on startup', async function() {
    this.timeout(15000);
    
    // Close any existing panel first
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await vscode.commands.executeCommand('rifler._openWindowInternal');
    // Wait for webview to load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Panel should be open');
    
    // Clear state and wait for it to take effect
    panel.webview.postMessage({ type: 'clearState' });
    await new Promise(resolve => setTimeout(resolve, 1500));

    const status = await getUiStatus(panel.webview);
    assert.ok(status, 'Should receive UI status');
    assert.strictEqual(status.summaryBarVisible, true, 'Summary bar should be visible');
    assert.strictEqual(status.resultsCountText, 'Type to search...', 'Initial text should be correct');
  });

  test('Filters panel should toggle visibility', async function() {
    this.timeout(10000);
    
    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Panel should be open');

    // Initially hidden (default)
    let status = await getUiStatus(panel.webview);
    assert.strictEqual(status.filtersVisible, false, 'Filters should be initially hidden');

    // Toggle filters
    panel.webview.postMessage({ type: '__test_toggleFilters' });
    await new Promise(resolve => setTimeout(resolve, 500));
    
    status = await getUiStatus(panel.webview);
    assert.strictEqual(status.filtersVisible, true, 'Filters should be visible after toggle');

    // Toggle back
    panel.webview.postMessage({ type: '__test_toggleFilters' });
    await new Promise(resolve => setTimeout(resolve, 500));
    
    status = await getUiStatus(panel.webview);
    assert.strictEqual(status.filtersVisible, false, 'Filters should be hidden after second toggle');
  });

  test('Replace row should toggle visibility', async function() {
    this.timeout(10000);
    
    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Panel should be open');

    // Initially hidden
    let status = await getUiStatus(panel.webview);
    assert.strictEqual(status.replaceVisible, false, 'Replace row should be initially hidden');

    // Toggle replace
    panel.webview.postMessage({ type: '__test_toggleReplace' });
    await new Promise(resolve => setTimeout(resolve, 500));
    
    status = await getUiStatus(panel.webview);
    assert.strictEqual(status.replaceVisible, true, 'Replace row should be visible after toggle');

    // Toggle back
    panel.webview.postMessage({ type: '__test_toggleReplace' });
    await new Promise(resolve => setTimeout(resolve, 500));
    
    status = await getUiStatus(panel.webview);
    assert.strictEqual(status.replaceVisible, false, 'Replace row should be hidden after second toggle');
  });

  test('Preview panel should appear when a result is selected', async function() {
    this.timeout(30000);
    
    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Panel should be open');

    // Clear state first and wait for it to take effect
    panel.webview.postMessage({ type: 'clearState' });
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Note: We don't assert on initial preview visibility because state restoration
    // during panel reopen may keep preview visible. The key test is that preview
    // becomes visible after a search with results.

    // Trigger a search
    panel.webview.postMessage({ type: '__test_setSearchInput', value: 'visibility-check' });
    
    // Wait for results
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // After search, first result is auto-selected, so preview should be visible
    const status = await getUiStatus(panel.webview);
    assert.strictEqual(status.previewVisible, true, 'Preview should be visible after search (auto-select first result)');
  });
});
