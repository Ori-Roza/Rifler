export const Uri = {
  parse: jest.fn((path) => ({ fsPath: path, toString: () => path })),
  file: jest.fn((path) => ({ fsPath: path, toString: () => path })),
  joinPath: jest.fn((base, ...pathSegments) => ({
    fsPath: `${base.fsPath}/${pathSegments.join('/')}`,
    toString: () => `${base.fsPath}/${pathSegments.join('/')}`
  })),
};

export const Range = jest.fn((startLine, startChar, endLine, endChar) => ({
  start: { line: startLine, character: startChar },
  end: { line: endLine, character: endChar },
}));

export const WorkspaceEdit = jest.fn(() => ({
  replace: jest.fn(),
}));

export const commands = {
  registerCommand: jest.fn().mockReturnValue({ dispose: jest.fn() }),
  getCommands: jest.fn().mockResolvedValue([]),
  executeCommand: jest.fn().mockResolvedValue(undefined),
};

export const workspace = {
  applyEdit: jest.fn().mockResolvedValue(true),
  openTextDocument: jest.fn().mockResolvedValue({
    save: jest.fn().mockResolvedValue(true),
  }),
  getConfiguration: jest.fn().mockReturnValue({
    get: jest.fn().mockReturnValue('ctrl+shift+r'),
    update: jest.fn().mockResolvedValue(undefined),
  }),
  onDidChangeConfiguration: jest.fn().mockReturnValue({ dispose: jest.fn() }),
  onDidChangeWorkspaceFolders: jest.fn().mockReturnValue({ dispose: jest.fn() }),
  textDocuments: [],
  workspaceFolders: [],
  fs: {
    readDirectory: jest.fn().mockResolvedValue([]),
    readFile: jest.fn().mockResolvedValue(new Uint8Array()),
    writeFile: jest.fn().mockResolvedValue(undefined),
    stat: jest.fn().mockResolvedValue({ type: 1, size: 0, ctime: 0, mtime: 0 }),
    delete: jest.fn().mockResolvedValue(undefined),
    rename: jest.fn().mockResolvedValue(undefined),
    copy: jest.fn().mockResolvedValue(undefined),
    createDirectory: jest.fn().mockResolvedValue(undefined),
  },
};

export const window = {
  showErrorMessage: jest.fn(),
  showInformationMessage: jest.fn(),
  showQuickPick: jest.fn().mockResolvedValue(undefined),
  activeTextEditor: undefined,
  onDidChangeActiveTextEditor: jest.fn().mockReturnValue({ dispose: jest.fn() }),
  tabGroups: {
    onDidChangeTabs: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    onDidChangeTabGroups: jest.fn().mockReturnValue({ dispose: jest.fn() }),
  },
  createStatusBarItem: jest.fn().mockReturnValue({
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn(),
  }),
  registerWebviewViewProvider: jest.fn().mockReturnValue({ dispose: jest.fn() }),
};

export class FileSystemError extends Error {
  static FileNotFound() {
    const err = new FileSystemError('File not found');
    (err as any).code = 'FileNotFound';
    return err;
  }
  code?: string;
}

export const extensions = {
  getExtension: jest.fn(),
};

export const ViewColumn = {
  One: 1,
  Beside: -2,
};

export const StatusBarAlignment = {
  Left: 1,
  Right: 2,
};

export const ThemeColor = jest.fn((name) => ({ name }));

export const FileType = {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
};

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
};
