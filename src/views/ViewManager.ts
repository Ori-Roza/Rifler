import * as vscode from 'vscode';
import { RiflerSidebarProvider } from '../sidebar/SidebarProvider';
import { StateStore } from '../state/StateStore';
import { MinimizeMessage } from '../messaging/types';
import { PanelManager } from '../services/PanelManager';

export type PanelLocation = 'sidebar' | 'bottom' | 'window';

export class ViewManager {
  private _sidebarProvider?: RiflerSidebarProvider;
  private _bottomProvider?: RiflerSidebarProvider;
  private _panelManager?: PanelManager;
  private _context: vscode.ExtensionContext;
  private _stateStore?: StateStore;
  private _isSwitching = false; // Lock to prevent concurrent switches

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
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

  public registerBottomProvider(provider: RiflerSidebarProvider): void {
    this._bottomProvider = provider;
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
    } else if (panelLocation === 'bottom') {
      await this._openBottom(options);
    } else {
      await this._openWindow(options);
    }
  }

  private async _openSidebar(options: { showReplace?: boolean; initialQuery?: string; initialQueryFocus?: boolean }): Promise<void> {
    if (this._sidebarProvider) {
      // Wait for any lingering tab to close before focusing the sidebar
      await this._waitForPanelClosure();
      await vscode.commands.executeCommand('workbench.action.focusSideBar');
      await vscode.commands.executeCommand('workbench.view.extension.rifler-sidebar');
      
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

  private async _openBottom(options: { showReplace?: boolean; initialQuery?: string; initialQueryFocus?: boolean }): Promise<void> {
    if (this._bottomProvider) {
      // Wait for any lingering tab to close before focusing the panel
      await this._waitForPanelClosure();
      await vscode.commands.executeCommand('workbench.action.focusPanel');
      await vscode.commands.executeCommand('workbench.view.extension.rifler-bottom');

      this._bottomProvider.show();

      if (typeof options.initialQuery === 'string') {
        this._bottomProvider.postMessage({
          type: 'setSearchQuery',
          query: options.initialQuery,
          focus: options.initialQueryFocus !== false
        });
      } else {
        this._bottomProvider.postMessage({ type: 'focusSearch' });
      }

      if (options.showReplace) {
        this._bottomProvider.postMessage({ type: 'showReplace' });
      }
    }
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

  public async openInBottom(): Promise<void> {
    await this.openView({ forcedLocation: 'bottom' });
  }

  private async _performSwitchView(): Promise<void> {
    const config = vscode.workspace.getConfiguration('rifler');
    
    // Determine current location: if panel exists, we're definitely in window mode
    // Otherwise use the configured setting
    let currentLocation: PanelLocation;
    if (this._panelManager?.panel) {
      currentLocation = 'window';
    } else {
      const configured = config.get<PanelLocation>('panelLocation') || 'sidebar';
      currentLocation = configured === 'bottom' ? 'bottom' : 'sidebar';
    }
    
    // Keep switch behavior as a simple toggle between Sidebar and Window.
    // If currently in Bottom, switch goes to Window.
    const newLocation: PanelLocation = currentLocation === 'window' ? 'sidebar' : 'window';
    
    console.log('[Rifler] Switching view: current =', currentLocation, 'new =', newLocation);
    
    // Request state to be saved from current view before closing
    const scope = config.get<'workspace' | 'global' | 'off'>('persistenceScope', 'workspace');
    const store = scope === 'global' ? this._context.globalState : this._context.workspaceState;
    
    if (currentLocation === 'sidebar' && this._sidebarProvider) {
      this._sidebarProvider.markShouldSaveOnNextHide();
      this._sidebarProvider.suppressVisibilitySideEffects(1000);
      await this._sidebarProvider.requestSaveState();
    } else if (currentLocation === 'bottom' && this._bottomProvider) {
      this._bottomProvider.markShouldSaveOnNextHide();
      this._bottomProvider.suppressVisibilitySideEffects(1000);
      await this._bottomProvider.requestSaveState();
    } else {
      // Request window panel to save its state
      await vscode.commands.executeCommand('rifler.minimize');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Get the saved state from the current view
    // Sidebar uses 'rifler.sidebarState', window uses StateStore ('rifler.persistedSearchState')
    let savedState: MinimizeMessage['state'] | undefined;
    if (currentLocation === 'sidebar' || currentLocation === 'bottom') {
      savedState = store.get<MinimizeMessage['state']>('rifler.sidebarState');
    } else if (this._stateStore) {
      savedState = this._stateStore.getSavedState();
    }
    
    // Close current view
    if (currentLocation === 'sidebar') {
      // When switching FROM sidebar to tab, close the sidebar for a clean fullscreen feel
      await vscode.commands.executeCommand('workbench.action.closeSidebar');
      // Small delay to ensure sidebar is closed before opening window
      await new Promise(resolve => setTimeout(resolve, 100));
    } else if (currentLocation === 'bottom') {
      // Avoid closing the entire VS Code panel (Terminal/Problems/etc.).
      // Just proceed to opening the new location.
    } else {
      // When switching FROM tab to sidebar, close the tab panel
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
}
