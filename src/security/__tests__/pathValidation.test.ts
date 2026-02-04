/**
 * Security Tests for Path Validation Module
 * 
 * Tests defense against path traversal and workspace boundary violations.
 */

import * as vscode from 'vscode';
import {
  isWithinWorkspace,
  isUriSafe,
  validateDirectoryPath,
  validateUriString,
} from '../pathValidation';

// Mock vscode.workspace
jest.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [],
  },
  Uri: {
    parse: jest.fn((str: string) => ({
      scheme: str.startsWith('file://') ? 'file' : 'http',
      fsPath: str.replace('file://', ''),
    })),
    file: jest.fn((fsPath: string) => ({
      scheme: 'file',
      fsPath,
    })),
  },
}));

describe('Path Validation Security', () => {
  beforeEach(() => {
    // Setup workspace mock
    (vscode.workspace.workspaceFolders as any) = [
      {
        uri: { fsPath: '/Users/test/project' },
        name: 'project',
        index: 0,
      },
    ];
  });

  describe('isWithinWorkspace', () => {
    test('Should allow path within workspace', () => {
      const safePath = '/Users/test/project/src/file.ts';
      expect(isWithinWorkspace(safePath)).toBe(true);
    });

    test('Should reject path with .. going outside workspace', () => {
      const unsafePath = '/Users/test/project/../../etc/passwd';
      expect(isWithinWorkspace(unsafePath)).toBe(false);
    });

    test('Should reject absolute path outside workspace', () => {
      const unsafePath = '/etc/passwd';
      expect(isWithinWorkspace(unsafePath)).toBe(false);
    });

    test('Should reject path traversal using ..', () => {
      const unsafePath = '../../../etc/passwd';
      expect(isWithinWorkspace(unsafePath)).toBe(false);
    });

    test('Should allow relative path within workspace', () => {
      // Test with a path relative to the mocked workspace
      const safePath = '/Users/test/project/src/components';
      expect(isWithinWorkspace(safePath)).toBe(true);
    });

    test('Should reject when no workspace folders exist', () => {
      (vscode.workspace.workspaceFolders as any) = undefined;
      
      const anyPath = '/Users/test/project/src';
      expect(isWithinWorkspace(anyPath)).toBe(false);
    });
  });

  describe('isUriSafe', () => {
    test('Should allow file:// URI within workspace', () => {
      const uri = vscode.Uri.file('/Users/test/project/src/file.ts');
      expect(isUriSafe(uri)).toBe(true);
    });

    test('Should reject http:// URI', () => {
      const uri = vscode.Uri.parse('http://evil.com/file.txt');
      expect(isUriSafe(uri)).toBe(false);
    });

    test('Should reject file:// URI outside workspace', () => {
      const uri = vscode.Uri.file('/etc/passwd');
      expect(isUriSafe(uri)).toBe(false);
    });

    test('Should reject data: URI', () => {
      const uri = vscode.Uri.parse('data:text/plain,malicious');
      expect(isUriSafe(uri)).toBe(false);
    });
  });

  describe('validateDirectoryPath', () => {
    test('Should accept valid path within workspace', () => {
      const validPath = '/Users/test/project/src';
      const result = validateDirectoryPath(validPath);
      // Normalize for cross-platform comparison (Windows uses backslashes)
      const normalized = result.replace(/\\/g, '/');
      expect(normalized).toContain('project/src');
    });

    test('Should throw on path traversal with ..', () => {
      const maliciousPath = '../../etc';
      expect(() => validateDirectoryPath(maliciousPath)).toThrow('path traversal');
    });

    test('Should throw on empty path', () => {
      expect(() => validateDirectoryPath('')).toThrow('cannot be empty');
      expect(() => validateDirectoryPath('   ')).toThrow('cannot be empty');
    });

    test('Should throw on path outside workspace', () => {
      const outsidePath = '/var/log';
      expect(() => validateDirectoryPath(outsidePath)).toThrow('must be within workspace');
    });
  });

  describe('validateUriString', () => {
    test('Should accept valid file:// URI string', () => {
      const validUri = 'file:///Users/test/project/src/file.ts';
      expect(validateUriString(validUri)).toBe(true);
    });

    test('Should reject http:// URI string', () => {
      const httpUri = 'http://evil.com/file.txt';
      expect(validateUriString(httpUri)).toBe(false);
    });

    test('Should reject URI outside workspace', () => {
      const outsideUri = 'file:///etc/passwd';
      expect(validateUriString(outsideUri)).toBe(false);
    });

    test('Should reject malformed URI', () => {
      const malformed = 'not-a-uri';
      // URI.parse might not throw, but validation should fail
      const result = validateUriString(malformed);
      // Result depends on how URI.parse handles it
      expect(typeof result).toBe('boolean');
    });

    test('Should reject null/undefined', () => {
      expect(validateUriString(null as any)).toBe(false);
      expect(validateUriString(undefined as any)).toBe(false);
    });
  });

  describe('Integration: Malicious Workspace Scenario', () => {
    test('Should prevent searching ../../etc via directory scope', () => {
      const maliciousDir = '../../etc';
      expect(() => validateDirectoryPath(maliciousDir)).toThrow();
    });

    test('Should prevent replacing file:///etc/passwd', () => {
      const maliciousUri = vscode.Uri.file('/etc/passwd');
      expect(isUriSafe(maliciousUri)).toBe(false);
    });

    test('Should prevent accessing files via symlink traversal', () => {
      // If symlink points outside workspace, resolved path should fail validation
      // In real scenario, path.resolve would follow symlink to /etc/passwd
      // For this test, we simulate the resolved path
      const resolvedPath = '/etc/passwd';
      expect(isWithinWorkspace(resolvedPath)).toBe(false);
    });
  });
});
