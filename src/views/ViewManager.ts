import * as vscode from 'vscode';
import { RiflerSidebarProvider } from '../sidebar/SidebarProvider';
import { StateStore } from '../state/StateStore';
import { MinimizeMessage } from '../messaging/types';
import { PanelManager } from '../services/PanelManager';

export type PanelLocation = 'sidebar' | 'window';

export class ViewManager {
  private _sidebarProvider?: RiflerSidebarProvider;
  private _panelManager?: PanelManager;
  private _context: vscode.ExtensionContext;
  private _stateStore?: StateStore;
  private _isSwitching = false; // Lock to prevent concurrent switches
  private _lastNonRiflerSidebarCommand: string;

  private static readonly PREV_SIDEBAR_KEY = 'rifler.prevSidebarCommand';
  private static readonly RIFLER_VIEWLET_ID = 'workbench.view.extension.rifler-sidebar';
  private static readonly DEFAULT_SIDEBAR_COMMAND = 'workbench.view.explorer';

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
    this._lastNonRiflerSidebarCommand =
      context.workspaceState.get<string>(ViewManager.PREV_SIDEBAR_KEY) ?? ViewManager.DEFAULT_SIDEBAR_COMMAND;
  }

  public setStateStore(stateStore: StateStore): void {
    this._stateStore = stateStore;
  }

  public setPanelManager(panelManager: PanelManager): void {
    this._panelManager = panelManager;
  }

  public registerSidebarProvider(provider: RiflerSidebarProvider): void {
    this._sidebarProvider = provider;
  }

  public async openView(options: {
    showReplace?: boolean;
    initialQuery?: string;
    initialQueryFocus?: boolean;
    forcedLocation?: PanelLocation;
  } = {}): Promise<void> {
    // Sanitize options
    if (typeof options.initialQuery === 'string' && options.initialQuery.length > 2000) {
      options.initialQuery = options.initialQuery.slice(0, 2000);
    }
    const config = vscode.workspace.getConfiguration('rifler');
    
    let panelLocation = options.forcedLocation;
    if (!panelLocation) {
      // Try new setting first
      panelLocation = config.get<PanelLocation>('panelLocation');
      if (!panelLocation) {
        // Fall back to deprecated viewMode setting
        const viewMode = config.get<'sidebar' | 'tab'>('viewMode', 'sidebar');
        panelLocation = viewMode === 'tab' ? 'window' : 'sidebar';
      }
    }

    if (panelLocation === 'sidebar') {
      await this._openSidebar(options);
    } else {
      await this._openWindow(options);
    }
  }

  private async _openSidebar(options: { showReplace?: boolean; initialQuery?: string; initialQueryFocus?: boolean }): Promise<void> {
    if (this._sidebarProvider) {
      // Wait for any lingering tab to close before focusing the sidebar
      await this._waitForPanelClosure();

      await this._rememberPreviousSidebarContainer();
      await vscode.commands.executeCommand('workbench.action.focusSideBar');
      await vscode.commands.executeCommand(ViewManager.RIFLER_VIEWLET_ID);

      // Then show the sidebar provider view
      this._sidebarProvider.show();
      
      if (typeof options.initialQuery === 'string') {
        this._sidebarProvider.postMessage({ 
          type: 'setSearchQuery', 
          query: options.initialQuery,
          focus: options.initialQueryFocus !== false
        });
      } else {
        // No initial query provided, ensure input receives focus on open
        this._sidebarProvider.postMessage({ type: 'focusSearch' });
      }
      
      if (options.showReplace) {
        this._sidebarProvider.postMessage({ type: 'showReplace' });
      }
    }
  }

  private async _openWindow(options: { showReplace?: boolean; initialQuery?: string }): Promise<void> {
    // Use internal command that always opens without toggle logic
    await vscode.commands.executeCommand('rifler._openWindowInternal', {
      initialQuery: options.initialQuery,
      showReplace: options.showReplace
    });
  }

  private async _waitForPanelClosure(): Promise<void> {
    const deadline = Date.now() + 500;
    while (this._panelManager?.panel && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  public async switchView(): Promise<void> {
    // Prevent concurrent switches - ignore if already switching
    if (this._isSwitching) {
      console.log('[Rifler] View switch already in progress, ignoring request');
      return;
    }
    
    this._isSwitching = true;
    try {
      await this._performSwitchView();
    } finally {
      this._isSwitching = false;
    }
  }

  public async openInTab(): Promise<void> {
    await this.openView({ forcedLocation: 'window' });
  }

  public async openInSidebar(): Promise<void> {
    await this.openView({ forcedLocation: 'sidebar' });
  }

  public async restorePreviousSidebarOrFallback(): Promise<void> {
    const previous =
      this._lastNonRiflerSidebarCommand ||
      this._context.workspaceState.get<string>(ViewManager.PREV_SIDEBAR_KEY) ||
      ViewManager.DEFAULT_SIDEBAR_COMMAND;

    try {
      await vscode.commands.executeCommand(previous);
    } catch (err) {
      console.warn('[Rifler] Failed to restore previous sidebar, falling back to Explorer', err);
      await vscode.commands.executeCommand(ViewManager.DEFAULT_SIDEBAR_COMMAND);
    }
  }
  private async _performSwitchView(): Promise<void> {
    const config = vscode.workspace.getConfiguration('rifler');
    
    // Determine current location based on actual visibility/existence
    // This fixes the "second click" issue when config is out of sync with reality
    let currentLocation: PanelLocation;
    if (this._sidebarProvider && this._stateStore?.getSidebarVisible()) {
      currentLocation = 'sidebar';
    } else if (this._panelManager?.panel) {
      currentLocation = 'window';
    } else {
      // Fallback to config if we can't determine
      currentLocation = config.get<PanelLocation>('panelLocation') || 'sidebar';
    }
    
    const newLocation: PanelLocation = currentLocation === 'sidebar' ? 'window' : 'sidebar';
    
    // Request state to be saved from current view before closing
    const scope = config.get<'workspace' | 'global' | 'off'>('persistenceScope', 'workspace');
    const store = scope === 'global' ? this._context.globalState : this._context.workspaceState;
    
    if (currentLocation === 'sidebar' && this._sidebarProvider) {
      // Request sidebar to save its current state and wait for it
      await this._sidebarProvider.requestSaveState();
    } else {
      // Request window panel to save its state
      await vscode.commands.executeCommand('rifler.minimize');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Get the saved state from the current view
    // Sidebar uses 'rifler.sidebarState', window uses StateStore ('rifler.persistedSearchState')
    let savedState: MinimizeMessage['state'] | undefined;
    if (currentLocation === 'sidebar') {
      savedState = store.get<MinimizeMessage['state']>('rifler.sidebarState');
    } else if (this._stateStore) {
      savedState = this._stateStore.getSavedState();
    }
    
    // Close current view
    if (currentLocation === 'sidebar') {
      // Close the sidebar when switching to window mode
      await vscode.commands.executeCommand('workbench.action.closeSidebar');
      // Small delay to ensure sidebar is closed before opening window
      await new Promise(resolve => setTimeout(resolve, 200));
    } else {
      await vscode.commands.executeCommand('rifler._closeWindowInternal');
      // Small delay to ensure window is closed before opening sidebar
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // Update both settings for backward compatibility
    // Use undefined target to let VS Code decide (defaults to Workspace if in one)
    const target = vscode.workspace.workspaceFolders ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    
    await config.update('panelLocation', newLocation, target);
    // Also update deprecated viewMode setting
    await config.update('viewMode', newLocation === 'window' ? 'tab' : 'sidebar', target);
    
    // Transfer state to the new view location if we have saved state
    if (savedState) {
      if (newLocation === 'sidebar') {
        // Save to sidebar state key
        await store.update('rifler.sidebarState', savedState);
      } else if (this._stateStore) {
        // Save to StateStore for window panel
        this._stateStore.setSavedState(savedState);
      }
    }
    
    // Open in new location
    await this.openView({ forcedLocation: newLocation });
  }

  private async _rememberPreviousSidebarContainer(): Promise<void> {
    const activeViewlet = await this._getActiveViewletId();
    if (activeViewlet && activeViewlet !== ViewManager.RIFLER_VIEWLET_ID) {
      this._lastNonRiflerSidebarCommand = activeViewlet;
      await this._context.workspaceState.update(ViewManager.PREV_SIDEBAR_KEY, activeViewlet);
    }
  }

  private async _getActiveViewletId(): Promise<string | undefined> {
    try {
      // VS Code internal helper that returns the active sidebar container id (e.g., workbench.view.explorer)
      return await vscode.commands.executeCommand<string>('vscode.getContextKeyValue', 'activeViewlet');
    } catch {
      return undefined;
    }
  }
}
