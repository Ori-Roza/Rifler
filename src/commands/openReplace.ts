import * as vscode from 'vscode';
import { CommandContext } from './types';

/**
 * rifler.openReplace - Open search panel in replace mode
 */
export async function openReplaceCommand(ctx: CommandContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('rifler');
  const panelLocation = getEffectivePanelLocation(config);
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
