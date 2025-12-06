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
- **Full File Preview** - View entire file with all matches highlighted
- **Keyboard Navigation**
  - `↑/↓` - Navigate results
  - `Enter` - Open selected result
  - `Escape` - Focus search box

## Usage

1. Press `Cmd+Shift+F` (Mac) or `Ctrl+Shift+F` (Windows/Linux)
2. Type your search query
3. Toggle search options as needed
4. Select scope (Project/Module/Directory)
5. Navigate results and preview files

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

## Requirements

- VS Code 1.85.0 or higher

## License

MIT
