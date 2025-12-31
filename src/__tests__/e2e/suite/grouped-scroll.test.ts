import * as assert from 'assert';
import { before, after } from 'mocha';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { testHelpers } from '../../../extension';

async function waitForMessage<T = any>(webview: vscode.Webview, type: string, timeoutMs = 8000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      disposable.dispose();
      reject(new Error(`Timeout waiting for message ${type}`));
    }, timeoutMs);

    const disposable = webview.onDidReceiveMessage((message: any) => {
      if (message?.type === type) {
        clearTimeout(timer);
        disposable.dispose();
        resolve(message as T);
      }
    });
  });
}

suite('Rifler Grouped Results Scroll Persistence E2E', () => {
  let testFilePath: string;

  before(async () => {
    const extension = vscode.extensions.getExtension('Ori-Roza.rifler');
    if (extension && !extension.isActive) {
      await extension.activate();
    }

    // Disable persistence and force window mode to keep the environment stable
    const config = vscode.workspace.getConfiguration('rifler');
    await config.update('persistSearchState', false, vscode.ConfigurationTarget.Workspace);
    await config.update('panelLocation', 'window', vscode.ConfigurationTarget.Workspace);

    // Create a local file with many matches to guarantee grouped scroll
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder, 'Workspace folder not found');
    testFilePath = path.join(workspaceFolder.uri.fsPath, 'grouped-scroll-virtual.ts');

    const lines = ['// grouped scroll virtualization data'];
    for (let i = 0; i < 150; i++) {
      lines.push(`export const virtual_match_${i} = "virtual_match_${i}";`);
    }
    fs.writeFileSync(testFilePath, lines.join('\n'));
  });

  after(async () => {
    const config = vscode.workspace.getConfiguration('rifler');
    await config.update('persistSearchState', undefined, vscode.ConfigurationTarget.Workspace);
    await config.update('panelLocation', undefined, vscode.ConfigurationTarget.Workspace);

    if (testFilePath && fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });

  test('keeps grouped scroll position when selecting mid-list occurrence', async function() {
    this.timeout(25000);

    await vscode.commands.executeCommand('rifler._openWindowInternal');
    await new Promise(res => setTimeout(res, 2000));

    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Panel should be open');

    // Wait for search completion after setting input
    const searchDone = waitForMessage<any>(panel!.webview, '__test_searchCompleted');
    panel!.webview.postMessage({ type: '__test_setSearchInput', value: 'virtual_match' });
    const searchResultsMsg = await searchDone;
    const results = (searchResultsMsg as any).results || [];
    assert.ok(results.length > 0, 'Search should return results for virtual_match');

    // Expand first file if needed (first file auto-expands, but be explicit for stability)
    panel!.webview.postMessage({ type: '__test_expandFirstFileHeader' });
    await new Promise(res => setTimeout(res, 300));

    // Get initial grouped scroll info
    panel!.webview.postMessage({ type: '__test_getGroupScrollInfo' });
    const infoBeforeMsg = await waitForMessage<any>(panel!.webview, '__test_groupScrollInfo');
    const groupsBefore = infoBeforeMsg.groups || [];
    assert.ok(groupsBefore.length > 0, 'Should have at least one grouped container');
    const targetGroup = groupsBefore.find((g: any) => g.scrollHeight > g.clientHeight) || groupsBefore[0];
    assert.ok(targetGroup.path, 'Grouped container should have a path');

    // Set a mid-list scroll position
    const targetIndex = 35; // keep within viewport after custom scroll
    const approxRowHeight = 28;
    const targetScroll = Math.min(
      Math.max(targetIndex * approxRowHeight - 60, 0),
      Math.max(targetGroup.scrollHeight - targetGroup.clientHeight, 0)
    );
    panel!.webview.postMessage({ type: '__test_setGroupScrollTop', path: targetGroup.path, scrollTop: targetScroll });
    await new Promise(res => setTimeout(res, 200));

    // Trigger selection of a mid occurrence to force re-render
    panel!.webview.postMessage({ type: '__test_setActiveIndex', index: targetIndex });
    await new Promise(res => setTimeout(res, 400));

    // Fetch scroll info again
    panel!.webview.postMessage({ type: '__test_getGroupScrollInfo' });
    const infoAfterMsg = await waitForMessage<any>(panel!.webview, '__test_groupScrollInfo');
    const afterGroup = (infoAfterMsg.groups || []).find((g: any) => g.path === targetGroup.path);
    assert.ok(afterGroup, 'Should find the same grouped container after render');

    const delta = Math.abs((afterGroup as any).scrollTop - targetScroll);
    assert.ok(delta < 10, `Grouped scroll should persist (delta=${delta})`);
  });
});
