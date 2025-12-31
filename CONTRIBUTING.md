# Contributing to Rifler

Thank you for your interest in contributing to Rifler! This document provides guidelines and instructions for contributing to the project.

## Getting Started

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn
- VS Code (for testing extensions)

### Setup Development Environment

1. **Clone the repository**
   ```bash
   git clone https://github.com/Ori-Roza/rifler.git
   cd rifler
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the project**
   ```bash
   npm run compile
   ```

4. **Run tests**
   ```bash
   # Unit and integration tests
   npm test

   # E2E tests (requires closing VS Code)
   npm run test:e2e

   # Linter
   npm run lint
   ```

## Development Workflow

### Code Structure

```
src/
├── extension.ts           # Main extension entry point
├── search.ts             # Search functionality
├── replacer.ts           # Replace functionality
├── utils.ts              # Utility functions
├── commands/             # Command implementations
│   ├── index.ts          # Command registration
│   ├── open.ts           # Open command
│   ├── minimize.ts       # Minimize command
│   ├── restore.ts        # Restore command
│   └── ...               # Other commands
├── messaging/            # Message handling
│   ├── handler.ts        # Unified message handler
│   ├── registerCommonHandlers.ts  # Common handlers
│   └── types.ts          # Message types
├── services/
│   └── PanelManager.ts   # Panel lifecycle management
├── state/
│   └── StateStore.ts     # State persistence
├── sidebar/
│   └── SidebarProvider.ts # Sidebar UI provider
├── views/
│   └── ViewManager.ts    # View mode switching
├── webview/              # Webview assets
│   ├── index.html        # HTML template
│   ├── script.js         # Client-side logic
│   └── styles.css        # Styles
└── __tests__/            # Test files
```

### Making Changes

1. **Create a feature branch**
   ```bash
   git checkout -b feature/issue-XX-description
   ```

2. **Make your changes**
   - Write clean, well-documented code
   - Follow the existing code style
   - Add tests for new functionality

3. **Run tests and linter**
   ```bash
   npm test
   npm run lint
   npm run compile
   ```
   # Benchmarks (optional)
   node ripgrep-benchmark.js <path>        # current ripgrep engine
   node benchmark.js <path>                # legacy traversal benchmark

4. **Fix any issues**
   - Resolve test failures
   - Fix linting errors
   - Ensure TypeScript compilation succeeds

## Testing Guidelines

### Unit Tests
Located in `src/__tests__/`, unit tests cover:
- Search functionality with various scopes and options
- Replace operations
- File masking and filtering
- Utility functions
- Storage and persistence

**Run:** `npm test`

### E2E Tests
Located in `src/__tests__/e2e/suite/`, e2E tests cover:
- Functional search and replace operations
- Webview UI automation
- Sidebar integration
- Toggle functionality
- Keyboard shortcuts

**Run:** `npm run test:e2e` (requires VS Code to be closed)

### Writing Tests

1. **Unit tests** - Use Jest and mock VS Code APIs
   ```typescript
   describe('Feature', () => {
     test('should do something', () => {
       const result = myFunction();
       expect(result).toBe(expected);
     });
   });
   ```

2. **E2E tests** - Use VS Code API directly
   ```typescript
   test('should perform action', async function() {
     this.timeout(30000);
     const result = await vscode.commands.executeCommand('rifler.open');
     assert.ok(result);
   });
   ```

## Code Style

- **TypeScript**: Use strict mode, add type annotations
- **Naming**: Use camelCase for variables/functions, PascalCase for classes
- **Comments**: Add JSDoc comments for public functions
- **Formatting**: Use ESLint (run `npm run lint`)

Example:
```typescript
/**
 * Searches for text in files
 * @param query The search query
 * @param scope The search scope (project/directory/file)
 * @returns Array of search results
 */
export async function performSearch(
  query: string,
  scope: 'project' | 'directory' | 'file'
): Promise<SearchResult[]> {
  // Implementation
}
```

## Configuration & Settings

### Extension Configuration
Rifler settings are defined in `package.json` under `contributes.configuration`:

- **`rifler.viewMode`** - Default view mode (sidebar/tab)
- **`rifler.replaceInPreviewKeybinding`** - Keybinding for replace in preview

### Keybindings
Defined in `package.json` under `contributes.keybindings`:

| Command | Default (Mac) | Default (Windows/Linux) |
|---------|---------------|------------------------|
| Rifler: Toggle Open/Close | `Cmd+Alt+F` | `Ctrl+Alt+F` |
| Rifler: Open Replace Mode | `Cmd+Alt+R` | `Ctrl+Alt+R` |
| Rifler: Switch View Mode | `Cmd+Alt+T` | `Ctrl+Alt+T` |

## Commit Guidelines

- **Message format**: `type: brief description`
- **Types**: feat, fix, docs, test, refactor, style, chore
- **Examples**:
  - `feat: add keyboard shortcut customization`
  - `fix: sidebar toggle not closing properly`
  - `test: add e2e tests for toggle functionality`
  - `docs: update README with configuration options`

## Pull Request Process

1. **Update your branch** with latest changes
   ```bash
   git fetch origin
   git rebase origin/master
   ```

2. **Push your changes**
   ```bash
   git push origin feature/issue-XX-description
   ```

3. **Create a Pull Request**
   - Reference the issue: `Fixes #XX`
   - Describe your changes
   - List any breaking changes
   - Include screenshots if UI changes

4. **Pass all checks**
   - Tests must pass (160+ unit tests)
   - Linter must pass (ESLint)
   - TypeScript compilation must succeed
   - E2E tests should pass (89+ tests)

## Common Tasks

### Adding a New Search Option

1. Add to `SearchOptions` type in relevant files
2. Update search implementation in `search.ts`
3. Add UI control in webview HTML
4. Add tests for the new option
5. Update README documentation

### Adding a Keybinding

1. Add to `contributes.keybindings` in `package.json`
2. Register command in `extension.ts`
3. Add tests for the keybinding
4. Document in README

### Fixing a Bug

1. Write a failing test that reproduces the bug
2. Fix the implementation
3. Verify the test passes
4. Run full test suite
5. Commit with `fix:` prefix

## Debugging

### Extension Debugging

1. Open the project in VS Code
2. Press `F5` to start debugging
3. A new VS Code window opens with the extension loaded
4. Set breakpoints and inspect variables

### Console Output

The extension logs to the Debug Console. Filter by `Rifler` in the console to see extension logs.

### Common Issues

- **E2E tests fail to run**: Close all VS Code instances: `killall "Visual Studio Code"`
- **Tests timeout**: Increase timeout in test: `this.timeout(60000)`
- **Module not found**: Run `npm install` again and compile: `npm run compile`

## Documentation

- **README.md** - User-facing features and usage guide
- **Code comments** - Explain complex logic and design decisions
- **JSDoc** - Document public APIs
- **Changelog** - Track changes in releases

When adding features, update:
1. README.md with usage examples
2. Inline code comments
3. JSDoc for public functions
4. This CONTRIBUTING.md if adding new processes

## Release Process

Rifler uses **automated CI/CD** for releases with GitHub Actions and standard-version.

### For Maintainers: Creating a Release

1. **Create conventional commits** as you make changes:
   - `feat: add new feature` → minor version bump
   - `fix: resolve bug` → patch version bump
   - `BREAKING CHANGE:` → major version bump

2. **Generate release version and changelog**:
   ```bash
   npm run release
   # or for specific version:
   npm run release:major
   npm run release:minor
   npm run release:patch
   ```

3. **Review generated CHANGELOG.md** and commit messages

4. **Push the release commit and tag**:
   ```bash
   git push origin master --follow-tags
   ```

5. **GitHub Actions automatically**:
   - ✅ Runs all tests and linting
   - ✅ Builds and packages the extension (VSIX)
   - ✅ Publishes to VS Code Marketplace (requires VSCODE_MARKETPLACE_TOKEN secret)
   - ✅ Creates a GitHub release with CHANGELOG notes and VSIX artifact

### Prerequisites for Releases

**VS Code Marketplace Publisher Token**: Required to publish to the Marketplace.

1. Go to [VS Code Marketplace Publisher Dashboard](https://marketplace.visualstudio.com/manage/publishers)
2. Create a Personal Access Token (PAT) with `Marketplace > Manage` scope
3. Add it to GitHub Secrets:
   - Repository → Settings → Secrets and variables → Actions
   - Create secret: `VSCE_PAT` = `<your-pat>`

### Manual Release Workaround

If needed, manually publish without CI:
```bash
npm run vscode:prepublish
vsce publish -p $VSCODE_MARKETPLACE_TOKEN
```

## Questions?

- Open an issue for bug reports
- Start a discussion for feature requests
- Check existing issues before creating new ones

## License

By contributing to Rifler, you agree that your contributions will be licensed under the same license as the project (check LICENSE file).

---

Thank you for contributing to Rifler! 🎉
