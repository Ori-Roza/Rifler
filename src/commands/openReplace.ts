import * as vscode from 'vscode';
import { CommandContext } from './types';

/**
 * rifler.openReplace - Open search panel in replace mode
 */
export async function openReplaceCommand(ctx: CommandContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('rifler');
  let panelLocation = config.get<'sidebar' | 'bottom' | 'window'>('panelLocation');
  if (!panelLocation) {
    const viewMode = config.get<'sidebar' | 'tab'>('viewMode', 'sidebar');
    panelLocation = viewMode === 'tab' ? 'window' : 'sidebar';
  }
  const selectedText = getSelectedText();

  if (panelLocation === 'sidebar') {
    await ctx.viewManager.openView({
      forcedLocation: 'sidebar',
      showReplace: true,
      initialQuery: selectedText
    });
  } else if (panelLocation === 'bottom') {
    await ctx.viewManager.openView({
      forcedLocation: 'bottom',
      showReplace: true,
      initialQuery: selectedText
    });
  } else {
    // Use viewManager to ensure sidebar is closed for "fullscreen" feel
    await ctx.viewManager.openView({
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
