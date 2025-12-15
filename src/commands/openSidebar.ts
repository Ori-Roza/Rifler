import * as vscode from 'vscode';
import { CommandContext } from './index';

/**
 * rifler.openSidebar - Open search in sidebar
 */
export function openSidebarCommand(ctx: CommandContext): void {
  const selectedText = getSelectedText();
  ctx.viewManager.openView({
    forcedLocation: 'sidebar',
    initialQuery: selectedText
  });
}

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
