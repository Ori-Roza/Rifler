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
import { validateDirectoryPath } from './security/pathValidation';
import { filterResultsByCodeContext } from './codeContextFilter';
import { getTelemetryLogger } from './telemetry';

type RootSpec = { fsPath: string; type: vscode.FileType };

function filterResultsToRoots(results: SearchResult[], roots: RootSpec[]): SearchResult[] {
  if (!results.length || !roots.length) return results;

  const rootSpecs = roots.map((r) => ({ root: path.resolve(r.fsPath), type: r.type }));

  const isWithinDir = (filePath: string, dirPath: string): boolean => {
    const rel = path.relative(dirPath, filePath);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };

  const uriToFsPath = (uri: string): string => {
    const trimmed = (uri || '').trim();
    if (!trimmed) return '';

    // Prefer a string-based conversion so this works under Jest's vscode mock
    // (which does not implement URI parsing semantics).
    if (trimmed.startsWith('file://')) {
      let rest = trimmed.slice('file://'.length);
      // Collapse leading slashes to a single slash for POSIX paths.
      rest = rest.replace(/^\/+/, '/');
      // Decode FIRST, then check for Windows drive letter
      try {
        rest = decodeURIComponent(rest);
      } catch {
        // If decoding fails, continue with the original
      }
      // Handle Windows drive letter form: /C:/...
      if (/^\/[A-Za-z]:[\\/]/.test(rest)) {
        rest = rest.slice(1);
      }
      // Normalize path separators for the current platform
      return path.normalize(rest);
    }

    return path.normalize(trimmed);
  };

  return results.filter((r) => {
    try {
      const filePath = path.resolve(uriToFsPath(r.uri));
      return rootSpecs.some(({ root, type }) => {
        if (type === vscode.FileType.File) {
          return filePath === root;
        }
        // Treat unknown roots as directories to avoid accidentally expanding scope.
        return isWithinDir(filePath, root);
      });
    } catch {
      return false;
    }
  });
}

export interface SearchOutcome {
  results: SearchResult[];
  timedOut: boolean;
  cancelled: boolean;
  resultCapHit: boolean;
  profile?: SearchProfile;
}

export interface SearchProfile {
  requestId?: string;
  scope: SearchScope;
  queryLength: number;
  rootCount: number;
  serializedBytes: number;
  resultsBeforeContextFilter: number;
  resultsAfterContextFilter: number;
  durationsMs: {
    resolveRoots: number;
    rgSearch: number;
    rootFilter: number;
    contextFilter: number;
    total: number;
  };
}

const SEARCH_TIMEOUT_MS = 5000;
const DIRECTORY_SCOPE_MIN_QUERY_LENGTH = 3;

function estimateSearchPayloadBytes(results: SearchResult[]): number {
  let bytes = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    bytes += (r.uri?.length || 0) + (r.fileName?.length || 0) + (r.relativePath?.length || 0) + (r.preview?.length || 0);
    bytes += 48;
    if (Array.isArray(r.matchRanges)) {
      bytes += r.matchRanges.length * 16;
    }
    if (Array.isArray(r.previewMatchRanges)) {
      bytes += r.previewMatchRanges.length * 16;
    }
  }
  return bytes;
}

export async function performSearch(
  query: string,
  scope: SearchScope,
  options: SearchOptions,
  directoryPath?: string,
  modulePath?: string,
  maxResults: number = 10000,
  smartExcludesEnabled: boolean = true,
  requestId?: string
): Promise<SearchOutcome> {
  const searchStartedAt = Date.now();
  if (!query.trim() || query.length < 2) {
    return { results: [], timedOut: false, cancelled: false, resultCapHit: false };
  }

  if (scope === 'directory' && query.trim().length < DIRECTORY_SCOPE_MIN_QUERY_LENGTH) {
    return { results: [], timedOut: false, cancelled: false, resultCapHit: false };
  }

  options.multiline = !!options.multiline;

  const regexValidation = validateRegex(query, options.useRegex, !!options.multiline);
  if (!regexValidation.isValid) {
    console.error('Invalid regex:', regexValidation.error);
    return { results: [], timedOut: false, cancelled: false, resultCapHit: false };
  }

  if (options.useRegex && !isSafeRegex(query)) {
    console.warn('Rejected potentially unsafe regex pattern');
    return { results: [], timedOut: false, cancelled: false, resultCapHit: false };
  }

  if (!buildSearchRegex(query, options)) {
    return { results: [], timedOut: false, cancelled: false, resultCapHit: false };
  }

  const maskValidation = validateFileMask(options.fileMask);
  if (!maskValidation.isValid) {
    console.warn('File mask validation failed:', maskValidation.message);
    options.fileMask = '';
  }

  const effectiveMaxResults = Math.max(1, Math.floor(maxResults || 10000));
  const resolveRootsStartedAt = Date.now();
  const rootSpecs = await resolveSearchRoots(scope, directoryPath, modulePath);
  const resolveRootsDurationMs = Date.now() - resolveRootsStartedAt;
  if (rootSpecs.length === 0) {
    return { results: [], timedOut: false, cancelled: false, resultCapHit: false };
  }
  const roots = rootSpecs.map((r) => r.fsPath);

  let timedOut = false;
  let cancelled = false;
  let resultCapHit = false;

  cancelActiveSearch();
  const { promise, cancel } = startRipgrepSearch({
    query,
    options,
    fileMask: options.fileMask,
    roots,
    maxResults: effectiveMaxResults,
    workspaceFolders: vscode.workspace.workspaceFolders,
    smartExcludesEnabled
  });

  const cancelForNewSearch = (): void => {
    cancelled = true;
    cancel();
  };

  activeSearchCancel = cancelForNewSearch;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    cancel();
  }, SEARCH_TIMEOUT_MS);

  try {
    const rgStartedAt = Date.now();
    const rawResults = await promise;
    const rgDurationMs = Date.now() - rgStartedAt;
    clearTimeout(timeoutId);

    const rootFilterStartedAt = Date.now();
    const results = filterResultsToRoots(rawResults, rootSpecs);
    const rootFilterDurationMs = Date.now() - rootFilterStartedAt;

    const contextFilterStartedAt = Date.now();
    const filteredResults = await filterResultsByCodeContext(results, options);
    const contextFilterDurationMs = Date.now() - contextFilterStartedAt;

    resultCapHit = rawResults.length >= effectiveMaxResults;
    if (activeSearchCancel === cancelForNewSearch) {
      activeSearchCancel = undefined;
    }
    const profile: SearchProfile = {
      requestId,
      scope,
      queryLength: query.length,
      rootCount: rootSpecs.length,
      serializedBytes: estimateSearchPayloadBytes(filteredResults),
      resultsBeforeContextFilter: results.length,
      resultsAfterContextFilter: filteredResults.length,
      durationsMs: {
        resolveRoots: resolveRootsDurationMs,
        rgSearch: rgDurationMs,
        rootFilter: rootFilterDurationMs,
        contextFilter: contextFilterDurationMs,
        total: Date.now() - searchStartedAt,
      },
    };
    return { results: filteredResults, timedOut, cancelled, resultCapHit, profile };
  } catch (error) {
    clearTimeout(timeoutId);
    if (activeSearchCancel === cancelForNewSearch) {
      activeSearchCancel = undefined;
    }
    console.error('Error during ripgrep search:', error);
    getTelemetryLogger()?.logError(error instanceof Error ? error : new Error(String(error)), {
      stage: 'ripgrep',
    });
    // Fallback to JS search to preserve behavior (useful for tests or missing rg)
    try {
      const results: SearchResult[] = [];
      const regex = buildSearchRegex(query, options);
      if (!regex) return { results: [], timedOut, cancelled, resultCapHit: false };
      const limiter = new Limiter(100);
      const perFileTimeBudgetMs = 2500;

      for (const spec of rootSpecs) {
        if (spec.type === vscode.FileType.File) {
          await fallbackSearchInFile(spec.fsPath, regex, results, effectiveMaxResults, perFileTimeBudgetMs);
        } else {
          await fallbackSearchInDirectory(spec.fsPath, regex, options.fileMask, results, effectiveMaxResults, limiter, perFileTimeBudgetMs, smartExcludesEnabled);
        }

        if (results.length >= effectiveMaxResults) break;
      }
      const rootFiltered = filterResultsToRoots(results, rootSpecs);
      resultCapHit = results.length >= effectiveMaxResults;
      return {
        results: await filterResultsByCodeContext(rootFiltered, options),
        timedOut,
        cancelled,
        resultCapHit,
      };
    } catch (fallbackError) {
      getTelemetryLogger()?.logError(fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError)), {
        stage: 'fallback',
      });
      return { results: [], timedOut, cancelled, resultCapHit: false };
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
): Promise<RootSpec[]> {
  const roots: RootSpec[] = [];

  const addIfExists = async (fsPath: string | undefined): Promise<void> => {
    if (!fsPath) return;
    try {
      const uri = vscode.Uri.file(fsPath);
      const stat = await vscode.workspace.fs.stat(uri);
      roots.push({ fsPath, type: stat.type });
    } catch {
      // Ignore missing paths
    }
  };

  if (scope === 'directory') {
    const trimmedPath = directoryPath?.trim();
    if (trimmedPath) {
      // Security: Validate directory path to prevent path traversal attacks
      // Only enforce validation if workspace folders exist (skip in tests/edge cases)
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders && workspaceFolders.length > 0) {
        try {
          const safePath = validateDirectoryPath(trimmedPath);
          await addIfExists(safePath);
        } catch (error) {
          console.warn(`[Rifler] Directory path validation failed for "${trimmedPath}", blocking directory scope search:`, error);
        }
      } else {
        // No workspace folders (test mode or edge case) - allow path without validation
        await addIfExists(trimmedPath);
      }
    }
  } else if (scope === 'module') {
    await addIfExists(modulePath?.trim());
  } else {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      for (const folder of workspaceFolders) {
        // Workspace folders are expected to be directories.
        roots.push({ fsPath: folder.uri.fsPath, type: vscode.FileType.Directory });
      }
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return roots
    .filter((r) => !!r.fsPath)
    .filter((r) => {
      if (seen.has(r.fsPath)) return false;
      seen.add(r.fsPath);
      return true;
    });
}

async function fallbackSearchInDirectory(
  dirPath: string,
  regex: RegExp,
  fileMask: string,
  results: SearchResult[],
  maxResults: number,
  limiter: Limiter,
  perFileTimeBudgetMs: number,
  smartExcludesEnabled: boolean = true
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
        const isDotDir = entryName.startsWith('.');
        const shouldExclude = smartExcludesEnabled && (EXCLUDE_DIRS.has(entryName) || isDotDir);
        if (!shouldExclude) {
          tasks.push(fallbackSearchInDirectory(fullPath, regex, fileMask, results, maxResults, limiter, perFileTimeBudgetMs, smartExcludesEnabled));
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
    // Normalize for cross-platform comparison (case-insensitive on Windows)
    const normalizedFileUriString = fileUriString.toLowerCase().replace(/\\/g, '/');
    const openDoc = vscode.workspace.textDocuments.find(doc => {
      const docUriString = doc.uri.toString().toLowerCase().replace(/\\/g, '/');
      return docUriString === normalizedFileUriString;
    });

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
    // Check for nested quantifiers without catastrophic backtracking
    /(\([^)]*[*+][^)]*\))[+*]/,
    /([^\\]|^)\d+\s*[*+]/,
    /\[[^\]]*\][*+]\s*[?+*]/
  ];
  for (const seq of dangerousSequences) {
    if (seq.test(pattern)) return false;
  }
  return true;
}
