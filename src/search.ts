import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { 
  SearchOptions, 
  SearchResult, 
  SearchScope, 
  buildSearchRegex, 
  matchesFileMask,
  EXCLUDE_DIRS,
  BINARY_EXTENSIONS
} from './utils';

export async function performSearch(
  query: string,
  scope: SearchScope,
  options: SearchOptions,
  directoryPath?: string,
  modulePath?: string,
  filePath?: string
): Promise<SearchResult[]> {
  console.log('performSearch called:', { query, scope, directoryPath, modulePath, filePath, options });
  
  if (!query.trim() || query.length < 2) {
    return [];
  }

  const regex = buildSearchRegex(query, options);
  if (!regex) {
    return [];
  }

  const results: SearchResult[] = [];
  const maxResults = 5000;

  // For directory or module scope, search directly in filesystem
  if (scope === 'file' && filePath) {
    searchInFile(filePath, regex, results, maxResults);
  } else if (scope === 'directory') {
    let searchPath = (directoryPath || '').trim();
    console.log('Directory search path:', searchPath, 'exists:', searchPath ? fs.existsSync(searchPath) : false);
    
    if (searchPath && fs.existsSync(searchPath)) {
      const stat = fs.statSync(searchPath);
      if (stat.isDirectory()) {
        // Search in the directory
        await searchInDirectory(searchPath, regex, options.fileMask, results, maxResults);
      } else {

        console.log('Path is a file, searching only in:', searchPath);
        searchInFile(searchPath, regex, results, maxResults);
      }
    } else {
      console.log('Directory does not exist or is empty, returning no results');
      // Don't fall back to project - user explicitly chose directory scope
    }
  } else if (scope === 'module' && modulePath) {
    if (fs.existsSync(modulePath)) {
      await searchInDirectory(modulePath, regex, options.fileMask, results, maxResults);
    }
  } else {
    // Project scope - use workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    console.log('Workspace folders:', workspaceFolders ? workspaceFolders.map(f => f.uri.fsPath) : 'None');
    if (workspaceFolders) {
      for (const folder of workspaceFolders) {
        if (results.length >= maxResults) break;
        console.log('Searching in folder:', folder.uri.fsPath);
        await searchInDirectory(folder.uri.fsPath, regex, options.fileMask, results, maxResults);
      }
    }
  }

  console.log('Search completed, results:', results.length);
  return results;
}

async function searchInDirectory(
  dirPath: string,
  regex: RegExp,
  fileMask: string,
  results: SearchResult[],
  maxResults: number
): Promise<void> {
  // console.log('Searching directory:', dirPath);
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= maxResults) break;

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          await searchInDirectory(fullPath, regex, fileMask, results, maxResults);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!BINARY_EXTENSIONS.has(ext) && matchesFileMask(entry.name, fileMask)) {
          // console.log('Searching file:', fullPath);
          searchInFile(fullPath, regex, results, maxResults);
        }
      }
    }
  } catch (error) {
    console.error('Error reading directory:', dirPath, error);
  }
}

function searchInFile(
  filePath: string,
  regex: RegExp,
  results: SearchResult[],
  maxResults: number
): void {
  try {
    let content: string;
    
    // Check if document is open in editor to get latest content (including dirty state)
    const openDoc = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === filePath);
    
    if (openDoc) {
      content = openDoc.getText();
    } else {
      // Check file size - skip files larger than 1MB
      const stats = fs.statSync(filePath);
      if (stats.size > 1024 * 1024) return;
      content = fs.readFileSync(filePath, 'utf-8');
    }

    const lines = content.split('\n');
    const fileName = path.basename(filePath);

    for (let lineIndex = 0; lineIndex < lines.length && results.length < maxResults; lineIndex++) {
      const line = lines[lineIndex];
      let match: RegExpExecArray | null;
      
      // Reset regex for each line
      regex.lastIndex = 0;

      while ((match = regex.exec(line)) !== null) {
        if (results.length >= maxResults) break;

        // Calculate the leading whitespace that will be trimmed
        const leadingWhitespace = line.length - line.trimStart().length;
        const adjustedStart = match.index - leadingWhitespace;
        const adjustedEnd = match.index + match[0].length - leadingWhitespace;

        results.push({
          uri: vscode.Uri.file(filePath).toString(),
          fileName,
          relativePath: filePath,
          line: lineIndex,
          character: match.index,
          length: match[0].length,
          preview: line.trim(),
          previewMatchRange: {
            start: Math.max(0, adjustedStart),
            end: Math.max(0, adjustedEnd)
          }
        });

        // Prevent infinite loop for zero-length matches
        if (match[0].length === 0) regex.lastIndex++;
      }
    }
  } catch {
    // Skip files that can't be read
  }
}
