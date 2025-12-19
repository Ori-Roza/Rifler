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
});
