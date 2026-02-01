import * as assert from 'assert';
import * as vscode from 'vscode';
import { testHelpers } from '../../../extension';

suite('Title Hint E2E Tests', () => {
  async function retryAssert(fn: () => void | Promise<void>, timeout = 15000, interval = 250) {
    const start = Date.now();
     
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

  async function setRiflerConfig<K extends string>(key: K, value: unknown): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('rifler');
    await cfg.update(key, value, vscode.ConfigurationTarget.Workspace);
  }

  function getWorkspaceValue<T>(key: string): T | undefined {
    const cfg = vscode.workspace.getConfiguration('rifler');
    const inspected = cfg.inspect<T>(key);
    return inspected?.workspaceValue;
  }

  async function cleanUi(): Promise<void> {
    await vscode.commands.executeCommand('workbench.action.closeSidebar');
    await vscode.commands.executeCommand('workbench.action.closePanel');
    await vscode.commands.executeCommand('rifler._closeWindowInternal');
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  async function assertSidebarTitle(expected: string): Promise<void> {
    await vscode.commands.executeCommand('rifler.openInSidebar');
    await retryAssert(async () => {
      const visible = await vscode.commands.executeCommand('__test_getSidebarVisible');
      assert.strictEqual(visible, true, 'Sidebar should be visible');
    });

    await retryAssert(() => {
      const title = testHelpers.getSidebarTitle();
      assert.strictEqual(title, expected);
    });
  }

  async function assertBottomTitle(expected: string): Promise<void> {
    await setRiflerConfig('panelLocation', 'bottom');
    await vscode.commands.executeCommand('rifler.open');

    await retryAssert(async () => {
      const visible = await vscode.commands.executeCommand('__test_getBottomVisible');
      assert.strictEqual(visible, true, 'Bottom view should be visible');
    });

    await retryAssert(() => {
      const title = testHelpers.getBottomTitle();
      assert.strictEqual(title, expected);
    });
  }

  async function assertTabTitle(expected: string): Promise<void> {
    await vscode.commands.executeCommand('rifler.openInTab');

    await retryAssert(() => {
      const panel = testHelpers.getCurrentPanel();
      assert.ok(panel, 'Tab panel should be open');
      assert.strictEqual(panel!.title, expected);
    });
  }

  test('Titles reflect openKeybindingHint across sidebar/tab/bottom', async function () {
    this.timeout(60000);

    const originalPanelLocation = getWorkspaceValue<string>('panelLocation');
    const originalOpenKeybindingHint = getWorkspaceValue<string>('openKeybindingHint');

    try {
      // Hint #1
      await cleanUi();
      await setRiflerConfig('openKeybindingHint', 'cmd+alt+f');
      await assertSidebarTitle('(CMD+ALT+F)');
      await assertTabTitle('Rifler Search (cmd+alt+f)');
      await cleanUi();
      await assertBottomTitle('(CMD+ALT+F)');

      // Hint #2
      await cleanUi();
      await setRiflerConfig('openKeybindingHint', 'ctrl+shift+g');
      await assertSidebarTitle('(CTRL+SHIFT+G)');
      await assertTabTitle('Rifler Search (ctrl+shift+g)');
      await cleanUi();
      await assertBottomTitle('(CTRL+SHIFT+G)');
    } finally {
      // Cleanup: restore pre-test workspace settings (avoid impacting later E2E tests)
      await setRiflerConfig('panelLocation', originalPanelLocation);
      await setRiflerConfig('openKeybindingHint', originalOpenKeybindingHint);
      await cleanUi();
    }
  });
});
