import * as vscode from 'vscode';
import { performSearch } from '../search';
import { SearchOptions, SearchScope } from '../utils';

// Mock vscode
jest.mock('vscode');

const mockWorkspaceFs = vscode.workspace.fs as jest.Mocked<typeof vscode.workspace.fs>;

describe('Search', () => {
  const defaultOptions: SearchOptions = {
    matchCase: false,
    wholeWord: false,
    useRegex: false,
    fileMask: ''
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace as any).workspaceFolders = [];
    (vscode.workspace as any).textDocuments = [];
  });

  describe('performSearch', () => {
    describe('input validation', () => {
      test('should return empty array for empty query', async () => {
        const results = await performSearch('', 'project', defaultOptions);
        expect(results).toEqual([]);
      });

      test('should return empty array for whitespace-only query', async () => {
        const results = await performSearch('   ', 'project', defaultOptions);
        expect(results).toEqual([]);
      });

      test('should return empty array for query shorter than 2 characters', async () => {
        const results = await performSearch('a', 'project', defaultOptions);
        expect(results).toEqual([]);
      });

      test('should return empty array for invalid regex', async () => {
        const results = await performSearch('[invalid', 'project', { ...defaultOptions, useRegex: true });
        expect(results).toEqual([]);
      });
    });

    describe('file scope', () => {
      test('should search in specific file when scope is file', async () => {
        const testFilePath = '/test/file.ts';
        const fileContent = 'const test = "hello";\nconst test2 = "world";';
        
        mockWorkspaceFs.stat.mockResolvedValue({ type: vscode.FileType.File, size: 100, ctime: 0, mtime: 0 });
        mockWorkspaceFs.readFile.mockResolvedValue(new TextEncoder().encode(fileContent));

        const results = await performSearch('test', 'file', defaultOptions, undefined, undefined, testFilePath);

        expect(results.length).toBe(2);
        expect(results[0].fileName).toBe('file.ts');
        expect(results[0].line).toBe(0);
        expect(results[1].line).toBe(1);
      });

      test('should return empty for file scope without filePath', async () => {
        const results = await performSearch('test', 'file', defaultOptions);
        expect(results).toEqual([]);
      });
    });

    describe('directory scope', () => {
      test('should search in directory when scope is directory', async () => {
        const testDir = '/test/dir';
        const fileContent = 'const test = "hello";';
        
        mockWorkspaceFs.stat.mockImplementation(async (uri: vscode.Uri) => {
          if (uri.fsPath === testDir) {
            return { type: vscode.FileType.Directory, size: 0, ctime: 0, mtime: 0 };
          }
          return { type: vscode.FileType.File, size: 100, ctime: 0, mtime: 0 };
        });
        mockWorkspaceFs.readDirectory.mockResolvedValue([
          ['file.ts', vscode.FileType.File]
        ]);
        mockWorkspaceFs.readFile.mockResolvedValue(new TextEncoder().encode(fileContent));

        const results = await performSearch('test', 'directory', defaultOptions, testDir);

        expect(results.length).toBe(1);
        expect(results[0].preview).toContain('test');
      });

      test('should return empty for non-existent directory', async () => {
        mockWorkspaceFs.stat.mockRejectedValue(new Error('ENOENT'));

        const results = await performSearch('test', 'directory', defaultOptions, '/nonexistent');

        expect(results).toEqual([]);
      });

      test('should return empty for empty directory path', async () => {
        const results = await performSearch('test', 'directory', defaultOptions, '');
        expect(results).toEqual([]);
      });

      test('should search file if directory path points to a file', async () => {
        const testFilePath = '/test/file.ts';
        const fileContent = 'const test = "hello";';
        
        mockWorkspaceFs.stat.mockResolvedValue({ 
          type: vscode.FileType.File,
          size: 100,
          ctime: 0,
          mtime: 0
        });
        mockWorkspaceFs.readFile.mockResolvedValue(new TextEncoder().encode(fileContent));

        const results = await performSearch('test', 'directory', defaultOptions, testFilePath);

        expect(results.length).toBe(1);
      });
    });

    describe('module scope', () => {
      test('should search in module directory when scope is module', async () => {
        const modulePath = '/test/module';
        const fileContent = 'function test() {}';
        
        mockWorkspaceFs.stat.mockResolvedValue({ 
          type: vscode.FileType.File,
          size: 100,
          ctime: 0,
          mtime: 0
        });
        mockWorkspaceFs.readDirectory.mockResolvedValue([
          ['index.ts', vscode.FileType.File]
        ]);
        mockWorkspaceFs.readFile.mockResolvedValue(new TextEncoder().encode(fileContent));

        const results = await performSearch('test', 'module', defaultOptions, undefined, modulePath);

        expect(results.length).toBe(1);
      });

      test('should return empty for non-existent module path', async () => {
        mockWorkspaceFs.stat.mockRejectedValue(new Error('ENOENT'));

        const results = await performSearch('test', 'module', defaultOptions, undefined, '/nonexistent/module');

        expect(results).toEqual([]);
      });

      test('should return empty for module scope without modulePath', async () => {
        const results = await performSearch('test', 'module', defaultOptions);
        expect(results).toEqual([]);
      });
    });

    describe('project scope', () => {
      test('should search in workspace folders for project scope', async () => {
        const workspaceFolder = { uri: { fsPath: '/workspace' }, name: 'test', index: 0 };
        (vscode.workspace as any).workspaceFolders = [workspaceFolder];
        
        const fileContent = 'const test = true;';
        
        mockWorkspaceFs.readDirectory.mockResolvedValue([
          ['app.ts', vscode.FileType.File]
        ]);
        mockWorkspaceFs.stat.mockResolvedValue({ type: vscode.FileType.File, size: 100, ctime: 0, mtime: 0 });
        mockWorkspaceFs.readFile.mockResolvedValue(new TextEncoder().encode(fileContent));

        const results = await performSearch('test', 'project', defaultOptions);

        expect(results.length).toBe(1);
      });

      test('should return empty when no workspace folders', async () => {
        (vscode.workspace as any).workspaceFolders = null;

        const results = await performSearch('test', 'project', defaultOptions);

        expect(results).toEqual([]);
      });
    });

    describe('directory exclusion', () => {
      test('should exclude node_modules directory', async () => {
        const workspaceFolder = { uri: { fsPath: '/workspace' }, name: 'test', index: 0 };
        (vscode.workspace as any).workspaceFolders = [workspaceFolder];
        
        // Setup mock to return different results based on path to avoid infinite recursion
        mockWorkspaceFs.readDirectory.mockImplementation((uri: vscode.Uri) => {
          if (uri.fsPath === '/workspace') {
            return Promise.resolve([
              ['node_modules', vscode.FileType.Directory],
              ['src', vscode.FileType.Directory]
            ]);
          }
          return Promise.resolve([]);
        });

        await performSearch('test', 'project', defaultOptions);

        // readDirectory should be called for /workspace and /workspace/src, but not node_modules
        const calls = mockWorkspaceFs.readDirectory.mock.calls.map(c => c[0].fsPath);
        expect(calls).toContain('/workspace');
        expect(calls).not.toContain('/workspace/node_modules');
      });

      test('should exclude hidden directories', async () => {
        const workspaceFolder = { uri: { fsPath: '/workspace' }, name: 'test', index: 0 };
        (vscode.workspace as any).workspaceFolders = [workspaceFolder];
        
        // Setup mock to return different results based on path to avoid infinite recursion
        mockWorkspaceFs.readDirectory.mockImplementation((uri: vscode.Uri) => {
          if (uri.fsPath === '/workspace') {
            return Promise.resolve([
              ['.git', vscode.FileType.Directory],
              ['src', vscode.FileType.Directory]
            ]);
          }
          return Promise.resolve([]);
        });

        await performSearch('test', 'project', defaultOptions);

        const calls = mockWorkspaceFs.readDirectory.mock.calls.map(c => c[0].fsPath);
        expect(calls).not.toContain('/workspace/.git');
      });
    });

    describe('file filtering', () => {
      test('should skip binary files', async () => {
        const workspaceFolder = { uri: { fsPath: '/workspace' }, name: 'test', index: 0 };
        (vscode.workspace as any).workspaceFolders = [workspaceFolder];
        
        mockWorkspaceFs.readDirectory.mockResolvedValue([
          ['image.png', vscode.FileType.File],
          ['app.ts', vscode.FileType.File]
        ]);
        mockWorkspaceFs.stat.mockResolvedValue({ type: vscode.FileType.File, size: 100, ctime: 0, mtime: 0 });
        mockWorkspaceFs.readFile.mockResolvedValue(new TextEncoder().encode('const test = 1;'));

        const results = await performSearch('test', 'project', defaultOptions);

        // Only app.ts should be searched, not image.png
        expect(mockWorkspaceFs.readFile).toHaveBeenCalledTimes(1);
      });

      test('should skip large files (> 1MB)', async () => {
        const testFilePath = '/test/large.ts';
        
        mockWorkspaceFs.stat.mockResolvedValue({ type: vscode.FileType.File, size: 2 * 1024 * 1024, ctime: 0, mtime: 0 }); // 2MB

        const results = await performSearch('test', 'file', defaultOptions, undefined, undefined, testFilePath);

        expect(mockWorkspaceFs.readFile).not.toHaveBeenCalled();
        expect(results).toEqual([]);
      });

      test('should respect file mask filter', async () => {
        const workspaceFolder = { uri: { fsPath: '/workspace' }, name: 'test', index: 0 };
        (vscode.workspace as any).workspaceFolders = [workspaceFolder];
        
        mockWorkspaceFs.readDirectory.mockResolvedValue([
          ['app.ts', vscode.FileType.File],
          ['style.css', vscode.FileType.File]
        ]);
        mockWorkspaceFs.stat.mockResolvedValue({ type: vscode.FileType.File, size: 100, ctime: 0, mtime: 0 });
        mockWorkspaceFs.readFile.mockResolvedValue(new TextEncoder().encode('const test = 1;'));

        const results = await performSearch('test', 'project', { ...defaultOptions, fileMask: '*.ts' });

        // Only .ts files should be searched
        expect(mockWorkspaceFs.readFile).toHaveBeenCalledTimes(1);
        const readFileUri = mockWorkspaceFs.readFile.mock.calls[0][0] as vscode.Uri;
        expect(readFileUri.fsPath).toContain('app.ts');
      });

      test('should apply exclude masks with priority', async () => {
        const workspaceFolder = { uri: { fsPath: '/workspace' }, name: 'test', index: 0 };
        (vscode.workspace as any).workspaceFolders = [workspaceFolder];
        
        mockWorkspaceFs.readDirectory.mockResolvedValue([
          ['component.tsx', vscode.FileType.File],
          ['component.test.tsx', vscode.FileType.File]
        ]);
        mockWorkspaceFs.stat.mockResolvedValue({ type: vscode.FileType.File, size: 100, ctime: 0, mtime: 0 });
        mockWorkspaceFs.readFile.mockResolvedValue(new TextEncoder().encode('const test = 1;'));

        await performSearch('test', 'project', { ...defaultOptions, fileMask: '*.tsx,!*.test.tsx' });

        // Only non-test tsx file should be read
        expect(mockWorkspaceFs.readFile).toHaveBeenCalledTimes(1);
        const readFileUri = mockWorkspaceFs.readFile.mock.calls[0][0] as vscode.Uri;
        expect(readFileUri.fsPath).toContain('component.tsx');
      });
    });

    describe('open documents', () => {
      test('should use content from open documents instead of disk', async () => {
        const testFilePath = '/test/file.ts';
        const diskContent = 'old content';
        const openDocContent = 'new test content';
        
        (vscode.workspace as any).textDocuments = [{
          uri: { 
            fsPath: testFilePath,
            toString: () => testFilePath 
          },
          getText: () => openDocContent
        }];
        
        mockWorkspaceFs.readFile.mockResolvedValue(new TextEncoder().encode(diskContent));

        const results = await performSearch('test', 'file', defaultOptions, undefined, undefined, testFilePath);

        expect(results.length).toBe(1);
        expect(results[0].preview).toContain('test');
      });
    });

    describe('result limits', () => {
      test('should respect maxResults limit', async () => {
        const testFilePath = '/test/file.ts';
        // Create content with many matches
        const lines = Array(100).fill('test test test test test');
        const fileContent = lines.join('\n');
        
        mockWorkspaceFs.stat.mockResolvedValue({ type: vscode.FileType.File, size: 100, ctime: 0, mtime: 0 });
        mockWorkspaceFs.readFile.mockResolvedValue(new TextEncoder().encode(fileContent));

        const results = await performSearch('test', 'file', defaultOptions, undefined, undefined, testFilePath);

        // Should have many results but not exceed reasonable limits
        expect(results.length).toBeGreaterThan(0);
        expect(results.length).toBeLessThanOrEqual(5000);
      });
    });

    describe('search result format', () => {
      test('should return correctly formatted results', async () => {
        const testFilePath = '/test/dir/file.ts';
        const fileContent = '  const test = "hello";';
        
        mockWorkspaceFs.stat.mockResolvedValue({ type: vscode.FileType.File, size: 100, ctime: 0, mtime: 0 });
        mockWorkspaceFs.readFile.mockResolvedValue(new TextEncoder().encode(fileContent));

        const results = await performSearch('test', 'file', defaultOptions, undefined, undefined, testFilePath);

        expect(results.length).toBe(1);
        expect(results[0]).toMatchObject({
          fileName: 'file.ts',
          relativePath: 'file.ts',
          line: 0,
          character: 8, // position of 'test' in original line
          length: 4,
          preview: 'const test = "hello";' // trimmed preview
        });
        expect(results[0].uri).toContain('file.ts');
        expect(results[0].previewMatchRange).toBeDefined();
      });

      test('should handle multiple matches on same line', async () => {
        const testFilePath = '/test/file.ts';
        const fileContent = 'test test test';
        
        mockWorkspaceFs.stat.mockResolvedValue({ type: vscode.FileType.File, size: 100, ctime: 0, mtime: 0 });
        mockWorkspaceFs.readFile.mockResolvedValue(new TextEncoder().encode(fileContent));

        const results = await performSearch('test', 'file', defaultOptions, undefined, undefined, testFilePath);

        expect(results.length).toBe(3);
        expect(results[0].character).toBe(0);
        expect(results[1].character).toBe(5);
        expect(results[2].character).toBe(10);
      });
    });

    describe('error handling', () => {
      test('should handle directory read errors gracefully', async () => {
        const workspaceFolder = { uri: { fsPath: '/workspace' }, name: 'test', index: 0 };
        (vscode.workspace as any).workspaceFolders = [workspaceFolder];

        // Mock fs functions to simulate permission denied
        mockWorkspaceFs.readDirectory.mockRejectedValue(new Error('Permission denied'));

        const results = await performSearch('test', 'project', defaultOptions);

        // Should not throw, just return empty results
        expect(results).toEqual([]);
        // The readDirectory should have been called
        expect(mockWorkspaceFs.readDirectory).toHaveBeenCalled();
      });

      test('should handle file read errors gracefully', async () => {
        const testFilePath = '/test/file.ts';

        mockWorkspaceFs.stat.mockResolvedValue({ type: vscode.FileType.File, size: 100, ctime: 0, mtime: 0 });
        mockWorkspaceFs.readFile.mockRejectedValue(new Error('Permission denied'));

        const results = await performSearch('test', 'file', defaultOptions, undefined, undefined, testFilePath);

        // Should not throw, just return empty results
        expect(results).toEqual([]);
        expect(mockWorkspaceFs.readFile).toHaveBeenCalled();
      });
    });
  });

  describe('maxResults parameter', () => {
    test('should limit results to maxResults value', async () => {
      const testFilePath = '/test/file.ts';
      // Create content with many matches
      const lines = Array.from({ length: 100 }, (_, i) => `const test${i} = "test value";`);
      const content = lines.join('\n');

      mockWorkspaceFs.stat.mockResolvedValue({ type: vscode.FileType.File, size: content.length, ctime: 0, mtime: 0 });
      mockWorkspaceFs.readFile.mockResolvedValue(new TextEncoder().encode(content));

      const results = await performSearch('test', 'file', defaultOptions, undefined, undefined, testFilePath, 10);

      expect(results.length).toBe(10);
    });

    test('should return all results when under maxResults limit', async () => {
      const testFilePath = '/test/file.ts';
      const content = 'const test1 = "value";\nconst test2 = "value";';

      mockWorkspaceFs.stat.mockResolvedValue({ type: vscode.FileType.File, size: content.length, ctime: 0, mtime: 0 });
      mockWorkspaceFs.readFile.mockResolvedValue(new TextEncoder().encode(content));

      const results = await performSearch('test', 'file', defaultOptions, undefined, undefined, testFilePath, 1000);

      expect(results.length).toBe(2);
    });

    test('should use default maxResults of 10000 when not specified', async () => {
      const testFilePath = '/test/file.ts';
      const content = 'const test = "value";';

      mockWorkspaceFs.stat.mockResolvedValue({ type: vscode.FileType.File, size: content.length, ctime: 0, mtime: 0 });
      mockWorkspaceFs.readFile.mockResolvedValue(new TextEncoder().encode(content));

      // Just verify it doesn't throw and returns results
      const results = await performSearch('test', 'file', defaultOptions, undefined, undefined, testFilePath);

      expect(results.length).toBe(1);
    });

    test('should handle maxResults of 0 or negative by using default', async () => {
      const testFilePath = '/test/file.ts';
      const lines = Array.from({ length: 10 }, (_, i) => `const test${i} = "value";`);
      const content = lines.join('\n');

      mockWorkspaceFs.stat.mockResolvedValue({ type: vscode.FileType.File, size: content.length, ctime: 0, mtime: 0 });
      mockWorkspaceFs.readFile.mockResolvedValue(new TextEncoder().encode(content));

      // With maxResults = 0, should still return results (uses default)
      const results = await performSearch('test', 'file', defaultOptions, undefined, undefined, testFilePath, 0);

      expect(results.length).toBe(10);
    });
  });
});
