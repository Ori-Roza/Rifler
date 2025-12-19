import * as vscode from 'vscode';
import {
  SearchOptions,
  findWorkspaceModules
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

// Cache for webview HTML template
let cachedBodyHtml: string | null = null;

// Webview HTML assembly
export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  if (!cachedBodyHtml) {
    throw new Error('Webview HTML template not loaded. Call loadWebviewTemplate() during activation.');
  }
  
  const nonce = getNonce();
  const stylesUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'styles.css')
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'script.js')
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!-- TODO: Consider bundling highlight.js locally or add SRI -->
  <link href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" rel="stylesheet" crossorigin="anonymous">
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="${stylesUri}">
</head>
<body>
${cachedBodyHtml}
<!-- TODO: Add integrity attribute with SRI hash or bundle locally -->
<script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js" crossorigin="anonymous"></script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

// Load and cache the webview HTML template
async function loadWebviewTemplate(extensionUri: vscode.Uri): Promise<void> {
  try {
    const indexUri = vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'index.html');
    const content = await vscode.workspace.fs.readFile(indexUri);
    cachedBodyHtml = new TextDecoder('utf-8').decode(content);
  } catch (error) {
    console.error('Failed to load webview template:', error);
    // Provide a minimal fallback template
    cachedBodyHtml = '<div id="root"></div>';
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

async function sendModulesList(panel: vscode.WebviewPanel): Promise<void> {
  try {
    const modules = await findWorkspaceModules();
    panel.webview.postMessage({
      type: 'modulesList',
      modules
    });
  } catch (error) {
    console.error('Error sending modules list:', error);
  }
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
    const relativePath = vscode.workspace.asRelativePath(uri);

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
      relativePath,
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

export async function activate(context: vscode.ExtensionContext) {
  console.log('Rifler extension is now active');

  const extensionUri = context.extensionUri;

  // Load webview HTML template (async, cached)
  await loadWebviewTemplate(extensionUri);

  // Initialize StateStore
  stateStore = new StateStore(context);

  // Detect workspace change to clear state if needed for "fresh search" on project change
  try {
    const lastWorkspaceFolders = context.globalState.get<string[]>('rifler.lastWorkspaceFolders');
    const currentWorkspaceFolders = vscode.workspace.workspaceFolders?.map(f => f.uri.toString()) || [];
    const foldersChanged = JSON.stringify(lastWorkspaceFolders) !== JSON.stringify(currentWorkspaceFolders);

    if (foldersChanged) {
      context.globalState.update('rifler.lastWorkspaceFolders', currentWorkspaceFolders);
      // Clear persisted state on workspace change to ensure a fresh start
      context.workspaceState.update('rifler.sidebarState', undefined);
      context.workspaceState.update('rifler.persistedSearchState', undefined);
      if (stateStore) {
        stateStore.setSavedState(undefined);
      }
    }
  } catch (error) {
    console.error('Error detecting workspace change on activation:', error);
  }

  // Initialize PanelManager
  panelManager = new PanelManager(context, extensionUri, getWebviewHtml, stateStore);

  // Initialize ViewManager
  viewManager = new ViewManager(context);
  viewManager.setStateStore(stateStore);
  viewManager.setPanelManager(panelManager);

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
    const scope = cfg.get<'workspace' | 'global' | 'off'>('persistenceScope', 'workspace');
    const persist = cfg.get<boolean>('persistSearchState', true) && scope !== 'off';
    if (!persist) {
      context.workspaceState.update('rifler.sidebarState', undefined);
      context.workspaceState.update('rifler.persistedSearchState', undefined);
      context.globalState.update('rifler.sidebarState', undefined);
      context.globalState.update('rifler.persistedSearchState', undefined);
      stateStore.setSavedState(undefined);
    }
  }

  // Clear persisted state when workspace folders change to ensure a fresh search
  vscode.workspace.onDidChangeWorkspaceFolders(() => {
    try {
      // Update last workspace folders to keep track of changes
      const currentWorkspaceFolders = vscode.workspace.workspaceFolders?.map(f => f.uri.toString()) || [];
      context.globalState.update('rifler.lastWorkspaceFolders', currentWorkspaceFolders);

      // Clear persisted state
      context.workspaceState.update('rifler.sidebarState', undefined);
      context.workspaceState.update('rifler.persistedSearchState', undefined);
      if (stateStore) {
        stateStore.setSavedState(undefined);
      }

      // Also clear any visible UI state in sidebar/window
      if (sidebarProvider) {
        sidebarProvider.postMessage({ type: 'clearState' });
        sidebarProvider.postMessage({ type: 'focusSearch' });
        sidebarProvider.sendCurrentDirectory();
        sidebarProvider.sendModules();
      }
      if (panelManager) {
        const panel = panelManager.panel;
        if (panel) {
          panel.webview.postMessage({ type: 'clearState' });
          panel.webview.postMessage({ type: 'focusSearch' });
          sendCurrentDirectory(panel);
          sendModulesList(panel);
        }
      }
    } catch (error) {
      console.error('Error handling workspace change:', error);
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
