import * as vscode from 'vscode';
import { PanelManager } from '../services/PanelManager';
import { ViewManager } from '../views/ViewManager';
import { RiflerSidebarProvider } from '../sidebar/SidebarProvider';

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

  getBottomVisible: () => boolean;
  onBottomVisibilityChange: (callback: (visible: boolean) => void) => void;
}
