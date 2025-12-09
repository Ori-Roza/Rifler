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
  BINARY_EXTENSIONS,
  Limiter
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
  const limiter = new Limiter(100);

  // For directory or module scope, search directly in filesystem
  if (scope === 'file' && filePath) {
    await searchInFileAsync(filePath, regex, results, maxResults);
  } else if (scope === 'directory') {
    let searchPath = (directoryPath || '').trim();
    
    try {
      if (searchPath) {
        const stat = await fs.promises.stat(searchPath);
        console.log('Directory search path:', searchPath, 'exists: true');
        
        if (stat.isDirectory()) {
          // Search in the directory
          await searchInDirectory(searchPath, regex, options.fileMask, results, maxResults, limiter);
        } else {
          console.log('Path is a file, searching only in:', searchPath);
          await searchInFileAsync(searchPath, regex, results, maxResults);
        }
      } else {
        console.log('Directory path is empty');
      }
    } catch (error) {
      console.log('Directory does not exist or cannot be accessed:', searchPath);
    }
  } else if (scope === 'module' && modulePath) {
    try {
      await fs.promises.access(modulePath);
      await searchInDirectory(modulePath, regex, options.fileMask, results, maxResults, limiter);
    } catch {
      // Module path doesn't exist
    }
  } else {
    // Project scope - use workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    console.log('Workspace folders:', workspaceFolders ? workspaceFolders.map(f => f.uri.fsPath) : 'None');
    if (workspaceFolders) {
      const tasks = workspaceFolders.map(folder => {
        if (results.length >= maxResults) return Promise.resolve();
        console.log('Searching in folder:', folder.uri.fsPath);
        return searchInDirectory(folder.uri.fsPath, regex, options.fileMask, results, maxResults, limiter);
      });
      await Promise.all(tasks);
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
  maxResults: number,
  limiter: Limiter
): Promise<void> {
  // console.log('Searching directory:', dirPath);
  try {
    const entries = await limiter.run(() => fs.promises.readdir(dirPath, { withFileTypes: true }));

    const tasks: Promise<void>[] = [];

    for (const entry of entries) {
      if (results.length >= maxResults) break;

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          tasks.push(searchInDirectory(fullPath, regex, fileMask, results, maxResults, limiter));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const isBinary = BINARY_EXTENSIONS.has(ext);
        const matchesMask = matchesFileMask(entry.name, fileMask);
        if (!isBinary && matchesMask) {
          tasks.push(limiter.run(() => searchInFileAsync(fullPath, regex, results, maxResults)));
        }
      }
    }
    
    await Promise.all(tasks);
  } catch (error) {
    console.error('Error reading directory:', dirPath, error);
  }
}

async function searchInFileAsync(
  filePath: string,
  regex: RegExp,
  results: SearchResult[],
  maxResults: number
): Promise<void> {
  try {
    let content: string;
    
    // Check if document is open in editor to get latest content (including dirty state)
    const openDoc = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === filePath);
    
    if (openDoc) {
      content = openDoc.getText();
    } else {
      // Check file size - skip files larger than 1MB
      const stats = await fs.promises.stat(filePath);
      if (stats.size > 1024 * 1024) return;
      content = await fs.promises.readFile(filePath, 'utf-8');
    }

    const lines = content.split('\n');
    const fileName = path.basename(filePath);
    
    // Calculate relative path including workspace folder name
    // e.g., "rifler/src/utils/helper.ts" instead of full absolute path
    let relativePath = fileName; // Default to just filename if no workspace match
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      for (const folder of workspaceFolders) {
        const folderPath = folder.uri.fsPath;
        const folderName = path.basename(folderPath);
        // Normalize paths for comparison
        const normalizedFilePath = path.normalize(filePath);
        const normalizedFolderPath = path.normalize(folderPath);
        
        if (normalizedFilePath.startsWith(normalizedFolderPath + path.sep) || normalizedFilePath === normalizedFolderPath) {
          // Get path relative to workspace folder, then prepend folder name
          const pathFromFolder = path.relative(normalizedFolderPath, normalizedFilePath);
          relativePath = path.join(folderName, pathFromFolder);
          break;
        }
      }
    }

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
          relativePath,
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
