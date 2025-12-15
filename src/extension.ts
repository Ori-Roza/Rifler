import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  SearchOptions
} from './utils';
import { RiflerSidebarProvider } from './sidebar/SidebarProvider';
import { ViewManager } from './views/ViewManager';
import { PanelManager } from './services/PanelManager';
import { StateStore } from './state/StateStore';
import { registerCommands } from './commands';
import { registerCommonHandlers } from './messaging/registerCommonHandlers';
import {
  MinimizeMessage,
  ValidateRegexMessage,
  ValidateFileMaskMessage,
  IncomingMessage
} from './messaging/types';

// Webview HTML assembly
export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = getNonce();
  const stylesUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'styles.css')
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'script.js')
  );
  const indexPath = path.join(extensionUri.fsPath, 'out', 'webview', 'index.html');
  const bodyHtml = fs.readFileSync(indexPath, 'utf8');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com; script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!-- TODO: Consider bundling highlight.js locally or add SRI -->
  <link href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" rel="stylesheet" crossorigin="anonymous">
  <link rel="stylesheet" href="${stylesUri}">
</head>
<body>
${bodyHtml}
<!-- TODO: Add integrity attribute with SRI hash or bundle locally -->
<script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js" crossorigin="anonymous"></script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

// Helper functions
async function findWorkspaceModules(): Promise<{ name: string; path: string }[]> {
  const modules: { name: string; path: string }[] = [];
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (!workspaceFolders) {
    return modules;
  }

  for (const folder of workspaceFolders) {
    try {
      const nodeModulesUri = vscode.Uri.joinPath(folder.uri, 'node_modules');
      const stat = await vscode.workspace.fs.stat(nodeModulesUri);

      if (stat.type === vscode.FileType.Directory) {
        const entries = await vscode.workspace.fs.readDirectory(nodeModulesUri);
        for (const [name, type] of entries) {
          if (type === vscode.FileType.Directory && !name.startsWith('.')) {
            modules.push({
              name,
              path: vscode.Uri.joinPath(nodeModulesUri, name).fsPath
            });
          }
        }
      }
    } catch {
      // If node_modules doesn't exist, continue
    }
  }

  return modules;
}

async function sendModulesList(panel: vscode.WebviewPanel): Promise<void> {
  const modules = await findWorkspaceModules();
  panel.webview.postMessage({
    type: 'modulesList',
    modules
  });
}

function sendCurrentDirectory(panel: vscode.WebviewPanel): void {
  const activeEditor = vscode.window.activeTextEditor;
  let directory = '';

  if (activeEditor && activeEditor.document.uri.scheme === 'file') {
    const filePath = activeEditor.document.uri.fsPath;
    const pathParts = filePath.split('/');
    pathParts.pop();
    directory = pathParts.join('/');
  } else {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      directory = workspaceFolders[0].uri.fsPath;
    }
  }

  panel.webview.postMessage({
    type: 'currentDirectory',
    directory
  });
}

async function sendFileContent(
  panel: vscode.WebviewPanel,
  uriString: string,
  query: string,
  options: SearchOptions
): Promise<void> {
  try {
    const uri = vscode.Uri.parse(uriString);
    const fileContent = new TextDecoder().decode(
      await vscode.workspace.fs.readFile(uri)
    );
    const fileName = uri.path.split('/').pop() || '';

    // Find matches in the file
    const regex = new RegExp(
      options.useRegex
        ? query
        : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      `g${options.matchCase ? '' : 'i'}`
    );

    const matches: Array<{ line: number; start: number; end: number }> = [];
    const lines = fileContent.split('\n');

    for (let lineNo = 0; lineNo < lines.length; lineNo++) {
      const line = lines[lineNo];
      let match;
      regex.lastIndex = 0;

      while ((match = regex.exec(line)) !== null) {
        matches.push({
          line: lineNo,
          start: match.index,
          end: match.index + match[0].length
        });
      }
    }

    panel.webview.postMessage({
      type: 'fileContent',
      uri: uriString,
      content: fileContent,
      fileName,
      matches
    });
  } catch (error) {
    console.error('Error reading file:', error);
    panel.webview.postMessage({
      type: 'fileContent',
      uri: uriString,
      content: '',
      fileName: '',
      matches: []
    });
  }
}

async function saveFile(
  panel: vscode.WebviewPanel,
  uriString: string,
  content: string
): Promise<void> {
  try {
    const uri = vscode.Uri.parse(uriString);
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
  } catch (error) {
    console.error('Error saving file:', error);
    panel.webview.postMessage({
      type: 'error',
      message: `Failed to save file: ${error}`
    });
  }
}

async function openLocation(
  uriString: string,
  line: number,
  character: number
): Promise<void> {
  const uri = vscode.Uri.parse(uriString);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

  const position = new vscode.Position(line, character);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(
    new vscode.Range(position, position),
    vscode.TextEditorRevealType.InCenter
  );
}

// State tracking
let stateStore: StateStore;
let viewManager: ViewManager;
let panelManager: PanelManager;

export function activate(context: vscode.ExtensionContext) {
  console.log('Rifler extension is now active');

  const extensionUri = context.extensionUri;

  // Initialize StateStore
  stateStore = new StateStore(context);

  // Initialize PanelManager
  panelManager = new PanelManager(context, extensionUri, getWebviewHtml, stateStore);

  // Initialize ViewManager
  viewManager = new ViewManager(context);

  // Register sidebar provider
  const sidebarProvider = new RiflerSidebarProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      RiflerSidebarProvider.viewType,
      sidebarProvider
    )
  );
  viewManager.registerSidebarProvider(sidebarProvider);

  // Set up sidebar visibility tracking
  sidebarProvider.setVisibilityCallback((visible: boolean) => {
    stateStore.setSidebarVisible(visible);
  });

  // Configure shared/common message handlers for the panel
  panelManager.setHandlerConfigurator((handler) => {
    registerCommonHandlers(handler, {
      postMessage: (msg) => handler.postMessage(msg),
      openLocation: openLocation,
      sendModules: async () => {
        const panel = panelManager.panel;
        if (!panel) return;
        await sendModulesList(panel);
      },
      sendCurrentDirectory: () => {
        const panel = panelManager.panel;
        if (!panel) return;
        sendCurrentDirectory(panel);
      },
      sendFileContent: async (uri, query, options, _activeIndex) => {
        const panel = panelManager.panel;
        if (!panel) return;
        await sendFileContent(panel, uri, query, options);
      },
      saveFile: async (uri, content) => {
        const panel = panelManager.panel;
        if (!panel) return;
        await saveFile(panel, uri, content);
      }
    });
    // No-op handlers for test signals
    handler.registerHandler('__test_searchCompleted', async () => {});
    handler.registerHandler('__test_searchResultsReceived', async () => {});
  });

  // Register all commands
  registerCommands({
    extensionContext: context,
    panelManager,
    viewManager,
    sidebarProvider,
    getSidebarVisible: () => stateStore.getSidebarVisible(),
    onSidebarVisibilityChange: (callback) => {
      stateStore.onSidebarVisibilityChange(callback);
    }
  });

  // If persistence is disabled, clear any prior leftover state on activation
  {
    const cfg = vscode.workspace.getConfiguration('rifler');
    const scope = cfg.get<'workspace' | 'global' | 'off'>('persistenceScope', 'off');
    const persist = cfg.get<boolean>('persistSearchState', false) && scope !== 'off';
    if (!persist) {
      context.workspaceState.update('rifler.sidebarState', undefined);
      context.workspaceState.update('rifler.persistedSearchState', undefined);
      context.globalState.update('rifler.sidebarState', undefined);
      context.globalState.update('rifler.persistedSearchState', undefined);
      stateStore.setSavedState(undefined);
    }
  }

  // Clear persisted state when workspace folders change (for workspace-scoped or off)
  vscode.workspace.onDidChangeWorkspaceFolders(() => {
    const cfg = vscode.workspace.getConfiguration('rifler');
    const scope = cfg.get<'workspace' | 'global' | 'off'>('persistenceScope', 'workspace');
    if (scope === 'workspace' || scope === 'off') {
      context.workspaceState.update('rifler.sidebarState', undefined);
      context.workspaceState.update('rifler.persistedSearchState', undefined);
      stateStore.setSavedState(undefined);
      // Also clear any visible UI state in sidebar/window
      if (sidebarProvider) {
        sidebarProvider.postMessage({ type: 'clearState' });
        sidebarProvider.postMessage({ type: 'focusSearch' });
      }
      const panel = panelManager.panel;
      if (panel) {
        panel.webview.postMessage({ type: 'clearState' });
        panel.webview.postMessage({ type: 'focusSearch' });
      }
    }
  }, undefined, context.subscriptions);

  // Status bar toggle
  const replaceToggleStatusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    99
  );
  replaceToggleStatusBar.text = '$(replace) Toggle Replace';
  replaceToggleStatusBar.tooltip = 'Toggle Replace row in Rifler';
  replaceToggleStatusBar.command = 'rifler.toggleReplace';
  context.subscriptions.push(replaceToggleStatusBar);
  replaceToggleStatusBar.show();
}

export function deactivate() {
  if (panelManager) {
    panelManager.dispose();
  }
}

// Export test helpers
export const testHelpers = {
  getPanelManager: () => panelManager,
  getCurrentPanel: () => panelManager?.panel
};

// Re-export messaging types for backward compatibility with tests
export type { IncomingMessage, MinimizeMessage, ValidateRegexMessage, ValidateFileMaskMessage };
