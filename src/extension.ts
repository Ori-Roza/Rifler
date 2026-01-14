import * as vscode from 'vscode';
import {
  SearchOptions,
  findWorkspaceModules,
  buildSearchRegex
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
import { getWebviewHtml, loadWebviewTemplate } from './webview/webviewUtils';

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

function sendWorkspaceInfo(panel: vscode.WebviewPanel): void {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  let name = '';
  let path = '';

  if (workspaceFolders && workspaceFolders.length > 0) {
    const workspaceFolder = workspaceFolders[0];
    name = workspaceFolder.name;
    path = workspaceFolder.uri.fsPath;
  } else {
    // Fallback for single file mode or no workspace
    name = 'No workspace';
    path = '';
  }

  panel.webview.postMessage({
    type: 'workspaceInfo',
    name,
    path
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
    // Prefer open document content (unsaved edits) before disk
    const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uriString);
    let fileContent: string;
    if (openDoc) {
      fileContent = openDoc.getText();
    } else {
      fileContent = new TextDecoder().decode(
        await vscode.workspace.fs.readFile(uri)
      );
    }
    const fileName = uri.path.split('/').pop() || '';
    const relativePath = vscode.workspace.asRelativePath(uri);

    // Get language ID for icon
    const languageId = getLanguageIdFromFilename(fileName);
    const iconUri = `vscode-icon://file_type_${languageId}`;

    // Find matches in the file using buildSearchRegex from utils
    const regex = buildSearchRegex(query, options);

    const matches: Array<{ line: number; start: number; end: number }> = [];
    const lines = fileContent.split('\n');

    if (regex) {
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
          // Prevent infinite loop for zero-length matches
          if (match[0].length === 0) regex.lastIndex++;
        }
      }
    }

    panel.webview.postMessage({
      type: 'fileContent',
      uri: uriString,
      content: fileContent,
      fileName,
      relativePath,
      iconUri,
      matches
    });
  } catch (error) {
    console.error('Error reading file:', error);
    panel.webview.postMessage({
      type: 'fileContent',
      uri: uriString,
      content: '',
      fileName: '',
      iconUri: 'vscode-icon://file_type_default',
      matches: []
    });
  }
}

function getLanguageIdFromFilename(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const langMap: { [key: string]: string } = {
    'js': 'javascript',
    'jsx': 'javascriptreact',
    'ts': 'typescript',
    'tsx': 'typescriptreact',
    'py': 'python',
    'java': 'java',
    'c': 'c',
    'cpp': 'cpp',
    'h': 'c',
    'hpp': 'cpp',
    'cs': 'csharp',
    'php': 'php',
    'rb': 'ruby',
    'go': 'go',
    'rs': 'rust',
    'swift': 'swift',
    'kt': 'kotlin',
    'kts': 'kotlin',
    'scala': 'scala',
    'html': 'html',
    'htm': 'html',
    'xml': 'xml',
    'css': 'css',
    'scss': 'scss',
    'less': 'less',
    'json': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'md': 'markdown',
    'sh': 'shellscript',
    'bash': 'shellscript',
    'zsh': 'shellscript',
    'sql': 'sql',
    'vue': 'vue',
    'svelte': 'svelte'
  };
  return langMap[ext || ''] || 'file';
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
let panelActivePreview: { uri: string; query: string; options: SearchOptions } | undefined;
let sidebarProviderRef: RiflerSidebarProvider;
let bottomProviderRef: RiflerSidebarProvider;

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
  const sidebarProvider = new RiflerSidebarProvider(context, stateStore, {
    viewType: RiflerSidebarProvider.sidebarViewType,
    logLabel: 'SidebarProvider'
  });
  sidebarProviderRef = sidebarProvider;
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      RiflerSidebarProvider.sidebarViewType,
      sidebarProvider
    )
  );
  viewManager.registerSidebarProvider(sidebarProvider);

  // Register bottom panel provider
  const bottomProvider = new RiflerSidebarProvider(context, stateStore, {
    viewType: RiflerSidebarProvider.bottomViewType,
    logLabel: 'BottomProvider'
  });
  bottomProviderRef = bottomProvider;
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      RiflerSidebarProvider.bottomViewType,
      bottomProvider
    )
  );
  viewManager.registerBottomProvider(bottomProvider);

  // Set up sidebar visibility tracking
  sidebarProvider.setVisibilityCallback((visible: boolean) => {
    stateStore.setSidebarVisible(visible);
  });

  // Set up bottom visibility tracking
  bottomProvider.setVisibilityCallback((visible: boolean) => {
    stateStore.setBottomVisible(visible);
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
      sendWorkspaceInfo: () => {
        const panel = panelManager.panel;
        if (!panel) return;
        sendWorkspaceInfo(panel);
      },
      sendFileContent: async (uri, query, options, _activeIndex) => {
        panelActivePreview = { uri, query, options };
        const panel = panelManager.panel;
        if (!panel) return;
        await sendFileContent(panel, uri, query, options);
      },
      applyEdits: async (uri, content) => {
        // For panel (full-window mode), just save to disk
        // (panel mode is less interactive than sidebar edit mode)
        try {
          const uriObj = vscode.Uri.parse(uri);
          const encoder = new TextEncoder();
          await vscode.workspace.fs.writeFile(uriObj, encoder.encode(content));
        } catch (error) {
          console.error('Error saving file from panel:', error);
        }
      },
      stateStore: stateStore
    });
    // Test signals are echoed in registerCommonHandlers; keep explicit registration for clarity
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
    },
    getBottomVisible: () => stateStore.getBottomVisible(),
    onBottomVisibilityChange: (callback) => {
      stateStore.onBottomVisibilityChange(callback);
    }
  });

  // Set up loop prevention: ignore onDidChangeTextDocument events when we're applying from webview
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      // Skip if this change came from applying edits from the webview
      if (sidebarProvider.isApplyingFromWebview(e.document.uri)) {
        return;
      }

      const panel = panelManager.panel;
      if (!panel || !panel.visible || !panelActivePreview) return;

      if (e.document.uri.toString() !== panelActivePreview.uri) return;

      // Use unsaved text from the document
      const fileName = e.document.uri.path.split('/').pop() || '';
      const relativePath = vscode.workspace.asRelativePath(e.document.uri);
      const languageId = getLanguageIdFromFilename(fileName);
      const iconUri = `vscode-icon://file_type_${languageId}`;

      const fileContent = e.document.getText();
      const regex = buildSearchRegex(panelActivePreview.query, panelActivePreview.options);

      const matches: Array<{ line: number; start: number; end: number }> = [];
      const lines = fileContent.split('\n');

      if (regex) {
        for (let lineNo = 0; lineNo < lines.length; lineNo++) {
          const line = lines[lineNo];
          regex.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = regex.exec(line)) !== null) {
            matches.push({
              line: lineNo,
              start: match.index,
              end: match.index + match[0].length
            });
            if (match[0].length === 0) regex.lastIndex++;
          }
        }
      }

      panel.webview.postMessage({
        type: 'fileContent',
        uri: panelActivePreview.uri,
        content: fileContent,
        fileName,
        relativePath,
        iconUri,
        matches
      });
    })
  );

  // Monitor for configuration changes that might affect panel visibility
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('rifler')) {
        const config = vscode.workspace.getConfiguration('rifler');
        const resultsShowCollapsed = config.get<boolean>('results.showCollapsed', false);
        
        // Send updated config to panel webview if visible
        if (panelManager.panel?.visible) {
          panelManager.panel.webview.postMessage({
            type: 'config',
            resultsShowCollapsed
          });
        }

        // Always refresh the panel title (keybinding hint may have changed)
        panelManager.updateTitleFromConfig();
        
        // Also update sidebar if visible
        sidebarProvider.sendConfigUpdate(resultsShowCollapsed);

        // Also update bottom view if visible
        bottomProvider.sendConfigUpdate(resultsShowCollapsed);
      }
    })
  );

  // Sidebar and panel can now coexist - no need for aggressive closing logic

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
      if (bottomProvider) {
        bottomProvider.postMessage({ type: 'clearState' });
        bottomProvider.postMessage({ type: 'focusSearch' });
        bottomProvider.sendCurrentDirectory();
        bottomProvider.sendModules();
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
  getCurrentPanel: () => panelManager?.panel,
  getStateStore: () => stateStore,
  getSidebarTitle: () => sidebarProviderRef?.__test_getViewTitle(),
  getSidebarDescription: () => sidebarProviderRef?.__test_getViewDescription(),
  getBottomTitle: () => bottomProviderRef?.__test_getViewTitle(),
  getBottomDescription: () => bottomProviderRef?.__test_getViewDescription()
};

// Re-export messaging types for backward compatibility with tests
export type { IncomingMessage, MinimizeMessage, ValidateRegexMessage, ValidateFileMaskMessage };
