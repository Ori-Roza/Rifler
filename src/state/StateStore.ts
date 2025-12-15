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
  private visibilityCallbacks: Array<(visible: boolean) => void> = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    const persisted = context.globalState.get<MinimizeMessage['state']>('rifler.persistedSearchState');
    if (persisted) {
      this.savedState = persisted;
    }
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
    this.context.globalState.update('rifler.persistedSearchState', state);
  }
}
