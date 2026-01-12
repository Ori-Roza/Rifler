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

function isWithinDir(filePath: string, dirPath: string): boolean {
  const rel = path.relative(dirPath, filePath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

suite('Rifler Directory Scope Filtering E2E', () => {
  let workspaceRoot: string;
  let scopedDir: string;
  let inScopeFile: string;
  let outScopeFile: string;

  const token = 'rifler_dirscope_token_12345';

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

    // Disable persistence and force window mode for deterministic UI.
    const config = vscode.workspace.getConfiguration('rifler');
    await config.update('persistSearchState', false, vscode.ConfigurationTarget.Workspace);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await config.update('panelLocation', 'window', vscode.ConfigurationTarget.Workspace);
    await new Promise((resolve) => setTimeout(resolve, 300));

    scopedDir = path.join(workspaceRoot, 'dir-scope-test', 'sub');
    fs.mkdirSync(scopedDir, { recursive: true });

    inScopeFile = path.join(scopedDir, 'in-scope.ts');
    outScopeFile = path.join(workspaceRoot, 'dir-scope-test-out.ts');

    fs.writeFileSync(inScopeFile, `export const a = "${token}";\n`);
    fs.writeFileSync(outScopeFile, `export const b = "${token}";\n`);
  });

  after(async () => {
    // Restore settings
    const config = vscode.workspace.getConfiguration('rifler');
    await config.update('persistSearchState', undefined, vscode.ConfigurationTarget.Workspace);
    await config.update('panelLocation', undefined, vscode.ConfigurationTarget.Workspace);

    try {
      if (fs.existsSync(outScopeFile)) {
        fs.unlinkSync(outScopeFile);
      }
      const rootDir = path.join(workspaceRoot, 'dir-scope-test');
      if (fs.existsSync(rootDir)) {
        fs.rmSync(rootDir, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup errors
    }
  });

  test('Directory scope should only return results within selected directory', async function () {
    this.timeout(25000);

    await vscode.commands.executeCommand('rifler._openWindowInternal');
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const panel = testHelpers.getCurrentPanel();
    assert.ok(panel, 'Panel should be open');

    // Set directory scope + directory path
    panel.webview.postMessage({ type: '__test_setScope', scope: 'directory' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    panel.webview.postMessage({ type: '__test_setDirectoryInput', value: scopedDir });
    await new Promise((resolve) => setTimeout(resolve, 700));

    const searchDone = waitForMessage<{ type: string; results: any[] }>(panel.webview, '__test_searchCompleted');
    panel.webview.postMessage({ type: '__test_setSearchInput', value: token });

    const msg = await searchDone;
    const results = Array.isArray(msg.results) ? msg.results : [];

    assert.ok(results.length >= 1, 'Expected at least one result in scoped directory');

    const scopedDirResolved = path.resolve(scopedDir);

    for (const r of results) {
      const fsPath = path.resolve(vscode.Uri.parse(r.uri).fsPath);
      assert.ok(
        isWithinDir(fsPath, scopedDirResolved),
        `Result outside directory scope: ${fsPath} (scope: ${scopedDirResolved})`
      );
    }

    const inScopeHit = results.some((r) => path.resolve(vscode.Uri.parse(r.uri).fsPath) === path.resolve(inScopeFile));
    assert.ok(inScopeHit, 'Expected in-scope file to be included');

    const outScopeHit = results.some((r) => path.resolve(vscode.Uri.parse(r.uri).fsPath) === path.resolve(outScopeFile));
    assert.strictEqual(outScopeHit, false, 'Expected out-of-scope file to be excluded');
  });
});
