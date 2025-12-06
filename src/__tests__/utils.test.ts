import {
  buildSearchRegex,
  matchesFileMask,
  shouldExcludeDirectory,
  isBinaryExtension,
  searchInContent,
  escapeHtml,
  escapeAttr,
  EXCLUDE_DIRS,
  BINARY_EXTENSIONS,
  SearchOptions
} from '../utils';

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
    
    expect(results).toHaveLength(3);
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
