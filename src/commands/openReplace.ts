import * as vscode from 'vscode';
import { CommandContext } from './index';

/**
 * rifler.openReplace - Open search panel in replace mode
 */
export function openReplaceCommand(ctx: CommandContext): void {
  const config = vscode.workspace.getConfiguration('rifler');
  const viewMode = config.get<'sidebar' | 'tab'>('viewMode', 'sidebar');
  const selectedText = getSelectedText();

  if (viewMode === 'sidebar') {
    ctx.viewManager.openView({
      forcedLocation: 'sidebar',
      showReplace: true,
      initialQuery: selectedText
    });
  } else {
    // Use viewManager to ensure sidebar is closed for "fullscreen" feel
    ctx.viewManager.openView({
      forcedLocation: 'window',
      showReplace: true,
      initialQuery: selectedText
    });
  }
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
