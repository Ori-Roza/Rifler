import * as assert from 'assert';
import * as vscode from 'vscode';
import { testHelpers } from '../../../extension';

suite('View Switching E2E Tests', () => {
  async function retryAssert(fn: () => void | Promise<void>, timeout = 5000, interval = 500) {
    const start = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await fn();
        return;
      } catch (e) {
        if (Date.now() - start > timeout) {
          throw e;
        }
        await new Promise(resolve => setTimeout(resolve, interval));
      }
    }
  }

  test('Should hide sidebar when switching to window mode', async function() {
    this.timeout(30000);

    // 1. Open sidebar
    await vscode.commands.executeCommand('rifler.openSidebar');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 2. Switch to window mode
    await vscode.commands.executeCommand('rifler.toggleView');
    
    // 3. Check if sidebar is hidden (with retry)
    await retryAssert(async () => {
      const isSidebarVisible = await vscode.commands.executeCommand('__test_getSidebarVisible');
      assert.strictEqual(isSidebarVisible, false, 'Sidebar should be hidden in window mode');
    });
    
    // 4. Check if window panel is open (with retry)
    await retryAssert(() => {
      const panel = testHelpers.getCurrentPanel();
      assert.ok(panel, 'Panel should be open');
    });

    // 5. Switch back to sidebar
    await vscode.commands.executeCommand('rifler.toggleView');
    
    // 6. Check if window panel is closed (with retry)
    await retryAssert(() => {
      const panelAfter = testHelpers.getCurrentPanel();
      assert.ok(!panelAfter, 'Rifler panel should be closed');
    });

    // 7. Check if sidebar is visible
    await retryAssert(async () => {
      const isSidebarVisibleAfter = await vscode.commands.executeCommand('__test_getSidebarVisible');
      assert.strictEqual(isSidebarVisibleAfter, true, 'Sidebar should be visible in sidebar mode');
    });
  });

  test('Should close sidebar when opening tab mode directly', async function() {
    this.timeout(30000);

    // 1. Ensure we are in tab mode (using toggleView if needed)
    await vscode.commands.executeCommand('rifler.openSidebar');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // If we are in sidebar, toggle to window
    const isSidebarVisibleInit = await vscode.commands.executeCommand('__test_getSidebarVisible');
    if (isSidebarVisibleInit) {
      await vscode.commands.executeCommand('rifler.toggleView');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Close the window panel to start clean
    await vscode.commands.executeCommand('rifler._closeWindowInternal');
    await new Promise(resolve => setTimeout(resolve, 500));

    // 2. Open sidebar manually to simulate it being open
    await vscode.commands.executeCommand('workbench.view.extension.rifler-sidebar');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await retryAssert(async () => {
      const isSidebarVisible = await vscode.commands.executeCommand('__test_getSidebarVisible');
      assert.strictEqual(isSidebarVisible, true, 'Sidebar should be visible initially');
    });

    // 3. Open Rifler (should open tab and close sidebar)
    await vscode.commands.executeCommand('rifler.open');

    // 4. Check sidebar is hidden
    await retryAssert(async () => {
      const isSidebarVisible = await vscode.commands.executeCommand('__test_getSidebarVisible');
      assert.strictEqual(isSidebarVisible, false, 'Sidebar should be hidden after opening tab');
    });

    // 5. Cleanup
    await vscode.commands.executeCommand('rifler._closeWindowInternal');
  });

  test('Toggling sidebar returns to previous container', async function() {
    this.timeout(40000);

    const config = vscode.workspace.getConfiguration('rifler');
    await config.update('panelLocation', 'sidebar', vscode.ConfigurationTarget.Workspace);
    await config.update('viewMode', 'sidebar', vscode.ConfigurationTarget.Workspace);

    // Ensure an editor is open with no selection (so toggle path is hit)
    const doc = await vscode.workspace.openTextDocument({ content: 'toggle-return-test', language: 'plaintext' });
    const editor = await vscode.window.showTextDocument(doc);
    editor.selections = [new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0))];

    // Start from a non-Rifler container (SCM) to verify restoration target
    await vscode.commands.executeCommand('workbench.view.scm');
    await new Promise(resolve => setTimeout(resolve, 800));

    const initialContainer = await getActiveViewletId();
    assert.ok(initialContainer);
    assert.notStrictEqual(initialContainer, 'workbench.view.extension.rifler-sidebar');

    // Open Rifler via toggle command (should record previous container)
    await vscode.commands.executeCommand('rifler.open');
    await new Promise(resolve => setTimeout(resolve, 1200));

    await retryAssert(async () => {
      const active = await getActiveViewletId();
      assert.strictEqual(active, 'workbench.view.extension.rifler-sidebar', 'Rifler sidebar should be active after open');
    });

    // Toggle again with no selection: should return to previous container (SCM)
    await vscode.commands.executeCommand('rifler.open');
    await new Promise(resolve => setTimeout(resolve, 1200));

    await retryAssert(async () => {
      const active = await getActiveViewletId();
      assert.strictEqual(
        active,
        initialContainer,
        'Toggling Rifler should restore the previous sidebar container'
      );
    });

    // Cleanup: return to Explorer to avoid leaving SCM active
    await vscode.commands.executeCommand('workbench.view.explorer');
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  async function getActiveViewletId(): Promise<string | undefined> {
    try {
      return await vscode.commands.executeCommand<string>('vscode.getContextKeyValue', 'activeViewlet');
    } catch {
      return undefined;
    }
  }
});
