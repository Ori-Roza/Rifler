import * as assert from 'assert';
import { after, before } from 'mocha';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { testHelpers } from '../../../extension';

suite('Rifler Results List UI Improvements E2E Tests', () => {
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

    // Create test files with content that will generate results
    testFilePath = path.join(testWorkspaceFolder.uri.fsPath, 'results-list-test.ts');
    const testContent = `
export const testFunction = () => {
  console.log('test function');
};

export const anotherFunction = () => {
  console.log('another function');
};

export const thirdFunction = () => {
  console.log('third function');
};

export const fourthFunction = () => {
  console.log('fourth function');
};

export const fifthFunction = () => {
  console.log('fifth function');
};
`.repeat(5); // Repeat to create more content

    fs.writeFileSync(testFilePath, testContent);
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

  async function getResultsListStatus(webview: vscode.Webview): Promise<any> {
    return new Promise((resolve) => {
      const disposable = webview.onDidReceiveMessage((message) => {
        if (message.type === '__test_resultsListStatus') {
          disposable.dispose();
          resolve(message);
        }
      });
      webview.postMessage({ type: '__test_getResultsListStatus' });

      // Timeout after 2 seconds
      setTimeout(() => {
        disposable.dispose();
        resolve(null);
      }, 2000);
    });
  }

  test('Results list should have visible scrollbar when content overflows', async function() {
    this.timeout(15000);

    await vscode.commands.executeCommand('rifler._openWindowInternal');
    // Wait for webview to load
    await new Promise(resolve => setTimeout(resolve, 2000));

    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Panel should be open');

    // Clear state first
    panel.webview.postMessage({ type: 'clearState' });
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Set up promise to wait for search completion
    const searchResultsPromise = new Promise<any[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for search results'));
      }, 8000);

      const disposable = panel.webview.onDidReceiveMessage((message: any) => {
        if (message.type === '__test_searchCompleted') {
          clearTimeout(timeout);
          disposable.dispose();
          resolve(message.results);
        }
      });
    });

    // Trigger a search that will generate multiple results
    panel.webview.postMessage({ type: '__test_setSearchInput', value: 'function' });

    // Wait for search to complete
    await searchResultsPromise;

    // Check results list status
    const status = await getResultsListStatus(panel.webview);
    assert.ok(status, 'Should receive results list status');

    // Scrollbar should be visible when there are results
    assert.strictEqual(status.scrollbarVisible, true, 'Scrollbar should be visible when results overflow');
  });

  test('Results list should not have horizontal overflow', async function() {
    this.timeout(15000);

    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Panel should be open');

    // Set up promise to wait for search completion
    const searchResultsPromise = new Promise<any[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for search results'));
      }, 8000);

      const disposable = panel.webview.onDidReceiveMessage((message: any) => {
        if (message.type === '__test_searchCompleted') {
          clearTimeout(timeout);
          disposable.dispose();
          resolve(message.results);
        }
      });
    });

    // Trigger a search with results
    panel.webview.postMessage({ type: '__test_setSearchInput', value: 'function' });

    // Wait for search to complete
    await searchResultsPromise;

    // Check results list status
    const status = await getResultsListStatus(panel.webview);
    assert.ok(status, 'Should receive results list status');

    // Should not have horizontal overflow
    assert.strictEqual(status.hasHorizontalOverflow, false, 'Results list should not have horizontal overflow');
  });

  test('Result file headers should have tooltips for truncated text', async function() {
    this.timeout(15000);

    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Panel should be open');

    // Set up promise to wait for search completion
    const searchResultsPromise = new Promise<any[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for search results'));
      }, 8000);

      const disposable = panel.webview.onDidReceiveMessage((message: any) => {
        if (message.type === '__test_searchCompleted') {
          clearTimeout(timeout);
          disposable.dispose();
          resolve(message.results);
        }
      });
    });

    // Trigger a search with results
    panel.webview.postMessage({ type: '__test_setSearchInput', value: 'function' });

    // Wait for search to complete
    await searchResultsPromise;

    // Check results list status
    const status = await getResultsListStatus(panel.webview);
    assert.ok(status, 'Should receive results list status');

    // Should have result headers
    assert.ok(status.resultHeadersCount > 0, 'Should have result headers');

    // Tooltips should be present on truncated elements
    assert.strictEqual(status.tooltipsPresent, true, 'Tooltips should be present on truncated file names and paths');
  });
});