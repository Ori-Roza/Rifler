import * as vscode from 'vscode';
import { RiflerSidebarProvider } from '../sidebar/SidebarProvider';
import { StateStore } from '../state/StateStore';
import { MinimizeMessage } from '../messaging/types';

export type PanelLocation = 'sidebar' | 'window';

export class ViewManager {
  private _sidebarProvider?: RiflerSidebarProvider;
  private _context: vscode.ExtensionContext;
  private _stateStore?: StateStore;

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
  }

  public setStateStore(stateStore: StateStore): void {
    this._stateStore = stateStore;
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
      this._openSidebar(options);
    } else {
      await this._openWindow(options);
    }
  }

  private _openSidebar(options: { showReplace?: boolean; initialQuery?: string; initialQueryFocus?: boolean }): void {
    if (this._sidebarProvider) {
      // Reveal the sidebar view container first
      vscode.commands.executeCommand('workbench.view.extension.rifler-sidebar');
      
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

  public async switchView(): Promise<void> {
    const config = vscode.workspace.getConfiguration('rifler');
    
    // Read current location (with backward compatibility for viewMode)
    let currentLocation = config.get<PanelLocation>('panelLocation');
    if (!currentLocation) {
      // Fall back to deprecated viewMode setting
      const viewMode = config.get<'sidebar' | 'tab'>('viewMode', 'sidebar');
      currentLocation = viewMode === 'tab' ? 'window' : 'sidebar';
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
    
    console.log('ViewManager.switchView: savedState =', savedState);
    
    // Close current view
    if (currentLocation === 'sidebar') {
      await vscode.commands.executeCommand('workbench.action.closeSidebar');
    } else {
      await vscode.commands.executeCommand('rifler._closeWindowInternal');
    }
    
    // Update both settings for backward compatibility
    await config.update('panelLocation', newLocation, vscode.ConfigurationTarget.Global);
    // Also update deprecated viewMode setting
    await config.update('viewMode', newLocation === 'window' ? 'tab' : 'sidebar', vscode.ConfigurationTarget.Global);
    
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
