<div align="center">
  <img src="assets/logo.jpeg" alt="Rifler Logo" width="300"/>
  
  
  # Rifler

  Fast file search extension for VS Code. Rifle through your codebase with dynamic search, regex support, file masking, and full file preview.
</div>

## Features

- **Dynamic Search** - Results appear as you type (no Find button needed)
- **Multiple Scopes**
  - **Project** - Search entire workspace
  - **Module** - Search in detected modules (package.json, tsconfig.json, etc.)
  - **Directory** - Search in a specific directory (with editable path)
- **Search Options**
  - **Match Case** - Case-sensitive search
  - **Words** - Match whole words only
  - **Regex** - Use regular expressions
  - **File Mask** - Filter by file patterns (e.g., `*.ts`, `*.js, *.py`)
- **Search & Replace**
  - **Replace One** - Replace current match and move to next
  - **Replace All** - Replace all occurrences in search results
  - **Undo Support** - Full undo support for all replacements
- **Full File Preview** - View entire file with all matches highlighted
- **Keyboard Navigation**
  - `↑/↓` - Navigate results
  - `Enter` - Open selected result
  - `Option+Shift+F` (Mac) / `Alt+Shift+F` - Toggle Replace mode
  - `Escape` - Focus search box

## Usage

1. Press `Cmd+Shift+F` (Mac) or `Ctrl+Shift+F` (Windows/Linux)
2. Type your search query
3. Toggle search options as needed
4. Select scope (Project/Module/Directory)
5. Navigate results and preview files

### Replace
1. Press `Option+Shift+F` (Mac) or `Alt+Shift+F` (Windows/Linux) to toggle replace mode
2. Enter replacement text
3. Press `Enter` to replace current match, or `Cmd+Enter` to replace all

### Replace in Preview Editor
While editing a file in the preview panel:
1. Press `Ctrl+Shift+R` (default) to open the replace widget
2. Use `↑/↓` arrows or `Enter/Shift+Enter` to navigate between matches
3. Press `Enter` to replace current match, or `Cmd+Enter` to replace all

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
| Rifler: Open | `Cmd+Shift+F` | `Ctrl+Shift+F` |
| Rifler: Open Replace | `Option+Shift+F` | `Alt+Shift+F` |

## Installation

### From VSIX
1. Download the `.vsix` file
2. Open VS Code
3. Press `Cmd+Shift+P` → "Extensions: Install from VSIX..."
4. Select the downloaded file

### From Marketplace
Search for "Rifler" in the VS Code Extensions marketplace.

## Performance

Benchmark results on a typical codebase:

| Scenario | Matches | Time |
|----------|---------|------|
| Search for "function" keyword | 34 | 5ms |
| Search for import statements | 3 | 6ms |
| Search for "if" keyword | 66 | 3ms |
| Search for variable declarations | 115 | 4ms |

Average search time: **5ms** | Max results: **5000**

### Comparison with Native VS Code Search

| Tool | Average Search Time | Notes |
|------|---------------------|-------|
| **Rifler** | **~5ms** | Direct filesystem search, optimized for speed |
| VS Code Native | ~50-200ms | Uses ripgrep, more features but slower |
| grep | ~36ms | Command-line baseline |

**Why Rifler is faster:**
- ⚡ Direct filesystem access (no process spawning)
- 🎯 Smart exclusions (node_modules, .git, binaries)
- 🚀 Early termination at 5000 results
- 💾 Memory efficient (1MB file size limit)

*Run `node benchmark.js` in your own project to test performance*

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
- Every push to main/develop branches
- All pull requests
- Multiple operating systems (Windows, macOS, Linux)

View test results and coverage in the Actions tab.

## Requirements

- VS Code 1.85.0 or higher

## License

MIT
