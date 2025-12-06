# Rifler

Fast file search extension for VS Code. Rifle through your codebase with dynamic search, regex support, file masking, and full file preview.

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

## Requirements

- VS Code 1.85.0 or higher

## License

MIT
