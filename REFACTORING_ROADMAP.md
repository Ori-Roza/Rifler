# Refactoring Roadmap - Issue #46
## Architecture Refactoring for Better Modularity and Maintainability

**Status:** In Progress  
**Branch:** `feat/ux-sidebar-refactor`  
**Start Date:** December 15, 2025

---

## Current Status

### Code Analysis
- **extension.ts**: **3,785 lines** (↑ from 2,893 when issue created)
- **getWebviewHtml()**: Lines 835-3777 (~2,943 lines of embedded HTML/CSS/JS)

### Progress Assessment
- ✅ **Partial:** ViewManager extracted (`src/views/ViewManager.ts` - 101 lines)
- ✅ **Partial:** SidebarProvider extracted (`src/sidebar/SidebarProvider.ts` - 404 lines)
- ❌ **Pending:** WebView UI extraction (Phase 1 - **CRITICAL**)
- ❌ **Pending:** Message Protocol centralization (Phase 3)
- ❌ **Pending:** Command separation (Phase 4)
- ❌ **Pending:** State Management refactoring (Phase 6)

**The core issue remains**: 2,900+ lines of embedded HTML/CSS/JS prevent maintainability.

---

## Implementation Phases

### Phase 1: Extract WebView UI ⚡ **HIGH PRIORITY**
**Priority:** CRITICAL  
**Estimated Time:** 4-6 hours  
**Status:** Not Started

#### Objective
Reduce extension.ts by ~2,900 lines by extracting embedded HTML/CSS/JS into separate files.

#### Files to Create
```
src/webview/
├── index.html    (~100 lines - HTML structure)
├── styles.css    (~975 lines - all styles)
└── script.js     (~1,830 lines - client logic)
```

#### Implementation Steps
1. **Create webview directory structure**
   ```bash
   mkdir -p src/webview
   ```

2. **Extract CSS** (lines 847-1822 in extension.ts)
   - Create `src/webview/styles.css`
   - Copy all CSS content from `<style>` tag
   - Remove `<style>` tags

3. **Extract HTML body** (lines 1823-1944 in extension.ts)
   - Create `src/webview/index.html`
   - Include full HTML structure with head
   - Reference styles.css and script.js
   - Keep nonce placeholder for CSP

4. **Extract JavaScript** (lines 1945-3775 in extension.ts)
   - Create `src/webview/script.js`
   - Copy all script content
   - Remove `<script>` tags and IIFE wrapper

5. **Update getWebviewHtml() function**
   ```typescript
   export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
     const nonce = getNonce();
     
     // Get URIs for resources
     const stylesUri = webview.asWebviewUri(
       vscode.Uri.joinPath(extensionUri, 'src', 'webview', 'styles.css')
     );
     const scriptUri = webview.asWebviewUri(
       vscode.Uri.joinPath(extensionUri, 'src', 'webview', 'script.js')
     );
     const indexUri = vscode.Uri.joinPath(extensionUri, 'src', 'webview', 'index.html');
     
     // Read and process HTML template
     // Replace placeholders with actual URIs and nonce
   }
   ```

6. **Update CSP (Content Security Policy)**
   - Allow loading from `webview.cspSource`
   - Maintain nonce for inline scripts if needed
   - Keep CDN access for highlight.js

7. **Update function signatures**
   - Add `extensionUri` parameter to `getWebviewHtml()`
   - Update all calls in extension.ts
   - Update call in SidebarProvider.ts

#### Testing Checklist
- [ ] Run unit tests: `npm test`
- [ ] Run E2E tests: `npm run test:e2e`
- [ ] Manual test: Open Rifler in sidebar mode
- [ ] Manual test: Open Rifler in window/tab mode
- [ ] Manual test: Toggle replace mode
- [ ] Manual test: Run search with results
- [ ] Manual test: Preview file content
- [ ] Manual test: Edit mode and replace in file
- [ ] Manual test: Minimize and restore
- [ ] Verify on macOS
- [ ] Verify on Windows (if possible)
- [ ] Verify on Linux (if possible)

#### Expected Result
- extension.ts reduced to ~850 lines
- All tests passing
- No functionality changes
- Better IDE support for HTML/CSS/JS

#### Commit Message Template
```
refactor(phase-1): Extract webview UI to separate files

BREAKING CHANGE: Refactored webview architecture

- Extracted ~975 lines of CSS to src/webview/styles.css
- Extracted ~100 lines of HTML to src/webview/index.html  
- Extracted ~1,830 lines of JS to src/webview/script.js
- Updated getWebviewHtml() to load files via asWebviewUri()
- Configured CSP for local resource loading
- Reduced extension.ts from 3,785 to ~850 lines

This is Phase 1 of the architecture refactoring outlined in Issue #46.
No functionality changes - pure code organization improvement.

Tests: All unit and E2E tests passing
Verified: Sidebar and window modes working correctly

Issue: #46
```

---

### Phase 2: Complete Panel Management Service
**Priority:** High  
**Estimated Time:** 4-5 hours  
**Status:** Not Started  
**Prerequisites:** Phase 1 complete

#### Objective
Consolidate all panel lifecycle management into a dedicated service.

#### Files to Create/Update
```
src/services/
└── PanelManager.ts  (new - ~200 lines)

src/views/
└── ViewManager.ts   (update - merge/delegate to PanelManager)
```

#### Functions to Migrate
From extension.ts to PanelManager:
- `minimizeToStatusBar()` (line 398)
- `restorePanel()` (line 428)
- `openSearchPanel()` (line 454)
- `getSelectedText()` (line 383)

#### API Design
```typescript
export interface PanelOptions {
  showReplace?: boolean;
  restoreState?: any;
  initialQuery?: string;
}

export class PanelManager {
  constructor(
    private context: vscode.ExtensionContext,
    private extensionUri: vscode.Uri
  ) {}

  createOrShowPanel(options: PanelOptions): void;
  minimize(state?: any): void;
  restore(): void;
  dispose(): void;
  
  get currentPanel(): vscode.WebviewPanel | undefined;
  get isMinimized(): boolean;
}
```

#### Implementation Steps
1. Create `src/services/PanelManager.ts`
2. Move panel-related functions from extension.ts
3. Update ViewManager to use PanelManager
4. Update extension.ts activate() to instantiate PanelManager
5. Update command handlers to use PanelManager
6. Maintain test exports (testHelpers)

#### Testing Checklist
- [ ] Run unit tests: `npm test`
- [ ] Run E2E tests: `npm run test:e2e`
- [ ] Test panel open/close
- [ ] Test minimize/restore
- [ ] Test status bar interactions
- [ ] Test state persistence

#### Commit Message Template
```
refactor(phase-2): Extract panel management to dedicated service

- Created PanelManager service for panel lifecycle
- Moved minimize/restore/open functions to PanelManager
- Updated ViewManager to delegate to PanelManager
- Encapsulated status bar management
- Maintained backward compatibility for tests

Reduces extension.ts by ~150 lines.
Phase 2 of architecture refactoring (Issue #46).

Tests: All passing
```

---

### Phase 3: Create Message Protocol Module
**Priority:** High  
**Estimated Time:** 5-6 hours  
**Status:** Not Started  
**Prerequisites:** Phase 2 complete

#### Objective
Centralize message handling and eliminate code duplication between window panel and sidebar.

#### Current Duplication
- extension.ts (lines 490-622): Window panel message handling
- SidebarProvider.ts (lines 112-181): Sidebar message handling
- **16 message interfaces** scattered in extension.ts (lines 10-154)

#### Files to Create
```
src/messaging/
├── types.ts       (~150 lines - all message interfaces)
└── handler.ts     (~250 lines - unified message dispatcher)
```

#### Message Interfaces to Move
From extension.ts to messaging/types.ts:
- MinimizeMessage
- ValidateRegexMessage
- ValidateFileMaskMessage
- TestSearchCompletedMessage
- TestSearchResultsReceivedMessage
- TestErrorMessage
- DiagPingMessage
- RunSearchMessage
- OpenLocationMessage
- GetModulesMessage
- GetCurrentDirectoryMessage
- GetFileContentMessage
- ReplaceOneMessage
- ReplaceAllMessage
- WebviewReadyMessage
- SaveFileMessage
- WebviewMessage (union type)
- SearchResultsMessage
- ModulesListMessage
- CurrentDirectoryMessage
- FileContentMessage

#### API Design
```typescript
// messaging/types.ts
export interface WebviewMessage {
  type: string;
  // ... common fields
}

export interface RunSearchMessage extends WebviewMessage {
  type: 'runSearch';
  query: string;
  scope: SearchScope;
  // ... other fields
}

// ... all other message interfaces

export type IncomingMessage = 
  | RunSearchMessage 
  | OpenLocationMessage 
  | GetModulesMessage
  // ... all message types

// messaging/handler.ts
export type MessageHandlerFn = (message: any) => Promise<void>;

export class MessageHandler {
  private handlers: Map<string, MessageHandlerFn> = new Map();
  
  constructor(
    private panel: vscode.WebviewPanel,
    private context: vscode.ExtensionContext
  ) {}
  
  registerHandler(type: string, handler: MessageHandlerFn): void;
  async handle(message: IncomingMessage): Promise<void>;
}
```

#### Implementation Steps
1. Create `src/messaging/types.ts`
2. Move all message interfaces from extension.ts
3. Create `src/messaging/handler.ts`
4. Implement MessageHandler class
5. Create handler registry pattern
6. Update extension.ts to use MessageHandler
7. Update SidebarProvider.ts to use MessageHandler
8. Remove duplicate switch-case statements

#### Testing Checklist
- [ ] Run unit tests: `npm test`
- [ ] Run E2E tests: `npm run test:e2e`
- [ ] Test all message types from webview
- [ ] Test search functionality
- [ ] Test replace functionality
- [ ] Test file operations
- [ ] Test validation messages
- [ ] Test sidebar and window modes

#### Commit Message Template
```
refactor(phase-3): Centralize message protocol

- Created messaging/types.ts with all message interfaces
- Created messaging/handler.ts with unified dispatcher
- Eliminated code duplication between extension and sidebar
- Replaced large switch-case with handler registry pattern
- Type-safe message handling throughout

Removes ~200 lines of duplicated code.
Phase 3 of architecture refactoring (Issue #46).

Tests: All passing
```

---

### Phase 4: Separate Command Registration
**Priority:** Medium  
**Estimated Time:** 3-4 hours  
**Status:** Not Started  
**Prerequisites:** Phase 3 complete

#### Objective
Extract command registration into modular, testable command files.

#### Current State
Lines 213-368 in extension.ts contain 12 commands registered inline in activate().

#### Files to Create
```
src/commands/
├── index.ts                     (~50 lines - registry)
├── open.ts                      (~30 lines)
├── openReplace.ts               (~30 lines)
├── openSidebar.ts               (~25 lines)
├── openSidebarReplace.ts        (~25 lines)
├── toggleView.ts                (~20 lines)
├── toggleReplace.ts             (~40 lines)
├── minimize.ts                  (~20 lines)
├── restore.ts                   (~20 lines)
└── internal/
    ├── openWindowInternal.ts    (~25 lines)
    ├── closeWindowInternal.ts   (~15 lines)
    └── testEnsureOpen.ts        (~15 lines)
```

#### Commands to Extract
- `rifler.open`
- `rifler.openReplace`
- `rifler.openSidebar`
- `rifler.openSidebarReplace`
- `rifler.toggleView`
- `rifler.toggleReplace`
- `rifler.restore`
- `rifler.minimize`
- `rifler._openWindowInternal` (internal)
- `rifler._closeWindowInternal` (internal)
- `__test_ensurePanelOpen` (test-only)

#### API Design
```typescript
// commands/index.ts
export interface CommandContext {
  extensionContext: vscode.ExtensionContext;
  panelManager: PanelManager;
  viewManager: ViewManager;
  sidebarProvider: RiflerSidebarProvider;
  // ... other dependencies
}

export function registerCommands(ctx: CommandContext): void {
  const { extensionContext } = ctx;
  
  extensionContext.subscriptions.push(
    vscode.commands.registerCommand('rifler.open', () => openCommand(ctx)),
    vscode.commands.registerCommand('rifler.openReplace', () => openReplaceCommand(ctx)),
    // ... all other commands
  );
}

// commands/open.ts
export function openCommand(ctx: CommandContext): void {
  // Command implementation
}
```

#### Implementation Steps
1. Create `src/commands/` directory structure
2. Create base `commands/index.ts` with registry
3. Extract each command to its own file
4. Define CommandContext interface
5. Update activate() to use registerCommands()
6. Update all command handlers to accept CommandContext
7. Remove inline command registrations from extension.ts

#### Testing Checklist
- [ ] Run unit tests: `npm test`
- [ ] Run E2E tests: `npm run test:e2e`
- [ ] Test each command individually
- [ ] Test command palette access
- [ ] Test keybinding triggers
- [ ] Test status bar clicks

#### Commit Message Template
```
refactor(phase-4): Extract commands to separate modules

- Created commands/ directory with modular structure
- Extracted 12 commands from extension.ts
- Introduced CommandContext for dependency injection
- Each command now in separate, testable file
- Simplified activate() function

Reduces extension.ts by ~155 lines.
Phase 4 of architecture refactoring (Issue #46).

Tests: All passing
```

---

### Phase 5: Refactor State Management
**Priority:** Medium  
**Estimated Time:** 3-4 hours  
**Status:** Not Started  
**Prerequisites:** Phase 4 complete

#### Objective
Encapsulate module-level state variables into a dedicated StateManager class.

#### Current State Variables (lines 164-168)
```typescript
let currentPanel: vscode.WebviewPanel | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let savedState: MinimizeMessage['state'] | undefined;
let isMinimized: boolean = false;
let sidebarVisible: boolean = false;
```

#### Files to Create
```
src/state/
└── StateManager.ts  (~150 lines)
```

#### API Design
```typescript
export interface SearchState {
  query: string;
  replaceText: string;
  scope: string;
  directoryPath?: string;
  modulePath?: string;
  filePath?: string;
  options: SearchOptions;
  showReplace: boolean;
}

export class StateManager {
  private _currentPanel?: vscode.WebviewPanel;
  private _statusBarItem?: vscode.StatusBarItem;
  private _savedState?: SearchState;
  private _isMinimized: boolean = false;
  private _sidebarVisible: boolean = false;
  
  constructor(private context: vscode.ExtensionContext) {}
  
  // Getters
  get currentPanel(): vscode.WebviewPanel | undefined;
  get statusBarItem(): vscode.StatusBarItem | undefined;
  get savedState(): SearchState | undefined;
  get isMinimized(): boolean;
  get sidebarVisible(): boolean;
  
  // Setters
  set currentPanel(panel: vscode.WebviewPanel | undefined);
  set statusBarItem(item: vscode.StatusBarItem | undefined);
  set sidebarVisible(visible: boolean);
  
  // State persistence
  async saveState(state: SearchState): Promise<void>;
  async loadState(): Promise<SearchState | undefined>;
  clearState(): Promise<void>;
  
  // Panel state
  setMinimized(state: SearchState): void;
  clearMinimized(): void;
  
  // Test helper (maintains backward compatibility)
  getTestHelpers(): { getCurrentPanel: () => vscode.WebviewPanel | undefined };
}
```

#### Implementation Steps
1. Create `src/state/StateManager.ts`
2. Move all state variables into StateManager class
3. Add getters/setters for state access
4. Implement state persistence methods
5. Update extension.ts to use StateManager
6. Update PanelManager to use StateManager
7. Update commands to use StateManager
8. Maintain `testHelpers` export for E2E tests

#### Testing Checklist
- [ ] Run unit tests: `npm test`
- [ ] Run E2E tests: `npm run test:e2e`
- [ ] Test state persistence across restarts
- [ ] Test minimize/restore state
- [ ] Test sidebar visibility tracking
- [ ] Test panel state management
- [ ] Verify testHelpers still work

#### Commit Message Template
```
refactor(phase-5): Encapsulate state management

- Created StateManager class for centralized state
- Removed module-level state variables
- Added state persistence methods
- Implemented getters/setters for controlled access
- Maintained testHelpers for backward compatibility

Improves testability and state predictability.
Phase 5 of architecture refactoring (Issue #46).

Tests: All passing
```

---

### Phase 6: Extract Workspace Utilities (Optional)
**Priority:** Optional  
**Estimated Time:** 4-5 hours  
**Status:** Not Started  
**Prerequisites:** Phase 5 complete

#### Objective
Create reusable workspace service for QuickPick mode (Issue #44).

#### Files to Create
```
src/services/
└── WorkspaceService.ts  (~250 lines)
```

#### Functions to Extract
From extension.ts:
- `findWorkspaceModules()` (line 626)
- `sendModulesList()` (line 675)
- `sendCurrentDirectory()` (line 680)
- `sendFileContent()` (line 700)
- `saveFile()` (line 743)

#### API Design
```typescript
export interface ModuleInfo {
  name: string;
  path: string;
}

export interface FileContentData {
  uri: string;
  content: string;
  fileName: string;
  matches: Array<{ line: number; start: number; end: number }>;
}

export class WorkspaceService {
  async findModules(): Promise<ModuleInfo[]>;
  getCurrentDirectory(): string;
  async getFileContent(
    uri: string,
    query: string,
    options: SearchOptions
  ): Promise<FileContentData>;
  async saveFile(uri: string, content: string): Promise<boolean>;
  
  // Send methods for webview communication
  async sendModulesList(panel: vscode.WebviewPanel): Promise<void>;
  sendCurrentDirectory(panel: vscode.WebviewPanel): void;
  async sendFileContent(
    panel: vscode.WebviewPanel,
    uri: string,
    query: string,
    options: SearchOptions
  ): Promise<void>;
}
```

#### Implementation Steps
1. Create `src/services/WorkspaceService.ts`
2. Move workspace functions from extension.ts
3. Make methods generic (not tied to specific panel)
4. Add unit tests for WorkspaceService
5. Update extension.ts to use WorkspaceService
6. Update SidebarProvider to use WorkspaceService
7. Document API for future QuickPick mode use

#### Testing Checklist
- [ ] Run unit tests: `npm test`
- [ ] Run E2E tests: `npm run test:e2e`
- [ ] Test module detection
- [ ] Test directory detection
- [ ] Test file content loading
- [ ] Test file saving
- [ ] Test with different workspace configurations

#### Commit Message Template
```
refactor(phase-6): Extract workspace utilities service

- Created WorkspaceService for workspace operations
- Extracted module/directory/file functions
- Made service reusable for future QuickPick mode (Issue #44)
- Added comprehensive unit tests
- Improved separation of concerns

Prepares codebase for QuickPick feature.
Phase 6 of architecture refactoring (Issue #46).

Tests: All passing
```

---

## Final Target Structure

After all phases complete:

```
src/
├── extension.ts                 (~150 lines ✨)
│
├── commands/
│   ├── index.ts                 (command registry)
│   ├── open.ts
│   ├── openReplace.ts
│   ├── openSidebar.ts
│   ├── openSidebarReplace.ts
│   ├── toggleView.ts
│   ├── toggleReplace.ts
│   ├── minimize.ts
│   ├── restore.ts
│   └── internal/
│       ├── openWindowInternal.ts
│       ├── closeWindowInternal.ts
│       └── testEnsureOpen.ts
│
├── services/
│   ├── PanelManager.ts          (panel lifecycle)
│   └── WorkspaceService.ts      (workspace operations)
│
├── messaging/
│   ├── types.ts                 (all message interfaces)
│   └── handler.ts               (message dispatcher)
│
├── state/
│   └── StateManager.ts          (state management)
│
├── webview/
│   ├── index.html               (UI structure)
│   ├── styles.css               (all styles)
│   └── script.js                (client-side logic)
│
├── views/
│   └── ViewManager.ts           (existing - view routing)
│
├── sidebar/
│   └── SidebarProvider.ts       (existing - sidebar integration)
│
├── search.ts                    (unchanged - search logic)
├── replacer.ts                  (unchanged - replace logic)
└── utils.ts                     (unchanged - utilities)
```

---

## Progress Tracking

### Week 1
- [ ] Day 1: Phase 1 - Extract WebView UI
- [ ] Day 2: Phase 1 - Testing and fixes
- [ ] Day 3: Phase 2 - Panel Management Service
- [ ] Day 4: Phase 2 - Testing and fixes
- [ ] Day 5: Phase 3 - Message Protocol (Part 1)

### Week 2
- [ ] Day 6: Phase 3 - Message Protocol (Part 2)
- [ ] Day 7: Phase 3 - Testing and fixes
- [ ] Day 8: Phase 4 - Command Registration
- [ ] Day 9: Phase 5 - State Management
- [ ] Day 10: Phase 6 - Workspace Utilities (Optional)

### Week 3
- [ ] Day 11: Final testing and documentation
- [ ] Day 12: PR review and adjustments
- [ ] Day 13: Merge and release

---

## Success Criteria

- [x] All existing tests pass
- [ ] Extension.ts reduced to ~150 lines
- [ ] WebView files exist as separate HTML/CSS/JS
- [ ] Services are independently testable
- [ ] No user-facing behavior changes
- [ ] Code coverage maintained or improved
- [ ] Documentation updated
- [ ] Architecture diagram created
- [ ] CONTRIBUTING.md updated with new structure

---

## Benefits Summary

### For Maintainability
- ✅ Extension.ts: 3,785 → ~150 lines (96% reduction)
- ✅ Clear module boundaries
- ✅ Single responsibility per file
- ✅ Easy to locate functionality

### For Testing
- ✅ Unit testable services
- ✅ Mockable dependencies
- ✅ Clear integration points
- ✅ Reduced test complexity

### For Future Features
- ✅ Ready for QuickPick mode (Issue #44)
- ✅ Easy to add new commands
- ✅ Reusable workspace utilities
- ✅ Extensible message protocol

### For Contributors
- ✅ Contributor-friendly structure
- ✅ Clear separation of concerns
- ✅ Well-documented architecture
- ✅ Easy onboarding

---

## Related Issues

- Issue #46: Main refactoring issue (this document)
- Issue #44: QuickPick mode (will benefit from Phase 6)
- Issue #25: Inline validation (easier after Phase 3)

---

## Notes

- Each phase is designed to be completable in 1-2 days
- All phases maintain backward compatibility
- Tests must pass before moving to next phase
- Commit after each successful phase
- Can pause between phases without breaking functionality
- Phase 6 is optional but recommended for future-proofing

---

## Appendix: Useful Commands

```bash
# Run all tests
npm test

# Run E2E tests only
npm run test:e2e

# Run with coverage
npm run test:coverage

# Build extension
npm run compile

# Watch mode for development
npm run watch

# Package extension
npm run package

# Check for issues
npm run lint

# View current line count
wc -l src/extension.ts

# View git diff
git diff src/extension.ts

# Commit with message
git add .
git commit -m "refactor(phase-N): Brief description"

# Push changes
git push origin feat/ux-sidebar-refactor
```

---

**Last Updated:** December 15, 2025  
**Document Version:** 1.0  
**Status:** Ready for Implementation
