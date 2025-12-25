import * as vscode from 'vscode';
import { SearchScope, SearchOptions, SearchResult, buildSearchRegex, findWorkspaceModules } from '../utils';
import { IncomingMessage } from '../messaging/types';
import { performSearch } from '../search';
import { replaceAll } from '../replacer';
import { getWebviewHtml } from '../webview/webviewUtils';
import { MessageHandler } from '../messaging/handler';
import { registerCommonHandlers } from '../messaging/registerCommonHandlers';

interface SidebarState {
  query?: string;
  replaceText?: string;
  scope?: SearchScope | string;
  directoryPath?: string;
  modulePath?: string;
  filePath?: string;
  options?: SearchOptions;
  showReplace?: boolean;
  showFilters?: boolean;
  results?: SearchResult[];
  activeIndex?: number;
  lastPreview?: {
    uri: string;
    content: string;
    fileName: string;
    matches: Array<{ line: number; start: number; end: number }>;
  };
}

export class RiflerSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'rifler.sidebarView';
  
  private _view?: vscode.WebviewView;
  private _context: vscode.ExtensionContext;
  activeIndex?: number;
  private _onVisibilityChanged?: (visible: boolean) => void;
  private _pendingInitOptions?: {
    initialQuery?: string;
    showReplace?: boolean;
  };
  private _messageHandler?: MessageHandler;
  private _stateSaveResolver?: () => void;

  constructor(private readonly context: vscode.ExtensionContext) {
    this._context = context;
  }

  public setVisibilityCallback(callback: (visible: boolean) => void): void {
    this._onVisibilityChanged = callback;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void | Thenable<void> {
    this._view = webviewView;
    console.log('Rifler Sidebar WebviewView resolved');

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    webviewView.webview.html = getWebviewHtml(webviewView.webview, this.context.extensionUri);

    // Notify initial visibility
    if (this._onVisibilityChanged) {
      this._onVisibilityChanged(webviewView.visible);
    }

    // Initialize unified message handler before wiring message listener
    this._messageHandler = new MessageHandler(webviewView);
    registerCommonHandlers(this._messageHandler, {
      postMessage: (msg) => this._view?.webview.postMessage(msg),
      openLocation: (uri, line, character) => this._openLocation({ type: 'openLocation', uri, line, character }),
      sendModules: () => this._sendModules(),
      sendCurrentDirectory: () => this._sendCurrentDirectory(),
      sendWorkspaceInfo: () => this._sendWorkspaceInfo(),
      sendFileContent: (uri, query, options, activeIndex) => this._sendFileContent(uri, query, options, activeIndex),
      saveFile: (uri, content) => this._saveFile(uri, content)
    });

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      // Basic payload validation: require a type string and limit size of known fields
      if (!message || typeof (message as Record<string, unknown>).type !== 'string') {
        return;
      }
      const m = message as Record<string, unknown>;
      if (typeof m['query'] === 'string' && (m['query'] as string).length > 2000) {
        // prevent excessively large queries
        return;
      }
      if (typeof m['replaceText'] === 'string' && (m['replaceText'] as string).length > 2000) {
        return;
      }
      await this._handleMessage(message);
    });
    // Restore state when view becomes visible, save when hidden
    webviewView.onDidChangeVisibility(() => {
      console.log('SidebarProvider: visibility changed, visible =', webviewView.visible);
      if (webviewView.visible) {
        this._restoreState();
        // Notify that sidebar is now visible
        if (this._onVisibilityChanged) {
          this._onVisibilityChanged(true);
        }
      } else {
        // Save state before hiding - request state from webview
        console.log('SidebarProvider: sidebar hidden, requesting state save');
        webviewView.webview.postMessage({ type: 'requestStateForMinimize' });
        // Notify that sidebar is now hidden
        if (this._onVisibilityChanged) {
          this._onVisibilityChanged(false);
        }
      }
    });

    // Handle dispose
    webviewView.onDidDispose(() => {
      this._view = undefined;
    });

    // Initial state restore if visible
    if (webviewView.visible) {
      this._restoreState();
    }
  }

  private async _handleMessage(message: { type: string; [key: string]: unknown }): Promise<void> {
    // Delegate common message types to shared handler first
    // NOTE: runSearch is NOT in this set - we handle it specially below to save state
    const commonTypes = new Set([
      'openLocation',
      'replaceOne',
      'replaceAll',
      'getModules',
      'getCurrentDirectory',
      'getFileContent',
      'saveFile',
      'validateRegex',
      'validateFileMask',
      '__diag_ping',
      '__test_searchCompleted',
      '__test_searchResultsReceived',
      'error'
    ]);
    if (commonTypes.has(message.type)) {
      await this._messageHandler?.handle(message as IncomingMessage);
      return;
    }

    switch (message.type) {
      case 'runSearch': {
        // Handle search locally to persist state after each search
        const searchMessage = message as unknown as { query: string; scope: SearchScope; options: SearchOptions; directoryPath?: string; modulePath?: string; filePath?: string; activeIndex?: number };
        await this._runSearch(searchMessage);
        break;
      }
      case 'webviewReady': {
        // Send pending initialization options when webview is ready
        if (this._pendingInitOptions) {
          const { initialQuery, showReplace } = this._pendingInitOptions;
          if (showReplace) {
            this._view?.webview.postMessage({ type: 'showReplace' });
          }
          if (initialQuery) {
            this._view?.webview.postMessage({
              type: 'setSearchQuery',
              query: initialQuery
            });
          }
          this._pendingInitOptions = undefined;
        }
        // Restore persisted sidebar state immediately on initial ready
        this._restoreState();
        break;
      }
      case 'requestStateForMinimize':
        // Return state for minimize
        if (this._view) {
          this._view.webview.postMessage({
            type: 'requestStateForMinimize',
            source: 'sidebar'
          });
        }
        break;
      case 'minimize':
        // Save state before minimize
        console.log('SidebarProvider: received minimize message with state:', message.state);
        if (message.state) {
          const cfg = vscode.workspace.getConfiguration('rifler');
          const scope = cfg.get<'workspace' | 'global' | 'off'>('persistenceScope', 'workspace');
          const persist = cfg.get<boolean>('persistSearchState', true) && scope !== 'off';
          const store = scope === 'global' ? this._context.globalState : this._context.workspaceState;
          if (persist) {
            await store.update('rifler.sidebarState', message.state as unknown as SidebarState);
            console.log('SidebarProvider: state saved to rifler.sidebarState');
          }
          // Resolve any pending save promise
          if (this._stateSaveResolver) {
            this._stateSaveResolver();
            this._stateSaveResolver = undefined;
          }
        }
        break;
      case 'clearState':
        // Clear saved state when search is cleared
        {
          const cfg = vscode.workspace.getConfiguration('rifler');
          const scope = cfg.get<'workspace' | 'global' | 'off'>('persistenceScope', 'workspace');
          const store = scope === 'global' ? this._context.globalState : this._context.workspaceState;
          await store.update('rifler.sidebarState', undefined);
        }
        break;
    }
  }

  private async _runSearch(message: { query: string; scope: SearchScope; options: SearchOptions; directoryPath?: string; modulePath?: string; filePath?: string; activeIndex?: number }): Promise<void> {
    if (!message.query || !message.scope || !message.options) {
      return;
    }

    const results = await performSearch(
      message.query,
      message.scope as SearchScope,
      message.options,
      message.directoryPath,
      message.modulePath,
      message.filePath
    );

    const activeIndex = message.activeIndex ?? (results.length > 0 ? 0 : -1);

    this._view?.webview.postMessage({
      type: 'searchResults',
      results,
      activeIndex
    });

    // Save search state for persistence
    const cfg = vscode.workspace.getConfiguration('rifler');
    const scope = cfg.get<'workspace' | 'global' | 'off'>('persistenceScope', 'workspace');
    const persist = cfg.get<boolean>('persistSearchState', true) && scope !== 'off';
    const store = scope === 'global' ? this._context.globalState : this._context.workspaceState;
    if (persist) {
      await store.update('rifler.sidebarState', {
      query: message.query,
      scope: message.scope,
      options: message.options,
      directoryPath: message.directoryPath,
      modulePath: message.modulePath,
      filePath: message.filePath,
      results: results,
      activeIndex
      });
    }
  }

  private async _openLocation(message: { type: string; uri: string; line: number; character: number }): Promise<void> {
    if (!message.uri || message.line === undefined || message.character === undefined) {
      return;
    }

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

  private async _replaceAll(message: { query: string; replaceText: string; scope: SearchScope; options: SearchOptions; directoryPath?: string; modulePath?: string; filePath?: string }): Promise<void> {
    if (!message.query || message.replaceText === undefined || !message.scope || !message.options) {
      return;
    }

    await replaceAll(
      message.query,
      message.replaceText,
      message.scope as SearchScope,
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
    if (!this._view) {
      return;
    }
    try {
      const modules = await findWorkspaceModules();
      this._view.webview.postMessage({
        type: 'modulesList',
        modules
      });
    } catch (error) {
      console.error('Error sending modules list to sidebar:', error);
    }
  }

  public sendModules(): void {
    this._sendModules();
  }

  private _sendCurrentDirectory(): void {
    if (!this._view) {
      return;
    }
    const workspaceFolders = vscode.workspace.workspaceFolders;
    let directory = '';

    if (workspaceFolders && workspaceFolders.length > 0) {
      // Default to the first workspace folder (project root)
      directory = workspaceFolders[0].uri.fsPath;
    }

    this._view.webview.postMessage({
      type: 'currentDirectory',
      directory
    });
  }

  private _sendWorkspaceInfo(): void {
    if (!this._view) {
      return;
    }
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

    this._view.webview.postMessage({
      type: 'workspaceInfo',
      name,
      path
    });
  }

  public sendCurrentDirectory(): void {
    this._sendCurrentDirectory();
  }

  private async _sendFileContent(uriString: string | undefined, query: string | undefined, options: SearchOptions | undefined, activeIndex?: number): Promise<void> {
    if (!uriString || !query || !options) {
      return;
    }

    try {
      const uri = vscode.Uri.parse(uriString);
      const content = await vscode.workspace.fs.readFile(uri);
      const text = new TextDecoder().decode(content);
      const fileName = uri.path.split('/').pop() || 'File';

      // Find all matches in the file using buildSearchRegex from utils
      const matches: Array<{ line: number; start: number; end: number }> = [];
      const lines = text.split('\n');
      const regex = buildSearchRegex(query, options);

      if (regex) {
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
          const line = lines[lineIndex];
          let match: RegExpExecArray | null;

          // Reset regex for each line
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

      // Get language ID for icon
      const languageId = this.getLanguageIdFromFilename(fileName);
      const iconUri = `vscode-icon://file_type_${languageId}`;

      const payload = {
        type: 'fileContent',
        uri: uriString,
        content: text,
        fileName,
        iconUri,
        matches
      };

      this._view?.webview.postMessage(payload);

      // Persist last preview and active index for instant restore
      const cfg = vscode.workspace.getConfiguration('rifler');
      const scope = cfg.get<'workspace' | 'global' | 'off'>('persistenceScope', 'workspace');
      const persist = cfg.get<boolean>('persistSearchState', true) && scope !== 'off';
      const store = scope === 'global' ? this._context.globalState : this._context.workspaceState;
      const existing = store.get<SidebarState>('rifler.sidebarState') || {};
      if (persist) {
        await store.update('rifler.sidebarState', {
        ...existing,
        lastPreview: payload,
        activeIndex: activeIndex ?? existing.activeIndex ?? 0
        });
      }
    } catch (error) {
      console.error('Error reading file for preview:', error);
    }
  }

  private async _saveFile(uriString: string | undefined, content: string | undefined): Promise<void> {
    if (!uriString || !content) {
      return;
    }

    try {
      const uri = vscode.Uri.parse(uriString);
      const encoder = new TextEncoder();
      await vscode.workspace.fs.writeFile(uri, encoder.encode(content));
    } catch (error) {
      const fileName = uriString.split('/').pop() || 'file';
      console.error('Error saving file:', error);
      vscode.window.showErrorMessage(`Could not save ${fileName}: ${error}`);
    }
  }

  private _restoreState(): void {
    // Restore saved search state
    const cfg = vscode.workspace.getConfiguration('rifler');
    const scope = cfg.get<'workspace' | 'global' | 'off'>('persistenceScope', 'workspace');
    const store = scope === 'global' ? this._context.globalState : this._context.workspaceState;
    const state = store.get('rifler.sidebarState');
    console.log('SidebarProvider._restoreState: state =', state ? 'exists' : 'undefined', state);
    if (state && this._view) {
      console.log('SidebarProvider._restoreState: sending restoreState message');
      this._view.webview.postMessage({
        type: 'restoreState',
        state
      });
    } else if (this._view) {
      console.log('SidebarProvider._restoreState: no state to restore, sending clearState');
      this._view.webview.postMessage({ type: 'clearState' });
    }
  }

  public show(): void {
    if (this._view) {
      this._view.show(true);
    }
  }

  public postMessage(message: { type: string; [key: string]: unknown }): void {
    // If view is ready, forward immediately
    if (this._view) {
      this._view.webview.postMessage(message);
      return;
    }

    // Otherwise queue initialization messages until webview is ready
    if (message.type === 'setSearchQuery' || message.type === 'showReplace') {
      if (!this._pendingInitOptions) {
        this._pendingInitOptions = {};
      }
      if (message.type === 'setSearchQuery') {
        this._pendingInitOptions.initialQuery = message.query as string;
      } else {
        this._pendingInitOptions.showReplace = true;
      }
    }
  }

  /**
   * Request the webview to save its current state and wait for completion
   */
  public async requestSaveState(): Promise<void> {
    if (!this._view) {
      return;
    }

    return new Promise<void>((resolve) => {
      this._stateSaveResolver = resolve;
      this._view!.webview.postMessage({ type: 'requestStateForMinimize' });
      
      // Timeout fallback in case webview doesn't respond
      setTimeout(() => {
        if (this._stateSaveResolver) {
          this._stateSaveResolver();
          this._stateSaveResolver = undefined;
        }
      }, 500);
    });
  }
  private getLanguageIdFromFilename(fileName: string): string {
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
  }}
