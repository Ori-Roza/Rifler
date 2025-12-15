import * as vscode from 'vscode';
import { PanelManager } from '../services/PanelManager';
import { ViewManager } from '../views/ViewManager';
import { RiflerSidebarProvider } from '../sidebar/SidebarProvider';
import { openCommand } from './open';
import { openReplaceCommand } from './openReplace';
import { openSidebarCommand } from './openSidebar';
import { openSidebarReplaceCommand } from './openSidebarReplace';
import { toggleViewCommand } from './toggleView';
import { toggleReplaceCommand } from './toggleReplace';
import { minimizeCommand } from './minimize';
import { restoreCommand } from './restore';
import { openWindowInternalCommand } from './internal/openWindowInternal';
import { closeWindowInternalCommand } from './internal/closeWindowInternal';
import { testEnsureOpenCommand } from './internal/testEnsureOpen';

/**
 * Context object passed to all command handlers
 * Provides access to essential services and dependencies
 */
export interface CommandContext {
  extensionContext: vscode.ExtensionContext;
  panelManager: PanelManager;
  viewManager: ViewManager;
  sidebarProvider: RiflerSidebarProvider;
  getSidebarVisible: () => boolean;
  onSidebarVisibilityChange: (callback: (visible: boolean) => void) => void;
}

// Re-export command functions for external use
export { openCommand } from './open';
export { openReplaceCommand } from './openReplace';
export { openSidebarCommand } from './openSidebar';
export { openSidebarReplaceCommand } from './openSidebarReplace';
export { toggleViewCommand } from './toggleView';
export { toggleReplaceCommand } from './toggleReplace';
export { minimizeCommand } from './minimize';
export { restoreCommand } from './restore';
export { openWindowInternalCommand } from './internal/openWindowInternal';
export { closeWindowInternalCommand } from './internal/closeWindowInternal';
export { testEnsureOpenCommand } from './internal/testEnsureOpen';

/**
 * Register all commands with the extension context
 */
export function registerCommands(ctx: CommandContext): void {
  const { extensionContext } = ctx;

  extensionContext.subscriptions.push(
    vscode.commands.registerCommand('rifler.open', () => openCommand(ctx)),
    vscode.commands.registerCommand('rifler.openReplace', () => openReplaceCommand(ctx)),
    vscode.commands.registerCommand('rifler.openSidebar', () => openSidebarCommand(ctx)),
    vscode.commands.registerCommand('rifler.openSidebarReplace', () => openSidebarReplaceCommand(ctx)),
    vscode.commands.registerCommand('rifler.toggleView', () => toggleViewCommand(ctx)),
    vscode.commands.registerCommand('rifler.toggleReplace', () => toggleReplaceCommand(ctx)),
    vscode.commands.registerCommand('rifler.minimize', () => minimizeCommand(ctx)),
    vscode.commands.registerCommand('rifler.restore', () => restoreCommand(ctx)),
    vscode.commands.registerCommand('rifler._openWindowInternal', (options?: { initialQuery?: string; showReplace?: boolean }) =>
      openWindowInternalCommand(ctx, options)
    ),
    vscode.commands.registerCommand('rifler._closeWindowInternal', () => closeWindowInternalCommand(ctx)),
    vscode.commands.registerCommand('__test_ensurePanelOpen', () => testEnsureOpenCommand(ctx))
  );
}
