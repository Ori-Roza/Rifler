import { CommandContext } from '../index';

/**
 * __test_ensurePanelOpen - Test-only command to ensure panel is open
 * Without toggle logic, just open a fresh panel
 */
export function testEnsureOpenCommand(ctx: CommandContext): void {
  if (!ctx.panelManager.panel) {
    ctx.panelManager.createOrShowPanel();
  }
}
