import * as vscode from 'vscode';
import { RiflerSidebarProvider } from '../sidebar/SidebarProvider';

export type PanelLocation = 'sidebar' | 'window' | 'ask';

export class ViewManager {
  private _sidebarProvider?: RiflerSidebarProvider;
  private _context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
  }

  public registerSidebarProvider(provider: RiflerSidebarProvider): void {
    this._sidebarProvider = provider;
  }

  public async openView(options: {
    showReplace?: boolean;
    initialQuery?: string;
    forcedLocation?: PanelLocation;
  } = {}): Promise<void> {
    const config = vscode.workspace.getConfiguration('rifler');
    const panelLocation = options.forcedLocation || config.get<PanelLocation>('panelLocation', 'window');

    if (panelLocation === 'ask') {
      const choice = await vscode.window.showQuickPick([
        { label: 'Sidebar', value: 'sidebar', description: 'Open in activity bar sidebar' },
        { label: 'Window', value: 'window', description: 'Open beside editor (current behavior)' }
      ], {
        placeHolder: 'Where would you like to open Rifler?'
      });

      if (!choice) return;
      
      if (choice.value === 'sidebar') {
        this._openSidebar(options);
      } else {
        this._openWindow(options);
      }
    } else if (panelLocation === 'sidebar') {
      this._openSidebar(options);
    } else {
      this._openWindow(options);
    }
  }

  private _openSidebar(options: { showReplace?: boolean; initialQuery?: string }): void {
    if (this._sidebarProvider) {
      // Reveal the sidebar view container first
      vscode.commands.executeCommand('workbench.view.extension.rifler-sidebar');
      
      // Then show the sidebar provider view
      this._sidebarProvider.show();
      
      if (options.initialQuery) {
        this._sidebarProvider.postMessage({ 
          type: 'setSearchQuery', 
          query: options.initialQuery 
        });
      }
      
      if (options.showReplace) {
        this._sidebarProvider.postMessage({ type: 'showReplace' });
      }
    }
  }

  private _openWindow(options: { showReplace?: boolean; initialQuery?: string }): void {
    // Signal to extension.ts to open the window panel
    // This will be handled by the existing openSearchPanel logic
    vscode.commands.executeCommand('rifler.open', {
      initialQuery: options.initialQuery,
      showReplace: options.showReplace
    });
  }

  public async switchView(): Promise<void> {
    const config = vscode.workspace.getConfiguration('rifler');
    const currentLocation = config.get<PanelLocation>('panelLocation', 'window');
    const newLocation: PanelLocation = currentLocation === 'sidebar' ? 'window' : 'sidebar';
    
    // Switch the setting
    await config.update('panelLocation', newLocation, vscode.ConfigurationTarget.Global);
    
    // Open in new location
    await this.openView({ forcedLocation: newLocation });
  }
}
