import * as vscode from 'vscode';
import * as path from 'path';
import { showPopupSearch } from '../quickpick';
import * as searchModule from '../search';

// Mock vscode
jest.mock('vscode', () => require('../../__mocks__/vscode'), { virtual: true });

describe('QuickPick Popup Search', () => {
  let mockContext: vscode.ExtensionContext;
  let mockQuickPick: any;
  let mockEditors: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock context
    mockContext = {
      globalState: {
        get: jest.fn(),
        update: jest.fn()
      }
    } as any;

    // Create mock QuickPick
    mockQuickPick = {
      placeholder: '',
      matchOnDescription: false,
      matchOnDetail: false,
      ignoreFocusOut: false,
      value: '',
      items: [],
      selectedItems: [],
      onDidChangeValue: jest.fn((callback) => {
        mockQuickPick._onDidChangeValue = callback;
        return { dispose: jest.fn() };
      }),
      onDidAccept: jest.fn((callback) => {
        mockQuickPick._onDidAccept = callback;
        return { dispose: jest.fn() };
      }),
      onDidHide: jest.fn((callback) => {
        mockQuickPick._onDidHide = callback;
        return { dispose: jest.fn() };
      }),
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn()
    };

    // Mock vscode.window.createQuickPick
    (vscode.window.createQuickPick as jest.Mock).mockReturnValue(mockQuickPick);

    // Mock vscode.window.showTextDocument
    (vscode.window.showTextDocument as jest.Mock).mockResolvedValue({
      selection: new vscode.Selection(0, 0, 0, 0),
      setDecorations: jest.fn()
    });

    // Mock vscode.workspace.openTextDocument
    (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue({
      uri: vscode.Uri.file('/test/file.ts'),
      getText: jest.fn().mockReturnValue('test content')
    });

    // Mock performSearch
    jest.spyOn(searchModule, 'performSearch').mockResolvedValue([]);

    mockEditors = {};
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('showPopupSearch initialization', () => {
    it('should create and show QuickPick', async () => {
      await showPopupSearch(mockContext);

      expect(vscode.window.createQuickPick).toHaveBeenCalled();
      expect(mockQuickPick.show).toHaveBeenCalled();
    });

    it('should set placeholder text', async () => {
      await showPopupSearch(mockContext);

      expect(mockQuickPick.placeholder).toBe('Search files... (type at least 2 characters)');
    });

    it('should enable matching on description and detail', async () => {
      await showPopupSearch(mockContext);

      expect(mockQuickPick.matchOnDescription).toBe(true);
      expect(mockQuickPick.matchOnDetail).toBe(true);
    });

    it('should set initial value from selected text', async () => {
      await showPopupSearch(mockContext, 'selectedText');

      expect(mockQuickPick.value).toBe('selectedText');
    });

    it('should register event listeners', async () => {
      await showPopupSearch(mockContext);

      expect(mockQuickPick.onDidChangeValue).toHaveBeenCalled();
      expect(mockQuickPick.onDidAccept).toHaveBeenCalled();
      expect(mockQuickPick.onDidHide).toHaveBeenCalled();
    });
  });

  describe('Search functionality', () => {
    it('should not search for queries shorter than 2 characters', async () => {
      await showPopupSearch(mockContext);

      mockQuickPick._onDidChangeValue('a');

      expect(searchModule.performSearch).not.toHaveBeenCalled();
      expect(mockQuickPick.items).toEqual([]);
    });

    it('should search for queries with 2 or more characters', async () => {
      const mockResults = [
        {
          uri: 'file:///test/file.ts',
          fileName: 'file.ts',
          relativePath: 'src/file.ts',
          line: 10,
          character: 5,
          length: 4,
          preview: 'const test = 123;',
          previewMatchRange: { start: 6, end: 10 }
        }
      ];

      (searchModule.performSearch as jest.Mock).mockResolvedValue(mockResults);

      await showPopupSearch(mockContext);
      mockQuickPick._onDidChangeValue('test');

      // Wait for async search
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(searchModule.performSearch).toHaveBeenCalledWith(
        'test',
        'project',
        expect.objectContaining({
          matchCase: false,
          wholeWord: false,
          useRegex: false,
          fileMask: ''
        }),
        undefined,
        undefined,
        undefined
      );
    });

    it('should format search results as QuickPick items', async () => {
      const mockResults = [
        {
          uri: 'file:///test/file.ts',
          fileName: 'file.ts',
          relativePath: 'src/file.ts',
          line: 10,
          character: 5,
          length: 4,
          preview: 'const test = 123;',
          previewMatchRange: { start: 6, end: 10 }
        }
      ];

      (searchModule.performSearch as jest.Mock).mockResolvedValue(mockResults);

      await showPopupSearch(mockContext);
      mockQuickPick._onDidChangeValue('test');

      // Wait for async search
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockQuickPick.items.length).toBeGreaterThan(0);
      const item = mockQuickPick.items[0];
      expect(item.label).toBe('file.ts');
      expect(item.description).toBe('src/file.ts');
      expect(item.detail).toContain('Ln 10');
      expect(item.detail).toContain('Col 5');
    });

    it('should show "No results found" message when search returns empty', async () => {
      (searchModule.performSearch as jest.Mock).mockResolvedValue([]);

      await showPopupSearch(mockContext);
      mockQuickPick._onDidChangeValue('nonexistent');

      // Wait for async search
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockQuickPick.items.length).toBeGreaterThan(0);
      expect(mockQuickPick.items[0].label).toBe('No results found');
    });

    it('should truncate long preview text', async () => {
      const longPreview = 'a'.repeat(100);
      const mockResults = [
        {
          uri: 'file:///test/file.ts',
          fileName: 'file.ts',
          relativePath: 'src/file.ts',
          line: 10,
          character: 5,
          length: 4,
          preview: longPreview,
          previewMatchRange: { start: 0, end: 4 }
        }
      ];

      (searchModule.performSearch as jest.Mock).mockResolvedValue(mockResults);

      await showPopupSearch(mockContext);
      mockQuickPick._onDidChangeValue('test');

      // Wait for async search
      await new Promise(resolve => setTimeout(resolve, 10));

      const item = mockQuickPick.items[0];
      expect(item.detail).toContain('...');
      expect(item.detail.length).toBeLessThan(longPreview.length);
    });

    it('should handle search errors gracefully', async () => {
      const mockError = new Error('Search failed');
      (searchModule.performSearch as jest.Mock).mockRejectedValue(mockError);
      (vscode.window.showErrorMessage as jest.Mock).mockResolvedValue(undefined);

      await showPopupSearch(mockContext);
      mockQuickPick._onDidChangeValue('test');

      // Wait for async search
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Search error'));
    });
  });

  describe('Result selection and opening', () => {
    it('should open file when result is selected', async () => {
      const mockResult = {
        uri: 'file:///test/file.ts',
        fileName: 'file.ts',
        relativePath: 'src/file.ts',
        line: 10,
        character: 5,
        length: 4,
        preview: 'const test = 123;',
        previewMatchRange: { start: 6, end: 10 }
      };

      mockQuickPick.selectedItems = [
        {
          label: 'file.ts',
          description: 'src/file.ts',
          detail: 'Ln 10, Col 5 - const test = 123;',
          result: mockResult
        }
      ];

      await showPopupSearch(mockContext);
      mockQuickPick._onDidAccept();

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(vscode.workspace.openTextDocument).toHaveBeenCalled();
      expect(vscode.window.showTextDocument).toHaveBeenCalled();
      expect(mockQuickPick.hide).toHaveBeenCalled();
    });

    it('should jump to correct position in opened file', async () => {
      const mockResult = {
        uri: 'file:///test/file.ts',
        fileName: 'file.ts',
        relativePath: 'src/file.ts',
        line: 5,
        character: 10,
        length: 4,
        preview: 'test code',
        previewMatchRange: { start: 10, end: 14 }
      };

      mockQuickPick.selectedItems = [
        {
          label: 'file.ts',
          description: 'src/file.ts',
          detail: 'Ln 5, Col 10 - test code',
          result: mockResult
        }
      ];

      const mockEditor = {
        selection: new vscode.Selection(0, 0, 0, 0),
        revealRange: jest.fn(),
        setDecorations: jest.fn()
      };

      (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor);

      await showPopupSearch(mockContext);
      mockQuickPick._onDidAccept();

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(mockEditor.revealRange).toHaveBeenCalled();
    });

    it('should handle errors when opening files', async () => {
      const mockResult = {
        uri: 'file:///nonexistent/file.ts',
        fileName: 'file.ts',
        relativePath: 'src/file.ts',
        line: 10,
        character: 5,
        length: 4,
        preview: 'test',
        previewMatchRange: { start: 5, end: 9 }
      };

      mockQuickPick.selectedItems = [
        {
          label: 'file.ts',
          description: 'src/file.ts',
          detail: 'Ln 10, Col 5 - test',
          result: mockResult
        }
      ];

      (vscode.workspace.openTextDocument as jest.Mock).mockRejectedValue(
        new Error('File not found')
      );
      (vscode.window.showErrorMessage as jest.Mock).mockResolvedValue(undefined);

      await showPopupSearch(mockContext);
      mockQuickPick._onDidAccept();

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Could not open file')
      );
    });
  });

  describe('QuickPick lifecycle', () => {
    it('should dispose QuickPick on hide', async () => {
      await showPopupSearch(mockContext);
      mockQuickPick._onDidHide();

      expect(mockQuickPick.dispose).toHaveBeenCalled();
    });

    it('should handle no selection gracefully', async () => {
      mockQuickPick.selectedItems = [];

      await showPopupSearch(mockContext);
      mockQuickPick._onDidAccept();

      // Should not crash
      expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
    });
  });

  describe('Performance and edge cases', () => {
    it('should debounce rapid input changes', async () => {
      (searchModule.performSearch as jest.Mock).mockResolvedValue([]);

      await showPopupSearch(mockContext);

      // Simulate rapid typing - only final state matters for search
      mockQuickPick._onDidChangeValue('t');  // <2 chars, no search
      mockQuickPick._onDidChangeValue('te'); // =2 chars, search triggered
      mockQuickPick._onDidChangeValue('tes'); // search triggered

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should have called search at least once for strings >= 2 chars
      const calls = (searchModule.performSearch as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
    });

    it('should handle empty file name gracefully', async () => {
      const mockResults = [
        {
          uri: 'file:///test/file.ts',
          fileName: '',
          relativePath: 'src/file.ts',
          line: 10,
          character: 5,
          length: 4,
          preview: 'test',
          previewMatchRange: { start: 5, end: 9 }
        }
      ];

      (searchModule.performSearch as jest.Mock).mockResolvedValue(mockResults);

      await showPopupSearch(mockContext);
      mockQuickPick._onDidChangeValue('test');

      // Wait for async search
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockQuickPick.items[0].label).toBe('unknown');
    });

    it('should handle result with zero length match', async () => {
      const mockResult = {
        uri: 'file:///test/file.ts',
        fileName: 'file.ts',
        relativePath: 'src/file.ts',
        line: 10,
        character: 5,
        length: 0,
        preview: 'test',
        previewMatchRange: { start: 5, end: 5 }
      };

      mockQuickPick.selectedItems = [
        {
          label: 'file.ts',
          description: 'src/file.ts',
          detail: 'Ln 10, Col 5 - test',
          result: mockResult
        }
      ];

      await showPopupSearch(mockContext);
      mockQuickPick._onDidAccept();

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 20));

      // Should not crash when setting decorations with zero length
      expect(vscode.window.showTextDocument).toHaveBeenCalled();
    });
  });
});
