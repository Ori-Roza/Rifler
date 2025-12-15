import * as vscode from 'vscode';
import { CommandContext } from './index';

/**
 * rifler.open - Toggle search panel based on viewMode configuration
 */
export function openCommand(ctx: CommandContext): void {
  const config = vscode.workspace.getConfiguration('rifler');
  const viewMode = config.get<'sidebar' | 'tab'>('viewMode', 'sidebar');
  const selectedText = getSelectedText();

  if (viewMode === 'sidebar') {
    if (ctx.getSidebarVisible()) {
      if (selectedText) {
        // Sidebar is visible: update search with selected text
        ctx.viewManager.openView({
          forcedLocation: 'sidebar',
          initialQuery: selectedText,
          initialQueryFocus: false
        });
      } else {
        // No selection: toggle (close) the sidebar
        vscode.commands.executeCommand('workbench.action.closeSidebar');
      }
    } else {
      // Sidebar is closed: open it
      ctx.viewManager.openView({
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
      ctx.panelManager.createOrShowPanel({ initialQuery: selectedText });
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
