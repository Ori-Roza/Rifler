import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// ============================================================================
// Types
// ============================================================================

/** Represents a single search result match */
interface SearchResult {
  uri: string;
  fileName: string;
  relativePath: string;
  line: number;
  character: number;
  preview: string;
  previewMatchRange: {
    start: number;
    end: number;
  };
}

/** Represents a module in the workspace */
interface ModuleInfo {
  name: string;
  path: string;
}

/** Scope options for search */
type SearchScope = 'project' | 'directory' | 'module';

/** Search options */
interface SearchOptions {
  matchCase: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  fileMask: string;
}

/** Messages from Webview to Extension */
interface RunSearchMessage {
  type: 'runSearch';
  query: string;
  scope: SearchScope;
  directoryPath?: string;
  modulePath?: string;
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

type WebviewMessage = RunSearchMessage | OpenLocationMessage | GetModulesMessage | GetCurrentDirectoryMessage | GetFileContentMessage;

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

export function activate(context: vscode.ExtensionContext) {
  console.log('Rifler extension is now active');

  const openCommand = vscode.commands.registerCommand(
    'rifler.open',
    () => openSearchPanel(context)
  );

  context.subscriptions.push(openCommand);
}

export function deactivate() {
  if (currentPanel) {
    currentPanel.dispose();
  }
}

// ============================================================================
// Panel Management
// ============================================================================

function openSearchPanel(context: vscode.ExtensionContext): void {
  // If panel already exists, reveal it
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside);
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

  currentPanel.webview.onDidReceiveMessage(
    async (message: WebviewMessage) => {
      switch (message.type) {
        case 'runSearch':
          await runSearch(
            currentPanel!,
            message.query,
            message.scope,
            message.options,
            message.directoryPath,
            message.modulePath
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
    const content = fs.readFileSync(uri.fsPath, 'utf-8');
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

// ============================================================================
// Search Implementation
// ============================================================================

function buildSearchRegex(query: string, options: SearchOptions): RegExp | null {
  if (!query) return null;
  
  try {
    let pattern: string;
    
    if (options.useRegex) {
      pattern = query;
    } else {
      // Escape special regex characters
      pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    
    if (options.wholeWord) {
      pattern = `\\b${pattern}\\b`;
    }
    
    const flags = options.matchCase ? 'g' : 'gi';
    return new RegExp(pattern, flags);
  } catch {
    // Invalid regex
    return null;
  }
}

function matchesFileMask(fileName: string, fileMask: string): boolean {
  if (!fileMask.trim()) return true;
  
  // Support multiple masks separated by comma or semicolon
  const masks = fileMask.split(/[,;]/).map(m => m.trim()).filter(m => m);
  if (masks.length === 0) return true;
  
  return masks.some(mask => {
    // Convert glob pattern to regex
    const regexPattern = mask
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape special chars except * and ?
      .replace(/\*/g, '.*')                    // * matches any characters
      .replace(/\?/g, '.');                    // ? matches single character
    
    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(fileName);
  });
}

async function runSearch(
  panel: vscode.WebviewPanel,
  query: string,
  scope: SearchScope,
  options: SearchOptions,
  directoryPath?: string,
  modulePath?: string
): Promise<void> {
  console.log('runSearch called:', { query, scope, directoryPath, modulePath, options });
  
  if (!query.trim() || query.length < 2) {
    panel.webview.postMessage({ type: 'searchResults', results: [] });
    return;
  }

  const regex = buildSearchRegex(query, options);
  if (!regex) {
    panel.webview.postMessage({ type: 'searchResults', results: [] });
    return;
  }

  const results: SearchResult[] = [];
  const maxResults = 5000;

  // For directory or module scope, search directly in filesystem
  if (scope === 'directory') {
    let searchPath = (directoryPath || '').trim();
    console.log('Directory search path:', searchPath, 'exists:', fs.existsSync(searchPath));
    
    if (searchPath && fs.existsSync(searchPath)) {
      const stat = fs.statSync(searchPath);
      // If user provided a file path, use its parent directory
      if (!stat.isDirectory()) {
        searchPath = path.dirname(searchPath);
        console.log('Path was a file, using parent directory:', searchPath);
      }
      await searchInDirectory(searchPath, regex, options.fileMask, results, maxResults);
    } else {
      console.log('Directory does not exist or is empty:', searchPath);
    }
  } else if (scope === 'module' && modulePath) {
    if (fs.existsSync(modulePath)) {
      await searchInDirectory(modulePath, regex, options.fileMask, results, maxResults);
    }
  } else {
    // Project scope - use workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      for (const folder of workspaceFolders) {
        if (results.length >= maxResults) break;
        await searchInDirectory(folder.uri.fsPath, regex, options.fileMask, results, maxResults);
      }
    }
  }

  console.log('Search completed, results:', results.length);
  
  panel.webview.postMessage({
    type: 'searchResults',
    results
  } as SearchResultsMessage);
}

async function searchInDirectory(
  dirPath: string,
  regex: RegExp,
  fileMask: string,
  results: SearchResult[],
  maxResults: number
): Promise<void> {
  const excludeDirs = new Set([
    'node_modules', '.git', 'dist', 'out', '__pycache__', '.venv', 'venv',
    '.idea', '.vscode', 'coverage', '.nyc_output', 'build', '.next',
    '.nuxt', '.cache', 'tmp', 'temp', '.pytest_cache', '.tox'
  ]);

  const binaryExts = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz',
    '.exe', '.dll', '.so', '.dylib', '.woff', '.woff2', '.ttf', '.eot',
    '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.svg',
    '.lock', '.bin', '.dat', '.db', '.sqlite', '.sqlite3'
  ]);

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= maxResults) break;

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (!excludeDirs.has(entry.name) && !entry.name.startsWith('.')) {
          await searchInDirectory(fullPath, regex, fileMask, results, maxResults);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!binaryExts.has(ext) && matchesFileMask(entry.name, fileMask)) {
          searchInFile(fullPath, regex, results, maxResults);
        }
      }
    }
  } catch {
    // Skip directories we can't read
  }
}

function searchInFile(
  filePath: string,
  regex: RegExp,
  results: SearchResult[],
  maxResults: number
): void {
  try {
    // Check file size - skip files larger than 1MB
    const stats = fs.statSync(filePath);
    if (stats.size > 1024 * 1024) return;

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const fileName = path.basename(filePath);

    for (let lineIndex = 0; lineIndex < lines.length && results.length < maxResults; lineIndex++) {
      const line = lines[lineIndex];
      let match: RegExpExecArray | null;
      
      // Reset regex for each line
      regex.lastIndex = 0;

      while ((match = regex.exec(line)) !== null) {
        if (results.length >= maxResults) break;

        // Calculate the leading whitespace that will be trimmed
        const leadingWhitespace = line.length - line.trimStart().length;
        const adjustedStart = match.index - leadingWhitespace;
        const adjustedEnd = match.index + match[0].length - leadingWhitespace;

        results.push({
          uri: vscode.Uri.file(filePath).toString(),
          fileName,
          relativePath: filePath,
          line: lineIndex,
          character: match.index,
          preview: line.trim(),
          previewMatchRange: {
            start: Math.max(0, adjustedStart),
            end: Math.max(0, adjustedEnd)
          }
        });

        // Prevent infinite loop for zero-length matches
        if (match[0].length === 0) regex.lastIndex++;
      }
    }
  } catch {
    // Skip files that can't be read
  }
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';">
  <title>Find in Files</title>
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

    .search-label {
      font-size: 11px;
      font-weight: 500;
      color: var(--vscode-descriptionForeground);
      min-width: 50px;
    }

    #query {
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

    #query:focus {
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
      </div>
      <div class="scope-input" id="directory-input-wrapper">
        <input type="text" id="directory-input" placeholder="Directory path..." />
      </div>
      <div class="scope-input" id="module-input-wrapper">
        <select id="module-select">
          <option value="">Select module...</option>
        </select>
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
        <span>Preview</span>
        <span class="preview-filename" id="preview-filename"></span>
      </div>
      <div class="preview-content" id="preview-content">
        <div class="empty-state">Select a result to preview file</div>
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

      // Initialize
      vscode.postMessage({ type: 'getModules' });
      vscode.postMessage({ type: 'getCurrentDirectory' });

      // Dynamic search on input
      queryInput.addEventListener('input', () => {
        clearTimeout(state.searchTimeout);
        state.searchTimeout = setTimeout(() => {
          runSearch();
        }, 300); // 300ms debounce
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
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          navigateResults(1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          navigateResults(-1);
        } else if (e.key === 'Enter' && document.activeElement !== directoryInput) {
          e.preventDefault();
          openActiveResult();
        } else if (e.key === 'Escape') {
          queryInput.focus();
          queryInput.select();
        }
      });

      // Messages from extension
      window.addEventListener('message', (event) => {
        const message = event.data;
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
        }
      });

      function updateScopeInputs() {
        directoryInputWrapper.classList.remove('visible');
        moduleInputWrapper.classList.remove('visible');
        if (state.currentScope === 'directory') {
          directoryInputWrapper.classList.add('visible');
        } else if (state.currentScope === 'module') {
          moduleInputWrapper.classList.add('visible');
        }
      }

      function runSearch() {
        const query = queryInput.value.trim();
        state.currentQuery = query;
        
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
        }

        console.log('Sending search message:', message);
        vscode.postMessage(message);
      }

      function handleSearchResults(results) {
        state.results = results;
        state.activeIndex = results.length > 0 ? 0 : -1;

        resultsCount.textContent = results.length + (results.length >= 5000 ? '+' : '') + ' results';

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
        renderFilePreview(message);
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

        let html = '';
        lines.forEach((line, idx) => {
          const lineMatches = fileData.matches.filter(m => m.line === idx);
          const hasMatch = lineMatches.length > 0;
          const isCurrentLine = idx === currentLine;

          let lineClass = 'code-line';
          if (isCurrentLine) lineClass += ' current-match';
          else if (hasMatch) lineClass += ' has-match';

          let lineContent = escapeHtml(line) || ' ';
          
          // Highlight all matches on this line (in reverse order to not mess up indices)
          lineMatches.sort((a, b) => b.start - a.start).forEach(match => {
            const before = lineContent.substring(0, match.start);
            const matchText = lineContent.substring(match.start, match.end);
            const after = lineContent.substring(match.end);
            lineContent = before + '<span class="match">' + matchText + '</span>' + after;
          });

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
