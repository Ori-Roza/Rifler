# Implementation Plan: Issues #42 & #43
## Sidebar Icon, Activity Bar Integration, and Panel Location Options

---

## Executive Summary

**Issue #42**: Add sidebar icon and left sidebar shortcut  
**Issue #43**: Add sidebar panel view option (alternative to full-window)

These issues are closely related and should be implemented together as they both involve adding sidebar functionality to Rifler. The current extension only supports a webview panel that opens beside the editor. This implementation will:

1. Add an Activity Bar icon for Rifler
2. Implement a sidebar panel view using `WebviewViewProvider`
3. Add configuration to choose between sidebar and window panel modes
4. Provide dedicated keyboard shortcuts for both modes
5. Maintain backward compatibility with existing behavior

---

## 1. CURRENT STATE ANALYSIS

### Current Architecture
- **Panel Type**: `WebviewPanel` only (opens beside editor in `ViewColumn.Beside`)
- **Activation**: Keyboard shortcuts (`Cmd+Shift+F`, `Alt+Shift+F`)
- **UI Location**: Replaces/splits editor area
- **State Management**: Module-level variables (`currentPanel`, `statusBarItem`, `savedState`)
- **Commands**: `rifler.open`, `rifler.openReplace`, `rifler.minimize`, `rifler.restore`

### Limitations
- No activity bar presence (low discoverability)
- No sidebar panel option (inflexible layout)
- Panel always replaces editor space
- Single panel mode only

---

## 2. IMPLEMENTATION OVERVIEW

### Architecture Design

```
┌─────────────────────────────────────────────────────────┐
│                   VS Code Extension                      │
├─────────────────────────────────────────────────────────┤
│  Activity Bar Icon → Toggle Sidebar/Panel based on mode │
│                                                          │
│  Commands:                                              │
│    - rifler.open (window panel - existing)              │
│    - rifler.openReplace (window panel - existing)       │
│    - rifler.openSidebar (NEW - sidebar view)            │
│    - rifler.toggleView (NEW - switch modes)             │
└─────────────────────────────────────────────────────────┘
                        ↓
    ┌───────────────────┴──────────────────┐
    ↓                                      ↓
┌──────────────────┐         ┌────────────────────────┐
│  Window Panel    │         │   Sidebar Panel        │
│  (WebviewPanel)  │         │ (WebviewViewProvider)  │
│  - Current impl  │         │ - NEW implementation   │
│  - Full control  │         │ - Activity bar icon    │
│  - ViewColumn    │         │ - Side-by-side view    │
└──────────────────┘         └────────────────────────┘
         ↓                              ↓
    ┌─────────────────────────────────────────┐
    │   Shared WebView HTML/CSS/JS            │
    │   Shared Search/Replace Logic           │
    │   (src/search.ts, src/replacer.ts)      │
    └─────────────────────────────────────────┘
```

### Key Components to Create

1. **SidebarProvider** (`src/sidebar/SidebarProvider.ts`)
   - Implements `vscode.WebviewViewProvider`
   - Manages sidebar webview lifecycle
   - Handles message protocol
   - Coordinates with shared search logic

2. **ViewManager** (`src/views/ViewManager.ts`)
   - Manages both panel types
   - Handles mode switching
   - State synchronization
   - View-agnostic operations

3. **Shared WebView Content** (refactored)
   - Extract HTML/CSS/JS to reusable modules
   - Support both panel contexts
   - Responsive layout for sidebar width

4. **Configuration Handler**
   - Read `rifler.panelLocation` setting
   - Apply user preferences
   - Handle mode switching

---

## 3. DETAILED IMPLEMENTATION PHASES

### Phase 1: Activity Bar Icon & View Container (Issue #42 - Part 1)

#### 3.1 Add Activity Bar Contribution to `package.json`

```json
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "rifler-sidebar",
          "title": "Rifler",
          "icon": "assets/icon-activitybar.svg"
        }
      ]
    },
    "views": {
      "rifler-sidebar": [
        {
          "type": "webview",
          "id": "rifler.sidebarView",
          "name": "Search",
          "contextualTitle": "Rifler Search"
        }
      ]
    }
  }
}
```

#### 3.2 Create Activity Bar Icon Asset

**File**: `assets/icon-activitybar.svg`

```svg
<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <!-- Stylized magnifying glass with rifle crosshair design -->
  <path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
  <circle cx="9.5" cy="9.5" r="1.5" fill="currentColor"/>
  <line x1="7.5" y1="9.5" x2="11.5" y2="9.5" stroke="currentColor" stroke-width="0.5"/>
  <line x1="9.5" y1="7.5" x2="9.5" y2="11.5" stroke="currentColor" stroke-width="0.5"/>
</svg>
```

**Acceptance Tests**:
- [ ] Icon visible in activity bar
- [ ] Icon color adapts to theme (light/dark)
- [ ] Icon tooltip shows "Rifler"
- [ ] Clicking icon toggles sidebar

---

### Phase 2: Sidebar WebView Provider (Issue #43 - Core)

#### 3.3 Create SidebarProvider Class

**File**: `src/sidebar/SidebarProvider.ts`

```typescript
import * as vscode from 'vscode';
import { SearchResult, SearchScope, SearchOptions } from '../utils';
import { performSearch } from '../search';
import { replaceOne, replaceAll } from '../replacer';

export class RiflerSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'rifler.sidebarView';
  
  private _view?: vscode.WebviewView;
  private _context: vscode.ExtensionContext;

  constructor(private readonly context: vscode.ExtensionContext) {
    this._context = context;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken
  ): void | Thenable<void> {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      await this._handleMessage(message);
    });

    // Restore state when view becomes visible
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this._restoreState();
      }
    });

    // Handle dispose
    webviewView.onDidDispose(() => {
      this._view = undefined;
    });
  }

  private async _handleMessage(message: any): Promise<void> {
    // Implement message handling (same as window panel)
    switch (message.type) {
      case 'runSearch':
        await this._runSearch(message);
        break;
      case 'openLocation':
        await this._openLocation(message);
        break;
      case 'replaceOne':
        await replaceOne(message.uri, message.line, message.character, message.length, message.replaceText);
        break;
      case 'replaceAll':
        await this._replaceAll(message);
        break;
      // ... other cases
    }
  }

  private async _runSearch(message: any): Promise<void> {
    const results = await performSearch(
      message.query,
      message.scope,
      message.options,
      message.directoryPath,
      message.modulePath,
      message.filePath
    );

    this._view?.webview.postMessage({
      type: 'searchResults',
      results
    });
  }

  private async _openLocation(message: any): Promise<void> {
    const uri = vscode.Uri.parse(message.uri);
    const document = await vscode.workspace.openTextDocument(uri);
    
    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.One,
      preview: false
    });

    const position = new vscode.Position(message.line, message.character);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }

  private async _replaceAll(message: any): Promise<void> {
    await replaceAll(
      message.query,
      message.replaceText,
      message.scope,
      message.options,
      message.directoryPath,
      message.modulePath,
      message.filePath,
      async () => {
        // Refresh search after replace
        await this._runSearch(message);
      }
    );
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    // Return same HTML as window panel (will be refactored to shared module)
    // Adjust CSS for narrow sidebar width
    return this._getSidebarHtml(webview);
  }

  private _getSidebarHtml(webview: vscode.Webview): string {
    // Implementation will include responsive CSS for sidebar
    const nonce = this._getNonce();
    
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com; style-src ${webview.cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com;">
      <title>Rifler</title>
      <style>
        /* Sidebar-optimized styles */
        body { 
          font-size: 12px; 
          padding: 8px;
        }
        .search-box { 
          flex-direction: column; 
        }
        .results-panel {
          max-height: 40vh;
        }
        /* ... responsive adjustments */
      </style>
    </head>
    <body>
      <!-- Same content as window panel -->
    </body>
    </html>`;
  }

  private _restoreState(): void {
    // Restore saved search state
    const state = this._context.globalState.get('rifler.sidebarState');
    if (state && this._view) {
      this._view.webview.postMessage({
        type: 'restoreState',
        state
      });
    }
  }

  private _getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  public show(): void {
    if (this._view) {
      this._view.show(true);
    }
  }

  public postMessage(message: any): void {
    this._view?.webview.postMessage(message);
  }
}
```

**Acceptance Tests**:
- [ ] Sidebar provider registers correctly
- [ ] Webview renders in sidebar
- [ ] Search functionality works in sidebar
- [ ] Replace functionality works in sidebar
- [ ] State persists when sidebar hidden/shown
- [ ] Messages handled correctly

---

### Phase 3: Configuration & Mode Management (Issue #43 - Settings)

#### 3.4 Add Settings to `package.json`

```json
{
  "contributes": {
    "configuration": {
      "title": "Rifler",
      "properties": {
        "rifler.panelLocation": {
          "type": "string",
          "enum": ["sidebar", "window", "ask"],
          "enumDescriptions": [
            "Always open in sidebar panel",
            "Always open in window panel (beside editor)",
            "Ask each time which view to use"
          ],
          "default": "window",
          "description": "Where to open the Rifler search panel",
          "order": 1
        },
        "rifler.sidebarWidth": {
          "type": "string",
          "enum": ["narrow", "medium", "wide"],
          "default": "medium",
          "description": "Preferred sidebar panel width (if supported by VS Code)",
          "order": 2
        },
        "rifler.defaultViewOnStartup": {
          "type": "boolean",
          "default": false,
          "description": "Automatically open Rifler sidebar on VS Code startup",
          "order": 3
        },
        "rifler.replaceInPreviewKeybinding": {
          "type": "string",
          "default": "ctrl+shift+r",
          "description": "Keybinding for Replace in Preview widget",
          "order": 4
        }
      }
    }
  }
}
```

#### 3.5 Create ViewManager

**File**: `src/views/ViewManager.ts`

```typescript
import * as vscode from 'vscode';
import { RiflerSidebarProvider } from '../sidebar/SidebarProvider';

export type PanelLocation = 'sidebar' | 'window' | 'ask';

export class ViewManager {
  private _sidebarProvider?: RiflerSidebarProvider;
  private _windowPanel?: vscode.WebviewPanel;
  private _context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
  }

  public registerSidebarProvider(provider: RiflerSidebarProvider): void {
    this._sidebarProvider = provider;
  }

  public setWindowPanel(panel: vscode.WebviewPanel | undefined): void {
    this._windowPanel = panel;
  }

  public async openView(options: {
    showReplace?: boolean;
    initialQuery?: string;
    forcedLocation?: PanelLocation;
  }): Promise<void> {
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
      this._sidebarProvider.show();
      
      if (options.showReplace) {
        this._sidebarProvider.postMessage({ type: 'showReplace' });
      }
      
      if (options.initialQuery) {
        this._sidebarProvider.postMessage({ 
          type: 'setSearchQuery', 
          query: options.initialQuery 
        });
      }
    } else {
      vscode.commands.executeCommand('rifler.sidebarView.focus');
    }
  }

  private _openWindow(options: { showReplace?: boolean; initialQuery?: string }): void {
    // Call existing openSearchPanel function
    vscode.commands.executeCommand('rifler.open');
    
    // Will be refactored to use shared window panel manager
  }

  public async switchView(): Promise<void> {
    const currentLocation = this._getCurrentLocation();
    const newLocation: PanelLocation = currentLocation === 'sidebar' ? 'window' : 'sidebar';
    
    // Save current state
    const state = await this._getCurrentState();
    
    // Close current view
    if (currentLocation === 'sidebar') {
      // Sidebar will remain in activity bar, just won't be focused
    } else if (this._windowPanel) {
      this._windowPanel.dispose();
    }
    
    // Open in new location
    await this.openView({ 
      forcedLocation: newLocation,
      showReplace: state?.showReplace,
      initialQuery: state?.query
    });
  }

  private _getCurrentLocation(): PanelLocation {
    if (this._windowPanel && this._windowPanel.visible) {
      return 'window';
    }
    return 'sidebar';
  }

  private async _getCurrentState(): Promise<any> {
    // Get state from active view
    return this._context.globalState.get('rifler.currentState');
  }
}
```

**Acceptance Tests**:
- [ ] Setting `rifler.panelLocation` controls default behavior
- [ ] "Ask" option shows quick pick for location
- [ ] ViewManager correctly routes to sidebar or window
- [ ] View switching preserves state
- [ ] Configuration changes take effect immediately

---

### Phase 4: Commands & Shortcuts (Issues #42 & #43)

#### 3.6 Add New Commands to `package.json`

```json
{
  "contributes": {
    "commands": [
      {
        "command": "rifler.open",
        "title": "Rifler: Search in Files (Window Panel)",
        "icon": "$(search)"
      },
      {
        "command": "rifler.openReplace",
        "title": "Rifler: Search and Replace (Window Panel)",
        "icon": "$(replace-all)"
      },
      {
        "command": "rifler.openSidebar",
        "title": "Rifler: Search in Files (Sidebar)",
        "icon": "$(search)"
      },
      {
        "command": "rifler.openSidebarReplace",
        "title": "Rifler: Search and Replace (Sidebar)",
        "icon": "$(replace-all)"
      },
      {
        "command": "rifler.toggleView",
        "title": "Rifler: Switch Between Sidebar and Window View",
        "icon": "$(split-horizontal)"
      },
      {
        "command": "rifler.minimize",
        "title": "Rifler: Minimize to Status Bar",
        "icon": "$(chevron-down)"
      },
      {
        "command": "rifler.restore",
        "title": "Rifler: Restore from Status Bar",
        "icon": "$(chevron-up)"
      }
    ],
    "keybindings": [
      {
        "command": "rifler.open",
        "key": "cmd+shift+f",
        "mac": "cmd+shift+f",
        "win": "ctrl+shift+f",
        "linux": "ctrl+shift+f",
        "when": "!config.rifler.panelLocation == 'sidebar'"
      },
      {
        "command": "rifler.openSidebar",
        "key": "cmd+ctrl+shift+f",
        "mac": "cmd+ctrl+shift+f",
        "win": "ctrl+alt+shift+f",
        "linux": "ctrl+alt+shift+f"
      },
      {
        "command": "rifler.openReplace",
        "key": "alt+shift+f",
        "mac": "alt+shift+f"
      },
      {
        "command": "rifler.toggleView",
        "key": "cmd+k cmd+r",
        "mac": "cmd+k cmd+r",
        "win": "ctrl+k ctrl+r",
        "linux": "ctrl+k ctrl+r"
      }
    ],
    "menus": {
      "commandPalette": [
        {
          "command": "rifler.open",
          "when": "workbenchState != 'empty'"
        },
        {
          "command": "rifler.openSidebar",
          "when": "workbenchState != 'empty'"
        },
        {
          "command": "rifler.toggleView",
          "when": "workbenchState != 'empty'"
        }
      ],
      "view/title": [
        {
          "command": "rifler.toggleView",
          "when": "view == rifler.sidebarView",
          "group": "navigation"
        }
      ]
    }
  }
}
```

#### 3.7 Register Commands in `extension.ts`

```typescript
export function activate(context: vscode.ExtensionContext) {
  console.log('Rifler extension is now active');

  // Initialize ViewManager
  const viewManager = new ViewManager(context);

  // Register sidebar provider
  const sidebarProvider = new RiflerSidebarProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      RiflerSidebarProvider.viewType,
      sidebarProvider
    )
  );
  viewManager.registerSidebarProvider(sidebarProvider);

  // Existing commands (updated to use ViewManager)
  const openCommand = vscode.commands.registerCommand(
    'rifler.open',
    () => {
      const selectedText = getSelectedText();
      viewManager.openView({ 
        forcedLocation: 'window',
        initialQuery: selectedText 
      });
    }
  );

  const openReplaceCommand = vscode.commands.registerCommand(
    'rifler.openReplace',
    () => {
      const selectedText = getSelectedText();
      viewManager.openView({ 
        forcedLocation: 'window',
        showReplace: true,
        initialQuery: selectedText 
      });
    }
  );

  // New sidebar commands
  const openSidebarCommand = vscode.commands.registerCommand(
    'rifler.openSidebar',
    () => {
      const selectedText = getSelectedText();
      viewManager.openView({ 
        forcedLocation: 'sidebar',
        initialQuery: selectedText 
      });
    }
  );

  const openSidebarReplaceCommand = vscode.commands.registerCommand(
    'rifler.openSidebarReplace',
    () => {
      const selectedText = getSelectedText();
      viewManager.openView({ 
        forcedLocation: 'sidebar',
        showReplace: true,
        initialQuery: selectedText 
      });
    }
  );

  const toggleViewCommand = vscode.commands.registerCommand(
    'rifler.toggleView',
    () => viewManager.switchView()
  );

  // Register all commands
  context.subscriptions.push(
    openCommand,
    openReplaceCommand,
    openSidebarCommand,
    openSidebarReplaceCommand,
    toggleViewCommand
  );

  // Existing minimize/restore commands remain unchanged
  // ...
}
```

**Acceptance Tests**:
- [ ] All commands registered successfully
- [ ] Keyboard shortcuts work for both sidebar and window
- [ ] Command palette shows all commands
- [ ] View title shows toggle button
- [ ] Activity bar icon click opens sidebar

---

### Phase 5: Responsive Layout & CSS Adjustments

#### 3.8 Create Shared WebView Content Module

**File**: `src/webview/shared.ts`

```typescript
export function getSharedHtml(webview: any, context: 'sidebar' | 'window'): string {
  const nonce = getNonce();
  const contextClass = context === 'sidebar' ? 'sidebar-context' : 'window-context';
  
  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com; style-src ${webview.cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com;">
    <title>Rifler</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/vs2015.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    <style>
      /* Base styles */
      * { box-sizing: border-box; margin: 0; padding: 0; }
      
      body { 
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
        background-color: var(--vscode-editor-background);
      }
      
      /* Sidebar-specific responsive styles */
      .sidebar-context {
        font-size: 12px;
      }
      
      .sidebar-context .search-box {
        flex-direction: column;
        gap: 6px;
      }
      
      .sidebar-context .search-input {
        font-size: 12px;
      }
      
      .sidebar-context .options-row {
        flex-wrap: wrap;
      }
      
      .sidebar-context .results-panel {
        max-height: 35vh;
      }
      
      .sidebar-context .preview-panel {
        max-height: 40vh;
      }
      
      .sidebar-context .result-item {
        padding: 4px 8px;
      }
      
      .sidebar-context .file-name {
        font-size: 11px;
      }
      
      /* Window-specific styles */
      .window-context {
        padding: 16px;
      }
      
      .window-context .results-panel {
        max-height: 50vh;
      }
      
      /* Shared styles continue... */
    </style>
  </head>
  <body class="${contextClass}">
    <!-- Same HTML content for both contexts -->
    <div class="search-container">
      <div class="search-box">
        <input type="text" id="query" placeholder="Search..." />
        <!-- ... rest of UI -->
      </div>
    </div>
  </body>
  </html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
```

**Acceptance Tests**:
- [ ] Shared HTML works in both contexts
- [ ] Sidebar layout is responsive and readable
- [ ] Window layout matches current behavior
- [ ] CSS classes correctly applied
- [ ] Theme colors work in both contexts

---

## 4. COMPREHENSIVE TEST PLAN

### 4.1 Unit Tests

**File**: `src/__tests__/sidebar/SidebarProvider.test.ts`

```typescript
import * as vscode from 'vscode';
import { RiflerSidebarProvider } from '../../sidebar/SidebarProvider';

describe('RiflerSidebarProvider', () => {
  let context: vscode.ExtensionContext;
  let provider: RiflerSidebarProvider;

  beforeEach(() => {
    context = {
      extensionUri: vscode.Uri.file('/test'),
      globalState: {
        get: jest.fn(),
        update: jest.fn()
      }
    } as any;
    
    provider = new RiflerSidebarProvider(context);
  });

  describe('resolveWebviewView', () => {
    it('should initialize webview with correct options', () => {
      const webviewView = {
        webview: {
          options: {},
          html: '',
          onDidReceiveMessage: jest.fn(),
          postMessage: jest.fn()
        },
        onDidChangeVisibility: jest.fn(),
        onDidDispose: jest.fn()
      } as any;

      provider.resolveWebviewView(webviewView, {} as any, {} as any);

      expect(webviewView.webview.options.enableScripts).toBe(true);
      expect(webviewView.webview.options.localResourceRoots).toBeDefined();
    });

    it('should set HTML content', () => {
      const webviewView = {
        webview: {
          options: {},
          html: '',
          onDidReceiveMessage: jest.fn(),
          postMessage: jest.fn()
        },
        onDidChangeVisibility: jest.fn(),
        onDidDispose: jest.fn()
      } as any;

      provider.resolveWebviewView(webviewView, {} as any, {} as any);

      expect(webviewView.webview.html).toContain('<!DOCTYPE html>');
      expect(webviewView.webview.html).toContain('Rifler');
    });

    it('should register message handler', () => {
      const webviewView = {
        webview: {
          options: {},
          html: '',
          onDidReceiveMessage: jest.fn(),
          postMessage: jest.fn()
        },
        onDidChangeVisibility: jest.fn(),
        onDidDispose: jest.fn()
      } as any;

      provider.resolveWebviewView(webviewView, {} as any, {} as any);

      expect(webviewView.webview.onDidReceiveMessage).toHaveBeenCalled();
    });
  });

  describe('message handling', () => {
    it('should handle runSearch message', async () => {
      // Test implementation
    });

    it('should handle openLocation message', async () => {
      // Test implementation
    });

    it('should handle replaceOne message', async () => {
      // Test implementation
    });

    it('should handle replaceAll message', async () => {
      // Test implementation
    });
  });

  describe('state management', () => {
    it('should restore state when view becomes visible', () => {
      // Test implementation
    });

    it('should persist state when view is hidden', () => {
      // Test implementation
    });
  });
});
```

**File**: `src/__tests__/views/ViewManager.test.ts`

```typescript
import * as vscode from 'vscode';
import { ViewManager } from '../../views/ViewManager';
import { RiflerSidebarProvider } from '../../sidebar/SidebarProvider';

describe('ViewManager', () => {
  let context: vscode.ExtensionContext;
  let viewManager: ViewManager;

  beforeEach(() => {
    context = {
      extensionUri: vscode.Uri.file('/test'),
      globalState: {
        get: jest.fn(),
        update: jest.fn()
      }
    } as any;
    
    viewManager = new ViewManager(context);
  });

  describe('openView', () => {
    it('should open sidebar when panelLocation is "sidebar"', async () => {
      const config = {
        get: jest.fn().mockReturnValue('sidebar')
      };
      jest.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue(config as any);

      await viewManager.openView({});

      // Assert sidebar was opened
    });

    it('should open window when panelLocation is "window"', async () => {
      const config = {
        get: jest.fn().mockReturnValue('window')
      };
      jest.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue(config as any);

      await viewManager.openView({});

      // Assert window was opened
    });

    it('should prompt user when panelLocation is "ask"', async () => {
      const config = {
        get: jest.fn().mockReturnValue('ask')
      };
      jest.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue(config as any);
      jest.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({ 
        value: 'sidebar' 
      } as any);

      await viewManager.openView({});

      expect(vscode.window.showQuickPick).toHaveBeenCalled();
    });

    it('should use forcedLocation when provided', async () => {
      await viewManager.openView({ forcedLocation: 'sidebar' });

      // Assert sidebar was opened regardless of config
    });
  });

  describe('switchView', () => {
    it('should switch from sidebar to window', async () => {
      // Test implementation
    });

    it('should switch from window to sidebar', async () => {
      // Test implementation
    });

    it('should preserve state during switch', async () => {
      // Test implementation
    });
  });
});
```

### 4.2 Integration Tests

**File**: `src/__tests__/integration/sidebarIntegration.test.ts`

```typescript
import * as vscode from 'vscode';
import * as assert from 'assert';

suite('Sidebar Integration Tests', () => {
  test('Should register sidebar view provider', async () => {
    const viewProviders = vscode.window.registerWebviewViewProvider;
    assert.ok(viewProviders, 'WebviewViewProvider should be registered');
  });

  test('Should open sidebar on command execution', async () => {
    await vscode.commands.executeCommand('rifler.openSidebar');
    
    // Wait for sidebar to open
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Verify sidebar is visible (this requires accessing VS Code internals)
    // In real test, we'd check if the view is focused
  });

  test('Should perform search in sidebar context', async () => {
    await vscode.commands.executeCommand('rifler.openSidebar');
    
    // Wait for sidebar to initialize
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Send search message
    // Verify results appear
  });

  test('Should switch between sidebar and window views', async () => {
    // Open sidebar
    await vscode.commands.executeCommand('rifler.openSidebar');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Switch to window
    await vscode.commands.executeCommand('rifler.toggleView');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Verify window panel is open
  });
});
```

### 4.3 E2E Tests

**File**: `src/__tests__/e2e/suite/sidebar.test.ts`

```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Sidebar E2E Tests', function() {
  this.timeout(30000);

  test('Should display activity bar icon', async () => {
    // Verify icon is visible in activity bar
    // This requires UI automation or screenshot testing
  });

  test('Should open sidebar and perform search', async () => {
    // Open sidebar
    await vscode.commands.executeCommand('rifler.openSidebar');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Simulate search input
    // Wait for results
    // Verify results are displayed
  });

  test('Should replace text in sidebar context', async () => {
    // Open sidebar with replace mode
    await vscode.commands.executeCommand('rifler.openSidebarReplace');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Perform search
    // Enter replacement text
    // Execute replace
    // Verify replacement occurred
  });

  test('Should navigate to file from sidebar result', async () => {
    // Open sidebar
    // Perform search
    // Click on result
    // Verify file opens in editor
    // Verify cursor at correct position
  });

  test('Should preserve state when switching views', async () => {
    // Open sidebar
    // Enter search query
    // Get results
    // Switch to window view
    // Verify same query and results
  });

  test('Should respect panelLocation setting', async () => {
    // Set config to sidebar
    await vscode.workspace.getConfiguration('rifler').update(
      'panelLocation', 
      'sidebar', 
      vscode.ConfigurationTarget.Global
    );

    // Execute rifler.open (should open sidebar due to setting)
    await vscode.commands.executeCommand('rifler.open');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify sidebar opened (not window)
  });

  test('Should handle "ask" mode correctly', async () => {
    // Set config to ask
    await vscode.workspace.getConfiguration('rifler').update(
      'panelLocation', 
      'ask', 
      vscode.ConfigurationTarget.Global
    );

    // Execute rifler.open
    const commandPromise = vscode.commands.executeCommand('rifler.open');
    
    // Wait for quick pick to appear
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Simulate user selection (requires input simulation)
    // Verify correct view opens
  });
});
```

### 4.4 Visual Regression Tests

**File**: `src/__tests__/visual/sidebarVisual.test.ts`

```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';

suite('Sidebar Visual Tests', function() {
  this.timeout(30000);

  test('Sidebar layout renders correctly in narrow width', async () => {
    await vscode.commands.executeCommand('rifler.openSidebar');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Take screenshot or verify DOM structure
    // Compare with baseline
  });

  test('Sidebar theme adapts to light/dark themes', async () => {
    // Switch to light theme
    await vscode.workspace.getConfiguration('workbench').update(
      'colorTheme',
      'Default Light Modern',
      vscode.ConfigurationTarget.Global
    );
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Open sidebar
    await vscode.commands.executeCommand('rifler.openSidebar');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Verify colors match theme
    
    // Switch to dark theme
    await vscode.workspace.getConfiguration('workbench').update(
      'colorTheme',
      'Default Dark Modern',
      vscode.ConfigurationTarget.Global
    );
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Verify colors updated
  });

  test('Activity bar icon displays correctly', async () => {
    // Verify icon SVG renders
    // Verify icon tooltip
    // Verify icon color adapts to theme
  });

  test('Results list scrolls correctly in sidebar', async () => {
    // Perform search with many results
    // Verify scroll behavior
    // Verify scroll position preserved
  });
});
```

### 4.5 Performance Tests

**File**: `src/__tests__/performance/sidebarPerformance.test.ts`

```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Sidebar Performance Tests', function() {
  this.timeout(60000);

  test('Sidebar opens within 500ms', async () => {
    const start = Date.now();
    
    await vscode.commands.executeCommand('rifler.openSidebar');
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const duration = Date.now() - start;
    assert.ok(duration < 500, `Sidebar took ${duration}ms to open (expected <500ms)`);
  });

  test('Search results render within 2s for 1000+ results', async () => {
    await vscode.commands.executeCommand('rifler.openSidebar');
    await new Promise(resolve => setTimeout(resolve, 500));

    const start = Date.now();
    
    // Trigger search that returns many results
    // Measure render time
    
    const duration = Date.now() - start;
    assert.ok(duration < 2000, `Results took ${duration}ms to render (expected <2000ms)`);
  });

  test('View switching completes within 300ms', async () => {
    await vscode.commands.executeCommand('rifler.openSidebar');
    await new Promise(resolve => setTimeout(resolve, 500));

    const start = Date.now();
    await vscode.commands.executeCommand('rifler.toggleView');
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const duration = Date.now() - start;
    assert.ok(duration < 300, `View switch took ${duration}ms (expected <300ms)`);
  });

  test('Memory usage stays below 50MB after 100 searches', async () => {
    await vscode.commands.executeCommand('rifler.openSidebar');
    await new Promise(resolve => setTimeout(resolve, 500));

    const initialMemory = process.memoryUsage().heapUsed;
    
    // Perform 100 searches
    for (let i = 0; i < 100; i++) {
      // Trigger search
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    const finalMemory = process.memoryUsage().heapUsed;
    const memoryIncrease = (finalMemory - initialMemory) / 1024 / 1024;
    
    assert.ok(memoryIncrease < 50, `Memory increased by ${memoryIncrease}MB (expected <50MB)`);
  });
});
```

### 4.6 Accessibility Tests

**File**: `src/__tests__/accessibility/sidebarA11y.test.ts`

```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Sidebar Accessibility Tests', function() {
  this.timeout(30000);

  test('Sidebar webview has proper ARIA labels', async () => {
    await vscode.commands.executeCommand('rifler.openSidebar');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify ARIA labels exist for:
    // - Search input
    // - Results list
    // - Replace input
    // - Action buttons
  });

  test('Keyboard navigation works in sidebar', async () => {
    await vscode.commands.executeCommand('rifler.openSidebar');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Simulate keyboard navigation
    // Tab through elements
    // Verify focus order
    // Verify all elements reachable
  });

  test('Activity bar icon has accessible tooltip', async () => {
    // Verify tooltip text
    // Verify screen reader announcement
  });

  test('Color contrast meets WCAG AA standards', async () => {
    // Verify text/background contrast ratios
    // Test in both light and dark themes
  });

  test('Focus indicators are visible', async () => {
    await vscode.commands.executeCommand('rifler.openSidebar');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Tab through elements
    // Verify focus indicators visible
  });
});
```

---

## 5. IMPLEMENTATION TIMELINE

### Week 1: Foundation
- **Day 1-2**: Activity bar icon, view container, basic sidebar provider
- **Day 3-4**: Message handling, search integration
- **Day 5**: Unit tests for sidebar provider

### Week 2: Configuration & View Management
- **Day 1-2**: Settings, ViewManager implementation
- **Day 3-4**: Command registration, keyboard shortcuts
- **Day 5**: Integration tests

### Week 3: Polish & Testing
- **Day 1-2**: Responsive CSS, layout adjustments
- **Day 3**: E2E tests
- **Day 4**: Performance & accessibility tests
- **Day 5**: Documentation, final testing

### Week 4: Beta & Feedback
- **Day 1-2**: Beta release, gather feedback
- **Day 3-4**: Bug fixes, refinements
- **Day 5**: Final release

**Total Estimated Effort**: 20-25 hours

---

## 6. MIGRATION & BACKWARD COMPATIBILITY

### Preserving Existing Behavior
- Default `panelLocation` is `"window"` (current behavior)
- Existing keyboard shortcuts unchanged
- Window panel code remains functional
- No breaking changes to API or state

### Migration Path for Users
1. **Automatic**: Existing users see no change (window panel default)
2. **Opt-in**: Users can change `rifler.panelLocation` setting
3. **Gradual**: Users can try sidebar mode without losing window mode
4. **Reversible**: Users can switch back anytime

### State Migration
```typescript
// Migrate old state format to new format
function migrateState(oldState: any): any {
  return {
    ...oldState,
    viewContext: 'window', // Add context field
    version: 2 // Bump version for future migrations
  };
}
```

---

## 7. DOCUMENTATION UPDATES

### README.md Updates
```markdown
## Features

### Multiple View Options
- **Sidebar Panel** - Activity bar icon, search alongside editor
- **Window Panel** - Full panel beside editor (classic mode)
- **Flexible Layout** - Switch between views anytime

### Keyboard Shortcuts
- `Cmd+Shift+F` - Open in default location
- `Cmd+Ctrl+Shift+F` - Open in sidebar
- `Cmd+K Cmd+R` - Toggle between sidebar and window
```

### Settings Documentation
```json
{
  "rifler.panelLocation": {
    "description": "Choose where Rifler opens: sidebar, window, or ask each time",
    "examples": [
      {
        "value": "sidebar",
        "description": "Always open in activity bar sidebar"
      },
      {
        "value": "window",
        "description": "Always open beside editor (classic)"
      },
      {
        "value": "ask",
        "description": "Prompt for location each time"
      }
    ]
  }
}
```

---

## 8. SUCCESS METRICS

### Functional Metrics
- [ ] Activity bar icon visible and functional
- [ ] Sidebar panel renders correctly
- [ ] All search functionality works in sidebar
- [ ] Replace functionality works in sidebar
- [ ] View switching preserves state
- [ ] Settings control default behavior
- [ ] Keyboard shortcuts work correctly

### Performance Metrics
- [ ] Sidebar opens <500ms
- [ ] Search results render <2s for 1000+ results
- [ ] View switching <300ms
- [ ] Memory usage <50MB increase after 100 searches

### Quality Metrics
- [ ] 95%+ test coverage
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] All E2E tests pass
- [ ] No accessibility violations

### User Experience Metrics
- [ ] Clear activity bar icon
- [ ] Intuitive view switching
- [ ] Responsive layout in sidebar
- [ ] Theme compatibility (light/dark)
- [ ] Keyboard navigation works

---

## 9. RISKS & MITIGATION

### Risk: WebviewViewProvider API Limitations
**Impact**: High  
**Probability**: Medium  
**Mitigation**:
- Research API capabilities early
- Have fallback to window-only if needed
- Test on multiple VS Code versions

### Risk: Layout Issues in Narrow Sidebar
**Impact**: Medium  
**Probability**: Medium  
**Mitigation**:
- Responsive CSS from start
- Test with various sidebar widths
- Provide "wide" sidebar option

### Risk: State Synchronization Between Views
**Impact**: High  
**Probability**: Low  
**Mitigation**:
- Centralized state management
- Comprehensive sync tests
- Clear state ownership model

### Risk: Breaking Changes to Existing Users
**Impact**: High  
**Probability**: Low  
**Mitigation**:
- Default to current behavior
- Thorough backward compatibility testing
- Clear migration docs

---

## 10. FUTURE ENHANCEMENTS

### Post-MVP Features
1. **Customizable Sidebar Width** (if VS Code supports)
2. **Drag-and-Drop** between sidebar and window views
3. **Multiple Sidebar Instances** (if needed)
4. **Sidebar-Specific UI Optimizations**
5. **Context Menu Integration** for view switching

### Long-term Vision
- **Unified View System** with pluggable UI backends
- **QuickPick Mode** integration (Issue #44)
- **Custom Layouts** for different workflows
- **View Presets** (e.g., "Research Mode", "Refactor Mode")

---

## APPENDIX A: VS Code API Reference

### WebviewViewProvider API
```typescript
interface WebviewViewProvider {
  resolveWebviewView(
    webviewView: WebviewView,
    context: WebviewViewResolveContext,
    token: CancellationToken
  ): void | Thenable<void>;
}
```

### View Container Contribution
```json
{
  "viewsContainers": {
    "activitybar": [
      {
        "id": "string",
        "title": "string",
        "icon": "string (path or codicon)"
      }
    ]
  }
}
```

### WebviewView vs WebviewPanel
| Feature | WebviewView | WebviewPanel |
|---------|-------------|--------------|
| Location | Sidebar only | Anywhere |
| Lifecycle | Managed by VS Code | Extension controlled |
| Visibility | Part of view container | Independent |
| State | Auto-preserved | Manual persistence |

---

## APPENDIX B: Testing Checklist

### Pre-Release Testing
- [ ] Test on macOS
- [ ] Test on Windows
- [ ] Test on Linux
- [ ] Test with light theme
- [ ] Test with dark theme
- [ ] Test with high contrast themes
- [ ] Test with various sidebar widths
- [ ] Test with large workspaces (10,000+ files)
- [ ] Test with multiple workspace folders
- [ ] Test memory leaks (extended usage)
- [ ] Test performance degradation over time
- [ ] Test accessibility with screen reader
- [ ] Test keyboard-only navigation
- [ ] Test with VS Code Insiders
- [ ] Test with VS Code stable

### User Acceptance Testing
- [ ] Beta testers can install and use sidebar
- [ ] No confusion about view modes
- [ ] Settings are clear and functional
- [ ] Keyboard shortcuts are intuitive
- [ ] Documentation is helpful
- [ ] Migration from old version smooth

---

## CONCLUSION

This implementation plan provides a comprehensive roadmap for adding sidebar functionality to Rifler (Issues #42 and #43). The phased approach ensures:

1. **Backward Compatibility**: Existing users unaffected
2. **Incremental Delivery**: Features can be shipped progressively
3. **Quality Assurance**: Extensive testing at every phase
4. **User Choice**: Flexible view options for different workflows
5. **Future-Proof**: Architecture supports future enhancements

The sidebar integration will significantly improve Rifler's discoverability and usability, aligning it with standard VS Code extension patterns while maintaining its powerful search and replace capabilities.

**Estimated Total Effort**: 20-25 hours  
**Target Completion**: 4 weeks  
**Priority**: High (as marked in both issues)
