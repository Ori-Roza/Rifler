import * as vscode from 'vscode';
import * as path from 'path';
import {
  SearchOptions,
  SearchResult,
  SearchScope,
  buildSearchRegex,
  matchesFileMask,
  searchInContent,
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
  maxResults: number = 10000
): Promise<SearchResult[]> {
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

  if (scope === 'directory') {
    const searchPath = (directoryPath || '').trim();
    try {
      if (searchPath) {
        const uri = vscode.Uri.file(searchPath);
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type === vscode.FileType.Directory) {
          await searchInDirectory(searchPath, regex, options.fileMask, results, effectiveMaxResults, limiter, perFileTimeBudgetMs);
        } else {
          await searchInFileAsync(searchPath, regex, results, effectiveMaxResults, perFileTimeBudgetMs);
        }
      }
    } catch (error) {
      // Directory does not exist or cannot be accessed
    }
  } else if (scope === 'module' && modulePath) {
    try {
      const uri = vscode.Uri.file(modulePath);
      await vscode.workspace.fs.stat(uri);
      await searchInDirectory(modulePath, regex, options.fileMask, results, effectiveMaxResults, limiter, perFileTimeBudgetMs);
    } catch {
      // Module path doesn't exist
    }
  } else {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      const tasks = workspaceFolders.map(folder => {
        if (results.length >= effectiveMaxResults) return Promise.resolve();
        return searchInDirectory(folder.uri.fsPath, regex, options.fileMask, results, effectiveMaxResults, limiter, perFileTimeBudgetMs);
      });
      await Promise.all(tasks);
    }
  }

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
    const uri = vscode.Uri.file(dirPath);
    const entries = await limiter.run(() => Promise.resolve(vscode.workspace.fs.readDirectory(uri)));
    const tasks: Promise<void>[] = [];
    for (const entry of entries) {
      if (results.length >= maxResults) break;
      const [entryName, entryType] = entry;
      const fullPath = path.join(dirPath, entryName);
      if (entryType === vscode.FileType.Directory) {
        if (!EXCLUDE_DIRS.has(entryName) && !entryName.startsWith('.')) {
          tasks.push(searchInDirectory(fullPath, regex, fileMask, results, maxResults, limiter, perFileTimeBudgetMs));
        }
      } else if (entryType === vscode.FileType.File) {
        const ext = path.extname(entryName).toLowerCase();
        const isBinary = BINARY_EXTENSIONS.has(ext);
        const matchesMask = matchesFileMask(entryName, fileMask);
        if (!isBinary && matchesMask) {
          tasks.push(limiter.run(() => searchInFileAsync(fullPath, regex, results, maxResults, perFileTimeBudgetMs)));
        }
      }
    }
    await Promise.all(tasks);
  } catch (error) {
    // Only log if it's not a "not found" error, which can happen during tests
    // when workspace folders are added/removed rapidly.
    const isNotFound = (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') ||
                      (error instanceof Error && (error as { code?: string }).code === 'ENOENT');
    
    if (isNotFound) {
      // Ignore
    } else {
      console.error(`Error reading directory: ${dirPath}`, error);
    }
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
    const fileUri = vscode.Uri.file(filePath);
    const fileUriString = fileUri.toString();
    const openDoc = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === fileUriString);
    
    if (openDoc) {
      content = openDoc.getText();
    } else {
      const stats = await vscode.workspace.fs.stat(fileUri);
      if (stats.size > 1024 * 1024) return; // 1MB limit (aligned with tests)
      const contentBytes = await vscode.workspace.fs.readFile(fileUri);
      content = new TextDecoder('utf-8').decode(contentBytes);
    }

    const lines = content.split('\n');
    const fileName = path.basename(filePath);
    let relativePath = fileName;
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      for (const folder of workspaceFolders) {
        const folderPath = folder.uri.fsPath;
        const normalizedFilePath = path.normalize(filePath);
        const normalizedFolderPath = path.normalize(folderPath);
        if (normalizedFilePath.startsWith(normalizedFolderPath + path.sep) || normalizedFilePath === normalizedFolderPath) {
          relativePath = path.relative(normalizedFolderPath, normalizedFilePath);
          break;
        }
      }
    }

    const fileResults = searchInContent(content, regex, filePath, maxResults - results.length, relativePath);
    results.push(...fileResults);
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
