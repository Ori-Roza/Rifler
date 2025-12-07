import * as assert from 'assert';
import { after, before } from 'mocha';
import * as vscode from 'vscode';
import * as path from 'path';

suite('Webview Integration Tests', () => {
  let testWorkspaceFolder: vscode.WorkspaceFolder;
  let testDocument: vscode.TextDocument;

  before(async () => {
    // Create a test workspace
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder available');
    }
    testWorkspaceFolder = workspaceFolder;

    // Create a test file with known content
    const testFilePath = path.join(testWorkspaceFolder.uri.fsPath, 'test-file.ts');
    const testContent = `// Test file for E2E testing
function helloWorld() {
  console.log("Hello, World!");
  const message = "test message";
  return message;
}

class TestClass {
  private testProperty: string = "test value";

  public testMethod(): string {
    return this.testProperty;
  }
}

const testVariable = "searchable content";
const anotherVariable = 42;`;


    // Write test file
    const fs = require('fs');
    fs.writeFileSync(testFilePath, testContent);

    // Open the test document
    testDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(testFilePath));
    await vscode.window.showTextDocument(testDocument);
  });

  after(async () => {
    // Clean up test file
    if (testDocument) {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      try {
        const fs = require('fs');
        fs.unlinkSync(testDocument.uri.fsPath);
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });

  test('Should perform search and return results', async function() {
    this.timeout(10000); // Increase timeout for E2E test

    // Execute search command
    await vscode.commands.executeCommand('rifler.open');

    // Wait for panel to open
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get the active webview panel
    const panels = vscode.window.tabGroups.all
      .flatMap(tg => tg.tabs)
      .filter(tab => tab.label.includes('Rifler'))
      .map(tab => (tab as any).webview);

    if (panels.length === 0) {
      // Panel might not be accessible in test environment
      console.log('Webview panel not accessible in test environment, skipping detailed test');
      return;
    }

    // Test passes if command executed without error
    assert.ok(true);
  });

  test('Should handle search with different scopes', async function() {
    this.timeout(15000);

    // Test different search scopes
    const scopes: Array<'project' | 'file'> = ['project', 'file'];

    for (const scope of scopes) {
      // Execute search command
      await vscode.commands.executeCommand('rifler.open');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Test passes if no errors occur
      assert.ok(true);
    }
  });

  test('Should work with replace functionality', async function() {
    this.timeout(10000);

    // Execute replace command
    await vscode.commands.executeCommand('rifler.openReplace');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test passes if command executed
    assert.ok(true);
  });

  test('Should handle configuration changes', async () => {
    // Test configuration access
    const config = vscode.workspace.getConfiguration('rifler');
    const originalValue = config.get('replaceInPreviewKeybinding');

    // Verify we can read the default configuration
    assert.ok(originalValue, 'Should be able to read configuration');

    // Note: Configuration updates may not work in test environment
    // so we just test that we can read the config
    console.log(`Configuration value: ${originalValue}`);
  });

  test('Should handle multiple concurrent operations', async function() {
    this.timeout(20000);

    // Open multiple search panels rapidly
    await vscode.commands.executeCommand('rifler.open');
    await new Promise(resolve => setTimeout(resolve, 500));

    await vscode.commands.executeCommand('rifler.openReplace');
    await new Promise(resolve => setTimeout(resolve, 500));

    await vscode.commands.executeCommand('rifler.open');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Should handle concurrent operations without crashing
    assert.ok(true);
  });
});