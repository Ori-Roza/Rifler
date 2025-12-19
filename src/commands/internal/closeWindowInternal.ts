import { CommandContext } from '../types';

/**
 * rifler._closeWindowInternal - Internal command to close window panel
 * Used by ViewManager for switching views
 */
export function closeWindowInternalCommand(ctx: CommandContext): void {
  if (ctx.panelManager.panel) {
    ctx.panelManager.panel.dispose();
  }
}
