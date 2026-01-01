import * as vscode from 'vscode';
import * as path from 'path';
import {
  SearchOptions,
  SearchResult,
  SearchScope,
  buildSearchRegex,
  validateRegex,
  validateFileMask,
  matchesFileMask,
  searchInContent,
  EXCLUDE_DIRS,
  BINARY_EXTENSIONS,
  Limiter
} from './utils';
import { startRipgrepSearch } from './rgSearch';

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

  if (!buildSearchRegex(query, options)) {
    return [];
  }

  const maskValidation = validateFileMask(options.fileMask);
  if (!maskValidation.isValid) {
    console.warn('File mask validation failed:', maskValidation.message);
    options.fileMask = '';
  }

  const effectiveMaxResults = Math.max(1, Math.floor(maxResults || 10000));
  const roots = await resolveSearchRoots(scope, directoryPath, modulePath);
  if (roots.length === 0) {
    return [];
  }

  cancelActiveSearch();
  const { promise, cancel } = startRipgrepSearch({
    query,
    options,
    fileMask: options.fileMask,
    roots,
    maxResults: effectiveMaxResults,
    workspaceFolders: vscode.workspace.workspaceFolders
  });

  activeSearchCancel = cancel;

  try {
    const results = await promise;
    if (activeSearchCancel === cancel) {
      activeSearchCancel = undefined;
    }
    return results;
  } catch (error) {
    if (activeSearchCancel === cancel) {
      activeSearchCancel = undefined;
    }
    console.error('Error during ripgrep search:', error);
    // Fallback to JS search to preserve behavior (useful for tests or missing rg)
    try {
      const results: SearchResult[] = [];
      const regex = buildSearchRegex(query, options);
      if (!regex) return [];
      const limiter = new Limiter(100);
      const perFileTimeBudgetMs = 2500;

      for (const root of roots) {
        // In legacy behavior, project scope roots were treated as directories without stat
        const treatAsDirectory = scope === 'project';
        let stat: vscode.FileStat | undefined;

        if (!treatAsDirectory) {
          try {
            stat = await vscode.workspace.fs.stat(vscode.Uri.file(root));
          } catch {
            stat = undefined; // default to directory traversal
          }
        }

        if (treatAsDirectory || !stat || stat.type === vscode.FileType.Directory) {
          await fallbackSearchInDirectory(root, regex, options.fileMask, results, effectiveMaxResults, limiter, perFileTimeBudgetMs);
        } else if (stat.type === vscode.FileType.File) {
          await fallbackSearchInFile(root, regex, results, effectiveMaxResults, perFileTimeBudgetMs);
        }

        if (results.length >= effectiveMaxResults) break;
      }
      return results;
    } catch {
      return [];
    }
  }
}

let activeSearchCancel: (() => void) | undefined;

function cancelActiveSearch(): void {
  if (activeSearchCancel) {
    activeSearchCancel();
    activeSearchCancel = undefined;
  }
}

async function resolveSearchRoots(
  scope: SearchScope,
  directoryPath?: string,
  modulePath?: string
): Promise<string[]> {
  const roots: string[] = [];

  const addIfExists = async (fsPath: string | undefined): Promise<void> => {
    if (!fsPath) return;
    try {
      const uri = vscode.Uri.file(fsPath);
      const stat = await vscode.workspace.fs.stat(uri);
      roots.push(fsPath);
      if (stat.type === vscode.FileType.File) {
        // For files, ensure we only search that file path
        return;
      }
    } catch {
      // Ignore missing paths
    }
  };

  if (scope === 'directory') {
    await addIfExists(directoryPath?.trim());
  } else if (scope === 'module') {
    await addIfExists(modulePath?.trim());
  } else {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      for (const folder of workspaceFolders) {
        roots.push(folder.uri.fsPath);
      }
    }
  }

  // Deduplicate
  return Array.from(new Set(roots.filter(Boolean)));
}

async function fallbackSearchInDirectory(
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
          tasks.push(fallbackSearchInDirectory(fullPath, regex, fileMask, results, maxResults, limiter, perFileTimeBudgetMs));
        }
      } else if (entryType === vscode.FileType.File) {
        const ext = path.extname(entryName).toLowerCase();
        const isBinary = BINARY_EXTENSIONS.has(ext);
        const matchesMask = matchesFileMask(entryName, fileMask);
        if (!isBinary && matchesMask) {
          tasks.push(limiter.run(() => fallbackSearchInFile(fullPath, regex, results, maxResults, perFileTimeBudgetMs)));
        }
      }
    }
    await Promise.all(tasks);
  } catch (error) {
    const isNotFound = (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') ||
      (error instanceof Error && (error as { code?: string }).code === 'ENOENT');
    if (isNotFound) return;
    console.error(`Error reading directory: ${dirPath}`, error);
  }
}

async function fallbackSearchInFile(
  filePath: string,
  regex: RegExp,
  results: SearchResult[],
  maxResults: number,
  _perFileTimeBudgetMs: number
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
      if (stats.size > 1024 * 1024) return; // 1MB limit
      const contentBytes = await vscode.workspace.fs.readFile(fileUri);
      content = new TextDecoder('utf-8').decode(contentBytes);
    }

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
