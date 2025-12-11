# Rifler Extension - Architecture Analysis
## For Issue #44: Add Popup/QuickPick Search Mode

---

## 1. CURRENT ARCHITECTURE OVERVIEW

### Extension Type
- **VS Code Extension** targeting API v1.85.0+
- **WebView-based UI** - All search/replace functionality runs in an embedded HTML panel
- **TypeScript** - Fully typed codebase
- **No external dependencies** for core functionality (only highlight.js for syntax highlighting)

### Core Components

#### **A. Extension Entry Point** (`src/extension.ts` - 2893 lines)
- **Single webview panel** for search/replace interface
- **Status bar integration** for minimize/restore functionality
- **Persistent state storage** using VS Code's `globalState`
- **Command registration** for:
  - `rifler.open` - Toggle main panel (Cmd+Shift+F / Ctrl+Shift+F)
  - `rifler.openReplace` - Open with replace mode visible (Alt+Shift+F)
  - `rifler.minimize` - Minimize to status bar
  - `rifler.restore` - Restore from status bar

#### **B. Search Engine** (`src/search.ts` - 226 lines)
- **Core function**: `performSearch(query, scope, options, directoryPath?, modulePath?, filePath?)`
- **Async file system operations** with concurrency limiting (max 100 concurrent operations)
- **Supports 4 search scopes**:
  - `project` - Entire workspace
  - `directory` - Specific directory (with custom path)
  - `module` - Detected modules (package.json, tsconfig.json, etc.)
  - `file` - Single file content

#### **C. Search Utilities** (`src/utils.ts` - 379 lines)
- **Regex building**: `buildSearchRegex()` - Handles case-sensitivity, whole-word matching, and raw regex
- **File masking**: `matchesFileMask()` - PyCharm-style patterns with include/exclude support
- **Validation**:
  - `validateRegex()` - Pre-flight regex validation
  - `validateFileMask()` - File mask pattern validation
- **Excluded directories**: node_modules, .git, dist, out, etc.
- **Binary file extensions**: Automatically skipped during search

#### **D. Replace Functionality** (`src/replacer.ts` - 44 lines)
- **replaceOne()** - Replace single occurrence with document save
- **replaceAll()** - Batch replace all occurrences with workspace edit

#### **E. WebView UI** (embedded in `extension.ts`)
- **Vanilla JavaScript** (no framework)
- **Embedded HTML/CSS/JS** starting at line ~700
- **Dynamic DOM manipulation** for results list and file preview
- **Syntax highlighting** via highlight.js CDN

---

## 2. KEY FUNCTIONS AND THEIR PURPOSES

### Search Pipeline

```
User Input
   ↓
performSearch() [search.ts]
   ├─→ buildSearchRegex() [utils.ts]
   ├─→ validateRegex() [utils.ts]
   ├─→ validateFileMask() [utils.ts]
   ├─→ searchInDirectory() [search.ts]
   ├─→ searchInFileAsync() [search.ts]
   └─→ Returns: SearchResult[]
```

### Critical Functions

| Function | File | Purpose | Reusable |
|----------|------|---------|----------|
| `performSearch()` | search.ts | Main async search with scope support | ✅ YES |
| `buildSearchRegex()` | utils.ts | Convert query string to RegExp with options | ✅ YES |
| `matchesFileMask()` | utils.ts | Check if filename matches mask pattern | ✅ YES |
| `validateRegex()` | utils.ts | Validate regex pattern syntax | ✅ YES |
| `validateFileMask()` | utils.ts | Validate file mask pattern | ✅ YES |
| `replaceOne()` | replacer.ts | Single replacement with document save | ✅ YES |
| `replaceAll()` | replacer.ts | Batch replacement across files | ✅ YES |
| `openSearchPanel()` | extension.ts | Create/show webview panel | ❌ Webview-specific |
| `runSearch()` | extension.ts | Execute search and send results to webview | ✅ Core logic reusable |
| `openLocation()` | extension.ts | Open file at specific position | ✅ YES |

### Type Definitions

```typescript
interface SearchOptions {
  matchCase: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  fileMask: string;
}

interface SearchResult {
  uri: string;
  fileName: string;
  relativePath: string;
  line: number;
  character: number;
  length: number;
  preview: string;
  previewMatchRange: {
    start: number;
    end: number;
  };
}

type SearchScope = 'project' | 'directory' | 'module' | 'file';
```

---

## 3. HOW CURRENT EDITOR-BASED SEARCH UI IS IMPLEMENTED

### Architecture Pattern

1. **Panel Creation**: `vscode.window.createWebviewPanel()`
   - Positioned beside editor (ViewColumn.Beside)
   - Retains context when hidden
   - Embedded HTML content

2. **Message Protocol**: Extension ↔ WebView
   - Extension sends: `searchResults`, `modulesList`, `fileContent`, `config`, `validationResult`
   - WebView sends: `runSearch`, `openLocation`, `getModules`, `getFileContent`, `replaceOne`, `replaceAll`, `minimize`
   
3. **Search Execution Flow**:
   ```
   User types in WebView search box
      ↓ (debounced or on input)
   webview.postMessage({ type: 'runSearch', ... })
      ↓
   Extension receives message in onDidReceiveMessage handler
      ↓
   runSearch() calls performSearch() from search.ts
      ↓
   Results returned to WebView via postMessage()
      ↓
   WebView updates DOM with results list
   ```

4. **WebView UI Components**:
   - Search input field
   - Replace input field (hidden by default)
   - Scope tabs (project, module, directory, file)
   - Scope-specific path inputs
   - Options checkboxes (match case, whole word, regex)
   - File mask input
   - Results list with syntax highlighting
   - File preview panel with inline editing
   - Replace in Preview widget

---

## 4. WHAT SEARCH LOGIC CAN BE REUSED FOR POPUP MODE

### ✅ Fully Reusable Components

1. **Search Execution**: `performSearch()` from `src/search.ts`
   - No UI dependencies
   - Returns raw SearchResult array
   - Can be called directly without webview

2. **Regex/Validation**: `buildSearchRegex()`, `validateRegex()`, `matchesFileMask()`
   - Pure utility functions
   - No side effects or UI coupling

3. **File Operations**: 
   - `replaceOne()` and `replaceAll()` already work with URIs
   - No UI framework assumptions

4. **Module/Directory Detection**: `findWorkspaceModules()`, `sendCurrentDirectory()`
   - Can be extracted and reused
   - Already async/promise-based

5. **Location Opening**: `openLocation()` 
   - Already extracted as separate function
   - Works with URI + line/character

### ⚠️ Components Needing Adaptation

1. **Result Display**
   - Current: DOM-based list with event handlers
   - QuickPick: Uses `vscode.QuickPickItem` interface
   - Need to transform `SearchResult[]` → `QuickPickItem[]`

2. **State Management**
   - Current: WebView maintains state object
   - QuickPick: Stateless (user chooses from list)
   - Simpler model for popup mode

3. **Inline Editing**
   - Current: File preview panel within webview
   - QuickPick: Not possible; would open file in editor
   - Scope reduction: Focus on search + navigate, not edit

---

## 5. CURRENT COMMAND REGISTRATION PATTERN

```typescript
export function activate(context: vscode.ExtensionContext) {
  const openCommand = vscode.commands.registerCommand(
    'rifler.open',
    () => { /* handler */ }
  );
  
  context.subscriptions.push(openCommand);
}
```

### Commands to Implement for Popup Mode

**Option A: New Commands (Recommended)**
```typescript
const openQuickPickCommand = vscode.commands.registerCommand(
  'rifler.quickPick',           // or 'rifler.openQuickPick'
  () => { /* new handler */ }
);

const openQuickPickReplaceCommand = vscode.commands.registerCommand(
  'rifler.quickPickReplace',    // or 'rifler.openQuickPickReplace'
  () => { /* new handler */ }
);
```

**Option B: Switch Modes (Less Recommended)**
- Add setting: `rifler.searchMode` with options: `"webview"`, `"quickpick"`, `"auto"`
- Router command based on setting

**Recommended Approach**: Option A (separate commands)
- Users can choose their preferred mode
- Both modes coexist
- Keybindings can be customized per mode

### Package.json Commands Addition
```json
{
  "command": "rifler.quickPick",
  "title": "Rifler: Quick Pick Search"
},
{
  "command": "rifler.quickPickReplace",
  "title": "Rifler: Quick Pick Replace"
}
```

---

## 6. CURRENT SETTINGS REGISTRATION PATTERN

### Existing Setting
```json
"rifler.replaceInPreviewKeybinding": {
  "type": "string",
  "default": "ctrl+shift+r",
  "description": "Keybinding for Replace in Preview..."
}
```

### New Settings for Popup Mode

```json
"rifler.enableQuickPickMode": {
  "type": "boolean",
  "default": false,
  "description": "Use QuickPick UI instead of webview for search"
},

"rifler.quickPickMaxItems": {
  "type": "integer",
  "default": 50,
  "minimum": 10,
  "maximum": 500,
  "description": "Maximum items to show in quick pick"
},

"rifler.quickPickPreviewLines": {
  "type": "integer",
  "default": 2,
  "minimum": 1,
  "maximum": 5,
  "description": "Preview line count in quick pick item details"
},

"rifler.rememberQuickPickState": {
  "type": "boolean",
  "default": true,
  "description": "Remember last search query and scope for quick pick mode"
}
```

---

## 7. EXISTING VS CODE APIs ALREADY IN USE

| API | Usage |
|-----|-------|
| `vscode.window.createWebviewPanel()` | Create search panel |
| `vscode.window.createStatusBarItem()` | Minimize button |
| `vscode.window.activeTextEditor` | Get selected text |
| `vscode.window.showTextDocument()` | Open file from search result |
| `vscode.window.showErrorMessage()` | Error notifications |
| `vscode.window.showInformationMessage()` | Info notifications |
| `vscode.commands.registerCommand()` | Register ext. commands |
| `vscode.workspace.workspaceFolders` | Get workspace root(s) |
| `vscode.workspace.textDocuments` | Get open files |
| `vscode.workspace.findFiles()` | Glob pattern matching |
| `vscode.workspace.getConfiguration()` | Read settings |
| `vscode.workspace.applyEdit()` | Apply text replacements |
| `vscode.workspace.openTextDocument()` | Open file document |
| `vscode.Uri` | Handle file URIs |
| `vscode.ExtensionContext.globalState` | Persist state |

### NEW APIs NEEDED FOR POPUP MODE

```typescript
// For QuickPick UI
vscode.window.showQuickPick<T>(items, options?)
vscode.window.createQuickPick<T>()  // for advanced usage

// Input for searching
vscode.window.showInputBox(options?)

// New potential APIs
vscode.workspace.onDidChangeConfiguration  // listen to setting changes
vscode.workspace.onDidChangeTextDocument   // watch for file changes
```

---

## 8. RECOMMENDED APPROACH FOR IMPLEMENTING POPUP SEARCH MODE

### 1. **Architecture Design**

```
┌─────────────────────────────────────────────────────┐
│           VS Code Extension API                     │
├─────────────────────────────────────────────────────┤
│ activate() → Register Commands                      │
│   ├─ rifler.open → UI Router / WebView Mode        │
│   ├─ rifler.openQuickPick → QuickPick Mode         │
│   └─ rifler.openReplace → WebView/QuickPick Mode   │
└─────────────────────────────────────────────────────┘
                        ↓
    ┌───────────────────┴───────────────────┐
    ↓                                       ↓
┌─────────────────┐           ┌──────────────────────┐
│  WebView Mode   │           │  QuickPick Mode      │
│  (existing)     │           │  (new)               │
└─────────────────┘           └──────────────────────┘
    ↓                                 ↓
┌─────────────────────────────────────────────────────┐
│     Shared Search Core (src/search.ts)              │
│     Shared Utils (src/utils.ts)                     │
│     Shared Replace (src/replacer.ts)                │
└─────────────────────────────────────────────────────┘
```

### 2. **New File Structure**

**Proposed**: Create `src/quickpick.ts` (300-400 lines)

```typescript
// src/quickpick.ts

import * as vscode from 'vscode';
import { SearchScope, SearchOptions, SearchResult } from './utils';
import { performSearch } from './search';

export interface QuickPickState {
  lastQuery: string;
  lastScope: SearchScope;
  lastOptions: SearchOptions;
  lastDirectoryPath?: string;
  lastModulePath?: string;
}

export async function openQuickPickSearch(
  context: vscode.ExtensionContext,
  initialQuery?: string,
  openReplace: boolean = false
): Promise<void> {
  // Implementation here
}

async function showSearchQuickPick(
  query: string,
  scope: SearchScope,
  options: SearchOptions,
  // ... other params
): Promise<SearchResult | undefined> {
  // Implementation here
}

function transformResultsToQuickPickItems(
  results: SearchResult[],
  options: QuickPickItemOptions
): vscode.QuickPickItem[] {
  // Transform SearchResult to QuickPickItem
}
```

### 3. **Implementation Steps**

#### **Phase 1: Core QuickPick Search (Minimal)**
1. Create `openQuickPickSearch()` function
2. Show input box for query
3. Execute `performSearch()`
4. Transform results to QuickPickItem format
5. Show results in quick pick
6. Handle selection → call `openLocation()`

```typescript
async function openQuickPickSearch(initialQuery?: string): Promise<void> {
  const query = await vscode.window.showInputBox({
    prompt: 'Search in project...',
    value: initialQuery || '',
    placeHolder: 'Enter search term (2+ chars)'
  });
  
  if (!query || query.length < 2) return;
  
  const results = await performSearch(query, 'project', defaultOptions);
  const items = results.map(r => ({
    label: r.fileName,
    description: r.preview,
    detail: `${r.relativePath}:${r.line + 1}`,
    result: r  // attach for access on selection
  }));
  
  const picked = await vscode.window.showQuickPick(items);
  if (picked?.result) {
    await openLocation(picked.result.uri, picked.result.line, picked.result.character);
  }
}
```

#### **Phase 2: Options Support**
1. Add scope selection (project/directory/module/file)
2. Add regex toggle
3. Add match case toggle
4. Add file mask input
5. Use input boxes or quick pick for options

#### **Phase 3: Replace Mode**
1. Show two inputs: search + replace terms
2. Execute `performSearch()`
3. Show quick pick with "Replace All" action
4. Call `replaceAll()` or `replaceOne()`

#### **Phase 4: State Persistence**
1. Implement `QuickPickState` persistence
2. Use `context.globalState` (same as webview)
3. Remember last query, scope, options

### 4. **Key Differences from WebView**

| Aspect | WebView | QuickPick |
|--------|---------|-----------|
| **Interaction** | Persistent panel | Modal dialog |
| **Scope Switching** | Tab buttons | Input selection step |
| **Options** | Always visible checkboxes | Input prompts or toggles |
| **File Preview** | Full editor with syntax highlighting | Single-line description |
| **Editing** | Inline in preview panel | Open in main editor only |
| **Replace Mode** | Toggle with input field | Separate input step |
| **Appearance** | Side panel | Center modal |
| **Keyboard Nav** | Arrow keys in custom UI | Arrow keys (native) |
| **Focus** | Stays in extension | Returns to editor on pick |

### 5. **Reused Code Patterns**

**From existing `runSearch()` in extension.ts**:
```typescript
// Reuse this pattern:
const results = await performSearch(
  query,
  scope,
  options,
  directoryPath,
  modulePath,
  filePath
);
```

**From existing `openLocation()` in extension.ts**:
```typescript
// Reuse this function directly - no changes needed
await openLocation(uriString, line, character);
```

**From existing `replaceOne/replaceAll()` in replacer.ts**:
```typescript
// Call directly - no UI coupling
await replaceOne(uri, line, char, length, replaceText);
await replaceAll(query, replaceText, scope, options, ...);
```

### 6. **Integration with Existing Code**

**In `activate()` function, add new command**:
```typescript
const quickPickCommand = vscode.commands.registerCommand(
  'rifler.quickPick',
  () => openQuickPickSearch(context, getSelectedText())
);

context.subscriptions.push(quickPickCommand);
```

**Keep existing webview code unchanged** - both modes coexist.

---

## 9. SUGGESTED IMPLEMENTATION PRIORITIES

### **Priority 1 - MVP (Quick Pick Search)**
- [ ] Create `src/quickpick.ts` with basic search
- [ ] Register `rifler.quickPick` command
- [ ] Input box for query
- [ ] Show results in quick pick
- [ ] Click to open file

### **Priority 2 - Options Support**
- [ ] Scope selection
- [ ] Regex toggle
- [ ] Match case toggle
- [ ] File mask input

### **Priority 3 - Replace Support**
- [ ] Replace input box
- [ ] Replace one/all actions
- [ ] Integration with existing `replaceOne/replaceAll`

### **Priority 4 - Polish**
- [ ] State persistence
- [ ] Settings configuration
- [ ] Keybinding registration
- [ ] Better preview formatting

---

## 10. DEPENDENCIES AND IMPORTS SUMMARY

### Current Imports in Main Files

**extension.ts**:
```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SearchResult, SearchScope, SearchOptions, buildSearchRegex, validateRegex, validateFileMask } from './utils';
import { performSearch } from './search';
import { replaceOne, replaceAll } from './replacer';
```

**search.ts**:
```typescript
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SearchOptions, SearchResult, SearchScope, buildSearchRegex, validateRegex, validateFileMask, ... } from './utils';
```

**replacer.ts**:
```typescript
import * as vscode from 'vscode';
import { SearchScope, SearchOptions } from './utils';
import { performSearch } from './search';
```

### New Imports Needed for QuickPick

**src/quickpick.ts** (new file):
```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import { SearchScope, SearchOptions, SearchResult } from './utils';
import { performSearch } from './search';
import { replaceOne, replaceAll } from './replacer';
import { openLocation } from './extension';  // OR export to utils
```

### No External Package Dependencies
- ✅ All core functionality uses only Node.js + VS Code APIs
- ✅ highlight.js only used for webview syntax highlighting (not needed for QuickPick)
- ✅ No npm package additions required

---

## 11. QUICK START CHECKLIST FOR IMPLEMENTATION

```
□ Create src/quickpick.ts
□ Implement openQuickPickSearch(initialQuery?: string, openReplace?: boolean)
□ Add showSearchQuickPick() helper function
□ Implement transformResultsToQuickPickItems()
□ Register rifler.quickPick command in activate()
□ Register rifler.quickPickReplace command in activate()
□ Add menu entry in package.json
□ Test with basic project search
□ Add regex/match-case options
□ Add file mask support
□ Implement replace mode
□ Add state persistence
□ Add settings to package.json
□ Write unit tests for quickpick module
□ Write e2e tests for new commands
```

---

## SUMMARY

The Rifler extension is well-architected for adding a QuickPick mode:

✅ **Highly reusable core**: `performSearch()`, `replaceOne/All()`, validation functions are pure and UI-agnostic

✅ **Clear separation of concerns**: Search logic, utils, and replace are in separate modules

✅ **Established patterns**: Command registration, message handling, state persistence patterns can be followed

✅ **Minimal new code needed**: ~300-400 lines for MVP QuickPick implementation

✅ **No breaking changes**: New features can coexist with existing webview mode

⚠️ **Trade-offs**:
- QuickPick cannot support inline file editing (modal nature)
- Limited preview (single line description vs. full file preview)
- Simpler state management (no persistent panel)
- Better for fast searches, webview better for exploratory/detailed searches
