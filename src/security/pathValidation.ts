/**
 * Path Validation Security Module
 * 
 * Provides path traversal protection and workspace boundary enforcement
 * to prevent malicious workspaces from accessing files outside the workspace.
 */

import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Security: Check if a path is within the workspace boundary.
 * Prevents path traversal attacks using ../ or absolute paths.
 * 
 * @param targetPath - Path to validate (can be relative or absolute)
 * @returns true if path is within workspace, false otherwise
 */
export function isWithinWorkspace(targetPath: string): boolean {
  const workspaces = vscode.workspace.workspaceFolders;
  if (!workspaces || workspaces.length === 0) {
    return false;
  }
  
  // Resolve and normalize the target path to detect traversal attempts
  const normalized = path.normalize(path.resolve(targetPath));
  
  // Check if the path is within any workspace folder
  return workspaces.some(ws => {
    const wsPath = ws.uri.fsPath;
    const rel = path.relative(wsPath, normalized);
    
    // Path is safe if:
    // 1. Relative path exists (not empty)
    // 2. Doesn't start with .. (not going up)
    // 3. Isn't absolute (contained within workspace)
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  });
}

/**
 * Security: Validate URI is within workspace and uses file:// scheme.
 * Prevents replace operations on files outside workspace or non-file URIs.
 * 
 * @param uri - URI to validate
 * @returns true if URI is safe, false otherwise
 */
export function isUriSafe(uri: vscode.Uri): boolean {
  // Only allow file:// URIs (no http://, data:, etc.)
  if (uri.scheme !== 'file') {
    return false;
  }
  
  const workspaces = vscode.workspace.workspaceFolders;
  if (!workspaces || workspaces.length === 0) {
    return false;
  }
  
  const filePath = uri.fsPath;
  return workspaces.some(ws => {
    const wsPath = ws.uri.fsPath;
    const rel = path.relative(wsPath, filePath);
    
    // Same checks as isWithinWorkspace
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  });
}

/**
 * Security: Validate and sanitize directory path for search scope.
 * Throws error if path attempts to escape workspace.
 * 
 * @param directoryPath - User-provided directory path
 * @returns Sanitized absolute path within workspace
 * @throws Error if path is outside workspace or invalid
 */
export function validateDirectoryPath(directoryPath: string): string {
  if (!directoryPath || directoryPath.trim().length === 0) {
    throw new Error('Directory path cannot be empty');
  }
  
  const trimmed = directoryPath.trim();
  
  // Reject obvious traversal attempts before path resolution
  if (trimmed.includes('../') || trimmed.includes('..\\')) {
    throw new Error('Directory path contains path traversal (..)');
  }
  
  // Resolve path and check workspace boundary
  if (!isWithinWorkspace(trimmed)) {
    throw new Error('Directory path must be within workspace. Attempted path traversal detected.');
  }
  
  // Return normalized absolute path
  return path.normalize(path.resolve(trimmed));
}

/**
 * Security: Get list of workspace root paths for validation.
 * Useful for validating that search/replace operations stay within bounds.
 * 
 * @returns Array of workspace root paths (absolute, normalized)
 */
export function getWorkspaceRoots(): string[] {
  const workspaces = vscode.workspace.workspaceFolders;
  if (!workspaces) {
    return [];
  }
  
  return workspaces.map(ws => path.normalize(ws.uri.fsPath));
}

/**
 * Security: Check if a URI matches any workspace folder.
 * More lenient than isUriSafe - only checks scheme and workspace membership.
 * 
 * @param uriString - URI string to parse and validate
 * @returns true if URI is valid and in workspace
 */
export function validateUriString(uriString: string): boolean {
  if (!uriString || typeof uriString !== 'string') {
    return false;
  }
  
  try {
    const uri = vscode.Uri.parse(uriString);
    return isUriSafe(uri);
  } catch {
    return false;
  }
}
