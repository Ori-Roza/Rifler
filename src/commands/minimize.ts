import { CommandContext } from './index';

/**
 * rifler.minimize - Minimize panel to status bar
 */
export function minimizeCommand(ctx: CommandContext): void {
  if (ctx.panelManager.panel) {
    ctx.panelManager.panel.webview.postMessage({ type: 'requestStateForMinimize' });
  }
}
