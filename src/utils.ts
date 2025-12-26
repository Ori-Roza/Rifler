import * as path from 'path';
import * as vscode from 'vscode';

// ============================================================================
// Types
// ============================================================================

export interface SearchOptions {
  matchCase: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  fileMask: string;
}

export interface SearchResult {
  uri: string;
  fileName: string;
  relativePath: string;
  line: number;
  character: number;
  length: number;
  preview: string;
  previewMatchRange: {
    start: number;
    end: number;
  };
}

/** Scope options for search */
export type SearchScope = 'project' | 'directory' | 'module';

// ============================================================================
// Search Utilities
// ============================================================================

/**
 * Build a search regex from a query string and options
 */
export function buildSearchRegex(query: string, options: SearchOptions): RegExp | null {
  try {
    let pattern: string;
    
    if (options.useRegex) {
      pattern = query;
    } else {
      // Escape special regex characters
      pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    
    if (options.wholeWord) {
      pattern = `\\b${pattern}\\b`;
    }
    
    const flags = options.matchCase ? 'g' : 'gi';
    return new RegExp(pattern, flags);
  } catch {
    // Invalid regex
    return null;
  }
}

/**
 * Check if a filename matches a file mask pattern
 */
export function matchesFileMask(fileName: string, fileMask: string): boolean {
  const trimmed = fileMask.trim();
  if (!trimmed) return true;

  // Split on comma/semicolon, support include and exclude masks (leading !)
  const tokens = trimmed.split(/[,;]/).map(m => m.trim()).filter(Boolean);
  if (tokens.length === 0) return true;

  const includes: RegExp[] = [];
  const excludes: RegExp[] = [];

  for (const token of tokens) {
    const isExclude = token.startsWith('!');
    const pattern = isExclude ? token.slice(1).trim() : token;
    if (!pattern) continue;

    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special chars except * and ?
      .replace(/\*/g, '.*')                   // * matches any characters
      .replace(/\?/g, '.');                   // ? matches a single character

    const regex = new RegExp(`^${regexPattern}$`, 'i');
    if (isExclude) {
      excludes.push(regex);
    } else {
      includes.push(regex);
    }
  }

  const matchesInclude = includes.length === 0 || includes.some(r => r.test(fileName));
  const matchesExclude = excludes.some(r => r.test(fileName));

  return matchesInclude && !matchesExclude; // Excludes always win
}

/** * Find modules in the workspace (directories with package.json, tsconfig.json, etc.)
 */
export async function findWorkspaceModules(): Promise<{ name: string; path: string }[]> {
  const modules: { name: string; path: string }[] = [];
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (!workspaceFolders) {
    return modules;
  }

  // Module detection patterns - files that indicate a module/project
  const moduleIndicators = [
    'package.json',
    'tsconfig.json',
    'pyproject.toml',
    'setup.py',
    'Cargo.toml',
    'go.mod',
    'composer.json',
    'Gemfile',
    'requirements.txt',
    '.git'
  ];

  for (const folder of workspaceFolders) {
    try {
      // First check if the workspace root itself is a module
      const hasModuleIndicators = await checkForModuleIndicators(folder.uri, moduleIndicators);
      if (hasModuleIndicators) {
        modules.push({
          name: folder.name,
          path: folder.uri.fsPath
        });
      }

      // Then check subdirectories for modules
      await findModulesInDirectory(folder.uri, modules, moduleIndicators, 2); // Max depth of 2
    } catch (error) {
      console.error('Error finding modules in workspace:', error);
    }
  }

  return modules;
}

/**
 * Recursively find modules in a directory
 */
async function findModulesInDirectory(
  dirUri: vscode.Uri,
  modules: { name: string; path: string }[],
  moduleIndicators: string[],
  maxDepth: number,
  currentDepth = 0
): Promise<void> {
  if (currentDepth >= maxDepth) {
    return;
  }

  try {
    const entries = await vscode.workspace.fs.readDirectory(dirUri);

    for (const [name, type] of entries) {
      if (type === vscode.FileType.Directory &&
          !name.startsWith('.') &&
          !EXCLUDE_DIRS.has(name)) {

        const subDirUri = vscode.Uri.joinPath(dirUri, name);

        // Check if this subdirectory is a module
        const hasModuleIndicators = await checkForModuleIndicators(subDirUri, moduleIndicators);
        if (hasModuleIndicators) {
          modules.push({
            name,
            path: subDirUri.fsPath
          });
        } else if (currentDepth < maxDepth - 1) {
          // Continue searching deeper, but avoid going too deep
          await findModulesInDirectory(subDirUri, modules, moduleIndicators, maxDepth, currentDepth + 1);
        }
      }
    }
  } catch (error) {
    // Directory might not be accessible, skip it
  }
}

/**
 * Check if a directory contains module indicator files
 */
async function checkForModuleIndicators(dirUri: vscode.Uri, indicators: string[]): Promise<boolean> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(dirUri);

    for (const [name] of entries) {
      if (indicators.includes(name)) {
        return true;
      }
    }
  } catch {
    // Directory not accessible
  }

  return false;
}

/** * Set of directories to exclude from search
 */
export const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'out', '__pycache__', '.venv', 'venv',
  '.idea', '.vscode', 'coverage', '.nyc_output', 'build', '.next',
  '.nuxt', '.cache', 'tmp', 'temp', '.pytest_cache', '.tox'
]);

/**
 * Set of binary file extensions to skip
 */
export const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz',
  '.exe', '.dll', '.so', '.dylib', '.woff', '.woff2', '.ttf', '.eot',
  '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.svg',
  '.lock', '.bin', '.dat', '.db', '.sqlite', '.sqlite3'
]);

/**
 * Check if a directory should be excluded from search
 */
export function shouldExcludeDirectory(dirName: string): boolean {
  return EXCLUDE_DIRS.has(dirName) || dirName.startsWith('.');
}

/**
 * Check if a file extension is binary
 */
export function isBinaryExtension(ext: string): boolean {
  return BINARY_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * Search for matches in file content
 */
export function searchInContent(
  content: string,
  regex: RegExp,
  filePath: string,
  maxResults: number = 5000
): SearchResult[] {
  const results: SearchResult[] = [];
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
        uri: `file://${filePath}`,
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

  return results;
}

/**
 * Collect files recursively from a directory
 */
export async function collectFiles(
  dirPath: string,
  fileMask: string = '',
  maxFiles: number = 10000
): Promise<string[]> {
  const files: string[] = [];
  
  async function walk(currentPath: string): Promise<void> {
    if (files.length >= maxFiles) return;
    
    try {
      const uri = vscode.Uri.file(currentPath);
      const entries = await vscode.workspace.fs.readDirectory(uri);
      
      for (const entry of entries) {
        if (files.length >= maxFiles) break;
        
        const [entryName, entryType] = entry;
        const fullPath = path.join(currentPath, entryName);
        
        if (entryType === vscode.FileType.Directory) {
          if (!shouldExcludeDirectory(entryName)) {
            await walk(fullPath);
          }
        } else if (entryType === vscode.FileType.File) {
          const ext = path.extname(entryName).toLowerCase();
          if (!isBinaryExtension(ext) && matchesFileMask(entryName, fileMask)) {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }
  
  await walk(dirPath);
  return files;
}

/**
 * Simple concurrency limiter
 */
export class Limiter {
  private active = 0;
  private queue: (() => void)[] = [];
  
  constructor(private max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>(resolve => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      if (this.queue.length > 0) {
        this.queue.shift()!();
      }
    }
  }
}

/**
 * Escape HTML special characters
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Escape attribute special characters
 */
export function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Result of validation operations
 */
export interface ValidationResult {
  isValid: boolean;
  error?: string;  // Error message for invalid input
}

export interface MaskValidationResult {
  isValid: boolean;
  message?: string;  // Warning or info message
  fallbackToAll: boolean;  // If true, mask will match all files
}

/**
 * Validate a regex pattern string
 * @param pattern The pattern to validate
 * @param useRegex Whether regex mode is enabled
 * @returns ValidationResult with error details if invalid
 */
export function validateRegex(pattern: string, useRegex: boolean): ValidationResult {
  if (!pattern || pattern.length === 0) {
    return { isValid: false, error: 'Search pattern cannot be empty' };
  }

  if (!useRegex) {
    // In non-regex mode, any pattern is valid (we escape special chars)
    return { isValid: true };
  }

  // In regex mode, try to compile the pattern
  try {
    new RegExp(pattern, 'g');
    return { isValid: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid regex pattern';
    return {
      isValid: false,
      error: `Invalid regex: ${message}`
    };
  }
}

/**
 * Validate a file mask pattern
 * @param fileMask The file mask to validate
 * @returns MaskValidationResult with warning if fallback behavior triggered
 */
export function validateFileMask(fileMask: string): MaskValidationResult {
  const trimmed = fileMask.trim();
  
  // Empty mask is valid - matches all files
  if (!trimmed) {
    return { isValid: true, fallbackToAll: false };
  }

  try {
    // Try to parse and compile the mask patterns
    const tokens = trimmed.split(/[,;]/).map(m => m.trim()).filter(Boolean);
    
    if (tokens.length === 0) {
      return { isValid: true, fallbackToAll: false };
    }

    for (const token of tokens) {
      const isExclude = token.startsWith('!');
      const pattern = isExclude ? token.slice(1).trim() : token;
      
      if (!pattern) continue;

      // Build the regex pattern (same logic as matchesFileMask)
      const regexPattern = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');

      // Test regex compilation
      new RegExp(`^${regexPattern}$`, 'i');
    }

    return { isValid: true, fallbackToAll: false };
  } catch (error) {
    // If there's an error, we can still fall back to match-all
    const message = error instanceof Error ? error.message : 'Invalid file mask pattern';
    return {
      isValid: false,
      message: `Invalid file mask (falling back to match all): ${message}`,
      fallbackToAll: true
    };
  }
}

/**
 * Quick check if regex pattern is valid
 */
export function isValidRegexPattern(pattern: string): boolean {
  if (!pattern) return false;
  try {
    new RegExp(pattern, 'g');
    return true;
  } catch {
    return false;
  }
}
