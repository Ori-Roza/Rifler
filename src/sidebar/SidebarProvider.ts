import * as vscode from 'vscode';
import { SearchResult, SearchScope, SearchOptions } from '../utils';
import { performSearch } from '../search';
import { replaceOne, replaceAll } from '../replacer';

export class RiflerSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'rifler.sidebarView';
  
  private _view?: vscode.WebviewView;
  private _context: vscode.ExtensionContext;

  constructor(private readonly context: vscode.ExtensionContext) {
    this._context = context;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken
  ): void | Thenable<void> {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      await this._handleMessage(message);
    });

    // Restore state when view becomes visible
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this._restoreState();
      }
    });

    // Handle dispose
    webviewView.onDidDispose(() => {
      this._view = undefined;
    });
  }

  private async _handleMessage(message: any): Promise<void> {
    // Implement message handling (same as window panel)
    switch (message.type) {
      case 'runSearch':
        await this._runSearch(message);
        break;
      case 'openLocation':
        await this._openLocation(message);
        break;
      case 'replaceOne':
        await replaceOne(message.uri, message.line, message.character, message.length, message.replaceText);
        break;
      case 'replaceAll':
        await this._replaceAll(message);
        break;
      case 'requestStateForMinimize':
        // Return state for minimize
        if (this._view) {
          this._view.webview.postMessage({
            type: 'requestStateForMinimize',
            source: 'sidebar'
          });
        }
        break;
      case 'getModules':
        await this._sendModules();
        break;
      case 'getCurrentDirectory':
        this._sendCurrentDirectory();
        break;
    }
  }

  private async _runSearch(message: any): Promise<void> {
    const results = await performSearch(
      message.query,
      message.scope,
      message.options,
      message.directoryPath,
      message.modulePath,
      message.filePath
    );

    this._view?.webview.postMessage({
      type: 'searchResults',
      results
    });
  }

  private async _openLocation(message: any): Promise<void> {
    const uri = vscode.Uri.parse(message.uri);
    const document = await vscode.workspace.openTextDocument(uri);
    
    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.One,
      preview: false
    });

    const position = new vscode.Position(message.line, message.character);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }

  private async _replaceAll(message: any): Promise<void> {
    await replaceAll(
      message.query,
      message.replaceText,
      message.scope,
      message.options,
      message.directoryPath,
      message.modulePath,
      message.filePath,
      async () => {
        // Refresh search after replace
        await this._runSearch(message);
      }
    );
  }

  private async _sendModules(): Promise<void> {
    const modules: any[] = [];
    const workspaceFolders = vscode.workspace.workspaceFolders;
    
    if (workspaceFolders && workspaceFolders.length > 0) {
      for (const folder of workspaceFolders) {
        const folderUri = folder.uri;
        const folderPath = folderUri.fsPath;
        try {
          const items = await vscode.workspace.fs.readDirectory(folderUri);
          for (const [name, type] of items) {
            if (type === vscode.FileType.Directory && !name.startsWith('.')) {
              modules.push({
                name,
                path: `${folderPath}/${name}`
              });
            }
          }
        } catch (error) {
          // Silently skip folders we can't read
        }
      }
    }

    this._view?.webview.postMessage({
      type: 'modules',
      modules
    });
  }

  private _sendCurrentDirectory(): void {
    const editor = vscode.window.activeTextEditor;
    let directory = '';

    if (editor) {
      const filePath = editor.document.uri.fsPath;
      const workspaceFolders = vscode.workspace.workspaceFolders;
      
      if (workspaceFolders && workspaceFolders.length > 0) {
        directory = workspaceFolders[0].uri.fsPath;
      } else {
        directory = filePath.substring(0, filePath.lastIndexOf('/'));
      }
    }

    this._view?.webview.postMessage({
      type: 'currentDirectory',
      directory
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = this._getNonce();
    
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com; style-src ${webview.cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com;">
      <title>Rifler</title>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/vs2015.min.css">
      <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        
        body { 
          font-family: var(--vscode-font-family);
          font-size: var(--vscode-font-size);
          color: var(--vscode-foreground);
          background-color: var(--vscode-editor-background);
          padding: 8px;
          overflow-y: auto;
        }

        .sidebar-header {
          display: flex;
          align-items: center;
          margin-bottom: 10px;
          font-weight: bold;
          color: var(--vscode-sideBar-foreground);
        }

        .search-container {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .search-input {
          width: 100%;
          padding: 6px 8px;
          border: 1px solid var(--vscode-input-border);
          background-color: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          font-size: 12px;
          border-radius: 2px;
        }

        .search-input:focus {
          outline: none;
          border: 1px solid var(--vscode-focusBorder);
        }

        .search-options {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          font-size: 12px;
        }

        .checkbox-label {
          display: flex;
          align-items: center;
          cursor: pointer;
          user-select: none;
        }

        .checkbox-label input {
          margin-right: 4px;
          cursor: pointer;
        }

        .replace-container {
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid var(--vscode-panel-border);
        }

        .results-container {
          margin-top: 12px;
          max-height: 40vh;
          overflow-y: auto;
          border: 1px solid var(--vscode-panel-border);
          border-radius: 2px;
        }

        .result-item {
          padding: 6px 8px;
          border-bottom: 1px solid var(--vscode-panel-border);
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .result-item:hover {
          background-color: var(--vscode-list-hoverBackground);
        }

        .result-item:active {
          background-color: var(--vscode-list-activeSelectionBackground);
        }

        .result-file {
          font-size: 11px;
          font-weight: bold;
          color: var(--vscode-textLink-foreground);
          margin-bottom: 4px;
        }

        .result-match {
          font-size: 11px;
          color: var(--vscode-foreground);
          white-space: pre-wrap;
          word-break: break-word;
        }

        .match-highlight {
          background-color: var(--vscode-editor-findMatchBackground);
          color: var(--vscode-editor-findMatchForeground);
          padding: 1px 2px;
          border-radius: 1px;
        }

        .result-line {
          font-size: 10px;
          color: var(--vscode-descriptionForeground);
        }

        .no-results {
          padding: 16px 8px;
          text-align: center;
          color: var(--vscode-descriptionForeground);
          font-size: 12px;
        }

        button {
          padding: 6px 12px;
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          border-radius: 2px;
          cursor: pointer;
          font-size: 12px;
          transition: background-color 0.2s;
        }

        button:hover {
          background-color: var(--vscode-button-hoverBackground);
        }

        button:active {
          background-color: var(--vscode-button-activeBackground);
        }

        .status-message {
          padding: 8px;
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
        }

        .error-message {
          padding: 8px;
          background-color: var(--vscode-errorForeground);
          color: var(--vscode-errorBackground);
          border-radius: 2px;
          font-size: 11px;
        }
      </style>
    </head>
    <body>
      <div class="search-container">
        <input type="text" id="query" class="search-input" placeholder="Search..." />
        
        <div class="search-options">
          <label class="checkbox-label">
            <input type="checkbox" id="matchCase" />
            <span>Match Case</span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" id="wholeWord" />
            <span>Whole Word</span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" id="useRegex" />
            <span>Regex</span>
          </label>
        </div>

        <input type="text" id="fileMask" class="search-input" placeholder="File mask (e.g., *.ts)" style="margin-top: 4px;" />

        <button id="searchBtn" style="margin-top: 4px;">Search</button>

        <div class="replace-container" style="display: none;" id="replacePanel">
          <input type="text" id="replaceText" class="search-input" placeholder="Replace with..." />
          <button id="replaceAllBtn" style="margin-top: 4px; width: 100%;">Replace All</button>
        </div>

        <div id="resultsContainer" class="results-container"></div>
        <div id="statusMessage" class="status-message"></div>
      </div>

      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        let currentResults = [];

        const queryInput = document.getElementById('query');
        const matchCaseCheckbox = document.getElementById('matchCase');
        const wholeWordCheckbox = document.getElementById('wholeWord');
        const useRegexCheckbox = document.getElementById('useRegex');
        const fileMaskInput = document.getElementById('fileMask');
        const searchBtn = document.getElementById('searchBtn');
        const replacePanel = document.getElementById('replacePanel');
        const replaceTextInput = document.getElementById('replaceText');
        const replaceAllBtn = document.getElementById('replaceAllBtn');
        const resultsContainer = document.getElementById('resultsContainer');
        const statusMessage = document.getElementById('statusMessage');

        // Search on Enter key
        queryInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            performSearch();
          }
        });

        searchBtn.addEventListener('click', performSearch);
        replaceAllBtn.addEventListener('click', performReplace);

        function performSearch() {
          const query = queryInput.value.trim();
          if (query.length < 2) {
            statusMessage.textContent = 'Query must be at least 2 characters';
            resultsContainer.innerHTML = '';
            return;
          }

          statusMessage.textContent = 'Searching...';
          resultsContainer.innerHTML = '';
          currentResults = [];

          vscode.postMessage({
            type: 'runSearch',
            query,
            scope: 'project',
            options: {
              matchCase: matchCaseCheckbox.checked,
              wholeWord: wholeWordCheckbox.checked,
              useRegex: useRegexCheckbox.checked,
              fileMask: fileMaskInput.value
            }
          });
        }

        function performReplace() {
          const query = queryInput.value.trim();
          const replaceText = replaceTextInput.value;

          if (query.length < 2) {
            statusMessage.textContent = 'Query must be at least 2 characters';
            return;
          }

          statusMessage.textContent = 'Replacing...';

          vscode.postMessage({
            type: 'replaceAll',
            query,
            replaceText,
            scope: 'project',
            options: {
              matchCase: matchCaseCheckbox.checked,
              wholeWord: wholeWordCheckbox.checked,
              useRegex: useRegexCheckbox.checked,
              fileMask: fileMaskInput.value
            }
          });
        }

        window.addEventListener('message', (event) => {
          const message = event.data;

          if (message.type === 'searchResults') {
            currentResults = message.results;
            displayResults(message.results);
          } else if (message.type === 'restoreState') {
            // Restore previous search state
            if (message.state) {
              queryInput.value = message.state.query || '';
              matchCaseCheckbox.checked = message.state.options?.matchCase || false;
              wholeWordCheckbox.checked = message.state.options?.wholeWord || false;
              useRegexCheckbox.checked = message.state.options?.useRegex || false;
              fileMaskInput.value = message.state.options?.fileMask || '';
              replaceTextInput.value = message.state.replaceText || '';
              if (message.state.showReplace) {
                replacePanel.style.display = 'block';
              }
            }
          }
        });

        function displayResults(results) {
          if (results.length === 0) {
            statusMessage.textContent = 'No results found';
            resultsContainer.innerHTML = '<div class="no-results">No matches</div>';
            return;
          }

          statusMessage.textContent = 'Found ' + results.length + ' matches';
          resultsContainer.innerHTML = '';

          results.forEach((result, index) => {
            const item = document.createElement('div');
            item.className = 'result-item';
            
            const fileDiv = document.createElement('div');
            fileDiv.className = 'result-file';
            fileDiv.textContent = result.fileName + ':' + (result.line + 1);
            
            const matchDiv = document.createElement('div');
            matchDiv.className = 'result-match';
            
            // Escape HTML and highlight the match
            const preview = escapeHtml(result.preview);
            const start = result.previewMatchRange?.start || 0;
            const end = result.previewMatchRange?.end || result.preview.length;
            
            const before = preview.substring(0, start);
            const match = preview.substring(start, end);
            const after = preview.substring(end);
            
            matchDiv.innerHTML = before + '<span class="match-highlight">' + match + '</span>' + after;
            
            item.appendChild(fileDiv);
            item.appendChild(matchDiv);
            
            item.addEventListener('click', () => {
              vscode.postMessage({
                type: 'openLocation',
                uri: result.uri,
                line: result.line,
                character: result.character
              });
            });
            
            resultsContainer.appendChild(item);
          });
        }

        function escapeHtml(text) {
          const div = document.createElement('div');
          div.textContent = text;
          return div.innerHTML;
        }
      </script>
    </body>
    </html>`;
  }

  private _restoreState(): void {
    // Restore saved search state
    const state = this._context.globalState.get('rifler.sidebarState');
    if (state && this._view) {
      this._view.webview.postMessage({
        type: 'restoreState',
        state
      });
    }
  }

  private _getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  public show(): void {
    if (this._view) {
      this._view.show(true);
    }
  }

  public postMessage(message: any): void {
    this._view?.webview.postMessage(message);
  }
}
