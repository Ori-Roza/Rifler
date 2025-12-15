import * as vscode from 'vscode';
import { MinimizeMessage, IncomingMessage } from '../messaging/types';
import { StateStore } from '../state/StateStore';
import { MessageHandler } from '../messaging/handler';

export type GetWebviewHtmlFn = (webview: vscode.Webview, extensionUri: vscode.Uri) => string;

export interface PanelOptions {
  showReplace?: boolean;
  restoreState?: MinimizeMessage['state'];
  initialQuery?: string;
}

export class PanelManager {
  private currentPanel: vscode.WebviewPanel | undefined;
  private statusBarItem: vscode.StatusBarItem | undefined;
  private messageHandlers: Map<string, (message: IncomingMessage) => Promise<void>> = new Map();
  private _messageHandler?: MessageHandler;
  private _handlerConfigurator?: (handler: MessageHandler) => void;

  constructor(
    private context: vscode.ExtensionContext,
    private extensionUri: vscode.Uri,
    private getWebviewHtml: GetWebviewHtmlFn,
    private stateStore: StateStore
  ) {
    // Load persisted state from storage
    const persistedState = context.globalState.get<MinimizeMessage['state']>(
      'rifler.persistedSearchState'
    );
    if (persistedState) {
      this.stateStore.setSavedState(persistedState);
    }
  }

  /**
   * Register a handler for a specific message type from the webview
   */
  registerMessageHandler(type: string, handler: (message: IncomingMessage) => Promise<void>): void {
    this.messageHandlers.set(type, handler);
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

    // If panel already exists, reveal it and send messages as needed
    if (this.currentPanel) {
      this.currentPanel.reveal(vscode.ViewColumn.Beside);
      if (showReplace) {
        this.currentPanel.webview.postMessage({ type: 'showReplace' });
      }
      if (initialQuery) {
        this.currentPanel.webview.postMessage({
          type: 'setSearchQuery',
          query: initialQuery
        });
      }
      return;
    }

    // Create a new webview panel
    this.currentPanel = vscode.window.createWebviewPanel(
      'rifler',
      'Rifler',
      {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true
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

    // Create unified message handler for the panel and configure common handlers
    this._messageHandler = new MessageHandler(this.currentPanel);
    if (this._handlerConfigurator) {
      this._handlerConfigurator(this._messageHandler);
    }

    // Store options to send when webview is ready
    const shouldShowReplace = showReplace;
    const stateToRestore = restoreState;
    const queryToSet = initialQuery;

    this.currentPanel.webview.onDidReceiveMessage(
      async (message: IncomingMessage) => {
        console.log('Extension received message from webview:', message.type);
        
        // First, delegate to unified message handler (shared/common message types)
        if (this._messageHandler) {
          await this._messageHandler.handle(message);
        }

        // Then, check if there's a registered handler for this message type
        const handler = this.messageHandlers.get(message.type);
        if (handler) {
          try {
            await handler(message);
          } catch (error) {
            console.error(`Error handling message type '${message.type}':`, error);
          }
        }

        // Handle built-in panel messages that are not part of common handlers
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
    this.statusBarItem.tooltip = 'Click to restore Rifler';
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
    this.stateStore.setSavedState(undefined);

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

    this.currentPanel.webview.postMessage({
      type: 'config',
      replaceKeybinding,
      maxResults
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
  }
}

// Export test helpers
export const testHelpers = {
  getPanelManager: (panelManager: PanelManager) => panelManager,
  getCurrentPanel: (panelManager: PanelManager) => panelManager.panel
};
