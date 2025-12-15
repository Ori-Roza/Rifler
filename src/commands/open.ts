import * as vscode from 'vscode';
import { CommandContext } from './index';

/**
 * rifler.open - Toggle search panel based on viewMode configuration
 */
export function openCommand(ctx: CommandContext): void {
  const config = vscode.workspace.getConfiguration('rifler');
  const viewMode = config.get<'sidebar' | 'tab'>('viewMode', 'sidebar');

  if (viewMode === 'sidebar') {
    if (ctx.sidebarVisible) {
      vscode.commands.executeCommand('workbench.action.closeSidebar');
    } else {
      const selectedText = getSelectedText();
      ctx.viewManager.openView({
        forcedLocation: 'sidebar',
        initialQuery: selectedText
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
