import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SearchResult, SearchScope, SearchOptions, buildSearchRegex, matchesFileMask } from './utils';
import { performSearch } from './search';
import { replaceOne, replaceAll } from './replacer';

// ============================================================================
// Types
// ============================================================================

/** Represents a module in the workspace */
interface ModuleInfo {
  name: string;
  path: string;
}

/** Messages from Webview to Extension */
interface RunSearchMessage {
  type: 'runSearch';
  query: string;
  scope: SearchScope;
  directoryPath?: string;
  modulePath?: string;
  filePath?: string;
  options: SearchOptions;
}

interface ReplaceOneMessage {
  type: 'replaceOne';
  uri: string;
  line: number;
  character: number;
  length: number;
  replaceText: string;
}

interface ReplaceAllMessage {
  type: 'replaceAll';
  query: string;
  replaceText: string;
  scope: SearchScope;
  directoryPath?: string;
  modulePath?: string;
  filePath?: string;
  options: SearchOptions;
}

interface OpenLocationMessage {
  type: 'openLocation';
  uri: string;
  line: number;
  character: number;
}

interface GetModulesMessage {
  type: 'getModules';
}

interface GetCurrentDirectoryMessage {
  type: 'getCurrentDirectory';
}

interface GetFileContentMessage {
  type: 'getFileContent';
  uri: string;
  query: string;
  options: SearchOptions;
}

interface SaveFileMessage {
  type: 'saveFile';
  uri: string;
  content: string;
}

interface WebviewReadyMessage {
  type: 'webviewReady';
}

// Test-only message types
interface TestSearchCompletedMessage {
  type: '__test_searchCompleted';
  results: SearchResult[];
}

interface TestSearchResultsReceivedMessage {
  type: '__test_searchResultsReceived';
  results: SearchResult[];
}

interface TestErrorMessage {
  type: 'error';
  message: string;
  source?: string;
  lineno?: number;
  colno?: number;
  error?: unknown;
}

type WebviewMessage = RunSearchMessage | OpenLocationMessage | GetModulesMessage | GetCurrentDirectoryMessage | GetFileContentMessage | ReplaceOneMessage | ReplaceAllMessage | WebviewReadyMessage | SaveFileMessage | TestSearchCompletedMessage | TestSearchResultsReceivedMessage | TestErrorMessage;

/** Messages from Extension to Webview */
interface SearchResultsMessage {
  type: 'searchResults';
  results: SearchResult[];
}

interface ModulesListMessage {
  type: 'modulesList';
  modules: ModuleInfo[];
}

interface CurrentDirectoryMessage {
  type: 'currentDirectory';
  directory: string;
}

interface FileContentMessage {
  type: 'fileContent';
  uri: string;
  content: string;
  fileName: string;
  matches: Array<{ line: number; start: number; end: number }>;
}

// ============================================================================
// Extension Activation
// ============================================================================

let currentPanel: vscode.WebviewPanel | undefined;

// Export for testing
export { currentPanel as __test_currentPanel };

export function activate(context: vscode.ExtensionContext) {
  console.log('Rifler extension is now active');

  const openCommand = vscode.commands.registerCommand(
    'rifler.open',
    () => openSearchPanel(context)
  );

  const openReplaceCommand = vscode.commands.registerCommand(
    'rifler.openReplace',
    () => openSearchPanel(context, true)
  );

  context.subscriptions.push(openCommand, openReplaceCommand);
}

export function deactivate() {
  if (currentPanel) {
    currentPanel.dispose();
  }
}

// ============================================================================
// Panel Management
// ============================================================================

function openSearchPanel(context: vscode.ExtensionContext, showReplace: boolean = false): void {
  // If panel already exists, reveal it
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside);
    if (showReplace) {
      currentPanel.webview.postMessage({ type: 'showReplace' });
    }
    return;
  }

  // Create a new webview panel - positioned beside current editor
  currentPanel = vscode.window.createWebviewPanel(
    'rifler',
    'Rifler',
    {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: true
    },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: []
    }
  );

  currentPanel.webview.html = getWebviewHtml(currentPanel.webview);

  // Store the replace mode state to send it when webview is ready
  const shouldShowReplace = showReplace;

  currentPanel.webview.onDidReceiveMessage(
    async (message: WebviewMessage) => {
      switch (message.type) {
        case 'webviewReady':
          // Send configuration to webview
          const config = vscode.workspace.getConfiguration('rifler');
          const replaceKeybinding = config.get<string>('replaceInPreviewKeybinding', 'ctrl+shift+r');
          currentPanel?.webview.postMessage({ type: 'config', replaceKeybinding });
          
          if (shouldShowReplace) {
            currentPanel?.webview.postMessage({ type: 'showReplace' });
          }
          break;
        case 'runSearch':
          console.log('Received runSearch message:', message);
          await runSearch(
            currentPanel!,
            message.query,
            message.scope,
            message.options,
            message.directoryPath,
            message.modulePath,
            message.filePath
          );
          break;
        case 'openLocation':
          await openLocation(message.uri, message.line, message.character);
          break;
        case 'getModules':
          await sendModulesList(currentPanel!);
          break;
        case 'getCurrentDirectory':
          sendCurrentDirectory(currentPanel!);
          break;
        case 'getFileContent':
          await sendFileContent(currentPanel!, message.uri, message.query, message.options);
          break;
        case 'saveFile':
          await saveFile(currentPanel!, message.uri, message.content);
          break;
        case 'replaceOne':
          await replaceOne(message.uri, message.line, message.character, message.length, message.replaceText);
          break;
        case 'replaceAll':
          await replaceAll(
            message.query,
            message.replaceText,
            message.scope,
            message.options,
            message.directoryPath,
            message.modulePath,
            message.filePath,
            async () => {
              if (currentPanel) {
                await runSearch(
                  currentPanel,
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
          break;
        // Test message handling - just ignore, the test listens to raw messages
        case '__test_searchCompleted':
        case '__test_searchResultsReceived':
        case 'error':
          // These messages are handled by the test listener directly
          break;
      }
    },
    undefined,
    context.subscriptions
  );

  currentPanel.onDidDispose(
    () => {
      currentPanel = undefined;
    },
    null,
    context.subscriptions
  );
}

// ============================================================================
// Module Detection
// ============================================================================

async function findWorkspaceModules(): Promise<ModuleInfo[]> {
  const modules: ModuleInfo[] = [];
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (!workspaceFolders) {
    return modules;
  }

  for (const folder of workspaceFolders) {
    modules.push({
      name: folder.name,
      path: folder.uri.fsPath
    });
  }

  const moduleIndicators = [
    '**/package.json',
    '**/tsconfig.json',
    '**/pyproject.toml',
    '**/Cargo.toml',
    '**/go.mod',
    '**/pom.xml'
  ];

  for (const pattern of moduleIndicators) {
    const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 100);

    for (const file of files) {
      const moduleDir = path.dirname(file.fsPath);

      if (!modules.some(m => m.path === moduleDir)) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(file);
        const relativePath = workspaceFolder
          ? path.relative(workspaceFolder.uri.fsPath, moduleDir)
          : path.basename(moduleDir);

        modules.push({
          name: relativePath || path.basename(moduleDir),
          path: moduleDir
        });
      }
    }
  }

  modules.sort((a, b) => a.name.localeCompare(b.name));
  return modules;
}

async function sendModulesList(panel: vscode.WebviewPanel): Promise<void> {
  const modules = await findWorkspaceModules();
  panel.webview.postMessage({ type: 'modulesList', modules } as ModulesListMessage);
}

function sendCurrentDirectory(panel: vscode.WebviewPanel): void {
  let directory = '';

  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    directory = path.dirname(activeEditor.document.uri.fsPath);
  } else {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      directory = workspaceFolders[0].uri.fsPath;
    }
  }

  panel.webview.postMessage({ type: 'currentDirectory', directory } as CurrentDirectoryMessage);
}

// ============================================================================
// File Content for Preview
// ============================================================================

async function sendFileContent(panel: vscode.WebviewPanel, uriString: string, query: string, options: SearchOptions): Promise<void> {
  try {
    const uri = vscode.Uri.parse(uriString);
    const content = await fs.promises.readFile(uri.fsPath, 'utf-8');
    const fileName = path.basename(uri.fsPath);
    
    // Find all matches in the file
    const matches: Array<{ line: number; start: number; end: number }> = [];
    const lines = content.split('\n');
    const regex = buildSearchRegex(query, options);
    
    if (regex) {
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        let match: RegExpExecArray | null;
        
        // Reset regex for each line (since it may have the global flag)
        regex.lastIndex = 0;
        
        while ((match = regex.exec(line)) !== null) {
          matches.push({
            line: lineIndex,
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
      content,
      fileName,
      matches
    } as FileContentMessage);
  } catch (error) {
    console.error('Error reading file:', error);
  }
}

async function saveFile(panel: vscode.WebviewPanel, uriString: string, content: string): Promise<void> {
  try {
    const uri = vscode.Uri.parse(uriString);
    const edit = new vscode.WorkspaceEdit();
    
    // Replace entire document content
    const doc = await vscode.workspace.openTextDocument(uri);
    const fullRange = new vscode.Range(
      doc.positionAt(0),
      doc.positionAt(doc.getText().length)
    );
    
    edit.replace(uri, fullRange, content);
    const success = await vscode.workspace.applyEdit(edit);
    
    if (success) {
      await doc.save();
      vscode.window.showInformationMessage(`Saved ${path.basename(uri.fsPath)}`);
    } else {
      vscode.window.showErrorMessage(`Failed to save ${path.basename(uri.fsPath)}`);
    }
  } catch (error) {
    console.error('Error saving file:', error);
    vscode.window.showErrorMessage(`Could not save file: ${error}`);
  }
}

// ============================================================================
// Search Implementation
// ============================================================================

async function runSearch(
  panel: vscode.WebviewPanel,
  query: string,
  scope: SearchScope,
  options: SearchOptions,
  directoryPath?: string,
  modulePath?: string,
  filePath?: string
): Promise<void> {
  if (scope === 'project' && (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0)) {
    vscode.window.showWarningMessage('No workspace folder open. Please open a folder to search in project scope.');
    panel.webview.postMessage({
      type: 'searchResults',
      results: []
    } as SearchResultsMessage);
    return;
  }

  // Get the currently active editor's file to exclude from results (like PyCharm)
  const activeEditor = vscode.window.activeTextEditor;
  const activeFileUri = activeEditor?.document.uri.toString();

  let results = await performSearch(query, scope, options, directoryPath, modulePath, filePath);
  
  // Exclude the active file from results
  if (activeFileUri) {
    results = results.filter(r => r.uri !== activeFileUri);
  }
  
  console.log('Sending searchResults to webview:', results.length, 'results');
  panel.webview.postMessage({
    type: 'searchResults',
    results
  } as SearchResultsMessage);
}

// ============================================================================
// Location Opening
// ============================================================================

async function openLocation(uriString: string, line: number, character: number): Promise<void> {
  try {
    const uri = vscode.Uri.parse(uriString);
    const document = await vscode.workspace.openTextDocument(uri);

    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.One,
      preview: false,
      preserveFocus: false
    });

    const position = new vscode.Position(line, character);
    const selection = new vscode.Selection(position, position);

    editor.selection = selection;
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  } catch (error) {
    console.error('Error opening location:', error);
    vscode.window.showErrorMessage(`Could not open file: ${error}`);
  }
}

// ============================================================================
// Webview HTML Generation
// ============================================================================

function getWebviewHtml(webview: vscode.Webview): string {
  const nonce = getNonce();

  return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com; style-src ${webview.cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com;">
  <title>Find in Files</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/vs2015.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ===== Search Header ===== */
    .search-header {
      padding: 12px;
      border-bottom: 1px solid var(--vscode-widget-border, #444);
      background-color: var(--vscode-sideBar-background);
    }

    .search-row {
      display: flex;
      gap: 8px;
      margin-bottom: 8px;
      align-items: center;
    }

    .search-row button {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: 1px solid var(--vscode-widget-border);
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 2px;
      font-size: 11px;
    }
    
    .search-row button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    #replace-row {
      display: none;
    }

    #replace-row.visible {
      display: flex;
    }

    .search-label {
      font-size: 11px;
      font-weight: 500;
      color: var(--vscode-descriptionForeground);
      min-width: 50px;
    }

    #query, #replace-input {
      flex: 1;
      padding: 6px 10px;
      font-size: 13px;
      font-family: var(--vscode-editor-font-family);
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #444));
      border-radius: 3px;
      outline: none;
    }

    #query:focus, #replace-input:focus {
      border-color: var(--vscode-focusBorder);
    }

    /* ===== Scope Selection ===== */
    .scope-row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }

    .scope-tabs {
      display: flex;
      gap: 0;
      border: 1px solid var(--vscode-widget-border, #444);
      border-radius: 3px;
      overflow: hidden;
    }

    .scope-tab {
      padding: 4px 10px;
      font-size: 11px;
      background-color: transparent;
      color: var(--vscode-foreground);
      border: none;
      border-right: 1px solid var(--vscode-widget-border, #444);
      cursor: pointer;
    }

    .scope-tab:last-child {
      border-right: none;
    }

    .scope-tab:hover {
      background-color: var(--vscode-list-hoverBackground);
    }

    .scope-tab.active {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .scope-input {
      flex: 1;
      min-width: 150px;
      display: none;
    }

    .scope-input.visible {
      display: block;
    }

    .scope-input input,
    .scope-input select {
      width: 100%;
      padding: 4px 8px;
      font-size: 11px;
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #444);
      border-radius: 3px;
    }

    /* ===== Main Content ===== */
    .main-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
    }

    /* ===== Results List ===== */
    .results-panel {
      height: 40%;
      min-height: 100px;
      display: flex;
      flex-direction: column;
      border-bottom: 1px solid var(--vscode-widget-border, #444);
    }

    .results-header {
      padding: 6px 12px;
      font-size: 11px;
      font-weight: 600;
      color: var(--vscode-sideBarSectionHeader-foreground);
      background-color: var(--vscode-sideBarSectionHeader-background);
      border-bottom: 1px solid var(--vscode-widget-border, #444);
    }

    .results-list {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
    }

    .result-item {
      padding: 4px 12px;
      cursor: pointer;
      border-bottom: 1px solid var(--vscode-widget-border, #333);
      font-size: 12px;
    }

    .result-item:hover {
      background-color: var(--vscode-list-hoverBackground);
    }

    .result-item.active {
      background-color: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }

    .result-file {
      display: flex;
      align-items: baseline;
      gap: 6px;
    }

    .result-filename {
      font-weight: 600;
      color: var(--vscode-textLink-foreground);
    }

    .result-location {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
    }

    .result-preview {
      font-size: 11px;
      font-family: var(--vscode-editor-font-family, monospace);
      color: var(--vscode-foreground);
      opacity: 0.8;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 2px;
    }

    .result-preview .match {
      background-color: var(--vscode-editor-findMatchHighlightBackground, rgba(255, 200, 0, 0.4));
      border-radius: 2px;
    }

    /* ===== Preview Panel ===== */
    .preview-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }

    .preview-header {
      padding: 6px 12px;
      font-size: 11px;
      font-weight: 600;
      color: var(--vscode-sideBarSectionHeader-foreground);
      background-color: var(--vscode-sideBarSectionHeader-background);
      border-bottom: 1px solid var(--vscode-widget-border, #444);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .preview-actions {
      display: flex;
      gap: 8px;
    }

    .preview-actions button {
      background: transparent;
      border: 1px solid var(--vscode-widget-border);
      color: var(--vscode-foreground);
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 2px;
      font-size: 10px;
    }

    .preview-actions button:hover {
      background: var(--vscode-toolbar-hoverBackground);
    }

    .preview-actions button.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-background);
    }

    .preview-filename {
      color: var(--vscode-textLink-foreground);
    }

    .preview-content {
      flex: 1;
      overflow: auto;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      line-height: 1.5;
      background-color: var(--vscode-editor-background);
      position: relative;
      cursor: text;
    }

    /* ===== Editor & Highlighting ===== */
    .editor-container {
      position: relative;
      flex: 1;
      overflow: hidden;
      background-color: var(--vscode-editor-background);
      display: none;
    }

    .editor-container.visible {
      display: flex;
      flex-direction: column;
    }

    .editor-wrapper {
      position: relative;
      flex: 1;
      overflow: hidden;
      display: flex;
    }

    .editor-line-numbers {
      flex-shrink: 0;
      width: 50px;
      padding: 10px 8px 10px 0;
      text-align: right;
      font-family: var(--vscode-editor-font-family, 'Consolas', 'Courier New', monospace);
      font-size: 13px;
      line-height: 20px;
      color: var(--vscode-editorLineNumber-foreground, #858585);
      background-color: var(--vscode-editor-background);
      user-select: none;
      overflow: hidden;
      box-sizing: border-box;
    }

    .editor-line-numbers div {
      height: 20px;
    }

    .editor-content-wrapper {
      position: relative;
      flex: 1;
      overflow: hidden;
    }

    #file-editor, #editor-backdrop {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 10px;
      border: none;
      font-family: var(--vscode-editor-font-family, 'Consolas', 'Courier New', monospace);
      font-size: 13px;
      line-height: 20px;
      letter-spacing: 0px;
      box-sizing: border-box;
      overflow: auto;
      white-space: pre-wrap;
      word-wrap: break-word;
      tab-size: 4;
    }

    #file-editor {
      z-index: 2;
      color: transparent;
      background: transparent;
      caret-color: var(--vscode-editor-foreground);
      resize: none;
      outline: none;
    }

    #editor-backdrop {
      z-index: 1;
      pointer-events: none;
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }

    /* Syntax Highlighting Colors */
    .hl-keyword { color: #569cd6; } /* Blue */
    .hl-string { color: #ce9178; } /* Orange/Red */
    .hl-comment { color: #6a9955; font-style: italic; } /* Green */
    .hl-number { color: #b5cea8; } /* Light Green */
    .hl-function { color: #dcdcaa; } /* Yellow */
    .hl-type { color: #4ec9b0; } /* Teal */
    .hl-property { color: #9cdcfe; } /* Light Blue */
    .hl-operator { color: #d4d4d4; } /* Light Gray */
    .hl-match { background-color: rgba(255, 200, 0, 0.4); }

    /* Replace Widget */
    .replace-widget {
      position: absolute;
      top: 10px;
      right: 10px;
      z-index: 10;
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-widget-border);
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      padding: 8px;
      border-radius: 4px;
      width: 320px;
      display: none;
    }

    .replace-widget.visible {
      display: block;
    }

    .replace-widget-row {
      display: flex;
      gap: 6px;
      align-items: center;
      margin-bottom: 6px;
    }

    .replace-widget-row:last-child {
      margin-bottom: 0;
    }

    .replace-widget-label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      min-width: 50px;
    }

    .replace-widget input {
      flex: 1;
      padding: 4px 8px;
      font-size: 12px;
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #444);
      border-radius: 2px;
    }

    .replace-widget input:focus {
      border-color: var(--vscode-focusBorder);
      outline: none;
    }

    .replace-widget-actions {
      display: flex;
      gap: 4px;
      justify-content: flex-end;
      margin-top: 4px;
    }

    .replace-widget .nav-btn {
      padding: 2px 6px;
      font-size: 10px;
      min-width: 20px;
    }

    .replace-widget button {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: 1px solid var(--vscode-widget-border);
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 2px;
      font-size: 11px;
    }

    .replace-widget button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .replace-widget button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-background);
    }

    .replace-widget button.primary:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .replace-match-count {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-left: auto;
    }

    #file-editor-old {
      width: 100%;
      height: 100%;
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      line-height: 1.5;
      border: none;
      resize: none;
      padding: 4px 8px;
      outline: none;
      display: none;
    }

    .code-line {
      display: flex;
      padding: 0 8px;
      min-height: 18px;
    }

    .code-line:hover {
      background-color: var(--vscode-list-hoverBackground);
    }

    .code-line.has-match {
      background-color: var(--vscode-editor-findMatchHighlightBackground, rgba(255, 200, 0, 0.15));
    }

    .code-line.current-match {
      background-color: var(--vscode-editor-findMatchBackground, rgba(255, 200, 0, 0.4));
    }

    .line-number {
      min-width: 50px;
      padding-right: 12px;
      text-align: right;
      color: var(--vscode-editorLineNumber-foreground, #858585);
      user-select: none;
    }

    .line-content {
      flex: 1;
      white-space: pre;
      overflow-x: visible;
    }

    .line-content .match {
      background-color: var(--vscode-editor-findMatchHighlightBackground, rgba(255, 200, 0, 0.5));
      border: 1px solid var(--vscode-editor-findMatchBorder, #f0a000);
      border-radius: 2px;
    }

    /* ===== Empty State ===== */
    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      font-size: 12px;
    }

    /* ===== Scrollbar ===== */
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }

    ::-webkit-scrollbar-thumb {
      background: var(--vscode-scrollbarSlider-background);
      border-radius: 4px;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: var(--vscode-scrollbarSlider-hoverBackground);
    }

    /* ===== Search Options ===== */
    .options-row {
      display: flex;
      gap: 16px;
      align-items: center;
      margin-top: 8px;
      padding: 6px 0;
    }

    .option-group {
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .option-group input[type="checkbox"] {
      width: 14px;
      height: 14px;
      margin: 0;
      cursor: pointer;
      accent-color: var(--vscode-button-background);
    }

    .option-group label {
      font-size: 11px;
      color: var(--vscode-foreground);
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
    }

    .file-mask-group {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-left: auto;
    }

    .file-mask-group label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
    }

    .file-mask-group input {
      width: 150px;
      padding: 3px 8px;
      font-size: 11px;
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #444);
      border-radius: 3px;
    }

    .file-mask-group input::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }
  </style>
</head>
<body>
  <div class="search-header">
    <div class="search-row">
      <span class="search-label">Find:</span>
      <input type="text" id="query" placeholder="Type to search..." autofocus />
      <button id="toggle-replace" title="Toggle Replace (Option+Shift+F)">&#x2195;</button>
    </div>
    <div class="search-row" id="replace-row">
      <span class="search-label">Replace:</span>
      <input type="text" id="replace-input" placeholder="Replace with..." />
      <button id="replace-btn" title="Replace (Enter)">Replace</button>
      <button id="replace-all-btn" title="Replace All (Cmd+Enter)">Replace All</button>
    </div>
    <div class="options-row">
      <div class="option-group">
        <input type="checkbox" id="match-case" />
        <label for="match-case">Match Case</label>
      </div>
      <div class="option-group">
        <input type="checkbox" id="whole-word" />
        <label for="whole-word">Words</label>
      </div>
      <div class="option-group">
        <input type="checkbox" id="use-regex" />
        <label for="use-regex">Regex</label>
      </div>
      <div class="file-mask-group">
        <label for="file-mask">File Mask:</label>
        <input type="text" id="file-mask" placeholder="*.ts, *.js, *.py" />
      </div>
    </div>
    <div class="scope-row">
      <span class="search-label">In:</span>
      <div class="scope-tabs">
        <button class="scope-tab active" data-scope="project">Project</button>
        <button class="scope-tab" data-scope="module">Module</button>
        <button class="scope-tab" data-scope="directory">Directory</button>
        <button class="scope-tab" data-scope="file" id="scope-file" style="display: none;">File</button>
      </div>
      <div class="scope-input" id="directory-input-wrapper">
        <input type="text" id="directory-input" placeholder="Directory path..." />
      </div>
      <div class="scope-input" id="module-input-wrapper">
        <select id="module-select">
          <option value="">Select module...</option>
        </select>
      </div>
      <div class="scope-input" id="file-input-wrapper">
        <input type="text" id="file-input" placeholder="File path..." readonly />
      </div>
    </div>
  </div>

  <div class="main-content">
    <div class="results-panel">
      <div class="results-header">
        <span>Results</span>
        <span id="results-count"></span>
      </div>
      <div class="results-list" id="results-list">
        <div class="empty-state">Type to search...</div>
      </div>
    </div>

    <div class="preview-panel">
      <div class="preview-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span>Preview</span>
          <span class="preview-filename" id="preview-filename"></span>
        </div>
        <div class="preview-actions" id="preview-actions" style="display: none;">
          <button id="replace-in-file-btn" title="Replace in this file (Cmd+Shift+R)">Replace in File</button>
        </div>
      </div>
      <div class="preview-content" id="preview-content">
        <div class="empty-state">Select a result to preview file</div>
      </div>
      
      <div class="editor-container" id="editor-container">
        <div class="editor-wrapper">
          <div class="editor-line-numbers" id="editor-line-numbers"></div>
          <div class="editor-content-wrapper">
            <div id="editor-backdrop"></div>
            <textarea id="file-editor" spellcheck="false"></textarea>
          </div>
        </div>
        <div id="replace-widget" class="replace-widget">
        <div class="replace-widget-row">
          <span class="replace-widget-label">Find:</span>
          <input type="text" id="local-search-input" placeholder="Search term...">
          <button id="local-prev-btn" class="nav-btn" title="Previous match (Shift+Enter)">▲</button>
          <button id="local-next-btn" class="nav-btn" title="Next match (Enter)">▼</button>
          <span class="replace-match-count" id="local-match-count"></span>
        </div>
        <div class="replace-widget-row">
          <span class="replace-widget-label">Replace:</span>
          <input type="text" id="local-replace-input" placeholder="Replace with...">
        </div>
        <div class="replace-widget-actions">
          <button id="local-replace-btn" title="Replace next (Enter)">Replace</button>
          <button id="local-replace-all-btn" class="primary" title="Replace All (Cmd+Enter)">Replace All</button>
          <button id="local-replace-close" title="Close (Esc)">✕</button>
        </div>
        </div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    (function() {
      const state = {
        results: [],
        activeIndex: -1,
        currentScope: 'project',
        modules: [],
        currentDirectory: '',
        currentQuery: '',
        fileContent: null,
        searchTimeout: null,
        replaceKeybinding: 'ctrl+shift+r',
        options: {
          matchCase: false,
          wholeWord: false,
          useRegex: false,
          fileMask: ''
        }
      };

      const vscode = acquireVsCodeApi();

      // DOM Elements
      const queryInput = document.getElementById('query');
      const replaceRow = document.getElementById('replace-row');
      const replaceInput = document.getElementById('replace-input');
      const replaceBtn = document.getElementById('replace-btn');
      const replaceAllBtn = document.getElementById('replace-all-btn');
      const toggleReplaceBtn = document.getElementById('toggle-replace');
      const resultsList = document.getElementById('results-list');
      const resultsCount = document.getElementById('results-count');
      const previewContent = document.getElementById('preview-content');
      const previewFilename = document.getElementById('preview-filename');
      const scopeTabs = document.querySelectorAll('.scope-tab');
      const directoryInputWrapper = document.getElementById('directory-input-wrapper');
      const moduleInputWrapper = document.getElementById('module-input-wrapper');
      const directoryInput = document.getElementById('directory-input');
      const moduleSelect = document.getElementById('module-select');
      const matchCaseCheckbox = document.getElementById('match-case');
      const wholeWordCheckbox = document.getElementById('whole-word');
      const useRegexCheckbox = document.getElementById('use-regex');
      const fileMaskInput = document.getElementById('file-mask');

      const scopeFileBtn = document.getElementById('scope-file');
      const fileInputWrapper = document.getElementById('file-input-wrapper');
      const fileInput = document.getElementById('file-input');
      const previewActions = document.getElementById('preview-actions');
      const replaceInFileBtn = document.getElementById('replace-in-file-btn');
      const fileEditor = document.getElementById('file-editor');
      const editorContainer = document.getElementById('editor-container');
      const editorBackdrop = document.getElementById('editor-backdrop');
      const editorLineNumbers = document.getElementById('editor-line-numbers');
      
      const replaceWidget = document.getElementById('replace-widget');
      const localSearchInput = document.getElementById('local-search-input');
      const localReplaceInput = document.getElementById('local-replace-input');
      const localMatchCount = document.getElementById('local-match-count');
      const localReplaceBtn = document.getElementById('local-replace-btn');
      const localReplaceAllBtn = document.getElementById('local-replace-all-btn');
      const localReplaceClose = document.getElementById('local-replace-close');
      const localPrevBtn = document.getElementById('local-prev-btn');
      const localNextBtn = document.getElementById('local-next-btn');

      // Debug: Check if elements are found
      console.log('DOM Elements loaded:', {
        queryInput: !!queryInput,
        resultsList: !!resultsList,
        previewContent: !!previewContent
      });

      // Language detection from filename for syntax highlighting
      function getLanguageFromFilename(filename) {
        const ext = (filename || '').split('.').pop().toLowerCase();
        const langMap = {
          'js': 'javascript',
          'jsx': 'javascript',
          'ts': 'typescript',
          'tsx': 'typescript',
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
          'html': 'xml',
          'htm': 'xml',
          'xml': 'xml',
          'css': 'css',
          'scss': 'scss',
          'less': 'less',
          'json': 'json',
          'yaml': 'yaml',
          'yml': 'yaml',
          'md': 'markdown',
          'sh': 'bash',
          'bash': 'bash',
          'zsh': 'bash',
          'sql': 'sql',
          'vue': 'xml',
          'svelte': 'xml'
        };
        return langMap[ext] || null;
      }

      // Local replace state
      var localMatches = [];
      var localMatchIndex = 0;

      // Initialize
      vscode.postMessage({ type: 'webviewReady' });
      vscode.postMessage({ type: 'getModules' });
      vscode.postMessage({ type: 'getCurrentDirectory' });

      // Toggle Replace
      function toggleReplace() {
        const isVisible = replaceRow.classList.toggle('visible');
        if (isVisible) {
          replaceInput.focus();
        } else {
          queryInput.focus();
        }
      }

      toggleReplaceBtn.addEventListener('click', toggleReplace);

      // Replace Actions
      replaceBtn.addEventListener('click', replaceOne);
      replaceAllBtn.addEventListener('click', replaceAll);
      
      replaceInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          if (e.metaKey || e.ctrlKey) {
            replaceAll();
          } else {
            replaceOne();
          }
        }
      });

      // Preview Actions
      function triggerReplaceInFile() {
        if (!state.fileContent) return;
        
        // Enter edit mode if not already
        if (!isEditMode) {
          enterEditMode();
        }
        
        // Pre-fill search with current query
        localSearchInput.value = state.currentQuery || '';
        localReplaceInput.value = '';
        
        // Show replace widget and focus search
        replaceWidget.classList.add('visible');
        localSearchInput.focus();
        localSearchInput.select();
        
        // Update match count
        updateLocalMatches();
      }

      replaceInFileBtn.addEventListener('click', triggerReplaceInFile);
      
      localReplaceClose.addEventListener('click', () => {
        replaceWidget.classList.remove('visible');
        localMatches = [];
        localMatchIndex = 0;
        updateHighlights();
        if (isEditMode) {
          fileEditor.focus();
        }
      });

      // Search input events
      localSearchInput.addEventListener('input', () => {
        updateLocalMatches();
        updateHighlights();
      });

      localSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (e.shiftKey) {
            navigateLocalMatch(-1);
          } else {
            navigateLocalMatch(1);
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          navigateLocalMatch(-1);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          navigateLocalMatch(1);
        } else if (e.key === 'Escape') {
          replaceWidget.classList.remove('visible');
          localMatches = [];
          updateHighlights();
          if (isEditMode) {
            fileEditor.focus();
          }
        }
      });

      localReplaceInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          if (e.metaKey || e.ctrlKey) {
            triggerLocalReplaceAll();
          } else {
            triggerLocalReplace();
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          navigateLocalMatch(-1);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          navigateLocalMatch(1);
        } else if (e.key === 'Escape') {
          replaceWidget.classList.remove('visible');
          localMatches = [];
          updateHighlights();
          if (isEditMode) {
            fileEditor.focus();
          }
        }
      });

      localReplaceBtn.addEventListener('click', triggerLocalReplace);
      localReplaceAllBtn.addEventListener('click', triggerLocalReplaceAll);
      localPrevBtn.addEventListener('click', () => navigateLocalMatch(-1));
      localNextBtn.addEventListener('click', () => navigateLocalMatch(1));

      function updateLocalMatches() {
        localMatches = [];
        localMatchIndex = 0;
        
        var searchTerm = localSearchInput.value;
        if (!searchTerm || searchTerm.length < 1) {
          localMatchCount.textContent = '';
          return;
        }
        
        var content = fileEditor.value;
        var flags = 'g';
        if (!state.options.matchCase) flags += 'i';
        
        try {
          var pattern = searchTerm;
          if (!state.options.useRegex) {
            // Escape all regex metacharacters using split/join to avoid regex escaping issues
            var chars = [['\\\\', '\\\\\\\\'], ['^', '\\\\^'], ['$', '\\\\$'], ['.', '\\\\.'], ['*', '\\\\*'], ['+', '\\\\+'], ['?', '\\\\?'], ['(', '\\\\('], [')', '\\\\)'], ['[', '\\\\['], [']', '\\\\]'], ['{', '\\\\{'], ['}', '\\\\}'], ['|', '\\\\|']];
            for (var ci = 0; ci < chars.length; ci++) {
              pattern = pattern.split(chars[ci][0]).join(chars[ci][1]);
            }
          }
          if (state.options.wholeWord) {
            pattern = '\\\\b' + pattern + '\\\\b';
          }
          
          var regex = new RegExp(pattern, flags);
          var match;
          while ((match = regex.exec(content)) !== null) {
            localMatches.push({
              start: match.index,
              end: match.index + match[0].length,
              text: match[0]
            });
            if (match[0].length === 0) break;
          }
        } catch (e) {
          // Invalid regex
        }
        
        if (localMatches.length > 0) {
          localMatchCount.textContent = '1 of ' + localMatches.length;
        } else {
          localMatchCount.textContent = 'No results';
        }
      }

      function navigateLocalMatch(delta) {
        if (localMatches.length === 0) return;
        
        localMatchIndex = (localMatchIndex + delta + localMatches.length) % localMatches.length;
        localMatchCount.textContent = (localMatchIndex + 1) + ' of ' + localMatches.length;
        
        // Scroll to match in editor
        var match = localMatches[localMatchIndex];
        fileEditor.setSelectionRange(match.start, match.end);
        fileEditor.focus();
        
        // Scroll textarea to selection
        var textBefore = fileEditor.value.substring(0, match.start);
        var lines = textBefore.split('\\n');
        var lineHeight = 18; // approx line height
        var scrollTop = (lines.length - 5) * lineHeight;
        fileEditor.scrollTop = Math.max(0, scrollTop);
        editorBackdrop.scrollTop = fileEditor.scrollTop;
        
        updateHighlights();
      }

      function triggerLocalReplace() {
        if (localMatches.length === 0) return;
        
        var match = localMatches[localMatchIndex];
        var content = fileEditor.value;
        var newContent = content.substring(0, match.start) + localReplaceInput.value + content.substring(match.end);
        
        fileEditor.value = newContent;
        state.fileContent.content = newContent;
        
        // Save
        saveFile();
        
        // Update matches
        updateLocalMatches();
        updateHighlights();
        
        // Navigate to next match if any
        if (localMatches.length > 0) {
          if (localMatchIndex >= localMatches.length) {
            localMatchIndex = 0;
          }
          localMatchCount.textContent = (localMatchIndex + 1) + ' of ' + localMatches.length;
        }
      }

      function triggerLocalReplaceAll() {
        if (localMatches.length === 0) return;
        
        var content = fileEditor.value;
        var searchTerm = localSearchInput.value;
        var replaceTerm = localReplaceInput.value;
        
        var flags = 'g';
        if (!state.options.matchCase) flags += 'i';
        
        try {
          var pattern = searchTerm;
          if (!state.options.useRegex) {
            pattern = pattern.split('.').join('\\\\.');
            pattern = pattern.split('*').join('\\\\*');
            pattern = pattern.split('+').join('\\\\+');
            pattern = pattern.split('?').join('\\\\?');
            pattern = pattern.split('^').join('\\\\^');
            pattern = pattern.split('$').join('\\\\$');
            pattern = pattern.split('(').join('\\\\(');
            pattern = pattern.split(')').join('\\\\)');
            pattern = pattern.split('{').join('\\\\{');
            pattern = pattern.split('}').join('\\\\}');
          }
          if (state.options.wholeWord) {
            pattern = '\\\\b' + pattern + '\\\\b';
          }
          
          var regex = new RegExp(pattern, flags);
          var newContent = content.replace(regex, replaceTerm);
          var count = localMatches.length;
          
          fileEditor.value = newContent;
          state.fileContent.content = newContent;
          
          // Save
          saveFile();
          
          // Update matches
          updateLocalMatches();
          updateHighlights();
          
          // Show info
          localMatchCount.textContent = 'Replaced ' + count;
        } catch (e) {
          // Invalid regex
        }
      }

      // Dynamic Editing
      let isEditMode = false;
      let saveTimeout = null;

      // Click to edit
      previewContent.addEventListener('click', (e) => {
        // Don't trigger if clicking a link or button (if any)
        if (e.target.tagName === 'BUTTON') return;
        
        enterEditMode();
      });

      function enterEditMode() {
        if (!state.fileContent || isEditMode) return;
        
        isEditMode = true;
        previewContent.style.display = 'none';
        editorContainer.classList.add('visible');
        fileEditor.value = state.fileContent.content;
        updateHighlights();
        fileEditor.focus();
      }

      function saveFile() {
        if (!state.fileContent) return;
        
        const newContent = fileEditor.value;
        vscode.postMessage({
          type: 'saveFile',
          uri: state.fileContent.uri,
          content: newContent
        });
        
        // Optimistically update content
        state.fileContent.content = newContent;
      }

      function exitEditMode() {
        if (!isEditMode) return;
        
        // Save before exiting
        saveFile();
        
        isEditMode = false;
        previewContent.style.display = 'block';
        editorContainer.classList.remove('visible');
        
        // Re-render preview with new content
        renderFilePreview(state.fileContent);
      }

      // Auto-save on input
      fileEditor.addEventListener('input', () => {
        updateHighlights();
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
          saveFile();
        }, 1000);
      });

      // Save and exit on blur
      fileEditor.addEventListener('blur', (e) => {
        // Don't exit if clicking inside the replace widget
        if (e.relatedTarget && (replaceWidget.contains(e.relatedTarget) || e.relatedTarget === replaceWidget)) {
          return;
        }
        
        if (saveTimeout) clearTimeout(saveTimeout);
        exitEditMode();
      });

      // Handle Cmd+S and configurable replace keybinding in editor
      fileEditor.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
          e.preventDefault();
          if (saveTimeout) clearTimeout(saveTimeout);
          saveFile();
        } else if (checkReplaceKeybinding(e)) {
          // Configurable keybinding to open replace widget
          e.preventDefault();
          triggerReplaceInFile();
        } else if (e.key === 'Escape') {
          if (saveTimeout) clearTimeout(saveTimeout);
          exitEditMode();
        }
      });
      
      // Check if the pressed key matches the configured replace keybinding
      function checkReplaceKeybinding(e) {
        const keybinding = state.replaceKeybinding || 'ctrl+shift+r';
        const parts = keybinding.toLowerCase().split('+');
        const key = parts[parts.length - 1];
        const needsCtrl = parts.includes('ctrl');
        const needsShift = parts.includes('shift');
        const needsAlt = parts.includes('alt');
        const needsMeta = parts.includes('cmd') || parts.includes('meta');
        
        const ctrlMatch = needsCtrl ? e.ctrlKey : true;
        const shiftMatch = needsShift ? e.shiftKey : true;
        const altMatch = needsAlt ? e.altKey : true;
        const metaMatch = needsMeta ? e.metaKey : true;
        const keyMatch = e.key.toLowerCase() === key;
        
        return ctrlMatch && shiftMatch && altMatch && metaMatch && keyMatch;
      }
      
      // Sync scroll between textarea, backdrop, and line numbers
      fileEditor.addEventListener('scroll', () => {
        if (editorBackdrop) {
          editorBackdrop.scrollTop = fileEditor.scrollTop;
          editorBackdrop.scrollLeft = fileEditor.scrollLeft;
        }
        if (editorLineNumbers) {
          editorLineNumbers.scrollTop = fileEditor.scrollTop;
        }
      });
      
      // Syntax highlighting for the editor
      function updateHighlights() {
        if (!editorBackdrop || !fileEditor) return;
        
        const text = fileEditor.value;
        const searchQuery = localSearchInput ? localSearchInput.value : (state.currentQuery || '');
        
        // Get language for syntax highlighting
        const fileName = state.fileContent ? state.fileContent.fileName : '';
        const language = getLanguageFromFilename(fileName);
        
        let highlighted = '';
        
        // Apply syntax highlighting if hljs is available
        if (typeof hljs !== 'undefined' && language) {
          try {
            highlighted = hljs.highlight(text, { language: language }).value;
          } catch (e) {
            // Fallback to escaped HTML if highlighting fails
            highlighted = text
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;');
          }
        } else {
          // Escape HTML if no syntax highlighting
          highlighted = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        }
        
        // Highlight search matches on top of syntax highlighting
        if (searchQuery && searchQuery.length > 0) {
          try {
            // Create a temporary element to work with the highlighted text
            const temp = document.createElement('div');
            temp.innerHTML = highlighted;
            
            // Walk through text nodes and mark matches
            const walker = document.createTreeWalker(temp, NodeFilter.SHOW_TEXT, null);
            const textNodes = [];
            while (walker.nextNode()) {
              textNodes.push(walker.currentNode);
            }
            
            const lowerQuery = searchQuery.toLowerCase();
            for (const node of textNodes) {
              const nodeText = node.textContent || '';
              const lowerNodeText = nodeText.toLowerCase();
              
              // Find all occurrences of the search query in this text node
              let index = lowerNodeText.indexOf(lowerQuery);
              if (index !== -1) {
                const fragment = document.createDocumentFragment();
                let lastIndex = 0;
                
                while (index !== -1) {
                  // Add text before the match
                  if (index > lastIndex) {
                    fragment.appendChild(document.createTextNode(nodeText.substring(lastIndex, index)));
                  }
                  
                  // Add the highlighted match
                  const mark = document.createElement('mark');
                  mark.style.background = 'rgba(255, 200, 0, 0.4)';
                  mark.style.color = 'inherit';
                  mark.textContent = nodeText.substring(index, index + searchQuery.length);
                  fragment.appendChild(mark);
                  
                  lastIndex = index + searchQuery.length;
                  index = lowerNodeText.indexOf(lowerQuery, lastIndex);
                }
                
                // Add remaining text after last match
                if (lastIndex < nodeText.length) {
                  fragment.appendChild(document.createTextNode(nodeText.substring(lastIndex)));
                }
                
                if (node.parentNode) {
                  node.parentNode.replaceChild(fragment, node);
                }
              }
            }
            
            highlighted = temp.innerHTML;
          } catch (e) {
            // Skip search highlighting on error
          }
        }
        
        // Add a trailing newline to match textarea behavior
        highlighted += '\\n';
        
        editorBackdrop.innerHTML = highlighted;
        
        // Update line numbers
        updateLineNumbers();
      }

      function updateLineNumbers() {
        if (!editorLineNumbers || !fileEditor) return;
        
        const text = fileEditor.value;
        const lines = text.split(String.fromCharCode(10));
        const lineCount = lines.length;
        
        let html = '';
        for (let i = 1; i <= lineCount; i++) {
          html += '<div>' + i + '</div>';
        }
        
        editorLineNumbers.innerHTML = html;
      }

      function replaceOne() {
        if (state.activeIndex < 0 || state.activeIndex >= state.results.length) return;
        const result = state.results[state.activeIndex];
        const replaceText = replaceInput.value;
        const replacedUri = result.uri;
        
        vscode.postMessage({
          type: 'replaceOne',
          uri: result.uri,
          line: result.line,
          character: result.character,
          length: result.length,
          replaceText: replaceText
        });

        // Optimistic update: Remove result and adjust offsets
        const currentUri = result.uri;
        const currentLine = result.line;
        const currentChar = result.character;
        const delta = replaceText.length - result.length;

        state.results.splice(state.activeIndex, 1);

        // Adjust subsequent matches on same line
        if (delta !== 0) {
          for (let i = state.activeIndex; i < state.results.length; i++) {
            const r = state.results[i];
            if (r.uri === currentUri && r.line === currentLine && r.character > currentChar) {
              r.character += delta;
            }
          }
        }

        // Update UI
        resultsCount.textContent = state.results.length + ' results';
        
        if (state.results.length === 0) {
          resultsList.innerHTML = '<div class="empty-state">No results found</div>';
          previewContent.innerHTML = '<div class="empty-state">No results</div>';
          previewFilename.textContent = '';
          state.activeIndex = -1;
          // Reload current file if in edit mode to reflect changes
          if (isEditMode && state.fileContent && state.fileContent.uri === replacedUri) {
            vscode.postMessage({
              type: 'getFileContent',
              uri: replacedUri,
              query: state.currentQuery,
              options: state.options
            });
          }
        } else {
          if (state.activeIndex >= state.results.length) {
            state.activeIndex = state.results.length - 1;
          }
          renderResults();
          if (state.activeIndex >= 0) {
            loadFileContent(state.results[state.activeIndex]);
          }
        }
        
        // Re-run search after a short delay to update results
        setTimeout(runSearch, 200);
      }

      function replaceAll() {
        vscode.postMessage({
          type: 'replaceAll',
          query: state.currentQuery,
          replaceText: replaceInput.value,
          scope: state.currentScope,
          options: state.options,
          directoryPath: state.currentScope === 'directory' ? directoryInput.value.trim() : undefined,
          modulePath: state.currentScope === 'module' ? moduleSelect.value : undefined,
          filePath: state.currentScope === 'file' ? fileInput.value.trim() : undefined
        });
      }

      // Dynamic search on input
      queryInput.addEventListener('input', () => {
        console.log('Input event triggered, value:', queryInput.value);
        clearTimeout(state.searchTimeout);
        state.searchTimeout = setTimeout(() => {
          console.log('Timeout fired, calling runSearch()');
          runSearch();
        }, 300); // 300ms debounce
        console.log('Timeout set, id:', state.searchTimeout);
      });

      // Search options change handlers
      matchCaseCheckbox.addEventListener('change', () => {
        state.options.matchCase = matchCaseCheckbox.checked;
        runSearch();
      });

      wholeWordCheckbox.addEventListener('change', () => {
        state.options.wholeWord = wholeWordCheckbox.checked;
        runSearch();
      });

      useRegexCheckbox.addEventListener('change', () => {
        state.options.useRegex = useRegexCheckbox.checked;
        runSearch();
      });

      fileMaskInput.addEventListener('input', () => {
        clearTimeout(state.searchTimeout);
        state.searchTimeout = setTimeout(() => {
          state.options.fileMask = fileMaskInput.value;
          runSearch();
        }, 300);
      });

      // Scope tabs
      scopeTabs.forEach(tab => {
        tab.addEventListener('click', () => {
          scopeTabs.forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          state.currentScope = tab.dataset.scope;
          updateScopeInputs();
          runSearch();
        });
      });

      // Directory input change
      directoryInput.addEventListener('input', () => {
        clearTimeout(state.searchTimeout);
        state.searchTimeout = setTimeout(() => {
          runSearch();
        }, 500);
      });

      // Module select change
      moduleSelect.addEventListener('change', runSearch);

      // Keyboard navigation
      document.addEventListener('keydown', (e) => {
        // Skip keyboard shortcuts when editing in textarea or input fields
        var activeEl = document.activeElement;
        var isInEditor = activeEl === fileEditor || activeEl === localSearchInput || activeEl === localReplaceInput;
        
        // Replace in File (Alt+R)
        if (e.altKey && e.code === 'KeyR') {
          e.preventDefault();
          triggerReplaceInFile();
          return;
        }

        if (e.altKey && e.shiftKey && e.code === 'KeyF') {
          e.preventDefault();
          toggleReplace();
        } else if (e.key === 'ArrowDown' && !isInEditor) {
          e.preventDefault();
          navigateResults(1);
        } else if (e.key === 'ArrowUp' && !isInEditor) {
          e.preventDefault();
          navigateResults(-1);
        } else if (e.key === 'Enter' && document.activeElement !== directoryInput && document.activeElement !== replaceInput && !isInEditor) {
          e.preventDefault();
          openActiveResult();
        } else if (e.key === 'Escape') {
          if (isEditMode && !replaceWidget.classList.contains('visible')) {
            exitEditMode();
          } else {
            queryInput.focus();
            queryInput.select();
          }
        }
      });

      // Messages from extension
      window.addEventListener('message', (event) => {
        const message = event.data;
        console.log('Webview received message:', message.type, message);
        switch (message.type) {
          case 'searchResults':
            handleSearchResults(message.results);
            break;
          case 'modulesList':
            handleModulesList(message.modules);
            break;
          case 'currentDirectory':
            handleCurrentDirectory(message.directory);
            break;
          case 'fileContent':
            handleFileContent(message);
            break;
          case 'showReplace':
            if (!replaceRow.classList.contains('visible')) {
              toggleReplace();
            } else {
              replaceInput.focus();
              replaceInput.select();
            }
            break;
          case 'config':
            if (message.replaceKeybinding) {
              state.replaceKeybinding = message.replaceKeybinding;
            }
            break;
          case '__test_searchCompleted': // Test confirmation: search results received by webview
            // Re-send to extension host for test to receive
            vscode.postMessage({ type: '__test_searchResultsReceived', results: message.results });
            break;
          case '__test_setSearchInput': // Test utility: set search input and trigger search
            queryInput.value = message.value;
            runSearch();
            break;
        }
      });

      function updateScopeInputs() {
        directoryInputWrapper.classList.remove('visible');
        moduleInputWrapper.classList.remove('visible');
        fileInputWrapper.classList.remove('visible');
        
        if (state.currentScope === 'directory') {
          directoryInputWrapper.classList.add('visible');
        } else if (state.currentScope === 'module') {
          moduleInputWrapper.classList.add('visible');
        } else if (state.currentScope === 'file') {
          fileInputWrapper.classList.add('visible');
        }
      }

      function runSearch() {
        try {
          const query = queryInput.value.trim();
          state.currentQuery = query;
          
          console.log('runSearch called, query:', query, 'length:', query.length);
          
          if (query.length < 2) {
            resultsList.innerHTML = '<div class="empty-state">Type at least 2 characters...</div>';
            resultsCount.textContent = '';
            return;
          }

          resultsList.innerHTML = '<div class="empty-state">Searching...</div>';
          resultsCount.textContent = '';

          const message = {
            type: 'runSearch',
            query: query,
            scope: state.currentScope,
            options: state.options
          };

          // Always include directory path when in directory scope
          if (state.currentScope === 'directory') {
            message.directoryPath = directoryInput.value.trim();
            console.log('Sending directory search:', message.directoryPath);
          } else if (state.currentScope === 'module') {
            message.modulePath = moduleSelect.value;
          } else if (state.currentScope === 'file') {
            message.filePath = fileInput.value.trim();
          }

          console.log('Sending search message:', message);
          vscode.postMessage(message);
        } catch (error) {
          console.error('Error in runSearch:', error);
        }
      }

      function handleSearchResults(results) {
        state.results = results;
        state.activeIndex = results.length > 0 ? 0 : -1;

        resultsCount.textContent = results.length + (results.length >= 5000 ? '+' : '') + ' results';

        // Send test confirmation message back to extension host
        vscode.postMessage({ type: '__test_searchCompleted', results: results });

        if (results.length === 0) {
          resultsList.innerHTML = '<div class="empty-state">No results found</div>';
          previewContent.innerHTML = '<div class="empty-state">No results</div>';
          previewFilename.textContent = '';
          return;
        }

        renderResults();
        
        // Auto-load first result's file content
        if (state.activeIndex >= 0) {
          loadFileContent(state.results[state.activeIndex]);
        }
      }

      function handleModulesList(modules) {
        state.modules = modules;
        moduleSelect.innerHTML = modules.length === 0
          ? '<option value="">No modules found</option>'
          : '<option value="">Select module...</option>' +
            modules.map(m => '<option value="' + escapeAttr(m.path) + '">' + escapeHtml(m.name) + '</option>').join('');
      }

      function handleCurrentDirectory(directory) {
        state.currentDirectory = directory;
        directoryInput.value = directory;
      }

      function handleFileContent(message) {
        state.fileContent = message;
        previewFilename.textContent = message.fileName;
        
        // Show actions
        previewActions.style.display = 'flex';
        
        // If in edit mode, update editor content and highlights
        if (isEditMode) {
          fileEditor.value = message.content;
          updateLocalMatches();
          updateHighlights();
        } else {
          renderFilePreview(message);
        }
      }

      function renderResults() {
        // Group results by file
        const grouped = {};
        state.results.forEach((result, index) => {
          if (!grouped[result.uri]) {
            grouped[result.uri] = [];
          }
          grouped[result.uri].push({ ...result, globalIndex: index });
        });

        let html = '';
        for (const uri in grouped) {
          const matches = grouped[uri];
          const first = matches[0];
          
          matches.forEach(result => {
            const isActive = result.globalIndex === state.activeIndex;
            const previewHtml = highlightMatch(
              escapeHtml(result.preview),
              result.previewMatchRange.start,
              result.previewMatchRange.end
            );

            html += '<div class="result-item' + (isActive ? ' active' : '') + '" data-index="' + result.globalIndex + '">' +
              '<div class="result-file">' +
                '<span class="result-filename">' + escapeHtml(result.fileName) + '</span>' +
                '<span class="result-location">:' + (result.line + 1) + '</span>' +
              '</div>' +
              '<div class="result-preview">' + previewHtml + '</div>' +
            '</div>';
          });
        }

        resultsList.innerHTML = html;

        // Click handlers
        resultsList.querySelectorAll('.result-item').forEach(item => {
          item.addEventListener('click', () => {
            const index = parseInt(item.dataset.index, 10);
            setActiveIndex(index);
          });
          item.addEventListener('dblclick', () => {
            openActiveResult();
          });
        });
      }

      function renderFilePreview(fileData) {
        const lines = fileData.content.split('\\n');
        const currentResult = state.results[state.activeIndex];
        const currentLine = currentResult ? currentResult.line : -1;

        // Get language for syntax highlighting
        const language = getLanguageFromFilename(fileData.fileName);
        
        // Apply syntax highlighting to the entire content first
        let highlightedContent = '';
        if (typeof hljs !== 'undefined' && language) {
          try {
            highlightedContent = hljs.highlight(fileData.content, { language: language }).value;
          } catch (e) {
            // If highlighting fails, fall back to escaped content
            highlightedContent = escapeHtml(fileData.content);
          }
        } else {
          highlightedContent = escapeHtml(fileData.content);
        }
        
        // Split highlighted content into lines
        const highlightedLines = highlightedContent.split('\\n');

        let html = '';
        lines.forEach((line, idx) => {
          const lineMatches = fileData.matches.filter(m => m.line === idx);
          const hasMatch = lineMatches.length > 0;
          const isCurrentLine = idx === currentLine;

          let lineClass = 'code-line';
          if (isCurrentLine) lineClass += ' current-match';
          else if (hasMatch) lineClass += ' has-match';

          // Use highlighted line content, or escape if not available
          let lineContent = highlightedLines[idx] || escapeHtml(line) || ' ';
          
          // If there are matches, we need to add match highlighting on top of syntax highlighting
          // This is tricky because the highlighted content has HTML tags
          // For now, we'll add a visual indicator via CSS class
          if (hasMatch && !lineContent.includes('class="match"')) {
            // We'll mark the entire line as having a match for visual feedback
            // The actual match is shown via the line background
          }

          html += '<div class="' + lineClass + '" data-line="' + idx + '">' +
            '<span class="line-number">' + (idx + 1) + '</span>' +
            '<span class="line-content">' + lineContent + '</span>' +
          '</div>';
        });

        previewContent.innerHTML = html;

        // Scroll to current match
        if (currentLine >= 0) {
          const currentLineEl = previewContent.querySelector('[data-line="' + currentLine + '"]');
          if (currentLineEl) {
            currentLineEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        }

        // Click on line to open
        previewContent.querySelectorAll('.code-line').forEach(lineEl => {
          lineEl.addEventListener('dblclick', () => {
            const lineNum = parseInt(lineEl.dataset.line, 10);
            if (state.fileContent) {
              vscode.postMessage({
                type: 'openLocation',
                uri: state.fileContent.uri,
                line: lineNum,
                character: 0
              });
            }
          });
        });
      }

      function loadFileContent(result) {
        vscode.postMessage({
          type: 'getFileContent',
          uri: result.uri,
          query: state.currentQuery,
          options: state.options
        });
      }

      function setActiveIndex(index) {
        if (index < 0 || index >= state.results.length) return;

        state.activeIndex = index;

        resultsList.querySelectorAll('.result-item').forEach((item, i) => {
          item.classList.toggle('active', parseInt(item.dataset.index, 10) === index);
        });

        const activeItem = resultsList.querySelector('.result-item.active');
        if (activeItem) {
          activeItem.scrollIntoView({ block: 'nearest' });
        }

        // Load file content for new selection
        loadFileContent(state.results[index]);
      }

      function navigateResults(delta) {
        if (state.results.length === 0) return;
        let newIndex = state.activeIndex + delta;
        if (newIndex < 0) newIndex = state.results.length - 1;
        if (newIndex >= state.results.length) newIndex = 0;
        setActiveIndex(newIndex);
      }

      function openActiveResult() {
        if (state.activeIndex < 0 || state.activeIndex >= state.results.length) return;
        const result = state.results[state.activeIndex];
        vscode.postMessage({
          type: 'openLocation',
          uri: result.uri,
          line: result.line,
          character: result.character
        });
      }

      function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }

      function escapeAttr(text) {
        return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      }

      function highlightMatch(html, start, end) {
        if (start < 0 || end <= start || start >= html.length) return html;
        end = Math.min(end, html.length);
        return html.substring(0, start) + '<span class="match">' + html.substring(start, end) + '</span>' + html.substring(end);
      }
    })();
  </script>
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
