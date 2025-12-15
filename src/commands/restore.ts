import { CommandContext } from './index';

/**
 * rifler.restore - Restore minimized panel from status bar
 */
export function restoreCommand(ctx: CommandContext): void {
  ctx.panelManager.restore();
}
