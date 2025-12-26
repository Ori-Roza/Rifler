import * as assert from 'assert';
import { after, before } from 'mocha';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { testHelpers } from '../../../extension';

suite('Rifler Project Input Issues E2E Tests', () => {
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

    // Create test files
    testFilePath = path.join(testWorkspaceFolder.uri.fsPath, 'project-input-test.ts');
    fs.writeFileSync(testFilePath, 'export const test = "project input test";\n');
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

  async function getScopeInputStatus(webview: vscode.Webview): Promise<any> {
    return new Promise((resolve) => {
      const disposable = webview.onDidReceiveMessage((message) => {
        if (message.type === '__test_scopeInputStatus') {
          disposable.dispose();
          resolve(message);
        }
      });
      webview.postMessage({ type: '__test_getScopeInputStatus' });

      // Timeout after 2 seconds
      setTimeout(() => {
        disposable.dispose();
        resolve(null);
      }, 2000);
    });
  }

  test('Project mode should show read-only input with workspace name placeholder', async function() {
    this.timeout(15000);

    await vscode.commands.executeCommand('rifler._openWindowInternal');
    // Wait for webview to load
    await new Promise(resolve => setTimeout(resolve, 2000));

    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Panel should be open');

    // Set scope to project
    panel.webview.postMessage({ type: '__test_setScope', scope: 'project' });
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check scope input status
    const status = await getScopeInputStatus(panel.webview);
    assert.ok(status, 'Should receive scope input status');

    // Project mode should show read-only input with workspace name placeholder
    const expectedWorkspaceName = testWorkspaceFolder.name;
    assert.strictEqual(status.currentScope, 'project', 'Should be in project scope');
    assert.strictEqual(status.pathLabel, 'Project:', 'Path label should be "Project:"');
    assert.strictEqual(status.directoryInputVisible, true, 'Directory input should be visible');
    assert.strictEqual(status.directoryInputReadOnly, true, 'Directory input should be read-only');
    assert.strictEqual(status.directoryInputPlaceholder, expectedWorkspaceName, `Directory input should have workspace name "${expectedWorkspaceName}" as placeholder`);
    assert.strictEqual(status.directoryInputValue, testWorkspaceFolder.uri.fsPath, `Directory input should have workspace path as value`);
    assert.strictEqual(status.moduleSelectVisible, false, 'Module select should be hidden');
  });

  test('Directory mode should show editable input with proper placeholder', async function() {
    this.timeout(15000);

    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Panel should be open');

    // Set scope to directory
    panel.webview.postMessage({ type: '__test_setScope', scope: 'directory' });
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check scope input status
    const status = await getScopeInputStatus(panel.webview);
    assert.ok(status, 'Should receive scope input status');

    // Directory mode should show editable input
    assert.strictEqual(status.currentScope, 'directory', 'Should be in directory scope');
    assert.strictEqual(status.pathLabel, 'Directory:', 'Path label should be "Directory:"');
    assert.strictEqual(status.directoryInputVisible, true, 'Directory input should be visible');
    assert.strictEqual(status.directoryInputReadOnly, false, 'Directory input should be editable');
    assert.strictEqual(status.directoryInputPlaceholder, 'src/components/', 'Directory input should have proper placeholder');
    assert.strictEqual(status.moduleSelectVisible, false, 'Module select should be hidden');
  });

  test('Module mode should show module select dropdown', async function() {
    this.timeout(15000);

    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Panel should be open');

    // Set scope to module
    panel.webview.postMessage({ type: '__test_setScope', scope: 'module' });
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check scope input status
    const status = await getScopeInputStatus(panel.webview);
    assert.ok(status, 'Should receive scope input status');

    // Module mode should show module select
    assert.strictEqual(status.currentScope, 'module', 'Should be in module scope');
    assert.strictEqual(status.pathLabel, 'Module:', 'Path label should be "Module:"');
    assert.strictEqual(status.directoryInputVisible, false, 'Directory input should be hidden');
    assert.strictEqual(status.moduleSelectVisible, true, 'Module select should be visible');
  });

  test('Switching between modes should properly update input visibility and state', async function() {
    this.timeout(20000);

    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Panel should be open');

    // Test switching from project to directory
    panel.webview.postMessage({ type: '__test_setScope', scope: 'project' });
    await new Promise(resolve => setTimeout(resolve, 500));

    let status = await getScopeInputStatus(panel.webview);
    assert.strictEqual(status.currentScope, 'project', 'Should start in project scope');
    assert.strictEqual(status.directoryInputVisible, true, 'Directory input should be visible in project mode');
    assert.strictEqual(status.directoryInputReadOnly, true, 'Directory input should be read-only in project mode');

    // Switch to directory mode
    panel.webview.postMessage({ type: '__test_setScope', scope: 'directory' });
    await new Promise(resolve => setTimeout(resolve, 500));

    status = await getScopeInputStatus(panel.webview);
    assert.strictEqual(status.currentScope, 'directory', 'Should switch to directory scope');
    assert.strictEqual(status.directoryInputVisible, true, 'Directory input should remain visible');
    assert.strictEqual(status.directoryInputReadOnly, false, 'Directory input should become editable');
    assert.strictEqual(status.directoryInputPlaceholder, 'src/components/', 'Directory input should have proper placeholder');

    // Switch to module mode
    panel.webview.postMessage({ type: '__test_setScope', scope: 'module' });
    await new Promise(resolve => setTimeout(resolve, 500));

    status = await getScopeInputStatus(panel.webview);
    assert.strictEqual(status.currentScope, 'module', 'Should switch to module scope');
    assert.strictEqual(status.directoryInputVisible, false, 'Directory input should be hidden');
    assert.strictEqual(status.moduleSelectVisible, true, 'Module select should be visible');

    // Switch back to project mode
    panel.webview.postMessage({ type: '__test_setScope', scope: 'project' });
    await new Promise(resolve => setTimeout(resolve, 500));

    status = await getScopeInputStatus(panel.webview);
    assert.strictEqual(status.currentScope, 'project', 'Should switch back to project scope');
    assert.strictEqual(status.directoryInputVisible, true, 'Directory input should be visible again');
    assert.strictEqual(status.directoryInputReadOnly, true, 'Directory input should be read-only again');
    assert.strictEqual(status.directoryInputPlaceholder, testWorkspaceFolder.name, `Directory input should have workspace name "${testWorkspaceFolder.name}" as placeholder`);
    assert.strictEqual(status.moduleSelectVisible, false, 'Module select should be hidden');
  });

  test('Project mode should show workspace name instead of "All files"', async function() {
    this.timeout(15000);

    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Panel should be open');

    // Switch to project mode
    panel.webview.postMessage({ type: '__test_setScope', scope: 'project' });
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check the scope input status
    const status = await getScopeInputStatus(panel.webview);
    assert.ok(status, 'Should receive scope input status');

    // Project mode should now show workspace name instead of "All files"
    const expectedWorkspaceName = testWorkspaceFolder.name;
    console.log('Project mode status:', {
      placeholder: status.directoryInputPlaceholder,
      value: status.directoryInputValue,
      readOnly: status.directoryInputReadOnly,
      expectedWorkspaceName
    });

    assert.strictEqual(status.directoryInputPlaceholder, expectedWorkspaceName, `Directory input should have workspace name "${expectedWorkspaceName}" as placeholder`);
    assert.strictEqual(status.directoryInputValue, testWorkspaceFolder.uri.fsPath, `Directory input should have workspace path as value`);
    assert.strictEqual(status.directoryInputReadOnly, true, 'Directory input should be read-only in project mode');
  });

  test('Directory validation should show error for non-existent directory', async function() {
    this.timeout(15000);

    await vscode.commands.executeCommand('rifler._openWindowInternal');
    // Wait for webview to load
    await new Promise(resolve => setTimeout(resolve, 2000));

    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Panel should be open');

    // Set scope to directory
    panel.webview.postMessage({ type: '__test_setScope', scope: 'directory' });
    await new Promise(resolve => setTimeout(resolve, 500));

    // Set directory input to a non-existent path
    const nonExistentPath = path.join(testWorkspaceFolder.uri.fsPath, 'non-existent-directory');
    panel.webview.postMessage({ type: '__test_setDirectoryInput', value: nonExistentPath });
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for validation

    // Check that validation error is shown
    const validationStatus = await getValidationStatus(panel.webview);
    assert.ok(validationStatus, 'Should receive validation status');
    assert.strictEqual(validationStatus.directoryValidationError, true, 'Should show directory validation error');
    assert.strictEqual(validationStatus.directoryValidationMessage, 'Directory is not found', 'Should show correct error message');
  });

  test('Directory validation should clear error for valid directory', async function() {
    this.timeout(15000);

    await vscode.commands.executeCommand('rifler._openWindowInternal');
    // Wait for webview to load
    await new Promise(resolve => setTimeout(resolve, 2000));

    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Panel should be open');

    // Set scope to directory
    panel.webview.postMessage({ type: '__test_setScope', scope: 'directory' });
    await new Promise(resolve => setTimeout(resolve, 500));

    // First set to invalid directory
    const nonExistentPath = path.join(testWorkspaceFolder.uri.fsPath, 'non-existent-directory');
    panel.webview.postMessage({ type: '__test_setDirectoryInput', value: nonExistentPath });
    await new Promise(resolve => setTimeout(resolve, 1000));

    let validationStatus = await getValidationStatus(panel.webview);
    assert.strictEqual(validationStatus.directoryValidationError, true, 'Should show error for invalid directory');

    // Then set to valid directory (the workspace root)
    panel.webview.postMessage({ type: '__test_setDirectoryInput', value: testWorkspaceFolder.uri.fsPath });
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check that validation error is cleared
    validationStatus = await getValidationStatus(panel.webview);
    assert.ok(validationStatus, 'Should receive validation status');
    assert.strictEqual(validationStatus.directoryValidationError, false, 'Should clear directory validation error for valid directory');
  });

  test('Directory validation should work when switching to directory mode with invalid path', async function() {
    this.timeout(15000);

    await vscode.commands.executeCommand('rifler._openWindowInternal');
    // Wait for webview to load
    await new Promise(resolve => setTimeout(resolve, 2000));

    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Panel should be open');

    // Set directory input to invalid path while in project mode
    const nonExistentPath = path.join(testWorkspaceFolder.uri.fsPath, 'another-non-existent-directory');
    panel.webview.postMessage({ type: '__test_setDirectoryInput', value: nonExistentPath });
    await new Promise(resolve => setTimeout(resolve, 500));

    // Switch to directory mode
    panel.webview.postMessage({ type: '__test_setScope', scope: 'directory' });
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for validation

    // Check that validation error is shown
    const validationStatus = await getValidationStatus(panel.webview);
    assert.ok(validationStatus, 'Should receive validation status');
    assert.strictEqual(validationStatus.directoryValidationError, true, 'Should show directory validation error when switching to directory mode');
    assert.strictEqual(validationStatus.directoryValidationMessage, 'Directory is not found', 'Should show correct error message');
  });

  async function getValidationStatus(webview: vscode.Webview): Promise<any> {
    return new Promise((resolve) => {
      const disposable = webview.onDidReceiveMessage((message) => {
        if (message.type === '__test_validationStatus') {
          disposable.dispose();
          resolve(message);
        }
      });
      webview.postMessage({ type: '__test_getValidationStatus' });

      // Timeout after 2 seconds
      setTimeout(() => {
        disposable.dispose();
        resolve(null);
      }, 2000);
    });
  }});
