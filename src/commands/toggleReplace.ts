import * as vscode from 'vscode';
import { CommandContext } from './index';

/**
 * rifler.toggleReplace - Toggle replace row in active Rifler view
 */
export function toggleReplaceCommand(ctx: CommandContext): void {
  if (ctx.panelManager.panel) {
    ctx.panelManager.panel.webview.postMessage({ type: 'toggleReplace' });
    return;
  }
  if (ctx.sidebarVisible) {
    ctx.sidebarProvider.postMessage({ type: 'toggleReplace' });
  }
}
