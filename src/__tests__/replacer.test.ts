import * as vscode from 'vscode';
import { replaceOne, replaceAll } from '../replacer';
import * as search from '../search';
import { SearchScope, SearchOptions } from '../utils';

// Mock vscode
jest.mock('vscode', () => require('../../__mocks__/vscode'), { virtual: true });

// Mock search module
jest.mock('../search');

describe('Replacer', () => {
  const mockEdit = {
    replace: jest.fn(),
  };
  
  const mockDoc = {
    save: jest.fn().mockResolvedValue(true),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.WorkspaceEdit as unknown as jest.Mock).mockReturnValue(mockEdit);
    (vscode.workspace.openTextDocument as unknown as jest.Mock).mockResolvedValue(mockDoc);
    (vscode.workspace.applyEdit as unknown as jest.Mock).mockResolvedValue(true);
  });

  describe('replaceOne', () => {
    test('should replace text and save document', async () => {
      const uri = 'file:///test/file.ts';
      const line = 1;
      const char = 5;
      const length = 4;
      const replaceText = 'new';

      await replaceOne(uri, line, char, length, replaceText);

      expect(vscode.WorkspaceEdit).toHaveBeenCalled();
      expect(mockEdit.replace).toHaveBeenCalledWith(
        expect.objectContaining({ fsPath: uri }),
        expect.objectContaining({ start: { line, character: char }, end: { line, character: char + length } }),
        replaceText
      );
      expect(vscode.workspace.applyEdit).toHaveBeenCalledWith(mockEdit);
      expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(expect.objectContaining({ fsPath: uri }));
      expect(mockDoc.save).toHaveBeenCalled();
    });

    test('should handle errors', async () => {
      (vscode.workspace.applyEdit as unknown as jest.Mock).mockRejectedValue(new Error('Failed'));
      
      await replaceOne('file:///test.ts', 0, 0, 1, 'text');
      
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Could not replace text'));
    });
  });

  describe('replaceAll', () => {
    const defaultOptions: SearchOptions = {
      matchCase: false,
      wholeWord: false,
      useRegex: false,
      fileMask: ''
    };

    test('should replace all occurrences and refresh', async () => {
      const query = 'old';
      const replaceText = 'new';
      const scope: SearchScope = 'project';
      const onRefresh = jest.fn().mockResolvedValue(undefined);

      const mockResults = [
        {
          uri: 'file:///test/file1.ts',
          line: 1,
          character: 5,
          length: 3,
          fileName: 'file1.ts',
          relativePath: 'test/file1.ts',
          preview: 'some old text',
          previewMatchRange: { start: 5, end: 8 }
        },
        {
          uri: 'file:///test/file2.ts',
          line: 10,
          character: 0,
          length: 3,
          fileName: 'file2.ts',
          relativePath: 'test/file2.ts',
          preview: 'old start',
          previewMatchRange: { start: 0, end: 3 }
        }
      ];

      (search.performSearch as jest.Mock).mockResolvedValue(mockResults);

      await replaceAll(query, replaceText, scope, defaultOptions, undefined, undefined, undefined, onRefresh);

      expect(search.performSearch).toHaveBeenCalledWith(query, scope, defaultOptions, undefined, undefined, undefined);
      expect(vscode.WorkspaceEdit).toHaveBeenCalled();
      expect(mockEdit.replace).toHaveBeenCalledTimes(2);
      expect(vscode.workspace.applyEdit).toHaveBeenCalledWith(mockEdit);
      
      // Should save both files
      expect(vscode.workspace.openTextDocument).toHaveBeenCalledTimes(2);
      expect(mockDoc.save).toHaveBeenCalledTimes(2);
      
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('Replaced 2 occurrences'));
      expect(onRefresh).toHaveBeenCalled();
    });

    test('should show message if no results found', async () => {
      (search.performSearch as jest.Mock).mockResolvedValue([]);
      const onRefresh = jest.fn();

      await replaceAll('query', 'replace', 'project', defaultOptions, undefined, undefined, undefined, onRefresh);

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('No occurrences found to replace.');
      expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
      expect(onRefresh).not.toHaveBeenCalled();
    });

    test('should handle applyEdit failure', async () => {
      (search.performSearch as jest.Mock).mockResolvedValue([{
        uri: 'file:///test.ts',
        line: 0,
        character: 0,
        length: 1,
        fileName: 'test.ts',
        relativePath: 'test.ts',
        preview: 'a',
        previewMatchRange: { start: 0, end: 1 }
      }]);
      
      (vscode.workspace.applyEdit as unknown as jest.Mock).mockResolvedValue(false);
      const onRefresh = jest.fn();

      await replaceAll('query', 'replace', 'project', defaultOptions, undefined, undefined, undefined, onRefresh);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Failed to apply replacements.');
      expect(onRefresh).not.toHaveBeenCalled();
    });

    test('should handle save errors gracefully', async () => {
      const mockResults = [
        {
          uri: 'file:///test/file1.ts',
          line: 1,
          character: 5,
          length: 3,
          fileName: 'file1.ts',
          relativePath: 'test/file1.ts',
          preview: 'some old text',
          previewMatchRange: { start: 5, end: 8 }
        }
      ];

      (search.performSearch as jest.Mock).mockResolvedValue(mockResults);
      
      // Mock save to throw error
      const mockDocWithError = {
        save: jest.fn().mockRejectedValue(new Error('Save failed'))
      };
      (vscode.workspace.openTextDocument as unknown as jest.Mock).mockResolvedValue(mockDocWithError);
      
      const onRefresh = jest.fn().mockResolvedValue(undefined);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await replaceAll('query', 'replace', 'project', defaultOptions, undefined, undefined, undefined, onRefresh);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to save'), expect.any(Error));
      // Should still show success and call refresh
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('Replaced 1 occurrences'));
      expect(onRefresh).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    test('should handle performSearch error', async () => {
      (search.performSearch as jest.Mock).mockRejectedValue(new Error('Search failed'));
      const onRefresh = jest.fn();
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await replaceAll('query', 'replace', 'project', defaultOptions, undefined, undefined, undefined, onRefresh);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error replacing all'), expect.any(Error));
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Could not replace all'));
      expect(onRefresh).not.toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    test('should pass directory, module, and file paths to performSearch', async () => {
      (search.performSearch as jest.Mock).mockResolvedValue([]);
      const onRefresh = jest.fn();

      await replaceAll('query', 'replace', 'directory', defaultOptions, '/test/dir', undefined, undefined, onRefresh);
      expect(search.performSearch).toHaveBeenCalledWith('query', 'directory', defaultOptions, '/test/dir', undefined, undefined);

      await replaceAll('query', 'replace', 'module', defaultOptions, undefined, '/test/module', undefined, onRefresh);
      expect(search.performSearch).toHaveBeenCalledWith('query', 'module', defaultOptions, undefined, '/test/module', undefined);

      await replaceAll('query', 'replace', 'file', defaultOptions, undefined, undefined, '/test/file.ts', onRefresh);
      expect(search.performSearch).toHaveBeenCalledWith('query', 'file', defaultOptions, undefined, undefined, '/test/file.ts');
    });
  });
});
