import { CommandContext } from './types';

/**
 * rifler.restore - Restore minimized panel from status bar
 */
export function restoreCommand(ctx: CommandContext): void {
  ctx.panelManager.restore();
}
