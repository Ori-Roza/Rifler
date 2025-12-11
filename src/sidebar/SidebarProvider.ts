import * as vscode from 'vscode';
import { SearchScope, SearchOptions } from '../utils';
import { performSearch } from '../search';
import { replaceOne, replaceAll } from '../replacer';
import { getWebviewHtml } from '../extension';

interface SearchMessage {
  type: string;
  query?: string;
  scope?: string;
  options?: SearchOptions;
  directoryPath?: string;
  modulePath?: string;
  filePath?: string;
  uri?: string;
  line?: number;
  character?: number;
  length?: number;
  replaceText?: string;
  content?: string;
  state?: any;
}

export class RiflerSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'rifler.sidebarView';
  
  private _view?: vscode.WebviewView;
  private _context: vscode.ExtensionContext;

  constructor(private readonly context: vscode.ExtensionContext) {
    this._context = context;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void | Thenable<void> {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    webviewView.webview.html = getWebviewHtml(webviewView.webview);

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

  private async _handleMessage(message: SearchMessage): Promise<void> {
    // Implement message handling (same as window panel)
    switch (message.type) {
      case 'runSearch':
        await this._runSearch(message);
        break;
      case 'openLocation':
        await this._openLocation(message);
        break;
      case 'replaceOne':
        if (message.uri && message.line !== undefined && message.character !== undefined && message.length !== undefined && message.replaceText) {
          await replaceOne(message.uri, message.line, message.character, message.length, message.replaceText);
        }
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
      case 'getFileContent':
        await this._sendFileContent(message.uri, message.query, message.options);
        break;
      case 'saveFile':
        await this._saveFile(message.uri, message.content);
        break;
      case 'minimize':
        // Save state before minimize
        if (message.state) {
          await this._context.globalState.update('rifler.sidebarState', message.state);
        }
        break;
    }
  }

  private async _runSearch(message: SearchMessage): Promise<void> {
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

    this._view?.webview.postMessage({
      type: 'searchResults',
      results
    });

    // Save search state for persistence
    await this._context.globalState.update('rifler.sidebarState', {
      query: message.query,
      scope: message.scope,
      options: message.options,
      directoryPath: message.directoryPath,
      modulePath: message.modulePath,
      filePath: message.filePath,
      results: results
    });
  }

  private async _openLocation(message: SearchMessage): Promise<void> {
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

  private async _replaceAll(message: SearchMessage): Promise<void> {
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
    const modules: Array<{ name: string; path: string }> = [];
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

  private async _sendFileContent(uriString: string | undefined, query: string | undefined, options: SearchOptions | undefined): Promise<void> {
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
      const { buildSearchRegex } = require('../utils');
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

      this._view?.webview.postMessage({
        type: 'fileContent',
        uri: uriString,
        content: text,
        fileName,
        matches
      });
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
      
      // Show confirmation
      const fileName = uri.path.split('/').pop() || 'File';
      vscode.window.showInformationMessage(`Saved ${fileName}`);
    } catch (error) {
      const fileName = uriString.split('/').pop() || 'file';
      console.error('Error saving file:', error);
      vscode.window.showErrorMessage(`Could not save ${fileName}: ${error}`);
    }
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

  public show(): void {
    if (this._view) {
      this._view.show(true);
    }
  }

  public postMessage(message: SearchMessage): void {
    this._view?.webview.postMessage(message);
  }
}
