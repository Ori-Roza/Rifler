import { CommandContext } from './index';

/**
 * rifler.toggleView - Switch between sidebar and window view
 */
export function toggleViewCommand(ctx: CommandContext): void {
  ctx.viewManager.switchView();
}
