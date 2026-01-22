import * as vscode from 'vscode';
import { CommandContext } from './types';

/**
 * rifler.open - Toggle search panel based on viewMode configuration
 */
export async function openCommand(ctx: CommandContext): Promise<void> {
  try {
    const config = vscode.workspace.getConfiguration('rifler');
    const panelLocation = getEffectivePanelLocation(config);
    const selectedText = getSelectedText();

    if (panelLocation === 'sidebar') {
      if (selectedText) {
        // Has selection: always open sidebar and insert text
        console.log('[Rifler] opening sidebar with selection');
        await ctx.viewManager.openView({
          forcedLocation: 'sidebar',
          initialQuery: selectedText,
          initialQueryFocus: false
        });
      } else {
        // No selection: check if Rifler is visible and toggle accordingly
        const riflerVisible = ctx.getSidebarVisible();
        console.log('[Rifler] toggling, riflerVisible:', riflerVisible);
        
        if (riflerVisible) {
          // Rifler is visible: close the sidebar
          console.log('[Rifler] closing sidebar');
          await vscode.commands.executeCommand('workbench.action.closeSidebar');
        } else {
          // Rifler is not visible: open it
          console.log('[Rifler] opening sidebar');
          await ctx.viewManager.openView({
            forcedLocation: 'sidebar',
            initialQueryFocus: true
          });
        }
      }
    } else if (panelLocation === 'bottom') {
      if (selectedText) {
        // Has selection: always open bottom panel and insert text
        console.log('[Rifler] opening bottom panel with selection');
        await ctx.viewManager.openView({
          forcedLocation: 'bottom',
          initialQuery: selectedText,
          initialQueryFocus: false
        });
      } else {
        // No selection: toggle bottom panel visibility
        console.log('[Rifler] toggling bottom panel visibility');
        await vscode.commands.executeCommand('workbench.action.togglePanel');
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
  } catch (error) {
    console.error('[Rifler] openCommand error:', error);
    vscode.window.showErrorMessage(`Rifler error: ${error}`);
  }
}

function getEffectivePanelLocation(config: vscode.WorkspaceConfiguration): 'sidebar' | 'bottom' | 'window' {
  const panelLocationInspection = config.inspect<'sidebar' | 'bottom' | 'window'>('panelLocation');
  const panelLocationExplicitlyConfigured =
    panelLocationInspection?.globalValue !== undefined ||
    panelLocationInspection?.workspaceValue !== undefined ||
    panelLocationInspection?.workspaceFolderValue !== undefined;

  if (!panelLocationExplicitlyConfigured) {
    const viewModeInspection = config.inspect<'sidebar' | 'tab'>('viewMode');
    const viewModeExplicitlyConfigured =
      viewModeInspection?.globalValue !== undefined ||
      viewModeInspection?.workspaceValue !== undefined ||
      viewModeInspection?.workspaceFolderValue !== undefined;

    if (viewModeExplicitlyConfigured) {
      const viewMode = config.get<'sidebar' | 'tab'>('viewMode', 'sidebar');
      return viewMode === 'tab' ? 'window' : 'sidebar';
    }
  }

  return config.get<'sidebar' | 'bottom' | 'window'>('panelLocation') || 'sidebar';
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
