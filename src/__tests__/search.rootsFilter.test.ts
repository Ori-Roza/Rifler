import * as vscode from 'vscode';
import { startRipgrepSearch } from '../rgSearch';
import { performSearch } from '../search';
import { SearchOptions } from '../utils';

jest.mock('vscode');
jest.mock('../rgSearch', () => ({
  startRipgrepSearch: jest.fn(),
}));

describe('Search roots filtering', () => {
  const defaultOptions: SearchOptions = {
    matchCase: false,
    wholeWord: false,
    useRegex: false,
    fileMask: '',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace as any).workspaceFolders = [];
    (vscode.workspace as any).textDocuments = [];
  });

  test('filters ripgrep results to directory root when scope is directory', async () => {
    const rootDir = '/workspace/src';

    (vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
      if (uri.fsPath === rootDir) {
        return { type: vscode.FileType.Directory, size: 0, ctime: 0, mtime: 0 };
      }
      // root stat is all we need for this test; anything else can be treated as file.
      return { type: vscode.FileType.File, size: 0, ctime: 0, mtime: 0 };
    });

    (startRipgrepSearch as unknown as jest.Mock).mockReturnValue({
      promise: Promise.resolve([
        {
          uri: '/workspace/src/in.ts',
          fileName: 'in.ts',
          relativePath: 'src/in.ts',
          line: 0,
          character: 0,
          length: 4,
          preview: 'test',
          previewMatchRange: { start: 0, end: 4 },
          previewMatchRanges: [{ start: 0, end: 4 }],
        },
        {
          uri: '/workspace/other/out.ts',
          fileName: 'out.ts',
          relativePath: 'other/out.ts',
          line: 0,
          character: 0,
          length: 4,
          preview: 'test',
          previewMatchRange: { start: 0, end: 4 },
          previewMatchRanges: [{ start: 0, end: 4 }],
        },
      ]),
      cancel: jest.fn(),
    });

    const results = await performSearch('test', 'directory', defaultOptions, rootDir);

    expect(results).toHaveLength(1);
    expect(results[0].uri).toBe('/workspace/src/in.ts');
  });
});
