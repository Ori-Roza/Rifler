import * as vscode from 'vscode';
import { CommandContext } from './types';

/**
 * rifler.open - Toggle search panel based on viewMode configuration
 */
export async function openCommand(ctx: CommandContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('rifler');
  const viewMode = config.get<'sidebar' | 'tab'>('viewMode', 'sidebar');
  const selectedText = getSelectedText();

  if (viewMode === 'sidebar') {
    if (ctx.getSidebarVisible()) {
      if (selectedText) {
        // Sidebar is visible: update search with selected text
        await ctx.viewManager.openView({
          forcedLocation: 'sidebar',
          initialQuery: selectedText,
          initialQueryFocus: false
        });
      } else {
        // No selection: toggle (switch back to the previous sidebar container)
        await ctx.viewManager.restorePreviousSidebarOrFallback();
      }
    } else {
      // Sidebar is closed: open it
      await ctx.viewManager.openView({
        forcedLocation: 'sidebar',
        initialQuery: selectedText,
        initialQueryFocus: true
      });
    }
  } else {
    if (ctx.panelManager.panel) {
      ctx.panelManager.panel.dispose();
    } else if (ctx.panelManager.minimized) {
      ctx.panelManager.restore();
    } else {
      const selectedText = getSelectedText();
      // Use viewManager to ensure sidebar is closed for "fullscreen" feel
      await ctx.viewManager.openView({
        forcedLocation: 'window',
        initialQuery: selectedText
      });
    }
  }
}

/**
 * Helper: Get selected text from active editor
 */
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
