import * as vscode from 'vscode';
import { SearchResult, SearchScope, SearchOptions } from './utils';
import { performSearch } from './search';

/**
 * Extended QuickPickItem with search result metadata
 */
interface SearchQuickPickItem extends vscode.QuickPickItem {
  result: SearchResult;
}

/**
 * Popup search using VS Code's QuickPick API
 * Provides a lightweight, modal search experience similar to JetBrains IDEs
 */
export async function showPopupSearch(
  context: vscode.ExtensionContext,
  selectedText?: string
): Promise<void> {
  const quickPick = vscode.window.createQuickPick<SearchQuickPickItem>();
  
  let currentScope: SearchScope = 'project';
  let currentOptions: SearchOptions = {
    matchCase: false,
    wholeWord: false,
    useRegex: false,
    fileMask: ''
  };
  let currentSearchPath: string | undefined;
  
  quickPick.placeholder = 'Search files... (type at least 2 characters)';
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  quickPick.ignoreFocusOut = false;
  
  // Set initial value if text is selected
  if (selectedText) {
    quickPick.value = selectedText;
  }

  let isSearching = false;
  let lastQuery = '';

  /**
   * Perform search and update QuickPick items
   */
  async function performQuickPickSearch(query: string): Promise<void> {
    if (isSearching) return;
    if (query.length < 2) {
      quickPick.items = [];
      return;
    }

    isSearching = true;
    try {
      const results = await performSearch(
        query,
        currentScope,
        currentOptions,
        currentSearchPath,
        undefined,
        undefined
      );

      const items: SearchQuickPickItem[] = results.map(result => ({
        label: result.fileName || 'unknown',
        description: result.relativePath || result.uri,
        detail: formatResultPreview(result),
        result: result
      }));

      quickPick.items = items;
      
      if (items.length === 0) {
        quickPick.items = [
          {
            label: 'No results found',
            description: '',
            result: {} as SearchResult
          } as SearchQuickPickItem
        ];
      }
    } catch (error) {
      console.error('Search error in popup:', error);
      vscode.window.showErrorMessage(`Search error: ${error}`);
    } finally {
      isSearching = false;
    }
  }

  /**
   * Format result preview text
   */
  function formatResultPreview(result: SearchResult): string {
    if (result.preview) {
      // Truncate preview to reasonable length
      const maxLength = 80;
      let preview = result.preview.trim();
      if (preview.length > maxLength) {
        preview = preview.substring(0, maxLength) + '...';
      }
      return `Ln ${result.line}, Col ${result.character} - ${preview}`;
    }
    return `Ln ${result.line}, Col ${result.character}`;
  }

  /**
   * Handle item selection
   */
  quickPick.onDidAccept(async () => {
    const selected = quickPick.selectedItems[0];
    if (selected && selected.result.uri) {
      quickPick.hide();
      await openSearchResult(selected.result);
    }
  });

  /**
   * Handle input changes
   */
  quickPick.onDidChangeValue((value) => {
    if (value !== lastQuery) {
      lastQuery = value;
      performQuickPickSearch(value);
    }
  });

  /**
   * Handle hide/dispose
   */
  quickPick.onDidHide(() => {
    quickPick.dispose();
  });

  // Show the quick pick
  quickPick.show();

  // Perform initial search if there's selected text
  if (selectedText && selectedText.length >= 2) {
    await performQuickPickSearch(selectedText);
  }
}

/**
 * Open a search result in the editor
 */
async function openSearchResult(result: SearchResult): Promise<void> {
  try {
    const uri = vscode.Uri.parse(result.uri);
    const document = await vscode.workspace.openTextDocument(uri);

    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.One,
      preview: false,
      preserveFocus: false
    });

    // Jump to the location
    const position = new vscode.Position(
      result.line,
      result.character
    );
    const selection = new vscode.Selection(position, position);

    editor.selection = selection;
    editor.revealRange(
      new vscode.Range(position, position),
      vscode.TextEditorRevealType.InCenter
    );

    // Optional: highlight the match
    if (result.length > 0) {
      const endPosition = new vscode.Position(
        result.line,
        result.character + result.length
      );
      const decoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(255, 255, 0, 0.3)',
        border: '1px solid rgba(255, 200, 0, 0.5)'
      });
      editor.setDecorations(decoration, [
        new vscode.Range(position, endPosition)
      ]);

      // Clear decoration after 2 seconds
      setTimeout(() => {
        decoration.dispose();
      }, 2000);
    }
  } catch (error) {
    console.error('Error opening search result:', error);
    vscode.window.showErrorMessage(`Could not open file: ${error}`);
  }
}
