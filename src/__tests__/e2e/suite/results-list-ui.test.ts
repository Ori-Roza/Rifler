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
    // Force project scope search
    panel.webview.postMessage({ type: '__test_setSearchInput', value: 'function' });

    // Wait for search to complete
    const results = await searchResultsPromise;
    console.log(`[Test] Search returned ${results.length} results for 'function'`);
    
    // If no results with project scope, we may have a search issue
    if (results.length === 0) {
      console.log('[Test] No results found - this test may fail due to search issues');
    }

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

  async function getCollapsedResultsStatus(webview: vscode.Webview): Promise<any> {
    return new Promise((resolve) => {
      const disposable = webview.onDidReceiveMessage((message) => {
        if (message.type === '__test_collapsedResultsStatus') {
          disposable.dispose();
          resolve(message);
        }
      });
      webview.postMessage({ type: '__test_getCollapsedResultsStatus' });

      // Timeout after 2 seconds
      setTimeout(() => {
        disposable.dispose();
        resolve(null);
      }, 2000);
    });
  }

  test('Results should be expanded by default when resultsShowCollapsed is false', async function() {
    this.timeout(15000);

    await vscode.commands.executeCommand('rifler._openWindowInternal');
    await new Promise(resolve => setTimeout(resolve, 2000));

    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Panel should be open');

    // Ensure setting is disabled
    const config = vscode.workspace.getConfiguration('rifler');
    await config.update('results.showCollapsed', false, vscode.ConfigurationTarget.Workspace);
    await new Promise(resolve => setTimeout(resolve, 500));

    // Clear state
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

    // Trigger a search
    panel.webview.postMessage({ type: '__test_setSearchInput', value: 'function' });
    
    // Wait for search to complete
    await searchResultsPromise;
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check collapsed results status
    const status = await getCollapsedResultsStatus(panel.webview);
    assert.ok(status, 'Should receive collapsed results status');
    
    // Results should be expanded by default
    assert.strictEqual(status.allResultsExpanded, true, 'All results should be expanded when setting is false');
  });

  test('Results should be collapsed by default when resultsShowCollapsed is true', async function() {
    this.timeout(15000);

    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Panel should be open');

    // Enable the collapsed results setting
    const config = vscode.workspace.getConfiguration('rifler');
    await config.update('results.showCollapsed', true, vscode.ConfigurationTarget.Workspace);
    await new Promise(resolve => setTimeout(resolve, 500));

    // Clear state and trigger fresh load
    panel.webview.postMessage({ type: 'clearState' });
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Reload the panel to apply new settings
    await vscode.commands.executeCommand('rifler._openWindowInternal');
    await new Promise(resolve => setTimeout(resolve, 2000));

    const freshPanel = testHelpers.getCurrentPanel();
    assert.ok(freshPanel, 'Panel should be open');

    // Set up promise to wait for search completion
    const searchResultsPromise = new Promise<any[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for search results'));
      }, 8000);

      const disposable = freshPanel.webview.onDidReceiveMessage((message: any) => {
        if (message.type === '__test_searchCompleted') {
          clearTimeout(timeout);
          disposable.dispose();
          resolve(message.results);
        }
      });
    });

    // Trigger a search
    freshPanel.webview.postMessage({ type: '__test_setSearchInput', value: 'function' });
    
    // Wait for search to complete
    await searchResultsPromise;
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check collapsed results status
    const status = await getCollapsedResultsStatus(freshPanel.webview);
    assert.ok(status, 'Should receive collapsed results status');
    
    // All results should be collapsed by default
    assert.strictEqual(status.allResultsCollapsed, true, 'All results should be collapsed when setting is true');
  });

  test('User should be able to expand collapsed results individually', async function() {
    this.timeout(15000);

    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Panel should be open');

    // Ensure collapsed results setting is enabled
    const config = vscode.workspace.getConfiguration('rifler');
    await config.update('results.showCollapsed', true, vscode.ConfigurationTarget.Workspace);
    await new Promise(resolve => setTimeout(resolve, 500));

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

    // Trigger a search
    panel.webview.postMessage({ type: '__test_setSearchInput', value: 'function' });
    
    // Wait for search to complete
    await searchResultsPromise;
    await new Promise(resolve => setTimeout(resolve, 500));

    // Expand the first file header
    panel.webview.postMessage({ type: '__test_expandFirstFileHeader' });
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check status after expansion
    const status = await getCollapsedResultsStatus(panel.webview);
    assert.ok(status, 'Should receive collapsed results status');
    
    // First file should be expanded, others should be collapsed
    assert.strictEqual(status.firstFileExpanded, true, 'First file should be expanded after user interaction');
    assert.ok(status.otherFilesCollapsed, 'Other files should remain collapsed');
  });
});
