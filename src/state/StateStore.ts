import * as vscode from 'vscode';
import { MinimizeMessage } from '../messaging/types';

export interface SearchHistoryEntry {
  query: string;
  scope: string;
  directoryPath?: string;
  modulePath?: string;
  filePath?: string;
  options: {
    matchCase: boolean;
    wholeWord: boolean;
    useRegex: boolean;
    fileMask: string;
  };
  ts: number;
}

/**
 * Lightweight shared state holder for sidebar visibility, minimized flag, and saved search state.
 * Panel ownership (panel/status bar) remains in PanelManager.
 */
export class StateStore {
  private sidebarVisible = false;
  private bottomVisible = false;
  private minimized = false;
  private savedState: MinimizeMessage['state'] | undefined;
  private previewPanelCollapsed = false;
  private resultsShowCollapsed = false;
  private searchHistory: SearchHistoryEntry[] = [];
  private visibilityCallbacks: Array<(visible: boolean) => void> = [];
  private bottomVisibilityCallbacks: Array<(visible: boolean) => void> = [];

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

      // Load search history - default empty
      const history = store.get<SearchHistoryEntry[]>('rifler.searchHistory', []);
      this.searchHistory = Array.isArray(history) ? history : [];

      // Normalize + de-dupe any persisted history (self-healing), keeping the most recent per query.
      const normalizeKey = (q: string): string => (q || '').trim().toLowerCase();
      const normalizedHistory = this.searchHistory
        .map((h) => {
          const query = (h?.query || '').trim();
          return {
            query,
            scope: (h?.scope || 'project') as string,
            directoryPath: h?.directoryPath,
            modulePath: h?.modulePath,
            filePath: h?.filePath,
            options: {
              matchCase: !!h?.options?.matchCase,
              wholeWord: !!h?.options?.wholeWord,
              useRegex: !!h?.options?.useRegex,
              fileMask: h?.options?.fileMask || ''
            },
            ts: typeof h?.ts === 'number' ? h.ts : 0
          } satisfies SearchHistoryEntry;
        })
        .filter((h) => !!h.query);

      normalizedHistory.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      const seen = new Set<string>();
      const deduped: SearchHistoryEntry[] = [];
      for (const h of normalizedHistory) {
        const key = normalizeKey(h.query);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        deduped.push(h);
      }

      this.searchHistory = deduped;
      store.update('rifler.searchHistory', this.searchHistory);
    } else {
      this.savedState = undefined;
      this.previewPanelCollapsed = false;
      this.searchHistory = [];
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

  getBottomVisible(): boolean {
    return this.bottomVisible;
  }

  setBottomVisible(visible: boolean): void {
    this.bottomVisible = visible;
    this.bottomVisibilityCallbacks.forEach((cb) => cb(visible));
  }

  onBottomVisibilityChange(callback: (visible: boolean) => void): void {
    this.bottomVisibilityCallbacks.push(callback);
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

  getSearchHistory(): SearchHistoryEntry[] {
    return [...this.searchHistory];
  }

  clearSearchHistory(): void {
    this.searchHistory = [];
    const cfg = vscode.workspace.getConfiguration('rifler');
    const scope = cfg.get<'workspace' | 'global' | 'off'>('persistenceScope', 'workspace');
    const persist = cfg.get<boolean>('persistSearchState', true) && scope !== 'off';
    const store = scope === 'global' ? this.context.globalState : this.context.workspaceState;
    if (persist) {
      store.update('rifler.searchHistory', this.searchHistory);
    }
  }

  recordSearch(entry: Omit<SearchHistoryEntry, 'ts'>): void {
    const normalizeKey = (q: string): string => (q || '').trim().toLowerCase();
    const normalized: SearchHistoryEntry = {
      ...entry,
      query: (entry.query || '').trim(),
      ts: Date.now()
    };

    if (!normalized.query) {
      return;
    }

    const cfg = vscode.workspace.getConfiguration('rifler');
    const maxEntriesRaw = cfg.get<number>('searchHistory.maxEntries', 5);
    const maxEntries = Math.max(1, Math.floor(Number.isFinite(maxEntriesRaw) ? maxEntriesRaw : 5));

    // Treat the query text as the unique key (case-insensitive) so the same query never appears twice.
    // Keep the most recent entry's scope/options/paths.
    const normalizedKey = normalizeKey(normalized.query);
    const withoutDupes = this.searchHistory.filter((h) => normalizeKey(h.query) !== normalizedKey);
    this.searchHistory = [normalized, ...withoutDupes].slice(0, maxEntries);

    const scope = cfg.get<'workspace' | 'global' | 'off'>('persistenceScope', 'workspace');
    const persist = cfg.get<boolean>('persistSearchState', true) && scope !== 'off';
    const store = scope === 'global' ? this.context.globalState : this.context.workspaceState;
    if (persist) {
      store.update('rifler.searchHistory', this.searchHistory);
    }
  }

  getResultsShowCollapsed(): boolean {
    return this.resultsShowCollapsed;
  }

  setResultsShowCollapsed(collapsed: boolean): void {
    this.resultsShowCollapsed = collapsed;
  }}