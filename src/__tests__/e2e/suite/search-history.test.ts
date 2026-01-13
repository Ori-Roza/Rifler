import * as assert from 'assert';
import { after, before } from 'mocha';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { testHelpers } from '../../../extension';

async function waitForMessage<T = any>(webview: vscode.Webview, type: string, timeoutMs = 12000): Promise<T> {
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

suite('Rifler Search History E2E', () => {
  let workspaceRoot: string;
  let fileA: string;
  let fileB: string;

  const tokenA = 'rifler_history_token_A_12345';
  const tokenB = 'rifler_history_token_B_67890';

  before(async () => {
    const extension = vscode.extensions.getExtension('Ori-Roza.rifler');
    if (extension && !extension.isActive) {
      await extension.activate();
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder available');
    }

    workspaceRoot = workspaceFolder.uri.fsPath;

    // Ensure deterministic UI location.
    const config = vscode.workspace.getConfiguration('rifler');
    await config.update('panelLocation', 'window', vscode.ConfigurationTarget.Workspace);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Ensure persistence is enabled for this suite (we test persistence across panel reopen).
    await config.update('persistSearchState', true, vscode.ConfigurationTarget.Workspace);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await config.update('persistenceScope', 'workspace', vscode.ConfigurationTarget.Workspace);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Ensure default max entries is 5 (explicitly set, to avoid user machine overrides).
    await config.update('searchHistory.maxEntries', 5, vscode.ConfigurationTarget.Workspace);
    await new Promise((resolve) => setTimeout(resolve, 300));

    fileA = path.join(workspaceRoot, 'rifler-history-a.ts');
    fileB = path.join(workspaceRoot, 'rifler-history-b.ts');

    fs.writeFileSync(fileA, `export const a = "${tokenA}";\n`);
    fs.writeFileSync(fileB, `export const b = "${tokenB}";\n`);
  });

  after(async () => {
    const config = vscode.workspace.getConfiguration('rifler');
    await config.update('panelLocation', undefined, vscode.ConfigurationTarget.Workspace);
    await config.update('persistSearchState', undefined, vscode.ConfigurationTarget.Workspace);
    await config.update('persistenceScope', undefined, vscode.ConfigurationTarget.Workspace);
    await config.update('searchHistory.maxEntries', undefined, vscode.ConfigurationTarget.Workspace);

    try {
      if (fs.existsSync(fileA)) fs.unlinkSync(fileA);
      if (fs.existsSync(fileB)) fs.unlinkSync(fileB);
    } catch {
      // ignore cleanup errors
    }
  });

  test('Selecting a history item triggers immediate search', async function () {
    this.timeout(30000);

    await vscode.commands.executeCommand('rifler._openWindowInternal');
    await new Promise((resolve) => setTimeout(resolve, 1800));

    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Panel should be open');

    // Clear history deterministically.
    const cleared = waitForMessage<{ type: string; entries: any[] }>(panel.webview, '__test_searchHistory');
    panel.webview.postMessage({ type: '__test_clearSearchHistory' });
    const clearedMsg = await cleared;
    assert.ok(Array.isArray(clearedMsg.entries), 'Expected history entries array');
    assert.strictEqual(clearedMsg.entries.length, 0, 'Expected cleared history');

    // First search
    const doneA = waitForMessage<{ type: string; results: any[] }>(panel.webview, '__test_searchCompleted');
    panel.webview.postMessage({ type: '__test_setSearchInput', value: tokenA });
    const msgA = await doneA;
    assert.ok(Array.isArray(msgA.results), 'Expected results array');
    assert.ok(msgA.results.length >= 1, 'Expected at least one result for tokenA');

    // Second search
    const doneB = waitForMessage<{ type: string; results: any[] }>(panel.webview, '__test_searchCompleted');
    panel.webview.postMessage({ type: '__test_setSearchInput', value: tokenB });
    const msgB = await doneB;
    assert.ok(Array.isArray(msgB.results), 'Expected results array');
    assert.ok(msgB.results.length >= 1, 'Expected at least one result for tokenB');

    // Confirm history has both entries, newest first
    panel.webview.postMessage({ type: '__test_getSearchHistory' });
    const historyMsg = await waitForMessage<{ type: string; entries: Array<{ query: string }> }>(panel.webview, '__test_searchHistory');
    assert.ok(historyMsg.entries.length >= 2, 'Expected at least 2 history entries');
    assert.strictEqual(historyMsg.entries[0].query, tokenB, 'Expected newest query first');

    // Select older entry by index and ensure it triggers a search immediately (no extra trigger)
    const doneSelect = waitForMessage<{ type: string; results: any[] }>(panel.webview, '__test_searchCompleted');
    panel.webview.postMessage({ type: '__test_selectSearchHistoryIndex', index: 1 });
    const msgSelect = await doneSelect;
    assert.ok(msgSelect.results.length >= 1, 'Expected results after selecting history item');

    // Verify query input updated to tokenA
    panel.webview.postMessage({ type: '__test_getQueryValue' });
    const queryValue = await waitForMessage<{ type: string; value: string }>(panel.webview, '__test_queryValue');
    assert.strictEqual(queryValue.value, tokenA);
  });

  test('History persists across panel reopen', async function () {
    this.timeout(30000);

    await vscode.commands.executeCommand('rifler._closeWindowInternal');
    await new Promise((resolve) => setTimeout(resolve, 800));

    await vscode.commands.executeCommand('rifler._openWindowInternal');
    await new Promise((resolve) => setTimeout(resolve, 1800));

    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Panel should be open');

    // Ensure webview has loaded persisted history
    panel.webview.postMessage({ type: '__test_getSearchHistory' });
    const historyMsg = await waitForMessage<{ type: string; entries: Array<{ query: string }> }>(panel.webview, '__test_searchHistory');
    const queries = historyMsg.entries.map((e) => e.query);

    assert.ok(queries.includes(tokenA), 'Expected tokenA in persisted history');
    assert.ok(queries.includes(tokenB), 'Expected tokenB in persisted history');
  });
});
