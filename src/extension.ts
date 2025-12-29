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
    const fileContent = new TextDecoder().decode(
      await vscode.workspace.fs.readFile(uri)
    );
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
      sendWorkspaceInfo: () => {
        const panel = panelManager.panel;
        if (!panel) return;
        sendWorkspaceInfo(panel);
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
      },
      stateStore: stateStore
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

  // Safety net: close sidebar if Rifler tab is active or visible
  // This handles cases like dragging the tab or switching tab groups
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      if (panelManager.panel?.active) {
        setTimeout(() => {
          vscode.commands.executeCommand('workbench.action.closeSidebar');
        }, 100);
      }
    }),
    vscode.window.tabGroups.onDidChangeTabs(() => {
      if (panelManager.panel?.visible) {
        setTimeout(() => {
          vscode.commands.executeCommand('workbench.action.closeSidebar');
        }, 100);
      }
    }),
    vscode.window.tabGroups.onDidChangeTabGroups(() => {
      if (panelManager.panel?.visible) {
        setTimeout(() => {
          vscode.commands.executeCommand('workbench.action.closeSidebar');
        }, 100);
      }
    }),
    // Monitor for configuration changes that might affect panel visibility
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
          
          setTimeout(() => {
            vscode.commands.executeCommand('workbench.action.closeSidebar');
          }, 100);
        }
        
        // Also update sidebar if visible
        sidebarProvider.sendConfigUpdate(resultsShowCollapsed);
      }
    })
  );

  // Set up an interval to continuously ensure sidebar is closed while panel is visible
  // This handles edge cases where VS Code auto-shows sidebar due to resize/layout changes
  const sidebarCloserInterval = setInterval(() => {
    if (panelManager.panel?.visible) {
      try {
        vscode.commands.executeCommand('workbench.action.closeSidebar');
      } catch (err) {
        // Ignore errors from closeSidebar command
      }
    }
  }, 500);
  
  // Mark timer as not preventing process exit (important for test teardown)
  if (sidebarCloserInterval.unref) {
    sidebarCloserInterval.unref();
  }

  context.subscriptions.push({
    dispose: () => clearInterval(sidebarCloserInterval)
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
  getCurrentPanel: () => {
    if (!panelManager?.panel) {
      // Ensure a panel exists for tests; create if missing
      panelManager?.createOrShowPanel();
    }
    return panelManager?.panel;
  },
  getStateStore: () => stateStore
};

// Re-export messaging types for backward compatibility with tests
export type { IncomingMessage, MinimizeMessage, ValidateRegexMessage, ValidateFileMaskMessage };
