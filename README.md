<div align="center">
  <img src="assets/logo.jpeg" alt="Rifler Logo" width="300"/>
  
  
  # Rifler

  Fast file search extension for VS Code. Rifle through your codebase with dynamic search, regex support, file masking, and full file preview with inline editing.
  
  ⭐ **Rated 5.0 on VS Code Marketplace** | ⬇️ **100+ installs and growing**

  [![CI](https://github.com/ori-roza/rifler/actions/workflows/pr-checks.yaml/badge.svg)](https://github.com/ori-roza/rifler/actions/workflows/pr-checks.yaml)
  [![Tests](https://img.shields.io/badge/tests-276%20passing-brightgreen)](https://github.com/ori-roza/rifler)
  [![Coverage](https://img.shields.io/badge/coverage-92%25-brightgreen)](https://github.com/ori-roza/rifler)
  [![Security](https://img.shields.io/badge/security-hardened-blue)](https://github.com/ori-roza/rifler/blob/main/SECURITY_AUDIT_REPORT.md)
</div>

<div align="center">
  <video src="https://raw.githubusercontent.com/ori-roza/rifler/assets/assets/rifler_demo_v116.mov" width="100%" autoplay loop muted playsinline></video>
</div>

## Features

- **Dynamic Search** - Results appear as you type (no Find button needed)
- **QuickPick Search** - A keyboard-first QuickPick search mode with live results, inline filters, and a "Show all results in Rifler" overflow for larger queries
- **Search From Selection** - Select text in the editor, then open Rifler and it will be used as the initial search query
- **Fresh State** - Automatically clears search results and state when switching workspaces
- **High Performance**
  - **Virtualized Results** - Smooth scrolling with 10,000+ results
  - **Configurable Limit** - Adjust max results via `rifler.maxResults` setting
  - **Path Tooltips** - Hover truncated paths to see full file path
  - **Search Duration** - Real-time performance metrics displayed with results
- **Multiple Scopes**
  - **Project** - Search entire workspace
  - **Module** - Search in detected modules (package.json, tsconfig.json, etc.)
  - **Directory** - Search in a specific directory (with editable path)
  - **File** - Search in a specific file (auto-enabled when file is opened from results)
- **Search Options**
  - **Match Case** - Case-sensitive search
  - **Words** - Match whole words only
  - **Regex** - Use regular expressions
  - **Usage-Aware (LSP)** - Semantic symbol search using Language Server Protocol
    - Finds actual symbol references, not just text matches
    - Supports References, Definitions, Implementations, and Type Definitions
    - Language-aware search (like JetBrains "Find Usages")
    - Clear indication when LSP mode is active
    - Graceful fallback when language server unavailable
  - **File Mask** - Filter by file patterns (e.g., `*.ts`, `*.js`)
    - Supports PyCharm-style include/exclude masks: comma/semicolon separated; `!` to exclude. Examples: `*.py`; `main.py, util.py`; `!*.txt`; `*.tsx,!*.test.tsx,!*.stories.tsx`; `*test*`.
  - **Smart Excludes** - Toggle to control automatic exclusion of common directories
    - **ON (default)** - Excludes node_modules, .git, dist, build, and other common directories
    - **OFF** - Searches all directories including node_modules (useful for searching dependencies)
    - State persists across sessions
  - **Context Filters** - Filter matches by code context (inspired by JetBrains IDEs)
    - **Code** - Include matches in code
    - **Comments** - Include matches in comments
    - **Strings** - Include matches in string literals
    - Configure default filters via settings (`rifler.searchContext.*`)
    - Helps avoid false positives in documentation and user-facing strings
    - Makes Replace operations safer and more trustworthy
- **Search & Replace**
  - **Replace One** - Replace current match and move to next
  - **Replace All** - Replace all occurrences in search results
  - **Undo Support** - Full undo support for all replacements
- **Full File Preview**
  - View entire file with all matches highlighted
  - **Syntax Highlighting** - Code highlighting for 50+ languages in both results and preview (powered by highlight.js)
  - **Click to Edit** - Click anywhere in preview to start editing inline
  - **Auto-save** - Changes auto-save as you type
- **Responsive Sidebar**
  - Layout flexes to the default VS Code sidebar width with wrapping controls (no overflow on first open)
  - Restores your last search, results, and preview when reopening
- **Flexible Panel Location**
  - Open Rifler in the **sidebar**, **bottom panel**, or a **separate editor tab** via `rifler.panelLocation`
- **Inline File Editing**
  - Edit files directly in the preview panel
  - Real-time syntax highlighting while editing
  - Integrated search & replace within the file
  - Line numbers with synchronized scrolling
- **Keyboard Navigation**
  - `↑/↓` - Navigate results
  - `Enter` - Open selected result in editor
  - `Double-click` - Open file at clicked line
  - `Cmd+Alt+R` (Mac) / `Ctrl+Alt+R` (Windows/Linux) - Open Replace mode
  - `Alt+R` - Open Replace in File widget
  - `Cmd+S` / `Ctrl+S` - Save current file (in edit mode)
- `Cmd+Shift+F12` (Mac) / `Ctrl+Shift+F12` (Windows/Linux) - Find Usages (LSP)
- `Cmd+Alt+P` (Mac) / `Ctrl+Alt+P` (Windows/Linux) - QuickPick search
- `Cmd+Alt+Y` (Mac) / `Ctrl+Alt+Y` (Windows/Linux) - QuickPick replace
  - `Escape` - Exit edit mode or focus search box

## Usage

### Opening Rifler

Press `Cmd+Alt+F` (Mac) or `Ctrl+Alt+F` (Windows/Linux) to **toggle** Rifler open/close.

- If you have text selected in the editor when you open Rifler, that selection becomes the initial search query (and searches immediately for queries with 2+ characters).

- By default, Rifler opens in the **sidebar** (Activity Bar)
- To change where Rifler opens, set `rifler.panelLocation` to one of:
  - `"sidebar"` (default)
  - `"bottom"`
  - `"window"` (opens as a separate editor tab)
- Legacy setting: `rifler.viewMode` (`"sidebar" | "tab"`) is still supported for backwards compatibility, but `rifler.panelLocation` is the preferred setting.

### Searching

1. Open Rifler with `Cmd+Alt+F` (Mac) or `Ctrl+Alt+F` (Windows/Linux)
2. Type your search query (results appear dynamically after 2+ characters)
3. Toggle search options as needed (Match Case, Words, Regex, Usage-Aware)
4. Use File Mask to filter results (e.g., `*.ts, *.js`)
5. Toggle **Smart Excludes** (ON by default) to include/exclude common directories like node_modules
6. Use **Context Filters** to search only in code, comments, or strings
7. Select scope (Project/Module/Directory)
8. Navigate results with arrow keys and preview files
9. Click on preview to edit inline, or double-click to open in main editor

### QuickPick Search

Use **Rifler: Search in Files (QuickPick)** for a lightweight, keyboard-first search flow:

1. Press `Cmd+Alt+P` (Mac) or `Ctrl+Alt+P` (Windows/Linux)
2. Type your query (results appear as you type)
3. Toggle **Match Case**, **Whole Word**, and **Regex** using the QuickPick buttons
4. If results hit the cap, select **Show all results in Rifler** to open the full panel with the same query
5. Press `Enter` to open the selected result in the editor

### QuickPick Replace

Use **Rifler: Replace in Files (QuickPick)** for a fast replace flow:

1. Run **Rifler: Replace in Files (QuickPick)** from the Command Palette
2. Type your query (results appear as you type)
3. Toggle **Match Case**, **Whole Word**, and **Regex** using the QuickPick buttons
4. If results hit the cap, select **Show all results in Rifler** to open the full panel in replace mode
5. Select a match, enter replacement text, then choose **Replace One** or **Replace All**

### Usage-Aware Search (LSP)

**Usage-Aware Search** uses VS Code's Language Server Protocol to find actual symbol references, not just text matches. This is similar to JetBrains' "Find Usages" feature.

**When to use:**
- Finding where a function, class, or variable is actually used
- Refactoring with confidence (avoids matching strings or comments with the same name)
- Understanding symbol relationships across files

**How to use:**
1. Open Rifler
2. Type the symbol name you want to find (or select text in editor before opening)
3. Click the **Usage-Aware (LSP)** toggle button (device_hub icon)
4. Choose the LSP mode:
   - **Refs** - Find all references to the symbol
   - **Defs** - Find definitions of the symbol
   - **Impl** - Find implementations
   - **Types** - Find type definitions

**Example:**
```javascript
class User {
  name: string;  // Definition
}

const user = "name";  // String (not found in LSP)
user.name;  // Reference (found in LSP)
```

Text search finds all 3 occurrences. Usage-Aware search finds only the actual field definition and reference.

**Note:** Results depend on your language server. Dynamic languages may have incomplete results.

### Context Filters

**Context Filters** allow you to search only in specific parts of your code: code, comments, or strings. This helps avoid false positives and makes replacements safer.

**How to use:**
1. Open Rifler
2. Click the filter button (tune icon) to show filters
3. Toggle the context filters:
   - **Code** (code icon) - Include matches in code
   - **Comments** (comment icon) - Include matches in comments  
   - **Strings** (S icon) - Include matches in string literals

**Example:**
```python
# TODO: rename foo
print("foo")
foo()
```

- With **Code only**: Finds only `foo()`
- With **Code + Comments**: Finds `foo()` and the TODO comment
- With all filters: Finds all 3 occurrences

**Default behavior:** You can configure which filters are enabled by default in settings:
- `rifler.searchContext.includeCode` (default: true)
- `rifler.searchContext.includeComments` (default: true)
- `rifler.searchContext.includeStrings` (default: true)

### Replace in Search Results
1. Press `Cmd+Alt+R` (Mac) or `Ctrl+Alt+R` (Windows/Linux) to open replace mode
2. Enter replacement text
3. Press `Enter` to replace current match, or `Cmd+Enter` / `Ctrl+Enter` to replace all

### Inline Editing
Click anywhere in the file preview to enter edit mode:
- Edit directly with full syntax highlighting
- Changes auto-save after 1 second of inactivity
- Press `Escape` to exit edit mode
- Press `Cmd+S` / `Ctrl+S` to save immediately

### Choosing Your Panel Location

Rifler can open in three locations:

1. **Sidebar (Default)** - Activity Bar sidebar
2. **Bottom Panel** - VS Code panel at the bottom
3. **Window** - A separate editor tab

Configure via your `settings.json`:

```json
{
  "rifler.panelLocation": "sidebar" // or "bottom" or "window"
}
```

### Switching Between Sidebar and Window

Rifler includes the `rifler.toggleView` command to switch between **sidebar** and **window**. There is no default keybinding; bind it via **Keyboard Shortcuts** by searching for `rifler.toggleView`.

### Replace in Preview Editor
While editing a file in the preview panel:
1. Press `Alt+R` or the configured keybinding (default: `Ctrl+Shift+R`) to open the replace widget
2. Use `↑/↓` arrows or `Enter/Shift+Enter` to navigate between matches
3. Press `Enter` to replace current match, or `Cmd+Enter` / `Ctrl+Enter` to replace all
4. Press `Escape` or `✕` to close the replace widget

## Customizing Keybindings

### Replace in Preview Keybinding
The keybinding to open the replace widget while editing in the preview can be customized via VS Code settings:

1. Open Settings (`Cmd+,` on Mac / `Ctrl+,` on Windows/Linux)
2. Search for "rifler"
3. Change **Rifler: Replace In Preview Keybinding** to your preferred keybinding

Or add to your `settings.json`:
```json
{
  "rifler.replaceInPreviewKeybinding": "ctrl+shift+r"
}
```

**Format:** `modifier+key` (e.g., `ctrl+shift+r`, `cmd+r`, `alt+h`, `ctrl+h`)

### Global Keybindings
To customize the main Rifler keybindings, open Keyboard Shortcuts (`Cmd+K Cmd+S`) and search for "rifler":

| Command | Default (Mac) | Default (Windows/Linux) |
|---------|---------------|------------------------|
| Rifler: Toggle Open/Close | `Cmd+Alt+F` | `Ctrl+Alt+F` |
| Rifler: Open Replace Mode | `Cmd+Alt+R` | `Ctrl+Alt+R` |
| Rifler: Find Usages (LSP) | `Cmd+Shift+F12` | `Ctrl+Shift+F12` |
| Rifler: Toggle View (sidebar/window) | _(not bound by default)_ | _(not bound by default)_ |

### Panel Location Configuration

To change where Rifler opens by default, add to your `settings.json`:

```json
{
  "rifler.panelLocation": "sidebar"  // or "bottom" or "window"
}
```

Or change it in Settings UI:
1. Open Settings (`Cmd+,` on Mac / `Ctrl+,` on Windows/Linux)
2. Search for "rifler panelLocation"
3. Choose either "sidebar", "bottom", or "window"

### Max Results Configuration

To change the maximum number of search results, add to your `settings.json`:

```json
{
  "rifler.maxResults": 10000  // default, minimum: 100
}
```

With virtualized rendering, Rifler efficiently handles large result sets without UI lag.

## Installation

### From VSIX
1. Download the `.vsix` file
2. Open VS Code
3. Press `Cmd+Shift+P` → "Extensions: Install from VSIX..."
4. Select the downloaded file

### From Marketplace
Search for "Rifler" in the VS Code Extensions marketplace.

## Performance

Rifler uses ripgrep (same engine as VS Code) for fast, async searches.

Recent benchmark on a large monorepo (~112k matches, query "test"):

| Engine | Avg Time | Matches |
|--------|----------|---------|
| Rifler bundled rg | ~0.63s | ~112k |
| VS Code rg | ~0.67s | ~112k |

Max results: **10,000** (configurable). Smaller codebases typically respond in **<100ms**.

Optimizations:
- 🎯 Smart exclusions (node_modules, .git, binaries, hidden folders)
- 🚀 Early termination at configurable max results (default: 10,000)
- 💾 Memory efficient (skips files > 1MB)
- ⚡ Parallel async I/O with concurrency limiter
- 🖥️ Virtualized results list for smooth scrolling with large result sets

Benchmarks:
- Legacy traversal benchmark: `node benchmark.js [path]`
- Ripgrep benchmark (current engine): `node ripgrep-benchmark.js [path] [query] [runs]`

## Testing

### Unit Tests
Run the unit test suite:
```bash
npm test
```

### Coverage Report
Generate test coverage:
```bash
npm run test:coverage
```

### End-to-End Tests
Run automated E2E tests that simulate user interactions using the official VS Code testing CLI:
```bash
npm run test:e2e
```

**Watch E2E tests live** (like Selenium browser testing):
```bash
npm run test:e2e:visible
```
This opens VS Code windows where you can see the tests running in real-time, perfect for debugging and understanding test behavior.

**Debug E2E tests** with inspector:
```bash
npm run test:e2e:debug
```

**Analyze E2E test coverage** (feature coverage analysis):
```bash
npm run test:e2e:coverage
```

**Run combined coverage** (unit tests + E2E tests):
```bash
npm run test:combined-coverage
```

The E2E tests automatically:
- Download and launch the specified version of VS Code
- Load your extension in development mode
- Test command registration and execution
- Verify webview panel creation
- Test configuration handling
- Validate search and replace functionality
- Run on Windows, macOS, and Linux via GitHub Actions

Tests are configured using `.vscode-test.js` for maximum flexibility and CI/CD compatibility.

### CI/CD Automation
Tests run automatically on:
- Every push to master/develop branches
- All pull requests
- Multiple operating systems (Windows, macOS, Linux)

View test results and coverage in the Actions tab.

## Requirements

- VS Code 1.85.0 or higher

## License

MIT

---

<div align="center">
  <p><strong>If Rifler helps you, a quick ⭐ or review goes a long way 🙏</strong></p>
</div>
