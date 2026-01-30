import * as vscode from 'vscode';
import { CommandContext } from './types';

/**
 * rifler.openSidebarReplace - Open search in sidebar with replace mode
 */
export function openSidebarReplaceCommand(ctx: CommandContext): void {
  const selectedText = getSelectedText();
  ctx.viewManager.openView({
    forcedLocation: 'sidebar',
    showReplace: true,
    initialQuery: selectedText
  });
}

function getSelectedText(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const selection = editor.selection;
    if (!selection.isEmpty) {
      const rawText = editor.document.getText(selection);
      const trimmedText = rawText.trim();
      if (trimmedText.length >= 2) {
        return trimmedText;
      }
    }
  }
  return undefined;
}
