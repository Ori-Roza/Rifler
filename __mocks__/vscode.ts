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
  workspace: {
    applyEdit: jest.fn().mockResolvedValue(true),
    openTextDocument: jest.fn().mockResolvedValue({
      save: jest.fn().mockResolvedValue(true),
    }),
    textDocuments: [],
    workspaceFolders: [],
  },
  window: {
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
  },
  ViewColumn: {
    One: 1,
    Beside: -2,
  },
};

module.exports = vscode;
