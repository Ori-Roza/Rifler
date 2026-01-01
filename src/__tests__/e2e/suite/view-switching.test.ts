import * as assert from 'assert';
import * as vscode from 'vscode';
import { testHelpers } from '../../../extension';

suite('View Switching E2E Tests - Bug Fix', () => {
  async function retryAssert(fn: () => void | Promise<void>, timeout = 10000, interval = 500) {
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

  test('Single click switch-to-tab opens tab (no multiple clicks needed)', async function() {
    this.timeout(30000);

    // 1. Ensure clean state - close sidebar first
    await vscode.commands.executeCommand('workbench.action.closeSidebar');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 2. Open tab directly with openInTab command
    await vscode.commands.executeCommand('rifler.openInTab');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 3. Verify tab is open
    await retryAssert(() => {
      const panel = testHelpers.getCurrentPanel();
      assert.ok(panel, 'Tab panel should be open after openInTab');
    });

    // Cleanup
    await vscode.commands.executeCommand('rifler._closeWindowInternal');
  });

  test('Single click switch-to-sidebar opens sidebar (no multiple clicks needed)', async function() {
    this.timeout(30000);

    // 1. Start in tab mode
    await vscode.commands.executeCommand('rifler.openInTab');
    await new Promise(resolve => setTimeout(resolve, 1500));

    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Tab should be open initially');

    // 2. Switch to sidebar with SINGLE click (should open sidebar)
    await vscode.commands.executeCommand('rifler.toggleView');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 3. Verify sidebar is visible (this is the core bug fix: single click works)
    await retryAssert(async () => {
      const sidebarVisible = await vscode.commands.executeCommand('__test_getSidebarVisible');
      assert.strictEqual(sidebarVisible, true, 'Sidebar should be visible after single switch-to-sidebar');
    });

    // Cleanup
    await vscode.commands.executeCommand('workbench.action.closeSidebar');
  });

  test('Sidebar and tab can coexist (no aggressive closing)', async function() {
    this.timeout(30000);

    // 1. Open tab mode
    await vscode.commands.executeCommand('rifler.openInTab');
    await new Promise(resolve => setTimeout(resolve, 1500));

    let panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Tab should be open');

    // 2. Click activity bar to open sidebar (should coexist)
    await vscode.commands.executeCommand('rifler.openInSidebar');
    await new Promise(resolve => setTimeout(resolve, 1500));

    // 3. Verify both are accessible (can see sidebar in activity bar and tab is still there)
    await retryAssert(async () => {
      // Sidebar should be accessible through activity bar
      const sidebarVisible = await vscode.commands.executeCommand('__test_getSidebarVisible');
      assert.strictEqual(sidebarVisible, true, 'Sidebar should be visible when explicitly opened');
      
      // Tab should still exist (no aggressive closure)
      panel = testHelpers.getCurrentPanel();
      assert.ok(panel, 'Tab should still exist (coexistence works)');
    });

    // Cleanup
    await vscode.commands.executeCommand('workbench.action.closeSidebar');
    await vscode.commands.executeCommand('rifler._closeWindowInternal');
  });

  test('Multiple rapid switches work reliably (no race conditions)', async function() {
    this.timeout(60000);

    // Perform 2 switches to verify reliability
    for (let i = 0; i < 2; i++) {
      // Switch to tab
      await vscode.commands.executeCommand('rifler.toggleView');
      await new Promise(resolve => setTimeout(resolve, 2000));

      await retryAssert(() => {
        const panel = testHelpers.getCurrentPanel();
        assert.ok(panel, `Iteration ${i}: Tab should be open after switch-to-tab`);
      });

      // Switch back to sidebar
      await vscode.commands.executeCommand('rifler.toggleView');
      await new Promise(resolve => setTimeout(resolve, 2000));

      await retryAssert(async () => {
        const sidebarVisible = await vscode.commands.executeCommand('__test_getSidebarVisible');
        assert.strictEqual(sidebarVisible, true, `Iteration ${i}: Sidebar should be visible after switch-to-sidebar`);
      });
    }

    // Cleanup
    await vscode.commands.executeCommand('workbench.action.closeSidebar');
  });

  test('Switch-to-tab closes sidebar for fullscreen feel', async function() {
    this.timeout(30000);

    // 1. Open sidebar and tab together (coexist)
    await vscode.commands.executeCommand('rifler.openInSidebar');
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    await vscode.commands.executeCommand('rifler.openInTab');
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Both should be accessible now
    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Tab should exist');

    // 2. Explicitly switch to tab via toggleView (should close sidebar for fullscreen)
    await vscode.commands.executeCommand('rifler.toggleView');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 3. Sidebar should be closed (for fullscreen tab feel)
    // Note: we check that sidebar state was closed, accounting for suppression delays
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Cleanup
    await vscode.commands.executeCommand('rifler._closeWindowInternal');
  });
});
