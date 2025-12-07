import * as path from 'path';
import * as fs from 'fs';

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
export type SearchScope = 'project' | 'directory' | 'module' | 'file';

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
  if (!fileMask.trim()) return true;
  
  // Support multiple masks separated by comma or semicolon
  const masks = fileMask.split(/[,;]/).map(m => m.trim()).filter(m => m);
  if (masks.length === 0) return true;
  
  return masks.some(mask => {
    // Convert glob pattern to regex
    const regexPattern = mask
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape special chars except * and ?
      .replace(/\*/g, '.*')                    // * matches any characters
      .replace(/\?/g, '.');                    // ? matches single character
    
    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(fileName);
  });
}

/**
 * Set of directories to exclude from search
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
export function collectFiles(
  dirPath: string,
  fileMask: string = '',
  maxFiles: number = 10000
): string[] {
  const files: string[] = [];
  
  function walk(currentPath: string): void {
    if (files.length >= maxFiles) return;
    
    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (files.length >= maxFiles) break;
        
        const fullPath = path.join(currentPath, entry.name);
        
        if (entry.isDirectory()) {
          if (!shouldExcludeDirectory(entry.name)) {
            walk(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (!isBinaryExtension(ext) && matchesFileMask(entry.name, fileMask)) {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }
  
  walk(dirPath);
  return files;
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
