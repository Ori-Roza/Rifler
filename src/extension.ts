import * as vscode from 'vscode';
import {
  SearchResult,
  SearchScope,
  SearchOptions,
  validateRegex,
  validateFileMask
} from './utils';
import { performSearch } from './search';
import { replaceOne, replaceAll } from './replacer';
import { RiflerSidebarProvider } from './sidebar/SidebarProvider';
import { ViewManager } from './views/ViewManager';
import { PanelManager } from './services/PanelManager';
import {
  MinimizeMessage,
  ValidateRegexMessage,
  ValidateFileMaskMessage,
  RunSearchMessage,
  OpenLocationMessage,
  GetModulesMessage,
  GetCurrentDirectoryMessage,
  GetFileContentMessage,
  ReplaceOneMessage,
  ReplaceAllMessage,
  WebviewReadyMessage,
  SaveFileMessage,
  IncomingMessage
} from './messaging/types';

// Webview HTML assembly
export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = getNonce();
  const stylesUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'src', 'webview', 'styles.css')
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'src', 'webview', 'script.js')
  );

  const bodyHtml = '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com; script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" rel="stylesheet">
  <link rel="stylesheet" href="${stylesUri}">
</head>
<body>
${bodyHtml}
<script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
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
function getSelectedText(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const selection = editor.selection;
    if (!selection.isEmpty) {
      return editor.document.getText(selection);
    }
  }
  return undefined;
}

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

async function runSearch(
  panel: vscode.WebviewPanel,
  query: string,
  scope: SearchScope,
  options: SearchOptions,
  directoryPath?: string,
  modulePath?: string,
  filePath?: string
): Promise<void> {
  const results = await performSearch(
    query,
    scope,
    options,
    directoryPath,
    modulePath,
    filePath
  );

  panel.webview.postMessage({
    type: 'searchResults',
    results,
    maxResults: 10000
  });
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
let sidebarVisible: boolean = false;
let viewManager: ViewManager;
let panelManager: PanelManager;

export function activate(context: vscode.ExtensionContext) {
  console.log('Rifler extension is now active');

  const extensionUri = context.extensionUri;

  // Initialize PanelManager
  panelManager = new PanelManager(context, extensionUri, getWebviewHtml);

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
    sidebarVisible = visible;
  });

  // Register message handlers with PanelManager
  panelManager.registerMessageHandler('runSearch', async (message: RunSearchMessage) => {
    const panel = panelManager.panel;
    if (!panel) return;

    await runSearch(
      panel,
      message.query,
      message.scope,
      message.options,
      message.directoryPath,
      message.modulePath,
      message.filePath
    );
  });

  panelManager.registerMessageHandler('openLocation', async (message: OpenLocationMessage) => {
    await openLocation(message.uri, message.line, message.character);
  });

  panelManager.registerMessageHandler('getModules', async (message: GetModulesMessage) => {
    const panel = panelManager.panel;
    if (!panel) return;
    await sendModulesList(panel);
  });

  panelManager.registerMessageHandler('getCurrentDirectory', async (message: GetCurrentDirectoryMessage) => {
    const panel = panelManager.panel;
    if (!panel) return;
    sendCurrentDirectory(panel);
  });

  panelManager.registerMessageHandler('getFileContent', async (message: GetFileContentMessage) => {
    const panel = panelManager.panel;
    if (!panel) return;
    await sendFileContent(panel, message.uri, message.query, message.options);
  });

  panelManager.registerMessageHandler('saveFile', async (message: SaveFileMessage) => {
    const panel = panelManager.panel;
    if (!panel) return;
    await saveFile(panel, message.uri, message.content);
  });

  panelManager.registerMessageHandler('replaceOne', async (message: ReplaceOneMessage) => {
    await replaceOne(
      message.uri,
      message.line,
      message.character,
      message.length,
      message.replaceText
    );
  });

  panelManager.registerMessageHandler('replaceAll', async (message: ReplaceAllMessage) => {
    await replaceAll(
      message.query,
      message.replaceText,
      message.scope,
      message.options,
      message.directoryPath,
      message.modulePath,
      message.filePath,
      async () => {
        const panel = panelManager.panel;
        if (panel) {
          await runSearch(
            panel,
            message.query,
            message.scope,
            message.options,
            message.directoryPath,
            message.modulePath,
            message.filePath
          );
        }
      }
    );
  });

  panelManager.registerMessageHandler('validateRegex', async (message: ValidateRegexMessage) => {
    const panel = panelManager.panel;
    if (!panel) return;

    const regexValidation = validateRegex(message.pattern, message.useRegex);
    panel.webview.postMessage({
      type: 'validationResult',
      field: 'regex',
      isValid: regexValidation.isValid,
      error: regexValidation.error
    });
  });

  panelManager.registerMessageHandler('validateFileMask', async (message: ValidateFileMaskMessage) => {
    const panel = panelManager.panel;
    if (!panel) return;

    const maskValidation = validateFileMask(message.fileMask);
    panel.webview.postMessage({
      type: 'validationResult',
      field: 'fileMask',
      isValid: maskValidation.isValid,
      message: maskValidation.message,
      fallbackToAll: maskValidation.fallbackToAll
    });
  });

  // Test message handlers
  panelManager.registerMessageHandler('__test_searchCompleted', async () => {});
  panelManager.registerMessageHandler('__test_searchResultsReceived', async () => {});
  panelManager.registerMessageHandler('error', async () => {});
  panelManager.registerMessageHandler('__diag_ping', async () => {
    console.log('Received webview diag ping');
  });

  // Register commands
  const openCommand = vscode.commands.registerCommand('rifler.open', () => {
    const config = vscode.workspace.getConfiguration('rifler');
    const viewMode = config.get<'sidebar' | 'tab'>('viewMode', 'sidebar');

    if (viewMode === 'sidebar') {
      if (sidebarVisible) {
        vscode.commands.executeCommand('workbench.action.closeSidebar');
      } else {
        const selectedText = getSelectedText();
        viewManager.openView({
          forcedLocation: 'sidebar',
          initialQuery: selectedText
        });
      }
    } else {
      if (panelManager.panel) {
        panelManager.panel.dispose();
      } else if (panelManager.minimized) {
        panelManager.restore();
      } else {
        const selectedText = getSelectedText();
        panelManager.createOrShowPanel({ initialQuery: selectedText });
      }
    }
  });

  const openReplaceCommand = vscode.commands.registerCommand('rifler.openReplace', () => {
    const config = vscode.workspace.getConfiguration('rifler');
    const viewMode = config.get<'sidebar' | 'tab'>('viewMode', 'sidebar');
    const selectedText = getSelectedText();

    if (viewMode === 'sidebar') {
      viewManager.openView({
        forcedLocation: 'sidebar',
        showReplace: true,
        initialQuery: selectedText
      });
    } else {
      panelManager.createOrShowPanel({
        showReplace: true,
        initialQuery: selectedText
      });
    }
  });

  const openSidebarCommand = vscode.commands.registerCommand('rifler.openSidebar', () => {
    const selectedText = getSelectedText();
    viewManager.openView({
      forcedLocation: 'sidebar',
      initialQuery: selectedText
    });
  });

  const openSidebarReplaceCommand = vscode.commands.registerCommand(
    'rifler.openSidebarReplace',
    () => {
      const selectedText = getSelectedText();
      viewManager.openView({
        forcedLocation: 'sidebar',
        showReplace: true,
        initialQuery: selectedText
      });
    }
  );

  const toggleViewCommand = vscode.commands.registerCommand('rifler.toggleView', () =>
    viewManager.switchView()
  );

  const toggleReplaceCommand = vscode.commands.registerCommand(
    'rifler.toggleReplace',
    () => {
      if (panelManager.panel) {
        panelManager.panel.webview.postMessage({ type: 'toggleReplace' });
        return;
      }
      if (sidebarVisible) {
        sidebarProvider.postMessage({ type: 'toggleReplace' });
      }
    }
  );

  const restoreCommand = vscode.commands.registerCommand('rifler.restore', () => {
    panelManager.restore();
  });

  const minimizeCommand = vscode.commands.registerCommand('rifler.minimize', () => {
    if (panelManager.panel) {
      panelManager.panel.webview.postMessage({ type: 'requestStateForMinimize' });
    }
  });

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

  // Test-only command
  const testEnsureOpenCommand = vscode.commands.registerCommand(
    '__test_ensurePanelOpen',
    () => {
      if (!panelManager.panel) {
        panelManager.createOrShowPanel();
      }
    }
  );

  // Internal commands for ViewManager
  const openWindowInternalCommand = vscode.commands.registerCommand(
    'rifler._openWindowInternal',
    (options?: { initialQuery?: string; showReplace?: boolean }) => {
      panelManager.createOrShowPanel({
        showReplace: options?.showReplace ?? false,
        initialQuery: options?.initialQuery
      });
    }
  );

  const closeWindowInternalCommand = vscode.commands.registerCommand(
    'rifler._closeWindowInternal',
    () => {
      if (panelManager.panel) {
        panelManager.panel.dispose();
      }
    }
  );

  context.subscriptions.push(
    openCommand,
    openReplaceCommand,
    openSidebarCommand,
    openSidebarReplaceCommand,
    toggleViewCommand,
    toggleReplaceCommand,
    restoreCommand,
    minimizeCommand,
    testEnsureOpenCommand,
    openWindowInternalCommand,
    closeWindowInternalCommand
  );
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
