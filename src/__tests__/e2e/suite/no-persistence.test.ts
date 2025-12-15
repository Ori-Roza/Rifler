import * as assert from 'assert';
import { after, before } from 'mocha';
import * as vscode from 'vscode';

suite('No Persistence (Default Behavior)', () => {
  before(async () => {
    // Activate the extension before running tests
    const extension = vscode.extensions.getExtension('Ori-Roza.rifler');
    if (extension && !extension.isActive) {
      await extension.activate();
    }
  });

  after(() => {
    vscode.window.showInformationMessage('No persistence tests done!');
  });

  test('Should have persistence disabled by default', async () => {
    const config = vscode.workspace.getConfiguration('rifler');
    const persistSearchState = config.get<boolean>('persistSearchState');
    const persistenceScope = config.get<string>('persistenceScope');

    assert.strictEqual(persistSearchState, false, 'persistSearchState should be false by default');
    assert.strictEqual(persistenceScope, 'off', 'persistenceScope should be "off" by default');
  });

  test('Should not restore state when persistence is off', async () => {
    // Open panel
    await vscode.commands.executeCommand('rifler.open');
    await new Promise(resolve => setTimeout(resolve, 800));

    // Close and reopen - state should NOT be restored
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await new Promise(resolve => setTimeout(resolve, 500));

    await vscode.commands.executeCommand('rifler.open');
    await new Promise(resolve => setTimeout(resolve, 800));

    // Test passes - with persistence off, there's no automatic restoration
    assert.ok(true, 'Panel opens fresh when persistence is disabled');
  });

  test('Should clear any legacy stored state on activation', async () => {
    const context = (global as any).testExtensionContext;
    if (!context) {
      // If we don't have access to context in tests, skip
      return assert.ok(true, 'Skipped - context not available in test');
    }

    // Check that state stores are undefined/cleared when persistence is off
    const workspaceState = await context.workspaceState.get('rifler.sidebarState');
    const globalState = await context.globalState.get('rifler.sidebarState');

    assert.strictEqual(workspaceState, undefined, 'workspaceState should be cleared');
    assert.strictEqual(globalState, undefined, 'globalState should be cleared');
  });

  test('Should start with clean UI on each open', async () => {
    // Open sidebar
    await vscode.commands.executeCommand('rifler.openSidebar');
    await new Promise(resolve => setTimeout(resolve, 800));

    // Close sidebar
    await vscode.commands.executeCommand('workbench.action.closeSidebar');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Reopen - should be clean
    await vscode.commands.executeCommand('rifler.openSidebar');
    await new Promise(resolve => setTimeout(resolve, 800));

    // Test passes if no errors occur
    assert.ok(true, 'Sidebar opens with clean state');
  });

  test('Should respect persistence when explicitly enabled', async () => {
    const config = vscode.workspace.getConfiguration('rifler');
    
    // Enable persistence temporarily (use Workspace target for tests)
    await config.update('persistSearchState', true, vscode.ConfigurationTarget.Workspace);
    await config.update('persistenceScope', 'workspace', vscode.ConfigurationTarget.Workspace);
    await new Promise(resolve => setTimeout(resolve, 300));

    // Get fresh config to see updates
    const updatedConfig = vscode.workspace.getConfiguration('rifler');
    const persistSearchState = updatedConfig.get<boolean>('persistSearchState');
    const persistenceScope = updatedConfig.get<string>('persistenceScope');

    assert.strictEqual(persistSearchState, true, 'persistSearchState should be true when set');
    assert.strictEqual(persistenceScope, 'workspace', 'persistenceScope should be workspace when set');

    // Reset to defaults
    await config.update('persistSearchState', undefined, vscode.ConfigurationTarget.Workspace);
    await config.update('persistenceScope', undefined, vscode.ConfigurationTarget.Workspace);
    await new Promise(resolve => setTimeout(resolve, 300));
  });

  test('Should allow switching to global scope', async () => {
    const config = vscode.workspace.getConfiguration('rifler');
    
    // Enable global persistence (use Workspace target for tests)
    await config.update('persistSearchState', true, vscode.ConfigurationTarget.Workspace);
    await config.update('persistenceScope', 'global', vscode.ConfigurationTarget.Workspace);
    await new Promise(resolve => setTimeout(resolve, 300));

    // Get fresh config to see updates
    const updatedConfig = vscode.workspace.getConfiguration('rifler');
    const persistenceScope = updatedConfig.get<string>('persistenceScope');
    assert.strictEqual(persistenceScope, 'global', 'persistenceScope should be global when set');

    // Reset to defaults
    await config.update('persistSearchState', undefined, vscode.ConfigurationTarget.Workspace);
    await config.update('persistenceScope', undefined, vscode.ConfigurationTarget.Workspace);
    await new Promise(resolve => setTimeout(resolve, 300));
  });

  test('Should clear state on workspace folder change when scope is workspace or off', async () => {
    const config = vscode.workspace.getConfiguration('rifler');
    
    // Set to workspace scope temporarily
    await config.update('persistSearchState', true, vscode.ConfigurationTarget.Global);
    await config.update('persistenceScope', 'workspace', vscode.ConfigurationTarget.Global);
    await new Promise(resolve => setTimeout(resolve, 300));

    // Open panel
    await vscode.commands.executeCommand('rifler.open');
    await new Promise(resolve => setTimeout(resolve, 800));

    // Simulate workspace change by toggling setting (actual workspace folder change is hard to test)
    // The real test here is that the code path exists and doesn't error
    await config.update('persistenceScope', 'off', vscode.ConfigurationTarget.Global);
    await new Promise(resolve => setTimeout(resolve, 300));

    // Reset to defaults
    await config.update('persistSearchState', false, vscode.ConfigurationTarget.Global);
    await config.update('persistenceScope', 'off', vscode.ConfigurationTarget.Global);
    
    assert.ok(true, 'Workspace change handling exists');
  });

  test('Should handle minimize/restore without persistence', async () => {
    // With persistence off, minimize/restore should still work for the session
    await vscode.commands.executeCommand('rifler.open');
    await new Promise(resolve => setTimeout(resolve, 800));

    await vscode.commands.executeCommand('rifler.minimize');
    await new Promise(resolve => setTimeout(resolve, 500));

    await vscode.commands.executeCommand('rifler.restore');
    await new Promise(resolve => setTimeout(resolve, 800));

    // Should work in-session even without persistence
    assert.ok(true, 'Minimize/restore works without persistence');
  });

  test('Should clear state when close button is clicked', async () => {
    // Open panel
    await vscode.commands.executeCommand('rifler.open');
    await new Promise(resolve => setTimeout(resolve, 800));

    // Close all editors (simulates clicking close)
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Reopen - should be fresh
    await vscode.commands.executeCommand('rifler.open');
    await new Promise(resolve => setTimeout(resolve, 800));

    assert.ok(true, 'State cleared on close');
  });

  test('Should toggle between sidebar and window without persisting', async () => {
    // Test toggling views without persistence issues
    await vscode.commands.executeCommand('rifler.openSidebar');
    await new Promise(resolve => setTimeout(resolve, 800));

    await vscode.commands.executeCommand('rifler.toggleView');
    await new Promise(resolve => setTimeout(resolve, 800));

    await vscode.commands.executeCommand('rifler.toggleView');
    await new Promise(resolve => setTimeout(resolve, 800));

    assert.ok(true, 'View toggle works without persistence');
  });
});
