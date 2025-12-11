const vscode = {
  Uri: {
    parse: jest.fn((path) => ({ fsPath: path, toString: () => path })),
    file: jest.fn((path) => ({ fsPath: path, toString: () => path })),
  },
  Range: jest.fn((startLine, startChar, endLine, endChar) => ({
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endChar },
  })),
  WorkspaceEdit: jest.fn(() => ({
    replace: jest.fn(),
  })),
  commands: {
    registerCommand: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    getCommands: jest.fn().mockResolvedValue([]),
    executeCommand: jest.fn().mockResolvedValue(undefined),
  },
  workspace: {
    applyEdit: jest.fn().mockResolvedValue(true),
    openTextDocument: jest.fn().mockResolvedValue({
      save: jest.fn().mockResolvedValue(true),
    }),
    getConfiguration: jest.fn().mockReturnValue({
      get: jest.fn().mockReturnValue('ctrl+shift+r'),
    }),
    textDocuments: [],
    workspaceFolders: [],
  },
  window: {
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    activeTextEditor: undefined,
    createStatusBarItem: jest.fn().mockReturnValue({
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn(),
    }),
  },
  extensions: {
    getExtension: jest.fn(),
  },
  ViewColumn: {
    One: 1,
    Beside: -2,
  },
  StatusBarAlignment: {
    Left: 1,
    Right: 2,
  },
  ThemeColor: jest.fn((name) => ({ name })),
};

module.exports = vscode;
