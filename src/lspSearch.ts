import * as vscode from 'vscode';
import * as path from 'path';
import { SearchResult } from './utils';

// ============================================================================
// Types
// ============================================================================

export type LspSearchMode = 'references' | 'definitions' | 'implementations' | 'typeDefinitions';

export interface SymbolInfo {
  symbolName: string;
  uri: vscode.Uri;
  position: vscode.Position;
  languageId: string;
}

export interface LspSearchInfo {
  languageId: string;
  symbolName: string;
  confidence: 'high' | 'partial';
}

// ============================================================================
// Symbol Detection
// ============================================================================

/**
 * Get the symbol under the cursor in the active text editor.
 * Returns null if no active editor or no word at cursor.
 */
export function getSymbolAtCursor(): SymbolInfo | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return null;
  }

  const document = editor.document;
  const position = editor.selection.active;
  const wordRange = document.getWordRangeAtPosition(position);

  if (!wordRange) {
    return null;
  }

  return {
    symbolName: document.getText(wordRange),
    uri: document.uri,
    position: wordRange.start,
    languageId: document.languageId,
  };
}

// ============================================================================
// LSP Command Mapping
// ============================================================================

const LSP_COMMANDS: Record<LspSearchMode, string> = {
  references: 'vscode.executeReferenceProvider',
  definitions: 'vscode.executeDefinitionProvider',
  implementations: 'vscode.executeImplementationProvider',
  typeDefinitions: 'vscode.executeTypeDefinitionProvider',
};

// ============================================================================
// LSP Search Execution
// ============================================================================

/**
 * Execute an LSP search using VS Code's built-in language server commands.
 * Returns results mapped to the standard SearchResult interface.
 */
export async function executeLspSearch(
  uri: vscode.Uri,
  position: vscode.Position,
  mode: LspSearchMode
): Promise<SearchResult[]> {
  const command = LSP_COMMANDS[mode];
  if (!command) {
    console.warn(`[Rifler LSP] Unknown LSP mode: ${mode}`);
    return [];
  }

  try {
    const locations: vscode.Location[] | undefined = await vscode.commands.executeCommand(
      command,
      uri,
      position
    );

    if (!locations || locations.length === 0) {
      return [];
    }

    return await mapLocationsToSearchResults(locations);
  } catch (error) {
    console.error(`[Rifler LSP] Error executing ${command}:`, error);
    return [];
  }
}

// ============================================================================
// Location Mapping
// ============================================================================

/**
 * Map VS Code Location[] to SearchResult[] by reading the actual file content
 * at each location to build preview strings.
 */
export async function mapLocationsToSearchResults(
  locations: vscode.Location[]
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  for (const location of locations) {
    try {
      const doc = await vscode.workspace.openTextDocument(location.uri);
      const line = location.range.start.line;
      const character = location.range.start.character;
      const endCharacter = location.range.end.character;
      const length = endCharacter - character;
      const lineText = doc.lineAt(line).text;

      const workspaceFolders = vscode.workspace.workspaceFolders;
      const wsRoot = workspaceFolders?.[0]?.uri.fsPath ?? '';
      const fsPath = location.uri.fsPath;
      const relativePath = wsRoot ? path.relative(wsRoot, fsPath) : fsPath;

      results.push({
        uri: location.uri.toString(),
        fileName: path.basename(fsPath),
        relativePath,
        line,
        character,
        length,
        preview: lineText,
        previewMatchRange: {
          start: character,
          end: endCharacter,
        },
      });
    } catch (error) {
      console.warn(`[Rifler LSP] Failed to read location ${location.uri.toString()}:`, error);
    }
  }

  return results;
}

// ============================================================================
// LSP Availability Check
// ============================================================================

/**
 * Check whether a language server is available for the given document URI.
 * Attempts a quick definition lookup; if it resolves (even empty), LSP is available.
 */
export async function checkLspAvailability(uri: vscode.Uri, position: vscode.Position): Promise<boolean> {
  try {
    const result = await Promise.race([
      vscode.commands.executeCommand('vscode.executeDefinitionProvider', uri, position),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 3000)),
    ]);
    return result !== 'timeout';
  } catch {
    return false;
  }
}

// ============================================================================
// LSP Replace
// ============================================================================

/**
 * Replace all LSP-found matches with the given text.
 * Re-runs the LSP search to get fresh locations, then applies a WorkspaceEdit.
 */
export async function lspReplaceAll(
  uri: vscode.Uri,
  position: vscode.Position,
  mode: LspSearchMode,
  replaceText: string
): Promise<{ replacedCount: number; results: SearchResult[] }> {
  const results = await executeLspSearch(uri, position, mode);

  if (results.length === 0) {
    return { replacedCount: 0, results: [] };
  }

  const edit = new vscode.WorkspaceEdit();
  for (const result of results) {
    const resultUri = vscode.Uri.parse(result.uri);
    const range = new vscode.Range(
      result.line,
      result.character,
      result.line,
      result.character + result.length
    );
    edit.replace(resultUri, range, replaceText);
  }

  const success = await vscode.workspace.applyEdit(edit);
  if (!success) {
    console.error('[Rifler LSP] Failed to apply bulk replace edit');
    return { replacedCount: 0, results };
  }

  // Save all affected documents
  const affectedUris = new Set(results.map((r) => r.uri));
  for (const uriStr of affectedUris) {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(uriStr));
      await doc.save();
    } catch (error) {
      console.warn(`[Rifler LSP] Failed to save document ${uriStr}:`, error);
    }
  }

  // Re-run search to get updated results
  const updatedResults = await executeLspSearch(uri, position, mode);
  return { replacedCount: results.length, results: updatedResults };
}
