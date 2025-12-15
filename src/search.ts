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
  Limiter,
  validateRegex,
  validateFileMask
} from './utils';

export async function performSearch(
  query: string,
  scope: SearchScope,
  options: SearchOptions,
  directoryPath?: string,
  modulePath?: string,
  filePath?: string,
  maxResults: number = 10000
): Promise<SearchResult[]> {
  console.log('performSearch called:', { query, scope, directoryPath, modulePath, filePath, options });

  if (!query.trim() || query.length < 2) {
    return [];
  }

  const regexValidation = validateRegex(query, options.useRegex);
  if (!regexValidation.isValid) {
    console.error('Invalid regex:', regexValidation.error);
    return [];
  }

  if (options.useRegex && !isSafeRegex(query)) {
    console.warn('Rejected potentially unsafe regex pattern');
    return [];
  }

  const regex = buildSearchRegex(query, options);
  if (!regex) {
    return [];
  }

  const maskValidation = validateFileMask(options.fileMask);
  if (!maskValidation.isValid) {
    console.warn('File mask validation failed:', maskValidation.message);
    options.fileMask = '';
  }

  const effectiveMaxResults = Math.max(1, Math.floor(maxResults || 10000));
  const results: SearchResult[] = [];
  const limiter = new Limiter(100);
  const perFileTimeBudgetMs = 2500;

  if (scope === 'file' && filePath) {
    await searchInFileAsync(filePath, regex, results, effectiveMaxResults, perFileTimeBudgetMs);
  } else if (scope === 'directory') {
    const searchPath = (directoryPath || '').trim();
    try {
      if (searchPath) {
        const stat = await fs.promises.stat(searchPath);
        console.log('Directory search path:', searchPath, 'exists: true');
        if (stat.isDirectory()) {
          await searchInDirectory(searchPath, regex, options.fileMask, results, effectiveMaxResults, limiter, perFileTimeBudgetMs);
        } else {
          console.log('Path is a file, searching only in:', searchPath);
          await searchInFileAsync(searchPath, regex, results, effectiveMaxResults, perFileTimeBudgetMs);
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
      await searchInDirectory(modulePath, regex, options.fileMask, results, effectiveMaxResults, limiter, perFileTimeBudgetMs);
    } catch {
      // Module path doesn't exist
    }
  } else {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    console.log('Workspace folders:', workspaceFolders ? workspaceFolders.map(f => f.uri.fsPath) : 'None');
    if (workspaceFolders) {
      const tasks = workspaceFolders.map(folder => {
        if (results.length >= effectiveMaxResults) return Promise.resolve();
        console.log('Searching in folder:', folder.uri.fsPath);
        return searchInDirectory(folder.uri.fsPath, regex, options.fileMask, results, effectiveMaxResults, limiter, perFileTimeBudgetMs);
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
  limiter: Limiter,
  perFileTimeBudgetMs: number
): Promise<void> {
  try {
    const entries = await limiter.run(() => fs.promises.readdir(dirPath, { withFileTypes: true }));
    const tasks: Promise<void>[] = [];
    for (const entry of entries) {
      if (results.length >= maxResults) break;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          tasks.push(searchInDirectory(fullPath, regex, fileMask, results, maxResults, limiter, perFileTimeBudgetMs));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const isBinary = BINARY_EXTENSIONS.has(ext);
        const matchesMask = matchesFileMask(entry.name, fileMask);
        if (!isBinary && matchesMask) {
          tasks.push(limiter.run(() => searchInFileAsync(fullPath, regex, results, maxResults, perFileTimeBudgetMs)));
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
  maxResults: number,
  perFileTimeBudgetMs: number
): Promise<void> {
  try {
    let content: string;
    const openDoc = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === filePath);
    if (openDoc) {
      content = openDoc.getText();
    } else {
      const stats = await fs.promises.stat(filePath);
      if (stats.size > 1024 * 1024) return; // 1MB limit (aligned with tests)
      content = await fs.promises.readFile(filePath, 'utf-8');
    }

    const lines = content.split('\n');
    const fileName = path.basename(filePath);
    let relativePath = fileName;
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      for (const folder of workspaceFolders) {
        const folderPath = folder.uri.fsPath;
        const folderName = path.basename(folderPath);
        const normalizedFilePath = path.normalize(filePath);
        const normalizedFolderPath = path.normalize(folderPath);
        if (normalizedFilePath.startsWith(normalizedFolderPath + path.sep) || normalizedFilePath === normalizedFolderPath) {
          const pathFromFolder = path.relative(normalizedFolderPath, normalizedFilePath);
          relativePath = path.join(folderName, pathFromFolder);
          break;
        }
      }
    }

    const startTime = Date.now();
    for (let lineIndex = 0; lineIndex < lines.length && results.length < maxResults; lineIndex++) {
      if (Date.now() - startTime > perFileTimeBudgetMs) break;
      const line = lines[lineIndex];
      let match: RegExpExecArray | null;
      regex.lastIndex = 0;
      while ((match = regex.exec(line)) !== null) {
        if (results.length >= maxResults) break;
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
        if (match[0].length === 0) regex.lastIndex++;
      }
    }
  } catch {
    // Skip files that can't be read
  }
}

function isSafeRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
  } catch {
    return false;
  }
  const dangerousSequences = [
    /(\([^)]*([*+]{1,})[^)]*\))+[+*]/,
    /([^\\]|^)\d+\s*[*+]{1,}/,
    /\[[^\]]*\][*+]{1,}\s*[?+*]{1,}/
  ];
  for (const seq of dangerousSequences) {
    if (seq.test(pattern)) return false;
  }
  return true;
}
