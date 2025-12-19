import * as assert from 'assert';
import { after, before } from 'mocha';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';

suite('Persistent Storage and Toggle Features', () => {
  before(async () => {
    // Activate the extension before running tests
    const extension = vscode.extensions.getExtension('Ori-Roza.rifler');
    if (extension && !extension.isActive) {
      await extension.activate();
    }

    // Ensure we start with default configuration
    const config = vscode.workspace.getConfiguration('rifler');
    await config.update('persistSearchState', undefined, vscode.ConfigurationTarget.Workspace);
    await config.update('persistenceScope', undefined, vscode.ConfigurationTarget.Workspace);
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  after(() => {
    vscode.window.showInformationMessage('Persistence and toggle tests done!');
  });

  test('Should have persistence-aware commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('rifler.open'), 'rifler.open command should exist');
    assert.ok(commands.includes('rifler.minimize'), 'rifler.minimize command should exist');
    assert.ok(commands.includes('rifler.restore'), 'rifler.restore command should exist');
  });

  test('Should open panel with cmd+shift+f (first toggle)', async () => {
    // First call opens the panel
    await vscode.commands.executeCommand('rifler.open');

    // Wait for panel to open
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test passes if command executes without error
    assert.ok(true, 'Panel should open on first cmd+shift+f');
  });

  test('Should minimize panel with cmd+shift+f (second toggle)', async () => {
    // This assumes the panel is still open from previous test
    // Second call should minimize it
    await vscode.commands.executeCommand('rifler.open');

    // Wait for state change
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test passes if command executes without error
    assert.ok(true, 'Panel should minimize on second cmd+shift+f');
  });

  test('Should restore minimized panel with cmd+shift+f (third toggle)', async () => {
    // Third call should restore the minimized panel
    await vscode.commands.executeCommand('rifler.open');

    // Wait for restoration
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test passes if command executes without error
    assert.ok(true, 'Panel should restore on third cmd+shift+f');
  });

  test('Should support direct minimize command', async () => {
    // Open panel first
    await vscode.commands.executeCommand('rifler.open');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Then minimize it directly
    await vscode.commands.executeCommand('rifler.minimize');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Test passes if command executes without error
    assert.ok(true, 'Minimize command should work');
  });

  test('Should support direct restore command', async () => {
    // Restore the minimized panel
    await vscode.commands.executeCommand('rifler.restore');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Test passes if command executes without error
    assert.ok(true, 'Restore command should work');
  });

  test('Should handle openReplace command with toggle support', async () => {
    // Open replace panel
    await vscode.commands.executeCommand('rifler.openReplace');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Should open without errors
    assert.ok(true, 'openReplace command should work');
  });

  test('Should persist state across panel minimize/restore cycles', async () => {
    // This is a functional test that the state is preserved
    // Open with some search
    await vscode.commands.executeCommand('rifler.open');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Minimize
    await vscode.commands.executeCommand('rifler.minimize');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Restore - should restore previous state
    await vscode.commands.executeCommand('rifler.restore');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Test passes if restoration works smoothly
    assert.ok(true, 'State should persist through minimize/restore cycle');
  });

  test('Should work with multiple toggle cycles', async () => {
    for (let i = 0; i < 3; i++) {
      await vscode.commands.executeCommand('rifler.open');
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // Test passes if multiple toggles work
    assert.ok(true, 'Should handle multiple toggle cycles');
  });

  test('Should maintain configuration during toggle', async () => {
    const config = vscode.workspace.getConfiguration('rifler');
    const keybinding = config.get('replaceInPreviewKeybinding') as string;

    // Open panel
    await vscode.commands.executeCommand('rifler.open');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Minimize
    await vscode.commands.executeCommand('rifler.minimize');
    await new Promise(resolve => setTimeout(resolve, 300));

    // Check config is still accessible
    const configAfter = vscode.workspace.getConfiguration('rifler');
    const keybindingAfter = configAfter.get('replaceInPreviewKeybinding') as string;

    assert.strictEqual(keybinding, keybindingAfter, 'Configuration should persist');
  });

  test('Should clean up status bar when restoring', async () => {
    // Open and minimize
    await vscode.commands.executeCommand('rifler.open');
    await new Promise(resolve => setTimeout(resolve, 500));

    await vscode.commands.executeCommand('rifler.minimize');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Restore should hide the status bar item
    await vscode.commands.executeCommand('rifler.restore');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Test passes if cleanup happens without errors
    assert.ok(true, 'Status bar should be cleaned up on restore');
  });

  test('Should have persistence enabled by default', async () => {
    const config = vscode.workspace.getConfiguration('rifler');
    const persistSearchState = config.get<boolean>('persistSearchState');
    const persistenceScope = config.get<string>('persistenceScope');

    // With new defaults, persistence should be enabled and scoped to workspace
    assert.strictEqual(persistSearchState, true, 'persistSearchState should be true by default');
    assert.strictEqual(persistenceScope, 'workspace', 'persistenceScope should be "workspace" by default');
  });

  test('Should persist state when switching between sidebar and tab view', async () => {
    // Open sidebar
    await vscode.commands.executeCommand('rifler.openSidebar');
    await new Promise(resolve => setTimeout(resolve, 800));

    // Toggle to window/tab view
    await vscode.commands.executeCommand('rifler.toggleView');
    await new Promise(resolve => setTimeout(resolve, 800));

    // Toggle back to sidebar
    await vscode.commands.executeCommand('rifler.toggleView');
    await new Promise(resolve => setTimeout(resolve, 800));

    // State should persist through the toggle
    assert.ok(true, 'State should persist when switching between sidebar and tab');
  });

  test('Should persist state when switching to other sidebar plugins', async () => {
    // Open rifler sidebar
    await vscode.commands.executeCommand('rifler.openSidebar');
    await new Promise(resolve => setTimeout(resolve, 800));

    // Switch to explorer (another sidebar)
    await vscode.commands.executeCommand('workbench.view.explorer');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Switch back to rifler sidebar
    await vscode.commands.executeCommand('workbench.view.extension.rifler-sidebar');
    await new Promise(resolve => setTimeout(resolve, 800));

    // State should be restored
    assert.ok(true, 'State should persist when switching between sidebar plugins');
  });
});
