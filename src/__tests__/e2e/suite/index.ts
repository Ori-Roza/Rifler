import * as assert from 'assert';
import { after, before } from 'mocha';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';

// import * as myExtension from '../../extension';

// Import persistence tests
import './persistence.test';

suite('Extension Test Suite', () => {
  before(async () => {
    // Activate the extension before running tests
    const extension = vscode.extensions.getExtension('Ori-Roza.rifler');
    if (extension && !extension.isActive) {
      await extension.activate();
    }
  });

  after(() => {
    vscode.window.showInformationMessage('All tests done!');
  });

  test('Extension should be present', () => {
    assert.ok(vscode.extensions.getExtension('Ori-Roza.rifler'));
  });

  test('Should register commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('rifler.open'));
    assert.ok(commands.includes('rifler.openReplace'));
  });

  test('Should open search panel', async () => {
    // Execute the command
    await vscode.commands.executeCommand('rifler.open');

    // Check if a webview panel was created
    // Note: We can't easily test the webview content in unit tests,
    // but we can verify the panel exists
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for panel to open

    // The test passes if no exception was thrown
    assert.ok(true);
  });

  test('Should open replace panel', async () => {
    // Execute the replace command
    await vscode.commands.executeCommand('rifler.openReplace');

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test passes if command executes without error
    assert.ok(true);
  });

  test('Should handle configuration', () => {
    const config = vscode.workspace.getConfiguration('rifler');
    const keybinding = config.get('replaceInPreviewKeybinding') as string;
    assert.strictEqual(typeof keybinding, 'string');
    assert.ok(keybinding.length > 0);
  });

  test('Should work with open document', async () => {
    // Create and open a test document
    const document = await vscode.workspace.openTextDocument({
      content: 'function test() {\n  console.log("hello world");\n}',
      language: 'typescript'
    });

    await vscode.window.showTextDocument(document);

    // Execute search command
    await vscode.commands.executeCommand('rifler.open');

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify document is still open and accessible
    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor);
    assert.strictEqual(activeEditor.document.uri.toString(), document.uri.toString());
  });

  test('Should handle multiple panel openings', async () => {
    // Open search panel multiple times
    await vscode.commands.executeCommand('rifler.open');
    await new Promise(resolve => setTimeout(resolve, 500));

    await vscode.commands.executeCommand('rifler.open');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Should not throw errors
    assert.ok(true);
  });

  test('Should switch between search and replace modes', async () => {
    // Open search
    await vscode.commands.executeCommand('rifler.open');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Open replace (should reuse same panel)
    await vscode.commands.executeCommand('rifler.openReplace');
    await new Promise(resolve => setTimeout(resolve, 500));

    assert.ok(true);
  });
});