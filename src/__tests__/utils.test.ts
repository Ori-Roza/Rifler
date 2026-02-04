import * as vscode from 'vscode';
import {
  buildSearchRegex,
  matchesFileMask,
  shouldExcludeDirectory,
  isBinaryExtension,
  searchInContent,
  escapeHtml,
  escapeAttr,
  collectFiles,
  validateRegex,
  validateFileMask,
  isValidRegexPattern,
  EXCLUDE_DIRS,
  BINARY_EXTENSIONS,
  SearchOptions
} from '../utils';

// Mock vscode
jest.mock('vscode');

const mockWorkspaceFs = vscode.workspace.fs as jest.Mocked<typeof vscode.workspace.fs>;

describe('buildSearchRegex', () => {
  const defaultOptions: SearchOptions = {
    matchCase: false,
    wholeWord: false,
    useRegex: false,
    fileMask: ''
  };

  test('should create case-insensitive regex by default', () => {
    const regex = buildSearchRegex('test', defaultOptions);
    expect(regex).not.toBeNull();
    expect(regex!.flags).toContain('i');
    expect('TEST'.match(regex!)).toBeTruthy();
    expect('test'.match(regex!)).toBeTruthy();
  });

  test('should create case-sensitive regex when matchCase is true', () => {
    const options = { ...defaultOptions, matchCase: true };
    const regex = buildSearchRegex('Test', options);
    expect(regex).not.toBeNull();
    expect(regex!.flags).not.toContain('i');
    expect('Test'.match(regex!)).toBeTruthy();
    expect('test'.match(regex!)).toBeFalsy();
  });

  test('should match whole words when wholeWord is true', () => {
    const options = { ...defaultOptions, wholeWord: true };
    const regex = buildSearchRegex('test', options);
    expect(regex).not.toBeNull();
    expect('test'.match(regex!)).toBeTruthy();
    expect('testing'.match(regex!)).toBeFalsy();
    expect('a test here'.match(regex!)).toBeTruthy();
  });

  test('should escape special characters in non-regex mode', () => {
    const regex = buildSearchRegex('test.file', defaultOptions);
    expect(regex).not.toBeNull();
    expect('test.file'.match(regex!)).toBeTruthy();
    expect('testXfile'.match(regex!)).toBeFalsy();
  });

  test('should use raw regex when useRegex is true', () => {
    const options = { ...defaultOptions, useRegex: true };
    const regex = buildSearchRegex('test.*file', options);
    expect(regex).not.toBeNull();
    expect('test.file'.match(regex!)).toBeTruthy();
    expect('testXYZfile'.match(regex!)).toBeTruthy();
  });

  test('should return null for invalid regex', () => {
    const options = { ...defaultOptions, useRegex: true };
    const regex = buildSearchRegex('[invalid', options);
    expect(regex).toBeNull();
  });

  test('should handle empty query', () => {
    const regex = buildSearchRegex('', defaultOptions);
    expect(regex).not.toBeNull();
  });

  test('should include multiline flag when multiline is enabled (but not dotall)', () => {
    const options = { ...defaultOptions, useRegex: true, multiline: true } as SearchOptions;
    const regex = buildSearchRegex('foo.bar', options);
    expect(regex).not.toBeNull();
    expect(regex!.flags).toContain('m');
    // 's' flag (dotall) should NOT be included - users expect '.' to not match newlines by default
    expect(regex!.flags).not.toContain('s');
    // '.' should not match newline without 's' flag
    expect('foo\nbar'.match(regex!)).toBeFalsy();
    // But it should match when there's no newline
    expect('foo_bar'.match(regex!)).toBeTruthy();
  });
});

describe('matchesFileMask', () => {
  test('should match all files when mask is empty', () => {
    expect(matchesFileMask('test.ts', '')).toBe(true);
    expect(matchesFileMask('test.js', '  ')).toBe(true);
  });

  test('should match exact extension patterns', () => {
    expect(matchesFileMask('test.ts', '*.ts')).toBe(true);
    expect(matchesFileMask('test.js', '*.ts')).toBe(false);
  });

  test('should match multiple patterns separated by comma', () => {
    expect(matchesFileMask('test.ts', '*.ts, *.js')).toBe(true);
    expect(matchesFileMask('test.js', '*.ts, *.js')).toBe(true);
    expect(matchesFileMask('test.py', '*.ts, *.js')).toBe(false);
  });

  test('should match multiple patterns separated by semicolon', () => {
    expect(matchesFileMask('test.ts', '*.ts; *.js')).toBe(true);
    expect(matchesFileMask('test.js', '*.ts; *.js')).toBe(true);
  });

  test('should handle wildcard in filename', () => {
    expect(matchesFileMask('test.spec.ts', '*.spec.ts')).toBe(true);
    expect(matchesFileMask('test.ts', '*.spec.ts')).toBe(false);
  });

  test('should handle single character wildcard', () => {
    expect(matchesFileMask('test1.ts', 'test?.ts')).toBe(true);
    expect(matchesFileMask('test12.ts', 'test?.ts')).toBe(false);
  });

  test('should be case-insensitive', () => {
    expect(matchesFileMask('TEST.TS', '*.ts')).toBe(true);
    expect(matchesFileMask('test.TS', '*.ts')).toBe(true);
  });

  test('should support exclude-only masks', () => {
    expect(matchesFileMask('notes.txt', '!*.txt')).toBe(false);
    expect(matchesFileMask('code.ts', '!*.txt')).toBe(true);
  });

  test('should handle include masks requiring a match when includes are present', () => {
    expect(matchesFileMask('file.ts', '*.ts,*.js')).toBe(true);
    expect(matchesFileMask('file.css', '*.ts,*.js')).toBe(false);
  });

  test('should support include and exclude masks with exclude winning', () => {
    expect(matchesFileMask('component.test.tsx', '*.tsx,!*.test.tsx')).toBe(false);
    expect(matchesFileMask('component.stories.tsx', '*.tsx,!*.stories.tsx')).toBe(false);
    expect(matchesFileMask('component.tsx', '*.tsx,!*.test.tsx,!*.stories.tsx')).toBe(true);
  });

  test('should support semicolon separated include/exclude masks', () => {
    expect(matchesFileMask('component.test.tsx', '*.tsx;!*.test.tsx')).toBe(false);
    expect(matchesFileMask('component.tsx', '*.tsx;!*.test.tsx')).toBe(true);
  });

  test('should match any file when includes are empty and only excludes provided', () => {
    expect(matchesFileMask('readme.md', '!*.txt')).toBe(true);
  });

  test('should handle substring wildcards', () => {
    expect(matchesFileMask('my_test_file.ts', '*test*')).toBe(true);
    expect(matchesFileMask('my_prod_file.ts', '*test*')).toBe(false);
  });

  test('should trim whitespace around exclude tokens', () => {
    expect(matchesFileMask('types.d.ts', '*.ts, !*.d.ts')).toBe(false);
    expect(matchesFileMask('index.ts', '*.ts, !*.d.ts')).toBe(true);
  });
});

describe('shouldExcludeDirectory', () => {
  test('should exclude common directories', () => {
    expect(shouldExcludeDirectory('node_modules')).toBe(true);
    expect(shouldExcludeDirectory('.git')).toBe(true);
    expect(shouldExcludeDirectory('dist')).toBe(true);
    expect(shouldExcludeDirectory('__pycache__')).toBe(true);
  });

  test('should exclude hidden directories', () => {
    expect(shouldExcludeDirectory('.hidden')).toBe(true);
    expect(shouldExcludeDirectory('.config')).toBe(true);
  });

  test('should not exclude normal directories', () => {
    expect(shouldExcludeDirectory('src')).toBe(false);
    expect(shouldExcludeDirectory('lib')).toBe(false);
    expect(shouldExcludeDirectory('tests')).toBe(false);
  });
});

describe('isBinaryExtension', () => {
  test('should identify binary extensions', () => {
    expect(isBinaryExtension('.png')).toBe(true);
    expect(isBinaryExtension('.jpg')).toBe(true);
    expect(isBinaryExtension('.exe')).toBe(true);
    expect(isBinaryExtension('.pdf')).toBe(true);
  });

  test('should not flag text extensions', () => {
    expect(isBinaryExtension('.ts')).toBe(false);
    expect(isBinaryExtension('.js')).toBe(false);
    expect(isBinaryExtension('.py')).toBe(false);
    expect(isBinaryExtension('.md')).toBe(false);
  });

  test('should be case-insensitive', () => {
    expect(isBinaryExtension('.PNG')).toBe(true);
    expect(isBinaryExtension('.Jpg')).toBe(true);
  });
});

describe('searchInContent', () => {
  test('should find simple matches', () => {
    const content = 'line one\nline two has test\nline three';
    const regex = /test/gi;
    const results = searchInContent(content, regex, '/path/to/file.ts');
    
    expect(results).toHaveLength(1);
    expect(results[0].line).toBe(1);
    expect(results[0].preview).toBe('line two has test');
  });

  test('should find multiple matches on same line', () => {
    const content = 'test one test two test three';
    const regex = /test/gi;
    const results = searchInContent(content, regex, '/path/to/file.ts');
    
    expect(results).toHaveLength(1);
    expect(results[0].previewMatchRanges).toHaveLength(3);
  });

  test('should find matches across multiple lines', () => {
    const content = 'test line one\nno match\ntest line three';
    const regex = /test/gi;
    const results = searchInContent(content, regex, '/path/to/file.ts');
    
    expect(results).toHaveLength(2);
    expect(results[0].line).toBe(0);
    expect(results[1].line).toBe(2);
  });

  test('should respect maxResults', () => {
    const content = 'test\ntest\ntest\ntest\ntest';
    const regex = /test/gi;
    const results = searchInContent(content, regex, '/path/to/file.ts', 2);
    
    expect(results).toHaveLength(2);
  });

  test('should trim preview and adjust match range', () => {
    const content = '    indented test here';
    const regex = /test/gi;
    const results = searchInContent(content, regex, '/path/to/file.ts');
    
    expect(results).toHaveLength(1);
    expect(results[0].preview).toBe('indented test here');
    expect(results[0].previewMatchRange.start).toBe(9); // 'indented ' is 9 chars
  });

  test('should include correct file metadata', () => {
    const content = 'test content';
    const regex = /test/gi;
    const results = searchInContent(content, regex, '/path/to/myfile.ts');
    
    expect(results[0].fileName).toBe('myfile.ts');
    expect(results[0].relativePath).toBe('/path/to/myfile.ts');
    expect(results[0].uri).toBe('file:///path/to/myfile.ts');
  });

  test('should handle empty content', () => {
    const content = '';
    const regex = /test/gi;
    const results = searchInContent(content, regex, '/path/to/file.ts');
    
    expect(results).toHaveLength(0);
  });

  test('should handle no matches', () => {
    const content = 'nothing here';
    const regex = /test/gi;
    const results = searchInContent(content, regex, '/path/to/file.ts');
    
    expect(results).toHaveLength(0);
  });
});

describe('escapeHtml', () => {
  test('should escape HTML special characters', () => {
    expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
    expect(escapeHtml('"test"')).toBe('&quot;test&quot;');
    expect(escapeHtml("'test'")).toBe('&#039;test&#039;');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  test('should handle mixed content', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  test('should handle empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('escapeAttr', () => {
  test('should escape attribute special characters', () => {
    expect(escapeAttr('"test"')).toBe('&quot;test&quot;');
    expect(escapeAttr("'test'")).toBe('&#039;test&#039;');
    expect(escapeAttr('a & b')).toBe('a &amp; b');
  });
});

describe('EXCLUDE_DIRS constant', () => {
  test('should contain expected directories', () => {
    expect(EXCLUDE_DIRS.has('node_modules')).toBe(true);
    expect(EXCLUDE_DIRS.has('.git')).toBe(true);
    expect(EXCLUDE_DIRS.has('dist')).toBe(true);
    expect(EXCLUDE_DIRS.has('coverage')).toBe(true);
  });
});

describe('BINARY_EXTENSIONS constant', () => {
  test('should contain expected extensions', () => {
    expect(BINARY_EXTENSIONS.has('.png')).toBe(true);
    expect(BINARY_EXTENSIONS.has('.jpg')).toBe(true);
    expect(BINARY_EXTENSIONS.has('.exe')).toBe(true);
    expect(BINARY_EXTENSIONS.has('.lock')).toBe(true);
  });
});

describe('collectFiles', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should collect files from directory', async () => {
    mockWorkspaceFs.readDirectory.mockResolvedValue([
      ['file1.ts', vscode.FileType.File],
      ['file2.ts', vscode.FileType.File]
    ]);

    const files = await collectFiles('/test/dir');

    expect(files.length).toBe(2);
    // Normalize for cross-platform comparison
    const normalized = files.map(f => f.replace(/\\/g, '/'));
    expect(normalized).toContain('/test/dir/file1.ts');
    expect(normalized).toContain('/test/dir/file2.ts');
  });

  test('should recursively search subdirectories', async () => {
    mockWorkspaceFs.readDirectory.mockImplementation((uri: vscode.Uri) => {
      const normalized = uri.fsPath.replace(/\\/g, '/');
      if (normalized === '/test/dir') {
        return Promise.resolve([
          ['subdir', vscode.FileType.Directory],
          ['file1.ts', vscode.FileType.File]
        ]);
      }
      if (normalized === '/test/dir/subdir') {
        return Promise.resolve([
          ['file2.ts', vscode.FileType.File]
        ]);
      }
      return Promise.resolve([]);
    });

    const files = await collectFiles('/test/dir');

    expect(files.length).toBe(2);
    const normalizedFiles = files.map(f => f.replace(/\\/g, '/'));
    expect(normalizedFiles).toContain('/test/dir/file1.ts');
    expect(normalizedFiles).toContain('/test/dir/subdir/file2.ts');
  });

  test('should exclude node_modules directory', async () => {
    mockWorkspaceFs.readDirectory.mockImplementation((uri: vscode.Uri) => {
      const normalized = uri.fsPath.replace(/\\/g, '/');
      if (normalized === '/test/dir') {
        return Promise.resolve([
          ['node_modules', vscode.FileType.Directory],
          ['src', vscode.FileType.Directory]
        ]);
      }
      if (normalized === '/test/dir/src') {
        return Promise.resolve([
          ['file.ts', vscode.FileType.File]
        ]);
      }
      return Promise.resolve([]);
    });

    const files = await collectFiles('/test/dir');

    expect(files.length).toBe(1);
    const normalizedFiles = files.map(f => f.replace(/\\/g, '/'));
    expect(normalizedFiles).toContain('/test/dir/src/file.ts');
  });

  test('should exclude binary files', async () => {
    mockWorkspaceFs.readDirectory.mockResolvedValue([
      ['file.ts', vscode.FileType.File],
      ['image.png', vscode.FileType.File],
      ['binary.exe', vscode.FileType.File]
    ]);

    const files = await collectFiles('/test/dir');

    expect(files.length).toBe(1);
    const normalizedFiles = files.map(f => f.replace(/\\/g, '/'));
    expect(normalizedFiles).toContain('/test/dir/file.ts');
  });

  test('should respect file mask', async () => {
    mockWorkspaceFs.readDirectory.mockResolvedValue([
      ['file.ts', vscode.FileType.File],
      ['file.js', vscode.FileType.File],
      ['style.css', vscode.FileType.File]
    ]);

    const files = await collectFiles('/test/dir', '*.ts');

    expect(files.length).toBe(1);
    const normalizedFiles = files.map(f => f.replace(/\\/g, '/'));
    expect(normalizedFiles).toContain('/test/dir/file.ts');
  });

  test('should respect maxFiles limit', async () => {
    mockWorkspaceFs.readDirectory.mockResolvedValue([
      ['file1.ts', vscode.FileType.File],
      ['file2.ts', vscode.FileType.File],
      ['file3.ts', vscode.FileType.File],
      ['file4.ts', vscode.FileType.File],
      ['file5.ts', vscode.FileType.File]
    ]);

    const files = await collectFiles('/test/dir', '', 3);

    expect(files.length).toBe(3);
  });

  test('should handle directory read errors gracefully', async () => {
    mockWorkspaceFs.readDirectory.mockRejectedValue(new Error('Permission denied'));

    const files = await collectFiles('/test/dir');

    expect(files).toEqual([]);
  });

  test('should handle empty directory', async () => {
    mockWorkspaceFs.readDirectory.mockResolvedValue([]);

    const files = await collectFiles('/test/dir');

    expect(files).toEqual([]);
  });
});

// ============================================================================
// VALIDATION TESTS
// ============================================================================

describe('validateRegex', () => {
  test('should return invalid for empty pattern', () => {
    const result = validateRegex('', false);
    expect(result.isValid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('empty');
  });

  test('should return valid for simple pattern in non-regex mode', () => {
    const result = validateRegex('test', false);
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test('should return valid for special characters in non-regex mode', () => {
    const result = validateRegex('test.file[123](*)', false);
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test('should return valid for simple regex in regex mode', () => {
    const result = validateRegex('test', true);
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test('should return valid for wildcard regex in regex mode', () => {
    const result = validateRegex('test.*', true);
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test('should return invalid for unclosed bracket in regex mode', () => {
    const result = validateRegex('[unclosed', true);
    expect(result.isValid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Invalid regex');
  });

  test('should return invalid for unclosed parenthesis in regex mode', () => {
    const result = validateRegex('(unclosed', true);
    expect(result.isValid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Invalid regex');
  });

  test('should return valid for unclosed brace in regex mode (valid in JS)', () => {
    const result = validateRegex('test{5,', true);
    // In JavaScript, test{5, is valid (matches "test" followed by 5 or more characters)
    expect(result.isValid).toBe(true);
  });

  test('should return valid for escape sequence in regex mode', () => {
    // In JavaScript, \k is valid in certain contexts (backreferences)
    const result = validateRegex('\\k', true);
    expect(result.isValid).toBe(true);
  });

  test('should return valid for complex valid email regex', () => {
    const emailRegex = '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$';
    const result = validateRegex(emailRegex, true);
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test('should return valid for word boundary patterns', () => {
    const result = validateRegex('\\bword\\b', true);
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test('should return valid for lookahead/lookbehind patterns', () => {
    const result = validateRegex('(?=pattern)', true);
    expect(result.isValid).toBe(true);
  });

  test('should return valid for character class with ranges', () => {
    const result = validateRegex('[a-zA-Z0-9]', true);
    expect(result.isValid).toBe(true);
  });

  test('should return valid for negated character class', () => {
    const result = validateRegex('[^abc]', true);
    expect(result.isValid).toBe(true);
  });

  test('should handle very long regex pattern', () => {
    const longPattern = 'a' + '|b'.repeat(1000);
    const result = validateRegex(longPattern, true);
    expect(result.isValid).toBe(true);
  });

  test('should preserve error message from regex engine', () => {
    const result = validateRegex('[a-', true);
    expect(result.isValid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('should validate with multiline flag when provided', () => {
    const result = validateRegex('^foo.bar$', true, true);
    expect(result.isValid).toBe(true);
  });
});

describe('validateFileMask', () => {
  test('should return valid for empty mask', () => {
    const result = validateFileMask('');
    expect(result.isValid).toBe(true);
    expect(result.fallbackToAll).toBe(false);
    expect(result.message).toBeUndefined();
  });

  test('should return valid for whitespace-only mask', () => {
    const result = validateFileMask('   ');
    expect(result.isValid).toBe(true);
    expect(result.fallbackToAll).toBe(false);
  });

  test('should return valid for simple extension pattern', () => {
    const result = validateFileMask('*.ts');
    expect(result.isValid).toBe(true);
    expect(result.fallbackToAll).toBe(false);
  });

  test('should return valid for multiple comma-separated patterns', () => {
    const result = validateFileMask('*.ts, *.js, *.py');
    expect(result.isValid).toBe(true);
    expect(result.fallbackToAll).toBe(false);
  });

  test('should return valid for semicolon-separated patterns', () => {
    const result = validateFileMask('*.ts; *.js; *.py');
    expect(result.isValid).toBe(true);
    expect(result.fallbackToAll).toBe(false);
  });

  test('should return valid for mixed separators', () => {
    const result = validateFileMask('*.ts, *.js; *.py');
    expect(result.isValid).toBe(true);
    expect(result.fallbackToAll).toBe(false);
  });

  test('should return valid for exclude-only patterns', () => {
    const result = validateFileMask('!*.test.ts');
    expect(result.isValid).toBe(true);
    expect(result.fallbackToAll).toBe(false);
  });

  test('should return valid for mixed include/exclude patterns', () => {
    const result = validateFileMask('*.tsx, !*.test.tsx');
    expect(result.isValid).toBe(true);
    expect(result.fallbackToAll).toBe(false);
  });

  test('should return valid for complex glob patterns', () => {
    const result = validateFileMask('**/src/**/*.ts');
    expect(result.isValid).toBe(true);
    expect(result.fallbackToAll).toBe(false);
  });

  test('should return valid for question mark patterns', () => {
    const result = validateFileMask('test?.ts');
    expect(result.isValid).toBe(true);
    expect(result.fallbackToAll).toBe(false);
  });

  test('should return valid for patterns with dots', () => {
    const result = validateFileMask('*.min.js');
    expect(result.isValid).toBe(true);
    expect(result.fallbackToAll).toBe(false);
  });

  test('should handle very long mask', () => {
    const longMask = '*.ts, ' + '*.js, '.repeat(100);
    const result = validateFileMask(longMask);
    expect(result.isValid).toBe(true);
  });

  test('should return valid for patterns with underscores', () => {
    const result = validateFileMask('*.test_*.ts');
    expect(result.isValid).toBe(true);
    expect(result.fallbackToAll).toBe(false);
  });

  test('should return valid for patterns with numbers', () => {
    const result = validateFileMask('*.config.v[0-9].ts');
    expect(result.isValid).toBe(true);
  });

  test('should handle comma-only input', () => {
    const result = validateFileMask(',,,');
    expect(result.isValid).toBe(true);
    expect(result.fallbackToAll).toBe(false);
  });

  test('should handle exclude-only with multiple patterns', () => {
    const result = validateFileMask('!*.test.ts, !*.spec.ts');
    expect(result.isValid).toBe(true);
    expect(result.fallbackToAll).toBe(false);
  });
});

describe('isValidRegexPattern', () => {
  test('should return true for simple valid pattern', () => {
    expect(isValidRegexPattern('test')).toBe(true);
  });

  test('should return true for wildcard pattern', () => {
    expect(isValidRegexPattern('test.*')).toBe(true);
  });

  test('should return true for anchored pattern', () => {
    expect(isValidRegexPattern('^start')).toBe(true);
    expect(isValidRegexPattern('end$')).toBe(true);
  });

  test('should return true for character class', () => {
    expect(isValidRegexPattern('[a-z]')).toBe(true);
  });

  test('should return false for unclosed bracket', () => {
    expect(isValidRegexPattern('[unclosed')).toBe(false);
  });

  test('should return false for unclosed parenthesis', () => {
    expect(isValidRegexPattern('(unclosed')).toBe(false);
  });

  test('should return false for empty pattern', () => {
    expect(isValidRegexPattern('')).toBe(false);
  });

  test('should return true for valid escape sequence', () => {
    // \k is valid in JavaScript for backreferences
    expect(isValidRegexPattern('\\k')).toBe(true);
  });

  test('should return true for complex regex', () => {
    expect(isValidRegexPattern('^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$')).toBe(true);
  });

  test('should return true for word boundary', () => {
    expect(isValidRegexPattern('\\bword\\b')).toBe(true);
  });
});

describe('buildSearchRegex with angle brackets', () => {
  test('should handle Array<string> pattern in regex mode', () => {
    const options: SearchOptions = {
      matchCase: false,
      wholeWord: false,
      useRegex: true,
      fileMask: ''
    };
    const regex = buildSearchRegex('Array<string>', options);
    expect(regex).not.toBeNull();
    expect(regex!.test('Array<string>')).toBe(true);
    regex!.lastIndex = 0;
    expect(regex!.test('array<string>')).toBe(true); // case insensitive
  });

  test('should handle Array<(.*)> pattern with capture group', () => {
    const options: SearchOptions = {
      matchCase: false,
      wholeWord: false,
      useRegex: true,
      fileMask: ''
    };
    const regex = buildSearchRegex('Array<(.*)>', options);
    expect(regex).not.toBeNull();
    expect(regex!.test('Array<string>')).toBe(true);
    regex!.lastIndex = 0;
    expect(regex!.test('Array<number>')).toBe(true);
    regex!.lastIndex = 0;
    expect(regex!.test('Array<boolean>')).toBe(true);
    regex!.lastIndex = 0;
    expect(regex!.test('ArrayOfStuff')).toBe(false);
  });

  test('should match greedy capture groups correctly', () => {
    const options: SearchOptions = {
      matchCase: true,
      wholeWord: false,
      useRegex: true,
      fileMask: ''
    };
    const regex = buildSearchRegex('Array<(.*)>', options);
    const testString = 'Array<string>';
    const match = regex!.exec(testString);
    expect(match).not.toBeNull();
    expect(match![0]).toBe('Array<string>');
    expect(match![1]).toBe('string');
  });

  test('should not match patterns without angle brackets', () => {
    const options: SearchOptions = {
      matchCase: false,
      wholeWord: false,
      useRegex: true,
      fileMask: ''
    };
    const regex = buildSearchRegex('Array<(.*)>', options);
    expect(regex!.test('List<string>')).toBe(false);
    expect(regex!.test('Arraystring')).toBe(false);
  });
});
