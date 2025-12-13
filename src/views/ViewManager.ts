import * as vscode from 'vscode';
import { RiflerSidebarProvider } from '../sidebar/SidebarProvider';

export type PanelLocation = 'sidebar' | 'window';

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
    const panelLocation = options.forcedLocation || config.get<PanelLocation>('panelLocation', 'sidebar');

    if (panelLocation === 'sidebar') {
      this._openSidebar(options);
    } else {
      await this._openWindow(options);
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

  private async _openWindow(options: { showReplace?: boolean; initialQuery?: string }): Promise<void> {
    // Use internal command that always opens without toggle logic
    await vscode.commands.executeCommand('rifler._openWindowInternal', {
      initialQuery: options.initialQuery,
      showReplace: options.showReplace
    });
  }

  public async switchView(): Promise<void> {
    const config = vscode.workspace.getConfiguration('rifler');
    const currentLocation = config.get<PanelLocation>('panelLocation', 'sidebar');
    const newLocation: PanelLocation = currentLocation === 'sidebar' ? 'window' : 'sidebar';
    
    // Close current view first
    if (currentLocation === 'sidebar') {
      await vscode.commands.executeCommand('workbench.action.closeSidebar');
    } else {
      await vscode.commands.executeCommand('rifler._closeWindowInternal');
    }
    
    // Update the setting
    await config.update('panelLocation', newLocation, vscode.ConfigurationTarget.Global);
    
    // Open in new location
    await this.openView({ forcedLocation: newLocation });
  }
}
