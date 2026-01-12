import * as vscode from 'vscode';
import { CommandContext } from './types';

/**
 * rifler.open - Toggle search panel based on viewMode configuration
 */
export async function openCommand(ctx: CommandContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('rifler');
  let panelLocation = config.get<'sidebar' | 'bottom' | 'window'>('panelLocation');
  if (!panelLocation) {
    const viewMode = config.get<'sidebar' | 'tab'>('viewMode', 'sidebar');
    panelLocation = viewMode === 'tab' ? 'window' : 'sidebar';
  }
  const selectedText = getSelectedText();

  if (panelLocation === 'sidebar') {
    if (ctx.getSidebarVisible()) {
      if (selectedText) {
        // Sidebar is visible: update search with selected text
        await ctx.viewManager.openView({
          forcedLocation: 'sidebar',
          initialQuery: selectedText,
          initialQueryFocus: false
        });
      } else {
        // No selection: toggle (close) the sidebar
        await vscode.commands.executeCommand('workbench.action.closeSidebar');
      }
    } else {
      // Sidebar is closed: open it
      await ctx.viewManager.openView({
        forcedLocation: 'sidebar',
        initialQuery: selectedText,
        initialQueryFocus: true
      });
    }
  } else if (panelLocation === 'bottom') {
    if (ctx.getBottomVisible()) {
      if (selectedText) {
        await ctx.viewManager.openView({
          forcedLocation: 'bottom',
          initialQuery: selectedText,
          initialQueryFocus: false
        });
      } else {
        // Keep behavior non-destructive: focus the panel + reveal Rifler.
        await vscode.commands.executeCommand('workbench.action.focusPanel');
        await vscode.commands.executeCommand('workbench.view.extension.rifler-bottom');
      }
    } else {
      await ctx.viewManager.openView({
        forcedLocation: 'bottom',
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
