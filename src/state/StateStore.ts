import * as vscode from 'vscode';
import { MinimizeMessage } from '../messaging/types';

/**
 * Lightweight shared state holder for sidebar visibility, minimized flag, and saved search state.
 * Panel ownership (panel/status bar) remains in PanelManager.
 */
export class StateStore {
  private sidebarVisible = false;
  private minimized = false;
  private savedState: MinimizeMessage['state'] | undefined;
  private previewPanelCollapsed = false;
  private resultsShowCollapsed = false;
  private visibilityCallbacks: Array<(visible: boolean) => void> = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    const cfg = vscode.workspace.getConfiguration('rifler');
    const scope = cfg.get<'workspace' | 'global' | 'off'>('persistenceScope', 'workspace');
    const persist = cfg.get<boolean>('persistSearchState', true) && scope !== 'off';
    const store = scope === 'global' ? context.globalState : context.workspaceState;
    if (persist) {
      const persisted = store.get<MinimizeMessage['state']>('rifler.persistedSearchState');
      if (persisted) {
        this.savedState = persisted;
      }
      
      // Load preview panel collapsed state - default to expanded (false)
      const previewCollapsed = store.get<boolean>('rifler.previewPanelCollapsed', false);
      this.previewPanelCollapsed = previewCollapsed || false; // Ensure it's false if undefined
    } else {
      this.savedState = undefined;
      this.previewPanelCollapsed = false;
    }

    // Load results show collapsed setting from configuration
    this.resultsShowCollapsed = cfg.get<boolean>('results.showCollapsed', false);
  }

  getSidebarVisible(): boolean {
    return this.sidebarVisible;
  }

  setSidebarVisible(visible: boolean): void {
    this.sidebarVisible = visible;
    this.visibilityCallbacks.forEach((cb) => cb(visible));
  }

  onSidebarVisibilityChange(callback: (visible: boolean) => void): void {
    this.visibilityCallbacks.push(callback);
  }

  isMinimized(): boolean {
    return this.minimized;
  }

  setMinimized(flag: boolean): void {
    this.minimized = flag;
  }

  getSavedState(): MinimizeMessage['state'] | undefined {
    return this.savedState;
  }

  setSavedState(state: MinimizeMessage['state'] | undefined): void {
    this.savedState = state;
    const cfg = vscode.workspace.getConfiguration('rifler');
    const scope = cfg.get<'workspace' | 'global' | 'off'>('persistenceScope', 'workspace');
    const persist = cfg.get<boolean>('persistSearchState', true) && scope !== 'off';
    const store = scope === 'global' ? this.context.globalState : this.context.workspaceState;
    if (persist) {
      store.update('rifler.persistedSearchState', state);
    }
  }

  getPreviewPanelCollapsed(): boolean {
    return this.previewPanelCollapsed;
  }

  setPreviewPanelCollapsed(collapsed: boolean): void {
    this.previewPanelCollapsed = collapsed;
    const cfg = vscode.workspace.getConfiguration('rifler');
    const scope = cfg.get<'workspace' | 'global' | 'off'>('persistenceScope', 'workspace');
    const persist = cfg.get<boolean>('persistSearchState', true) && scope !== 'off';
    const store = scope === 'global' ? this.context.globalState : this.context.workspaceState;
    if (persist) {
      store.update('rifler.previewPanelCollapsed', collapsed);
    }
  }

  getResultsShowCollapsed(): boolean {
    return this.resultsShowCollapsed;
  }

  setResultsShowCollapsed(collapsed: boolean): void {
    this.resultsShowCollapsed = collapsed;
  }}