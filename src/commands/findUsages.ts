import * as vscode from 'vscode';
import { CommandContext } from './types';

/**
 * rifler.findUsages - Open Rifler with LSP Usage-Aware Search mode pre-activated
 */
export async function findUsagesCommand(ctx: CommandContext): Promise<void> {
  try {
    const config = vscode.workspace.getConfiguration('rifler');
    const panelLocation = config.get<string>('panelLocation', 'sidebar');

    // Get the symbol at cursor for the initial query
    const editor = vscode.window.activeTextEditor;
    let symbolName: string | undefined;
    if (editor) {
      const position = editor.selection.active;
      const wordRange = editor.document.getWordRangeAtPosition(position);
      if (wordRange) {
        symbolName = editor.document.getText(wordRange);
      }
    }

    // Open the view
    if (panelLocation === 'sidebar' || panelLocation === 'bottom') {
      await ctx.viewManager.openView({
        forcedLocation: panelLocation as 'sidebar' | 'bottom',
        initialQuery: symbolName,
        initialQueryFocus: false,
      });
    } else {
      await ctx.viewManager.openView({
        initialQuery: symbolName,
        initialQueryFocus: false,
      });
    }

    // After the view is ready, tell the webview to switch to LSP mode
    // Use a short delay to ensure webviewReady has been processed
    setTimeout(() => {
      ctx.sidebarProvider.postMessage({ type: 'setSearchMode', mode: 'lsp' });
    }, 200);
  } catch (error) {
    console.error('[Rifler] findUsages command error:', error);
  }
}
