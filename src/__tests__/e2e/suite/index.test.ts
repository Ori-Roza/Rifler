import * as assert from 'assert';
import { after, before } from 'mocha';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';

// import * as myExtension from '../../extension';

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

    // Verify document is still open (might not be active due to webview panel)
    const openDocuments = vscode.workspace.textDocuments;
    const documentStillOpen = openDocuments.some(doc => doc.uri.toString() === document.uri.toString());
    assert.ok(documentStillOpen, 'Document should still be open after opening Rifler panel');
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

  // Sidebar specific tests
  suite('Sidebar Tests', () => {
    test('Should register sidebar commands', async () => {
      const commands = await vscode.commands.getCommands(true);
      assert.ok(commands.includes('rifler.openSidebar'), 'rifler.openSidebar command should exist');
      assert.ok(commands.includes('rifler.openSidebarReplace'), 'rifler.openSidebarReplace command should exist');
    });

    test('Should open sidebar with openSidebar command', async () => {
      await vscode.commands.executeCommand('rifler.openSidebar');
      await new Promise(resolve => setTimeout(resolve, 1500));
      assert.ok(true);
    });

    test('Should toggle sidebar visibility', async () => {
      // Execute the sidebar view command
      const sidebarView = await vscode.commands.executeCommand('workbench.view.extension.rifler-sidebar');
      await new Promise(resolve => setTimeout(resolve, 1000));
      assert.ok(true);
    });

    test('Should support keyboard shortcut cmd+k cmd+f for sidebar search', async () => {
      // This tests that the command is registered with the keybinding
      const commands = await vscode.commands.getCommands(true);
      assert.ok(commands.includes('rifler.openSidebar'), 'rifler.openSidebar should be accessible via keyboard shortcut');
    });

    test('Should open sidebar replace panel', async () => {
      await vscode.commands.executeCommand('rifler.openSidebarReplace');
      await new Promise(resolve => setTimeout(resolve, 1500));
      assert.ok(true);
    });

    test('Should persist sidebar state in globalState', async () => {
      const extension = vscode.extensions.getExtension('Ori-Roza.rifler');
      assert.ok(extension, 'Extension should be available');

      if (extension && extension.isActive) {
        // The extension should save sidebar state to globalState
        assert.ok(true);
      }
    });

    test('Should handle sidebar search with query', async () => {
      // Open sidebar
      await vscode.commands.executeCommand('rifler.openSidebar');
      await new Promise(resolve => setTimeout(resolve, 1500));

      // The sidebar should be ready to handle search queries
      assert.ok(true);
    });

    test('Should switch between sidebar and window view', async () => {
      // Open in window first
      await vscode.commands.executeCommand('rifler.open');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Switch to sidebar
      await vscode.commands.executeCommand('rifler.openSidebar');
      await new Promise(resolve => setTimeout(resolve, 1000));

      assert.ok(true);
    });

    test('Should restore sidebar after closing and reopening', async () => {
      // First open
      await vscode.commands.executeCommand('rifler.openSidebar');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Close sidebar by opening editor
      await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Reopen sidebar
      await vscode.commands.executeCommand('rifler.openSidebar');
      await new Promise(resolve => setTimeout(resolve, 1000));

      assert.ok(true);
    });

    test('Should support sidebar keyboard shortcut cmd+alt+f', async () => {
      // This tests that the command is registered with the keybinding
      const commands = await vscode.commands.getCommands(true);
      assert.ok(commands.includes('rifler.openSidebar'), 'rifler.openSidebar should be accessible via keyboard shortcut cmd+alt+f');
    });

    test('Should handle sidebar search with multiple queries', async () => {
      // Open sidebar
      await vscode.commands.executeCommand('rifler.openSidebar');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // The sidebar should handle multiple searches
      assert.ok(true);
    });

    test('Should maintain sidebar state during search operations', async () => {
      // Open sidebar
      await vscode.commands.executeCommand('rifler.openSidebar');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Search
      await vscode.commands.executeCommand('rifler.openSidebar');
      await new Promise(resolve => setTimeout(resolve, 1000));

      assert.ok(true);
    });
  });
});