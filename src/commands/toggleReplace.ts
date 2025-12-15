import { CommandContext } from './index';

/**
 * rifler.toggleReplace - Toggle replace row in active Rifler view
 */
export function toggleReplaceCommand(ctx: CommandContext): void {
  if (ctx.panelManager.panel) {
    ctx.panelManager.panel.webview.postMessage({ type: 'toggleReplace' });
    return;
  }
  if (ctx.getSidebarVisible()) {
    ctx.sidebarProvider.postMessage({ type: 'toggleReplace' });
  }
}
