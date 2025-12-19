import { CommandContext } from '../types';

/**
 * rifler._openWindowInternal - Internal command to open window panel
 * Used by ViewManager for switching views
 */
export function openWindowInternalCommand(
  ctx: CommandContext,
  options?: { initialQuery?: string; showReplace?: boolean }
): void {
  ctx.panelManager.createOrShowPanel({
    showReplace: options?.showReplace ?? false,
    initialQuery: options?.initialQuery
  });
}
