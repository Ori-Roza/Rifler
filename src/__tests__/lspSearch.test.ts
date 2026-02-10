jest.mock('vscode');

import * as vscode from 'vscode';
import {
  getSymbolAtCursor,
  executeLspSearch,
  mapLocationsToSearchResults,
  checkLspAvailability,
  lspReplaceAll,
} from '../lspSearch';

describe('lspSearch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.window as any).activeTextEditor = undefined;
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: '/workspace' }, index: 0, name: 'workspace' },
    ];
  });

  describe('getSymbolAtCursor', () => {
    test('returns null when no active editor', () => {
      (vscode.window as any).activeTextEditor = undefined;
      expect(getSymbolAtCursor()).toBeNull();
    });

    test('returns null when cursor is not on a word', () => {
      (vscode.window as any).activeTextEditor = {
        document: {
          getWordRangeAtPosition: jest.fn().mockReturnValue(undefined),
          languageId: 'typescript',
        },
        selection: {
          active: { line: 0, character: 0 },
        },
      };
      expect(getSymbolAtCursor()).toBeNull();
    });

    test('returns symbol info when cursor is on a word', () => {
      const mockWordRange = {
        start: { line: 5, character: 10 },
        end: { line: 5, character: 20 },
      };
      const mockUri = { fsPath: '/workspace/src/file.ts', toString: () => 'file:///workspace/src/file.ts' };
      (vscode.window as any).activeTextEditor = {
        document: {
          getWordRangeAtPosition: jest.fn().mockReturnValue(mockWordRange),
          getText: jest.fn().mockReturnValue('myFunction'),
          uri: mockUri,
          languageId: 'typescript',
        },
        selection: {
          active: { line: 5, character: 15 },
        },
      };

      const result = getSymbolAtCursor();
      expect(result).toEqual({
        symbolName: 'myFunction',
        uri: mockUri,
        position: { line: 5, character: 10 },
        languageId: 'typescript',
      });
    });
  });

  describe('executeLspSearch', () => {
    const mockUri = { fsPath: '/workspace/src/file.ts', toString: () => 'file:///workspace/src/file.ts' };
    const mockPosition = { line: 5, character: 10 };

    test('dispatches to correct VS Code command for references', async () => {
      (vscode.commands.executeCommand as jest.Mock).mockResolvedValue([]);
      await executeLspSearch(mockUri as any, mockPosition as any, 'references');
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'vscode.executeReferenceProvider',
        mockUri,
        mockPosition
      );
    });

    test('dispatches to correct VS Code command for definitions', async () => {
      (vscode.commands.executeCommand as jest.Mock).mockResolvedValue([]);
      await executeLspSearch(mockUri as any, mockPosition as any, 'definitions');
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'vscode.executeDefinitionProvider',
        mockUri,
        mockPosition
      );
    });

    test('dispatches to correct VS Code command for implementations', async () => {
      (vscode.commands.executeCommand as jest.Mock).mockResolvedValue([]);
      await executeLspSearch(mockUri as any, mockPosition as any, 'implementations');
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'vscode.executeImplementationProvider',
        mockUri,
        mockPosition
      );
    });

    test('dispatches to correct VS Code command for typeDefinitions', async () => {
      (vscode.commands.executeCommand as jest.Mock).mockResolvedValue([]);
      await executeLspSearch(mockUri as any, mockPosition as any, 'typeDefinitions');
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'vscode.executeTypeDefinitionProvider',
        mockUri,
        mockPosition
      );
    });

    test('returns empty array when no locations found', async () => {
      (vscode.commands.executeCommand as jest.Mock).mockResolvedValue([]);
      const results = await executeLspSearch(mockUri as any, mockPosition as any, 'references');
      expect(results).toEqual([]);
    });

    test('returns empty array when executeCommand returns undefined', async () => {
      (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined);
      const results = await executeLspSearch(mockUri as any, mockPosition as any, 'references');
      expect(results).toEqual([]);
    });

    test('returns empty array on error', async () => {
      (vscode.commands.executeCommand as jest.Mock).mockRejectedValue(new Error('LSP error'));
      const results = await executeLspSearch(mockUri as any, mockPosition as any, 'references');
      expect(results).toEqual([]);
    });

    test('maps locations to search results', async () => {
      const locationUri = { fsPath: '/workspace/src/other.ts', toString: () => 'file:///workspace/src/other.ts' };
      const locations = [
        {
          uri: locationUri,
          range: {
            start: { line: 10, character: 5 },
            end: { line: 10, character: 15 },
          },
        },
      ];

      (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(locations);
      (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue({
        lineAt: jest.fn().mockReturnValue({ text: '  const myFunction = () => {}' }),
      });

      const results = await executeLspSearch(mockUri as any, mockPosition as any, 'references');
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        uri: 'file:///workspace/src/other.ts',
        fileName: 'other.ts',
        relativePath: 'src/other.ts',
        line: 10,
        character: 5,
        length: 10,
        preview: '  const myFunction = () => {}',
        previewMatchRange: { start: 5, end: 15 },
      });
    });
  });

  describe('mapLocationsToSearchResults', () => {
    test('handles errors for individual locations gracefully', async () => {
      const goodUri = { fsPath: '/workspace/src/good.ts', toString: () => 'file:///workspace/src/good.ts' };
      const badUri = { fsPath: '/workspace/src/bad.ts', toString: () => 'file:///workspace/src/bad.ts' };

      const locations = [
        {
          uri: badUri,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
        },
        {
          uri: goodUri,
          range: { start: { line: 3, character: 2 }, end: { line: 3, character: 8 } },
        },
      ];

      (vscode.workspace.openTextDocument as jest.Mock)
        .mockRejectedValueOnce(new Error('File not found'))
        .mockResolvedValueOnce({
          lineAt: jest.fn().mockReturnValue({ text: '  myFunc();' }),
        });

      const results = await mapLocationsToSearchResults(locations as any);
      expect(results).toHaveLength(1);
      expect(results[0].fileName).toBe('good.ts');
    });
  });

  describe('checkLspAvailability', () => {
    const mockUri = { fsPath: '/workspace/src/file.ts', toString: () => 'file:///workspace/src/file.ts' };
    const mockPosition = { line: 0, character: 0 };

    test('returns true when LSP responds', async () => {
      (vscode.commands.executeCommand as jest.Mock).mockResolvedValue([]);
      const result = await checkLspAvailability(mockUri as any, mockPosition as any);
      expect(result).toBe(true);
    });

    test('returns false on error', async () => {
      (vscode.commands.executeCommand as jest.Mock).mockRejectedValue(new Error('No provider'));
      const result = await checkLspAvailability(mockUri as any, mockPosition as any);
      expect(result).toBe(false);
    });
  });

  describe('lspReplaceAll', () => {
    const mockUri = { fsPath: '/workspace/src/file.ts', toString: () => 'file:///workspace/src/file.ts' };
    const mockPosition = { line: 5, character: 10 };

    test('returns zero replaced when no results found', async () => {
      (vscode.commands.executeCommand as jest.Mock).mockResolvedValue([]);
      const result = await lspReplaceAll(mockUri as any, mockPosition as any, 'references', 'newName');
      expect(result.replacedCount).toBe(0);
      expect(result.results).toEqual([]);
    });

    test('applies WorkspaceEdit and saves documents', async () => {
      const locationUri = { fsPath: '/workspace/src/other.ts', toString: () => 'file:///workspace/src/other.ts' };
      const locations = [
        {
          uri: locationUri,
          range: {
            start: { line: 10, character: 5 },
            end: { line: 10, character: 15 },
          },
        },
      ];

      // First call: get references for replace. Second call: get updated references.
      (vscode.commands.executeCommand as jest.Mock)
        .mockResolvedValueOnce(locations)  // initial search
        .mockResolvedValueOnce([]);         // post-replace search

      const mockDoc = {
        lineAt: jest.fn().mockReturnValue({ text: '  const myFunction = () => {}' }),
        save: jest.fn().mockResolvedValue(true),
      };
      (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDoc);
      (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true);

      const result = await lspReplaceAll(mockUri as any, mockPosition as any, 'references', 'newName');
      expect(result.replacedCount).toBe(1);
      expect(vscode.workspace.applyEdit).toHaveBeenCalled();
      expect(mockDoc.save).toHaveBeenCalled();
    });

    test('returns zero replaced when applyEdit fails', async () => {
      const locationUri = { fsPath: '/workspace/src/other.ts', toString: () => 'file:///workspace/src/other.ts' };
      const locations = [
        {
          uri: locationUri,
          range: {
            start: { line: 10, character: 5 },
            end: { line: 10, character: 15 },
          },
        },
      ];

      (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(locations);
      const mockDoc = {
        lineAt: jest.fn().mockReturnValue({ text: '  const myFunc = () => {}' }),
      };
      (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDoc);
      (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(false);

      const result = await lspReplaceAll(mockUri as any, mockPosition as any, 'references', 'newName');
      expect(result.replacedCount).toBe(0);
    });
  });
});
