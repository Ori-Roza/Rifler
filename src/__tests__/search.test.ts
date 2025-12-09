import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { performSearch } from '../search';
import { SearchOptions, SearchScope } from '../utils';

// Mock vscode
jest.mock('vscode', () => require('../../__mocks__/vscode'), { virtual: true });

// Mock fs module
jest.mock('fs', () => {
  return {
    existsSync: jest.fn(),
    statSync: jest.fn(),
    readdirSync: jest.fn(),
    readFileSync: jest.fn(),
    promises: {
      readdir: jest.fn(),
      readFile: jest.fn(),
      stat: jest.fn(),
      access: jest.fn()
    }
  };
});

const mockFs = fs as unknown as {
  existsSync: jest.Mock;
  statSync: jest.Mock;
  readdirSync: jest.Mock;
  readFileSync: jest.Mock;
  promises: {
    readdir: jest.Mock;
    readFile: jest.Mock;
    stat: jest.Mock;
    access: jest.Mock;
  }
};

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
        
        mockFs.existsSync.mockReturnValue(true);
        mockFs.promises.stat.mockResolvedValue({ size: 100 } as fs.Stats);
        mockFs.promises.readFile.mockResolvedValue(fileContent);

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
        
        mockFs.existsSync.mockReturnValue(true);
        mockFs.promises.stat.mockImplementation(async (p: fs.PathLike) => {
          if (p === testDir) {
            return { isDirectory: () => true, isFile: () => false } as fs.Stats;
          }
          return { size: 100, isDirectory: () => false, isFile: () => true } as fs.Stats;
        });
        mockFs.promises.readdir.mockResolvedValue([
          { name: 'file.ts', isDirectory: () => false, isFile: () => true }
        ] as any);
        mockFs.promises.readFile.mockResolvedValue(fileContent);

        const results = await performSearch('test', 'directory', defaultOptions, testDir);

        expect(results.length).toBe(1);
        expect(results[0].preview).toContain('test');
      });

      test('should return empty for non-existent directory', async () => {
        mockFs.existsSync.mockReturnValue(false);
        mockFs.promises.stat.mockRejectedValue(new Error('ENOENT'));

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
        
        mockFs.existsSync.mockReturnValue(true);
        mockFs.promises.stat.mockImplementation(async () => ({ 
          isDirectory: () => false, 
          isFile: () => true,
          size: 100 
        } as fs.Stats));
        mockFs.promises.readFile.mockResolvedValue(fileContent);

        const results = await performSearch('test', 'directory', defaultOptions, testFilePath);

        expect(results.length).toBe(1);
      });
    });

    describe('module scope', () => {
      test('should search in module directory when scope is module', async () => {
        const modulePath = '/test/module';
        const fileContent = 'function test() {}';
        
        mockFs.existsSync.mockReturnValue(true);
        mockFs.promises.access.mockResolvedValue(undefined);
        mockFs.promises.stat.mockImplementation(async () => ({ 
          isDirectory: () => false, 
          isFile: () => true,
          size: 100 
        } as fs.Stats));
        mockFs.promises.readdir.mockResolvedValue([
          { name: 'index.ts', isDirectory: () => false, isFile: () => true }
        ] as any);
        mockFs.promises.readFile.mockResolvedValue(fileContent);

        const results = await performSearch('test', 'module', defaultOptions, undefined, modulePath);

        expect(results.length).toBe(1);
      });

      test('should return empty for non-existent module path', async () => {
        mockFs.existsSync.mockReturnValue(false);
        mockFs.promises.access.mockRejectedValue(new Error('ENOENT'));

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
        
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockImplementation(() => ({ 
          isDirectory: () => false, 
          isFile: () => true,
          size: 100 
        } as fs.Stats));
        mockFs.promises.readdir.mockResolvedValue([
          { name: 'app.ts', isDirectory: () => false, isFile: () => true }
        ] as any);
        mockFs.promises.stat.mockResolvedValue({ size: 100 } as fs.Stats);
        mockFs.promises.readFile.mockResolvedValue(fileContent);

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
        
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockImplementation(() => ({ 
          isDirectory: () => false, 
          isFile: () => true,
          size: 100 
        } as fs.Stats));
        
        // Setup mock to return different results based on path to avoid infinite recursion
        mockFs.promises.readdir.mockImplementation((path: string) => {
          if (path === '/workspace') {
            return Promise.resolve([
              { name: 'node_modules', isDirectory: () => true, isFile: () => false },
              { name: 'src', isDirectory: () => true, isFile: () => false }
            ] as any);
          }
          return Promise.resolve([]);
        });

        await performSearch('test', 'project', defaultOptions);

        // readdirSync should be called for /workspace and /workspace/src, but not node_modules
        const calls = mockFs.promises.readdir.mock.calls.map(c => c[0]);
        expect(calls).toContain('/workspace');
        expect(calls).not.toContain('/workspace/node_modules');
      });

      test('should exclude hidden directories', async () => {
        const workspaceFolder = { uri: { fsPath: '/workspace' }, name: 'test', index: 0 };
        (vscode.workspace as any).workspaceFolders = [workspaceFolder];
        
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockImplementation(() => ({ 
          isDirectory: () => false, 
          isFile: () => true,
          size: 100 
        } as fs.Stats));
        
        // Setup mock to return different results based on path to avoid infinite recursion
        mockFs.promises.readdir.mockImplementation((path: string) => {
          if (path === '/workspace') {
            return Promise.resolve([
              { name: '.git', isDirectory: () => true, isFile: () => false },
              { name: 'src', isDirectory: () => true, isFile: () => false }
            ] as any);
          }
          return Promise.resolve([]);
        });

        await performSearch('test', 'project', defaultOptions);

        const calls = mockFs.promises.readdir.mock.calls.map(c => c[0]);
        expect(calls).not.toContain('/workspace/.git');
      });
    });

    describe('file filtering', () => {
      test('should skip binary files', async () => {
        const workspaceFolder = { uri: { fsPath: '/workspace' }, name: 'test', index: 0 };
        (vscode.workspace as any).workspaceFolders = [workspaceFolder];
        
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockImplementation(() => ({ 
          isDirectory: () => false, 
          isFile: () => true,
          size: 100 
        } as fs.Stats));
        mockFs.promises.readdir.mockResolvedValue([
          { name: 'image.png', isDirectory: () => false, isFile: () => true },
          { name: 'app.ts', isDirectory: () => false, isFile: () => true }
        ] as any);
        mockFs.promises.stat.mockResolvedValue({ size: 100 } as fs.Stats);
        mockFs.promises.readFile.mockResolvedValue('const test = 1;');

        const results = await performSearch('test', 'project', defaultOptions);

        // Only app.ts should be searched, not image.png
        expect(mockFs.promises.readFile).toHaveBeenCalledTimes(1);
      });

      test('should skip large files (> 1MB)', async () => {
        const testFilePath = '/test/large.ts';
        
        mockFs.existsSync.mockReturnValue(true);
        mockFs.promises.stat.mockResolvedValue({ size: 2 * 1024 * 1024 } as fs.Stats); // 2MB

        const results = await performSearch('test', 'file', defaultOptions, undefined, undefined, testFilePath);

        expect(mockFs.promises.readFile).not.toHaveBeenCalled();
        expect(results).toEqual([]);
      });

      test('should respect file mask filter', async () => {
        const workspaceFolder = { uri: { fsPath: '/workspace' }, name: 'test', index: 0 };
        (vscode.workspace as any).workspaceFolders = [workspaceFolder];
        
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockImplementation(() => ({ 
          isDirectory: () => false, 
          isFile: () => true,
          size: 100 
        } as fs.Stats));
        mockFs.promises.readdir.mockResolvedValue([
          { name: 'app.ts', isDirectory: () => false, isFile: () => true },
          { name: 'style.css', isDirectory: () => false, isFile: () => true }
        ] as any);
        mockFs.promises.stat.mockResolvedValue({ size: 100 } as fs.Stats);
        mockFs.promises.readFile.mockResolvedValue('const test = 1;');

        const results = await performSearch('test', 'project', { ...defaultOptions, fileMask: '*.ts' });

        // Only .ts files should be searched
        expect(mockFs.promises.readFile).toHaveBeenCalledTimes(1);
        expect(mockFs.promises.readFile).toHaveBeenCalledWith(expect.stringContaining('app.ts'), 'utf-8');
      });

      test('should apply exclude masks with priority', async () => {
        const workspaceFolder = { uri: { fsPath: '/workspace' }, name: 'test', index: 0 };
        (vscode.workspace as any).workspaceFolders = [workspaceFolder];
        
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockImplementation(() => ({ 
          isDirectory: () => false, 
          isFile: () => true,
          size: 100 
        } as fs.Stats));
        mockFs.promises.readdir.mockResolvedValue([
          { name: 'component.tsx', isDirectory: () => false, isFile: () => true },
          { name: 'component.test.tsx', isDirectory: () => false, isFile: () => true }
        ] as any);
        mockFs.promises.stat.mockResolvedValue({ size: 100 } as fs.Stats);
        mockFs.promises.readFile.mockResolvedValue('const test = 1;');

        await performSearch('test', 'project', { ...defaultOptions, fileMask: '*.tsx,!*.test.tsx' });

        // Only non-test tsx file should be read
        expect(mockFs.promises.readFile).toHaveBeenCalledTimes(1);
        const calledPath = mockFs.promises.readFile.mock.calls[0][0];
        expect(calledPath).toContain('component.tsx');
      });
    });

    describe('open documents', () => {
      test('should use content from open documents instead of disk', async () => {
        const testFilePath = '/test/file.ts';
        const diskContent = 'old content';
        const openDocContent = 'new test content';
        
        (vscode.workspace as any).textDocuments = [{
          uri: { fsPath: testFilePath },
          getText: () => openDocContent
        }];
        
        mockFs.existsSync.mockReturnValue(true);
        mockFs.promises.readFile.mockResolvedValue(diskContent);

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
        
        mockFs.existsSync.mockReturnValue(true);
        mockFs.promises.stat.mockResolvedValue({ size: 100 } as fs.Stats);
        mockFs.promises.readFile.mockResolvedValue(fileContent);

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
        
        mockFs.existsSync.mockReturnValue(true);
        mockFs.promises.stat.mockResolvedValue({ size: 100 } as fs.Stats);
        mockFs.promises.readFile.mockResolvedValue(fileContent);

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
        
        mockFs.existsSync.mockReturnValue(true);
        mockFs.promises.stat.mockResolvedValue({ size: 100 } as fs.Stats);
        mockFs.promises.readFile.mockResolvedValue(fileContent);

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
        mockFs.existsSync.mockReturnValue(true);
        mockFs.promises.readdir.mockRejectedValue(new Error('Permission denied'));

        const results = await performSearch('test', 'project', defaultOptions);

        // Should not throw, just return empty results
        expect(results).toEqual([]);
        // The readdirSync should have been called with the correct parameters
        expect(mockFs.promises.readdir).toHaveBeenCalledWith('/workspace', { withFileTypes: true });
      });

      test('should handle file read errors gracefully', async () => {
        const testFilePath = '/test/file.ts';

        mockFs.existsSync.mockReturnValue(true);
        mockFs.promises.stat.mockResolvedValue({ size: 100, isFile: () => true, isDirectory: () => false } as fs.Stats);
        mockFs.promises.readFile.mockRejectedValue(new Error('Permission denied'));

        const results = await performSearch('test', 'file', defaultOptions, undefined, undefined, testFilePath);

        // Should not throw, just return empty results
        expect(results).toEqual([]);
        expect(mockFs.promises.readFile).toHaveBeenCalledWith(testFilePath, 'utf-8');
      });
    });
  });
});
