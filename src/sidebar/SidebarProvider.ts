import * as vscode from 'vscode';
import { SearchScope, SearchOptions, SearchResult, buildSearchRegex, findWorkspaceModules, getOpenKeybindingHint } from '../utils';
import { IncomingMessage } from '../messaging/types';
import { performSearch } from '../search';
import { replaceAll } from '../replacer';
import { getWebviewHtml } from '../webview/webviewUtils';
import { MessageHandler } from '../messaging/handler';
import { registerCommonHandlers } from '../messaging/registerCommonHandlers';
import { StateStore } from '../state/StateStore';

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
  public static readonly sidebarViewType = 'rifler.sidebarView';
  public static readonly bottomViewType = 'rifler.bottomView';
  // Backward-compatible alias used throughout the codebase
  public static readonly viewType = RiflerSidebarProvider.sidebarViewType;
  
  private _view?: vscode.WebviewView;
  private _context: vscode.ExtensionContext;
  activeIndex?: number;
  private _onVisibilityChanged?: (visible: boolean) => void;
  private _pendingInitOptions?: {
    initialQuery?: string;
    showReplace?: boolean;
  };
  private _webviewReady = false;
  private _messageHandler?: MessageHandler;
  private _stateSaveResolver?: () => void;
  private _activePreview?: { uri: string; query: string; options: SearchOptions; activeIndex?: number };
  private _applyingFromWebview = new Set<string>(); // Track URIs being edited from webview to prevent loops
  private _lastAppliedTextFromRifler = new Map<string, string>(); // Track last applied content per URI
  private _suppressSideEffectsUntil = 0;
  private _shouldSaveOnNextHide = false;
  private _lastVisibility?: boolean;

  public readonly viewType: string;
  private readonly _stateKey: string;
  private readonly _logLabel: string;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly stateStore?: StateStore,
    options: { viewType?: string; stateKey?: string; logLabel?: string } = {}
  ) {
    this._context = context;
    this.viewType = options.viewType ?? RiflerSidebarProvider.sidebarViewType;
    // Bottom and sidebar intentionally share state by default for a seamless experience.
    this._stateKey = options.stateKey ?? 'rifler.sidebarState';
    this._logLabel = options.logLabel ?? (this.viewType === RiflerSidebarProvider.bottomViewType ? 'BottomProvider' : 'SidebarProvider');
  }

  public suppressVisibilitySideEffects(ms: number): void {
    this._suppressSideEffectsUntil = Date.now() + ms;
  }

  private _sideEffectsSuppressed(): boolean {
    return Date.now() < this._suppressSideEffectsUntil;
  }

  public markShouldSaveOnNextHide(): void {
    this._shouldSaveOnNextHide = true;
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
    this._webviewReady = false;
    console.log(`Rifler ${this._logLabel} WebviewView resolved`);

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
      applyEdits: (uri, content) => this._applyEdits(uri, content),
      stateStore: this.stateStore
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
      const currentVisibility = webviewView.visible;
      if (this._sideEffectsSuppressed()) {
        console.log('SidebarProvider: visibility changed but side effects suppressed. visible =', currentVisibility);
        this._lastVisibility = currentVisibility;
        return;
      }
      console.log('SidebarProvider: visibility changed, visible =', currentVisibility);
      this._lastVisibility = currentVisibility;
      if (currentVisibility) {
        // Only restore state if we don't have a pending initialQuery (selection takes precedence)
        if (!this._pendingInitOptions?.initialQuery) {
          this._restoreState();
        }
        if (this._onVisibilityChanged) {
          this._onVisibilityChanged(true);
        }
      } else {
        if (this._shouldSaveOnNextHide) {
          this._shouldSaveOnNextHide = false;
          console.log('SidebarProvider: sidebar hidden, requesting state save');
          webviewView.webview.postMessage({ type: 'requestStateForMinimize' });
        } else {
          console.log('SidebarProvider: hidden due to incidental layout/focus; skipping save');
        }
        if (this._onVisibilityChanged) {
          this._onVisibilityChanged(false);
        }
      }
    });

    // Handle dispose
    webviewView.onDidDispose(() => {
      this._view = undefined;
      this._webviewReady = false;
    });

    // Refresh preview when the currently previewed document changes in VS Code
    this._context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        this._refreshPreviewFromDocument(e.document);
      })
    );

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
      'applyEdits',
      'validateRegex',
      'validateFileMask',
      'validateDirectory',
      '__diag_ping',
      '__test_searchCompleted',
      '__test_searchResultsReceived',
      '__test_clearSearchHistory',
      'error'
    ]);
    if (commonTypes.has(message.type)) {
      await this._messageHandler?.handle(message as IncomingMessage);
      return;
    }

    switch (message.type) {
      case 'runSearch': {
        // Handle search locally to persist state after each search
        const searchMessage = message as unknown as { query: string; scope: SearchScope; options: SearchOptions; directoryPath?: string; modulePath?: string; activeIndex?: number };
        await this._runSearch(searchMessage);
        break;
      }
      case 'webviewReady': {
        this._webviewReady = true;
        // Restore persisted sidebar state first
        this._restoreState();
        // Then apply pending initialization options (e.g. selection query) so they win over restored state
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

        // Send search history after restore/pending init so UI can show recent entries
        if (this.stateStore) {
          this._view?.webview.postMessage({
            type: 'searchHistory',
            entries: this.stateStore.getSearchHistory()
          });
        }
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
        console.log(`${this._logLabel}: received minimize message with state:`, message.state);
        if (message.state) {
          const cfg = vscode.workspace.getConfiguration('rifler');
          const scope = cfg.get<'workspace' | 'global' | 'off'>('persistenceScope', 'workspace');
          const persist = cfg.get<boolean>('persistSearchState', true) && scope !== 'off';
          const store = scope === 'global' ? this._context.globalState : this._context.workspaceState;
          if (persist) {
            await store.update(this._stateKey, message.state as unknown as SidebarState);
            console.log(`${this._logLabel}: state saved to ${this._stateKey}`);
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
          await store.update(this._stateKey, undefined);
        }
        break;
    }
  }

  private async _runSearch(message: { query: string; scope: SearchScope; options: SearchOptions; directoryPath?: string; modulePath?: string; activeIndex?: number }): Promise<void> {
    if (!message.query || !message.scope || !message.options) {
      return;
    }

    const results = await performSearch(
      message.query,
      message.scope as SearchScope,
      message.options,
      message.directoryPath,
      message.modulePath
    );

    const activeIndex = message.activeIndex ?? (results.length > 0 ? 0 : -1);

    this._view?.webview.postMessage({
      type: 'searchResults',
      results,
      activeIndex
    });

    if (this.stateStore) {
      this.stateStore.recordSearch({
        query: message.query,
        scope: message.scope,
        directoryPath: message.directoryPath,
        modulePath: message.modulePath,
        options: {
          matchCase: !!message.options.matchCase,
          wholeWord: !!message.options.wholeWord,
          useRegex: !!message.options.useRegex,
          fileMask: message.options.fileMask || ''
        }
      });
      this._view?.webview.postMessage({
        type: 'searchHistory',
        entries: this.stateStore.getSearchHistory()
      });
    }

    // Save search state for persistence
    const cfg = vscode.workspace.getConfiguration('rifler');
    const scope = cfg.get<'workspace' | 'global' | 'off'>('persistenceScope', 'workspace');
    const persist = cfg.get<boolean>('persistSearchState', true) && scope !== 'off';
    const store = scope === 'global' ? this._context.globalState : this._context.workspaceState;
    if (persist) {
      await store.update(this._stateKey, {
        query: message.query,
        scope: message.scope,
        options: message.options,
        directoryPath: message.directoryPath,
        modulePath: message.modulePath,
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

  private async _replaceAll(message: { query: string; replaceText: string; scope: SearchScope; options: SearchOptions; directoryPath?: string; modulePath?: string }): Promise<void> {
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
      // Prefer open document text (includes unsaved changes); fallback to disk
      const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uriString);
      let text: string;
      if (openDoc) {
        text = openDoc.getText();
      } else {
        const content = await vscode.workspace.fs.readFile(uri);
        text = new TextDecoder().decode(content);
      }
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

      const relativePath = vscode.workspace.asRelativePath(vscode.Uri.parse(uriString));

      const payload = {
        type: 'fileContent',
        uri: uriString,
        content: text,
        fileName,
        relativePath,
        iconUri,
        matches
      };

      // Track active preview for live refresh
      this._activePreview = { uri: uriString, query, options, activeIndex };

      this._view?.webview.postMessage(payload);

      // Persist last preview and active index for instant restore
      const cfg = vscode.workspace.getConfiguration('rifler');
      const scope = cfg.get<'workspace' | 'global' | 'off'>('persistenceScope', 'workspace');
      const persist = cfg.get<boolean>('persistSearchState', true) && scope !== 'off';
      const store = scope === 'global' ? this._context.globalState : this._context.workspaceState;
      const existing = store.get<SidebarState>(this._stateKey) || {};
      if (persist) {
        await store.update(this._stateKey, {
          ...existing,
          lastPreview: payload,
          activeIndex: activeIndex ?? existing.activeIndex ?? 0
        });
      }
    } catch (error) {
      console.error('Error reading file for preview:', error);
    }
  }

  private async _refreshPreviewFromDocument(doc: vscode.TextDocument): Promise<void> {
    if (!this._view || !this._activePreview) return;

    const key = doc.uri.toString();
    if (key !== this._activePreview.uri) return;

    // Avoid loops when updates originated from webview
    if (this.isApplyingFromWebview(doc.uri)) return;

    const text = doc.getText();
    const fileName = doc.uri.path.split('/').pop() || 'File';

    const relativePath = vscode.workspace.asRelativePath(doc.uri);

    const matches: Array<{ line: number; start: number; end: number }> = [];
    const lines = text.split('\n');
    const regex = buildSearchRegex(this._activePreview.query, this._activePreview.options);

    if (regex) {
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(line)) !== null) {
          matches.push({ line: lineIndex, start: match.index, end: match.index + match[0].length });
          if (match[0].length === 0) regex.lastIndex++;
        }
      }
    }

    const languageId = this.getLanguageIdFromFilename(fileName);
    const iconUri = `vscode-icon://file_type_${languageId}`;

    this._view.webview.postMessage({
      type: 'fileContent',
      uri: this._activePreview.uri,
      content: text,
      fileName,
      relativePath,
      iconUri,
      matches
    });
  }

  private async _applyEdits(uriString: string | undefined, content: string | undefined): Promise<void> {
    if (!uriString || content === undefined) {
      return;
    }

    try {
      const uri = vscode.Uri.parse(uriString);
      const key = uri.toString();
      
      // Mark that we're applying edits from the webview
      this._applyingFromWebview.add(key);
      
      try {
        // Open the document (or get if already open)
        const doc = await vscode.workspace.openTextDocument(uri);
        
        // Check for conflicts: if document is dirty and content doesn't match our last applied
        const lastApplied = this._lastAppliedTextFromRifler.get(key);
        const currentText = doc.getText();
        
        // If doc is dirty and content has diverged from our last applied, it's a conflict
        if (doc.isDirty && lastApplied !== undefined && currentText !== lastApplied) {
          // Conflict detected: notify webview
          this._view?.webview.postMessage({
            type: 'editConflict',
            uri: uriString,
            reason: 'vsCodeDirtyOrDiverged'
          });
          return;
        }
        
        // Apply the edit via WorkspaceEdit (doesn't save to disk)
        const fullRange = new vscode.Range(
          doc.positionAt(0),
          doc.positionAt(doc.getText().length)
        );
        
        const edit = new vscode.WorkspaceEdit();
        edit.replace(uri, fullRange, content);
        
        await vscode.workspace.applyEdit(edit);
        
        // Track this as the last applied content
        this._lastAppliedTextFromRifler.set(key, content);
      } finally {
        // Remove guard on next tick so VS Code has emitted change events
        setTimeout(() => {
          this._applyingFromWebview.delete(key);
        }, 0);
      }
    } catch (error) {
      const fileName = uriString.split('/').pop() || 'file';
      console.error('Error applying edits:', error);
      vscode.window.showErrorMessage(`Could not update ${fileName}: ${error}`);
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
    const state = store.get(this._stateKey);

    if (this._view) {
      // Send configuration to webview
      const replaceKeybinding = cfg.get<string>('replaceInPreviewKeybinding', 'ctrl+shift+r');
      const maxResults = cfg.get<number>('maxResults', 10000);
      const resultsShowCollapsed = cfg.get<boolean>('results.showCollapsed', false);
      const openKeybindingHint = getOpenKeybindingHint(cfg);

      this._view.webview.postMessage({
        type: 'config',
        replaceKeybinding,
        maxResults,
        resultsShowCollapsed,
        openKeybindingHint
      });

      console.log(`${this._logLabel}._restoreState: state =`, state ? 'exists' : 'undefined', state);
      if (state) {
        console.log(`${this._logLabel}._restoreState: sending restoreState message`);
        this._view.webview.postMessage({
          type: 'restoreState',
          state
        });
      } else {
        console.log(`${this._logLabel}._restoreState: no state to restore, sending clearState`);
        this._view.webview.postMessage({ type: 'clearState' });
      }
    }
  }

  public show(): void {
    if (this._view) {
      this._view.show(true);
    }
  }

  public postMessage(message: { type: string; [key: string]: unknown }): void {
    // Before the webview is ready, VS Code may drop messages.
    // Buffer key init messages and send them after 'webviewReady'.
    const shouldBufferUntilReady =
      message.type === 'setSearchQuery' ||
      message.type === 'showReplace' ||
      message.type === 'focusSearch';

    if (shouldBufferUntilReady && (!this._view || !this._webviewReady)) {
      if (!this._pendingInitOptions) {
        this._pendingInitOptions = {};
      }
      if (message.type === 'setSearchQuery') {
        this._pendingInitOptions.initialQuery = message.query as string;
      } else if (message.type === 'showReplace') {
        this._pendingInitOptions.showReplace = true;
      }
      return;
    }

    // For setSearchQuery, mark pending so visibility handler won't overwrite with restored state
    if (message.type === 'setSearchQuery' && message.query) {
      if (!this._pendingInitOptions) {
        this._pendingInitOptions = {};
      }
      this._pendingInitOptions.initialQuery = message.query as string;
      // Clear after a brief delay so it doesn't persist forever
      setTimeout(() => {
        if (this._pendingInitOptions?.initialQuery === message.query) {
          this._pendingInitOptions = undefined;
        }
      }, 500);
    }

    if (this._view) {
      this._view.webview.postMessage(message);
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
  }

  public sendConfigUpdate(resultsShowCollapsed: boolean): void {
    if (this._view) {
      this._view.webview.postMessage({
        type: 'config',
        resultsShowCollapsed,
        openKeybindingHint: getOpenKeybindingHint(vscode.workspace.getConfiguration('rifler'))
      });
    }
  }

  public isApplyingFromWebview(uri: vscode.Uri): boolean {
    return this._applyingFromWebview.has(uri.toString());
  }
}
