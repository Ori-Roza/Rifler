import * as vscode from 'vscode';
import { RiflerSidebarProvider } from '../sidebar/SidebarProvider';

jest.mock('vscode');

describe('RiflerSidebarProvider - current directory default', () => {
  const originalWorkspaceFolders = vscode.workspace.workspaceFolders;
  const originalActiveEditor = vscode.window.activeTextEditor;

  afterEach(() => {
    // Restore vscode mocks to avoid cross-test leakage
    (vscode.workspace as any).workspaceFolders = originalWorkspaceFolders;
    (vscode.window as any).activeTextEditor = originalActiveEditor;
  });

  test('falls back to first workspace folder when no active editor', () => {
    const workspacePath = '/tmp/workspace-default';
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: workspacePath } } as any];
    (vscode.window as any).activeTextEditor = undefined;

    const messages: any[] = [];

    const provider = new RiflerSidebarProvider({
      extensionUri: vscode.Uri.parse('/tmp/ext'),
      globalState: { update: jest.fn(), get: jest.fn() },
      subscriptions: []
    } as any);

    // Inject a mock view so we can capture postMessage payloads
    (provider as any)._view = {
      webview: {
        postMessage: (msg: any) => {
          messages.push(msg);
          return Promise.resolve(true);
        }
      }
    } as any;

    (provider as any)._sendCurrentDirectory();

    const currentDirMsg = messages.find(m => m.type === 'currentDirectory');
    expect(currentDirMsg).toBeDefined();
    expect(currentDirMsg.directory).toBe(workspacePath);
  });
});