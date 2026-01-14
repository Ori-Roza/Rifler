import * as vscode from 'vscode';
import { MinimizeMessage, IncomingMessage } from '../messaging/types';
import { StateStore } from '../state/StateStore';
import { MessageHandler } from '../messaging/handler';
import { formatRiflerSearchTooltip, getOpenKeybindingHint } from '../utils';

export type GetWebviewHtmlFn = (webview: vscode.Webview, extensionUri: vscode.Uri) => string;

export interface PanelOptions {
  showReplace?: boolean;
  restoreState?: MinimizeMessage['state'];
  initialQuery?: string;
}

export class PanelManager {
  private currentPanel: vscode.WebviewPanel | undefined;
  private statusBarItem: vscode.StatusBarItem | undefined;
  private _messageHandler?: MessageHandler;
  private _handlerConfigurator?: (handler: MessageHandler) => void;

  constructor(
    private context: vscode.ExtensionContext,
    private extensionUri: vscode.Uri,
    private getWebviewHtml: GetWebviewHtmlFn,
    private stateStore: StateStore
  ) {
    // Load persisted state honoring scope and setting
    const cfg = vscode.workspace.getConfiguration('rifler');
    const scope = cfg.get<'workspace' | 'global' | 'off'>('persistenceScope', 'workspace');
    const persist = cfg.get<boolean>('persistSearchState', true) && scope !== 'off';
    const store = scope === 'global' ? context.globalState : context.workspaceState;
    if (persist) {
      const persistedState = store.get<MinimizeMessage['state']>('rifler.persistedSearchState');
      if (persistedState) {
        this.stateStore.setSavedState(persistedState);
      }
    }
  }

  /**
   * Provide a configurator to register common/shared handlers on a MessageHandler
   * This will be invoked each time a new panel is created.
   */
  setHandlerConfigurator(configure: (handler: MessageHandler) => void): void {
    this._handlerConfigurator = configure;
  }

  /**
   * Create or show the search panel
   */
  createOrShowPanel(options: PanelOptions = {}): void {
    const { showReplace = false, restoreState, initialQuery } = options;

    // If panel already exists, check if it's still valid before using it
    if (this.currentPanel) {
      try {
        // Check if webview is still valid
        if (!this.currentPanel.webview) {
          // Panel was disposed, clear the reference and create a new one
          this.currentPanel = undefined;
        } else {
          // Panel is still valid, reveal it and send messages as needed
          this.currentPanel.reveal(vscode.ViewColumn.Two);
          if (showReplace) {
            this.currentPanel.webview.postMessage({ type: 'showReplace' });
          }
          if (initialQuery) {
            this.currentPanel.webview.postMessage({
              type: 'setSearchQuery',
              query: initialQuery
            });
          }
          // Ensure sidebar is closed when the panel is revealed
          vscode.commands.executeCommand('workbench.action.closeSidebar');
          return;
        }
      } catch (error) {
        // If there's an error, panel might be disposed
        console.error('[Rifler] Error accessing existing panel:', error);
        this.currentPanel = undefined;
      }
    }

    // If no restore state provided, try to load from StateStore
    const effectiveRestoreState = restoreState || this.stateStore.getSavedState();

    // Create a new webview panel
    this.currentPanel = vscode.window.createWebviewPanel(
      'rifler',
      'Rifler Search',
      {
        viewColumn: vscode.ViewColumn.Two,
        preserveFocus: false
      },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri]
      }
    );

    this.currentPanel.webview.html = this.getWebviewHtml(
      this.currentPanel.webview,
      this.extensionUri
    );

    // Panel and sidebar can now coexist

    // Create unified message handler for the panel and configure common handlers
    this._messageHandler = new MessageHandler(this.currentPanel);
    if (this._handlerConfigurator) {
      this._handlerConfigurator(this._messageHandler);
    }

    // Store options to send when webview is ready
    const shouldShowReplace = showReplace;
    const stateToRestore = effectiveRestoreState;
    const queryToSet = initialQuery;

    this.currentPanel.webview.onDidReceiveMessage(
      async (message: IncomingMessage) => {
        // Handle built-in panel messages first
        switch (message.type) {
          case 'webviewReady': {
            this.handleWebviewReady(
              shouldShowReplace,
              stateToRestore,
              queryToSet
            );
            break;
          }
          case 'minimize': {
            this.minimize(message.state);
            break;
          }
          default:
            // Delegate all other messages to unified handler
            if (this._messageHandler) {
              await this._messageHandler.handle(message);
            }
            break;
        }
      },
      undefined,
      this.context.subscriptions
    );

    this.currentPanel.onDidDispose(
      () => {
        this.currentPanel = undefined;
      },
      null,
      this.context.subscriptions
    );
  }

  /**
   * Minimize panel to status bar
   */
  minimize(state?: MinimizeMessage['state']): void {
    // Save the state before closing
    this.stateStore.setSavedState(state);

    // Hide the panel
    if (this.currentPanel) {
      this.currentPanel.dispose();
      this.currentPanel = undefined;
    }

    // Mark as minimized
    this.stateStore.setMinimized(true);

    // Create status bar item if it doesn't exist
    if (!this.statusBarItem) {
      this.statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
      );
      this.statusBarItem.command = 'rifler.restore';
      this.context.subscriptions.push(this.statusBarItem);
    }

    this.statusBarItem.text = '$(bookmark) Rifler';
    this.statusBarItem.tooltip = formatRiflerSearchTooltip(getOpenKeybindingHint());
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.statusBarItem.show();
  }

  /**
   * Restore minimized panel from status bar
   */
  restore(): void {
    // Hide status bar item
    if (this.statusBarItem) {
      this.statusBarItem.hide();
    }

    // Mark as no longer minimized
    this.stateStore.setMinimized(false);

    // Open the panel and restore state
    this.createOrShowPanel({
      restoreState: this.stateStore.getSavedState()
    });

    // Clear saved state after restoring
    const cfg = vscode.workspace.getConfiguration('rifler');
    const scope = cfg.get<'workspace' | 'global' | 'off'>('persistenceScope', 'workspace');
    const persist = cfg.get<boolean>('persistSearchState', true) && scope !== 'off';
    if (!persist) {
      this.stateStore.setSavedState(undefined);
    }

    // Ensure the panel is focused
    if (this.currentPanel) {
      this.currentPanel.reveal(vscode.ViewColumn.Beside, false);
    }
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    if (this.currentPanel) {
      this.currentPanel.dispose();
      this.currentPanel = undefined;
    }
    if (this.statusBarItem) {
      this.statusBarItem.dispose();
      this.statusBarItem = undefined;
    }
  }

  /**
   * Get the current panel (for testing)
   */
  get panel(): vscode.WebviewPanel | undefined {
    return this.currentPanel;
  }

  /**
   * Check if panel is minimized
   */
  get minimized(): boolean {
    return this.stateStore.isMinimized();
  }

  /**
   * Handle webview ready event - send initialization messages
   */
  private handleWebviewReady(
    shouldShowReplace: boolean,
    stateToRestore: MinimizeMessage['state'] | undefined,
    queryToSet: string | undefined
  ): void {
    if (!this.currentPanel) return;

    // Send configuration to webview
    const config = vscode.workspace.getConfiguration('rifler');
    const replaceKeybinding = config.get<string>('replaceInPreviewKeybinding', 'ctrl+shift+r');
    const maxResults = config.get<number>('maxResults', 10000);
    const resultsShowCollapsed = config.get<boolean>('results.showCollapsed', false);
    const openKeybindingHint = getOpenKeybindingHint(config);
    console.log('[Rifler] Initializing webview with config:', {
      replaceKeybinding,
      maxResults,
      resultsShowCollapsed,
      openKeybindingHint
    });
    this.currentPanel.webview.postMessage({
      type: 'config',
      replaceKeybinding,
      maxResults,
      resultsShowCollapsed,
      openKeybindingHint
    });

    if (shouldShowReplace) {
      this.currentPanel.webview.postMessage({ type: 'showReplace' });
    }

    // Restore state if available
    if (stateToRestore) {
      this.currentPanel.webview.postMessage({
        type: 'restoreState',
        state: stateToRestore
      });
    } else {
      this.currentPanel.webview.postMessage({ type: 'clearState' });
    }

    // Set initial query or focus search box
    if (queryToSet) {
      this.currentPanel.webview.postMessage({
        type: 'setSearchQuery',
        query: queryToSet
      });
    } else {
      this.currentPanel.webview.postMessage({ type: 'focusSearch' });
    }

    // Send preview panel state
    this.currentPanel.webview.postMessage({
      type: 'restorePreviewPanelState',
      collapsed: this.stateStore.getPreviewPanelCollapsed()
    });

    // Send search history (for magnifying-glass dropdown)
    this.currentPanel.webview.postMessage({
      type: 'searchHistory',
      entries: this.stateStore.getSearchHistory()
    });
  }
}

// Export test helpers
export const testHelpers = {
  getPanelManager: (panelManager: PanelManager) => panelManager,
  getCurrentPanel: (panelManager: PanelManager) => panelManager.panel
};
