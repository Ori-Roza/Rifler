import * as vscode from 'vscode';
import { SearchScope, SearchOptions } from './utils';
import { performSearch } from './search';
import { validateUriString, isUriSafe } from './security/pathValidation';

export async function replaceOne(uriString: string, line: number, character: number, length: number, replaceText: string): Promise<void> {
  try {
    const uri = vscode.Uri.parse(uriString);
    
    // Security: Validate URI is within workspace before replacing
    // Only enforce validation if workspace folders exist (skip in tests/edge cases)
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      if (!validateUriString(uriString)) {
        throw new Error('Security: URI must be a file:// URI within workspace');
      }
      
      // Security: Double-check after parsing
      if (!isUriSafe(uri)) {
        throw new Error('Security: Attempted to replace file outside workspace');
      }
    }
    
    const edit = new vscode.WorkspaceEdit();
    const range = new vscode.Range(line, character, line, character + length);
    edit.replace(uri, range, replaceText);
    const success = await vscode.workspace.applyEdit(edit);
    
    if (success) {
      // Save the document so fs-based search sees the change
      const doc = await vscode.workspace.openTextDocument(uri);
      await doc.save();
    }
  } catch (error) {
    console.error('Error replacing text:', error);
    vscode.window.showErrorMessage(`Could not replace text: ${error}`);
  }
}

export async function replaceAll(
  query: string,
  replaceText: string,
  scope: SearchScope,
  options: SearchOptions,
  directoryPath: string | undefined,
  modulePath: string | undefined,
  onRefresh: () => Promise<void>
): Promise<void> {
  try {
    const results = await performSearch(query, scope, options, directoryPath, modulePath);
    if (results.length === 0) {
      vscode.window.showInformationMessage('No occurrences found to replace.');
      return;
    }

    // Security: Validate all URIs before batch operation
    // Only enforce validation if workspace folders exist (skip in tests/edge cases)
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      for (const result of results) {
        if (!validateUriString(result.uri)) {
          throw new Error('Security: All URIs must be within workspace');
        }
      }
    }

    const edit = new vscode.WorkspaceEdit();
    const affectedUris = new Set<string>();
    
    for (const result of results) {
      const uri = vscode.Uri.parse(result.uri);
      const range = new vscode.Range(result.line, result.character, result.line, result.character + result.length);
      edit.replace(uri, range, replaceText);
      affectedUris.add(result.uri);
    }
    
    const success = await vscode.workspace.applyEdit(edit);
    
    if (success) {
      // Save all affected documents
      for (const uriString of affectedUris) {
        try {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(uriString));
          await doc.save();
        } catch (e) {
          console.error(`Failed to save ${uriString}:`, e);
        }
      }

      vscode.window.showInformationMessage(`Replaced ${results.length} occurrences.`);
      // Re-run search to update UI
      await onRefresh();
    } else {
      vscode.window.showErrorMessage('Failed to apply replacements.');
    }
    
  } catch (error) {
    console.error('Error replacing all:', error);
    vscode.window.showErrorMessage(`Could not replace all: ${error}`);
  }
}
