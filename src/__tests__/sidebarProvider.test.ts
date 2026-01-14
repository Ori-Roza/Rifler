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

  test('includes openKeybindingHint in initial config message', () => {
    const messages: any[] = [];

    // Mock configuration used by _restoreState
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'persistenceScope') return 'workspace';
        if (key === 'replaceInPreviewKeybinding') return 'ctrl+shift+r';
        if (key === 'maxResults') return 10000;
        if (key === 'results.showCollapsed') return false;
        if (key === 'openKeybindingHint') return 'cmd+alt+f';
        return defaultValue;
      })
    });

    const provider = new RiflerSidebarProvider({
      extensionUri: vscode.Uri.parse('/tmp/ext'),
      subscriptions: [],
      workspaceState: { update: jest.fn(), get: jest.fn() },
      globalState: { update: jest.fn(), get: jest.fn() }
    } as any);

    (provider as any)._view = {
      webview: {
        postMessage: (msg: any) => {
          messages.push(msg);
          return Promise.resolve(true);
        }
      }
    } as any;

    (provider as any)._restoreState();

    const configMsg = messages.find(m => m.type === 'config');
    expect(configMsg).toBeDefined();
    expect(configMsg.openKeybindingHint).toBe('cmd+alt+f');
  });
});