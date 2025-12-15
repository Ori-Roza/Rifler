# Status Update & Implementation Roadmap - Issue #46

**Date:** December 15, 2025  
**Branch:** `feat/ux-sidebar-refactor`

## Current Status

### Code Analysis
- **extension.ts**: **3,785 lines** (↑ from 2,893 when issue created)
- **getWebviewHtml()**: Lines 835-3777 (~2,943 lines of embedded HTML/CSS/JS)

### Progress Assessment
✅ **Partial:** ViewManager extracted (`src/views/ViewManager.ts` - 101 lines)  
✅ **Partial:** SidebarProvider extracted (`src/sidebar/SidebarProvider.ts` - 404 lines)  
❌ **Pending:** WebView UI extraction (Phase 1 - **CRITICAL**)  
❌ **Pending:** Message Protocol centralization (Phase 3)  
❌ **Pending:** Command separation (Phase 4)  
❌ **Pending:** State Management refactoring (Phase 6)

**The core issue remains**: 2,900+ lines of embedded HTML/CSS/JS prevent maintainability.

---

## Detailed Implementation Roadmap

### **Phase 1: Extract WebView UI** ⚡ **HIGH PRIORITY**
**Impact:** Reduce extension.ts by ~2,900 lines

**New Files:**
```
src/webview/
├── index.html    (~100 lines - HTML structure)
├── styles.css    (~975 lines - all styles)
└── script.js     (~1,830 lines - client logic)
```

**Implementation:**
1. Extract inline `<style>` (lines 847-1822) → `styles.css`
2. Extract `<body>` HTML (lines 1823-1944) → `index.html` 
3. Extract `<script>` (lines 1945-3775) → `script.js`
4. Update `getWebviewHtml()` to load via `webview.asWebviewUri()`
5. Configure Content Security Policy for local resources

**Testing:**
- All existing unit tests must pass
- All E2E tests must pass
- Manual testing: sidebar & window modes
- Verify on macOS/Windows/Linux

**Result:** extension.ts reduced to ~850 lines

---

### **Phase 2: Complete Panel Management Service**
**Goal:** Consolidate panel lifecycle

**File:** `src/services/PanelManager.ts` (create from ViewManager)

**Functions to migrate:**
- `minimizeToStatusBar()` (line 398)
- `restorePanel()` (line 428)
- `openSearchPanel()` (line 454)
- `getSelectedText()` (line 383)

**API:**
```typescript
export class PanelManager {
  createOrShowPanel(options: PanelOptions): void
  minimize(state?: SearchState): void
  restore(): void
  dispose(): void
  get currentPanel(): vscode.WebviewPanel | undefined
}
```

---

### **Phase 3: Create Message Protocol Module**
**Goal:** Eliminate code duplication

**Current Duplication:**
- extension.ts (lines 490-622): Window panel message handling
- SidebarProvider.ts (lines 112-181): Sidebar message handling
- **16 message interfaces** scattered in extension.ts (lines 10-154)

**New Structure:**
```
src/messaging/
├── types.ts       (all message interfaces)
└── handler.ts     (unified message dispatcher)
```

```typescript
export class MessageHandler {
  private handlers: Map<string, MessageHandlerFn>
  async handle(message: WebviewMessage): Promise<void>
  registerHandler(type: string, handler: MessageHandlerFn): void
}
```

---

### **Phase 4: Separate Command Registration**
**Goal:** Modular command structure

**Current:** Lines 213-368 in extension.ts (12 commands inline)

**New Structure:**
```
src/commands/
├── index.ts                  (registry)
├── open.ts
├── openReplace.ts
├── openSidebar.ts
├── openSidebarReplace.ts
├── toggleView.ts
├── toggleReplace.ts
├── minimize.ts
├── restore.ts
└── internal/
    ├── openWindowInternal.ts
    ├── closeWindowInternal.ts
    └── testEnsureOpen.ts
```

---

### **Phase 5: Refactor State Management**
**Goal:** Encapsulated state

**Current Module Variables (lines 164-168):**
```typescript
let currentPanel: vscode.WebviewPanel | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let savedState: MinimizeMessage['state'] | undefined;
let isMinimized: boolean = false;
let sidebarVisible: boolean = false;
```

**New:** `src/state/StateManager.ts`
```typescript
export class StateManager {
  get currentPanel(): vscode.WebviewPanel | undefined
  get isMinimized(): boolean
  get sidebarVisible(): boolean
  async saveState(state: SearchState): Promise<void>
  async loadState(): Promise<SearchState | undefined>
}
```

---

### **Phase 6: Workspace Utilities** (Optional)
**Goal:** Reusable workspace operations for QuickPick mode (Issue #44)

**File:** `src/services/WorkspaceService.ts`

**Functions:**
- `findWorkspaceModules()` (line 626)
- `sendModulesList()` (line 675)
- `sendCurrentDirectory()` (line 680)
- `sendFileContent()` (line 700)
- `saveFile()` (line 743)

---

## Final Target Structure

```
src/
├── extension.ts                 (~150 lines ✨)
├── commands/
│   ├── index.ts
│   ├── open.ts
│   ├── openReplace.ts
│   ├── minimize.ts
│   ├── restore.ts
│   ├── toggleView.ts
│   └── toggleReplace.ts
├── services/
│   ├── PanelManager.ts
│   └── WorkspaceService.ts (optional)
├── messaging/
│   ├── types.ts
│   └── handler.ts
├── state/
│   └── StateManager.ts
├── webview/
│   ├── index.html
│   ├── styles.css
│   └── script.js
├── views/
│   └── ViewManager.ts (existing)
├── sidebar/
│   └── SidebarProvider.ts (existing, updated)
├── search.ts (unchanged)
├── replacer.ts (unchanged)
└── utils.ts (unchanged)
```

---

## Implementation Strategy

Each phase will follow this workflow:
1. ✅ Implement changes
2. ✅ Run unit tests (`npm test`)
3. ✅ Run E2E tests (`npm run test:e2e`)
4. ✅ Fix any issues
5. ✅ Commit with detailed message
6. ✅ Proceed to next phase

---

## Estimated Effort

| Phase | Effort | Priority |
|-------|--------|----------|
| Phase 1: WebView Extraction | 4-6 hours | ⚡ CRITICAL |
| Phase 2: Panel Management | 4-5 hours | High |
| Phase 3: Message Protocol | 5-6 hours | High |
| Phase 4: Commands | 3-4 hours | Medium |
| Phase 5: State Management | 3-4 hours | Medium |
| Phase 6: Workspace Utils | 4-5 hours | Optional |

**Total Core:** 19-25 hours  
**With Optional:** 23-30 hours

---

## Benefits

✅ **Maintainability:** extension.ts from 3,785 → ~150 lines  
✅ **Testability:** Each module independently testable  
✅ **Extensibility:** Ready for QuickPick mode (Issue #44)  
✅ **Code Quality:** Clear separation of concerns  
✅ **Developer Experience:** Easy navigation & understanding  
✅ **Open Source:** Contributor-friendly codebase

---

## Daily Progress Plan

### Week 1
- **Day 1:** Phase 1 - Extract WebView UI
- **Day 2:** Phase 1 - Testing and fixes
- **Day 3:** Phase 2 - Panel Management Service
- **Day 4:** Phase 2 - Testing and fixes
- **Day 5:** Phase 3 - Message Protocol (Part 1)

### Week 2
- **Day 6:** Phase 3 - Message Protocol (Part 2)
- **Day 7:** Phase 3 - Testing and fixes
- **Day 8:** Phase 4 - Command Registration
- **Day 9:** Phase 5 - State Management
- **Day 10:** Phase 6 - Workspace Utilities (Optional)

### Week 3
- **Day 11:** Final testing and documentation
- **Day 12:** PR review and adjustments
- **Day 13:** Merge and release

---

**Status:** Ready to begin implementation starting with Phase 1.

**Full roadmap document:** See `REFACTORING_ROADMAP.md` in the repository root for detailed implementation steps, testing checklists, and commit message templates for each phase.
