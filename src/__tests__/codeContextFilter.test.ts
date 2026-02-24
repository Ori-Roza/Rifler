import * as assert from 'assert';
import * as vscode from 'vscode';
import { filterResultsByCodeContext } from '../codeContextFilter';
import { SearchResult } from '../utils';

describe('Code context filtering', () => {
  beforeEach(() => {
    (vscode.workspace.fs.readFile as jest.Mock).mockReset();
  });

  test('filters by code, comments, and strings for JavaScript', async () => {
    const content = [
      '// foo in comment',
      'const foo = "foo";',
      'foo();'
    ].join('\n');

    (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(Buffer.from(content, 'utf8'));

    const uri = vscode.Uri.file('/tmp/context-test.js').toString();

    const results: SearchResult[] = [
      {
        uri,
        fileName: 'context-test.js',
        relativePath: 'context-test.js',
        line: 0,
        character: 3,
        length: 3,
        preview: 'foo in comment',
        previewMatchRange: { start: 0, end: 3 },
        previewMatchRanges: [{ start: 0, end: 3 }],
        matchRanges: [{ start: 3, end: 6 }]
      },
      {
        uri,
        fileName: 'context-test.js',
        relativePath: 'context-test.js',
        line: 1,
        character: 6,
        length: 3,
        preview: 'const foo = "foo";',
        previewMatchRange: { start: 6, end: 9 },
        previewMatchRanges: [{ start: 6, end: 9 }, { start: 13, end: 16 }],
        matchRanges: [{ start: 6, end: 9 }, { start: 13, end: 16 }]
      },
      {
        uri,
        fileName: 'context-test.js',
        relativePath: 'context-test.js',
        line: 2,
        character: 0,
        length: 3,
        preview: 'foo();',
        previewMatchRange: { start: 0, end: 3 },
        previewMatchRanges: [{ start: 0, end: 3 }],
        matchRanges: [{ start: 0, end: 3 }]
      }
    ];

    const codeOnly = await filterResultsByCodeContext(results, {
      matchCase: false,
      wholeWord: false,
      useRegex: false,
      fileMask: '',
      includeCode: true,
      includeComments: false,
      includeStrings: false
    });

    assert.strictEqual(codeOnly.length, 2);
    assert.strictEqual(codeOnly[0].line, 1);
    assert.strictEqual(codeOnly[1].line, 2);

    const stringsOnly = await filterResultsByCodeContext(results, {
      matchCase: false,
      wholeWord: false,
      useRegex: false,
      fileMask: '',
      includeCode: false,
      includeComments: false,
      includeStrings: true
    });

    assert.strictEqual(stringsOnly.length, 1);
    assert.strictEqual(stringsOnly[0].line, 1);

    const commentsOnly = await filterResultsByCodeContext(results, {
      matchCase: false,
      wholeWord: false,
      useRegex: false,
      fileMask: '',
      includeCode: false,
      includeComments: true,
      includeStrings: false
    });

    assert.strictEqual(commentsOnly.length, 1);
    assert.strictEqual(commentsOnly[0].line, 0);
  });

  test('supports all context filter combinations', async () => {
    const content = [
      '// alpha',
      'const beta = "beta";',
      'gamma();'
    ].join('\n');

    (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(Buffer.from(content, 'utf8'));

    const uri = vscode.Uri.file('/tmp/context-combos.js').toString();

    const results: SearchResult[] = [
      {
        uri,
        fileName: 'context-combos.js',
        relativePath: 'context-combos.js',
        line: 0,
        character: 3,
        length: 5,
        preview: 'alpha',
        previewMatchRange: { start: 0, end: 5 },
        previewMatchRanges: [{ start: 0, end: 5 }],
        matchRanges: [{ start: 3, end: 8 }]
      },
      {
        uri,
        fileName: 'context-combos.js',
        relativePath: 'context-combos.js',
        line: 1,
        character: 6,
        length: 4,
        preview: 'const beta = "beta";',
        previewMatchRange: { start: 6, end: 10 },
        previewMatchRanges: [{ start: 6, end: 10 }, { start: 15, end: 19 }],
        matchRanges: [{ start: 6, end: 10 }, { start: 15, end: 19 }]
      },
      {
        uri,
        fileName: 'context-combos.js',
        relativePath: 'context-combos.js',
        line: 2,
        character: 0,
        length: 5,
        preview: 'gamma();',
        previewMatchRange: { start: 0, end: 5 },
        previewMatchRanges: [{ start: 0, end: 5 }],
        matchRanges: [{ start: 0, end: 5 }]
      }
    ];

    const allOn = await filterResultsByCodeContext(results, {
      matchCase: false,
      wholeWord: false,
      useRegex: false,
      fileMask: '',
      includeCode: true,
      includeComments: true,
      includeStrings: true
    });
    assert.strictEqual(allOn.length, 3);

    const noCode = await filterResultsByCodeContext(results, {
      matchCase: false,
      wholeWord: false,
      useRegex: false,
      fileMask: '',
      includeCode: false,
      includeComments: true,
      includeStrings: true
    });
    assert.deepStrictEqual(noCode.map((r) => r.line), [0, 1]);
    assert.strictEqual(noCode[1].character, 15);
    assert.strictEqual(noCode[1].length, 4);

    const noComments = await filterResultsByCodeContext(results, {
      matchCase: false,
      wholeWord: false,
      useRegex: false,
      fileMask: '',
      includeCode: true,
      includeComments: false,
      includeStrings: true
    });
    assert.deepStrictEqual(noComments.map((r) => r.line), [1, 2]);

    const noStrings = await filterResultsByCodeContext(results, {
      matchCase: false,
      wholeWord: false,
      useRegex: false,
      fileMask: '',
      includeCode: true,
      includeComments: true,
      includeStrings: false
    });
    assert.deepStrictEqual(noStrings.map((r) => r.line), [0, 1, 2]);
    assert.strictEqual(noStrings[1].character, 6);
    assert.strictEqual(noStrings[1].length, 4);

    const stringsOnly = await filterResultsByCodeContext(results, {
      matchCase: false,
      wholeWord: false,
      useRegex: false,
      fileMask: '',
      includeCode: false,
      includeComments: false,
      includeStrings: true
    });
    assert.deepStrictEqual(stringsOnly.map((r) => r.line), [1]);
    assert.strictEqual(stringsOnly[0].character, 15);
    assert.strictEqual(stringsOnly[0].length, 4);

    const commentsOnly = await filterResultsByCodeContext(results, {
      matchCase: false,
      wholeWord: false,
      useRegex: false,
      fileMask: '',
      includeCode: false,
      includeComments: true,
      includeStrings: false
    });
    assert.deepStrictEqual(commentsOnly.map((r) => r.line), [0]);

    const codeOnly = await filterResultsByCodeContext(results, {
      matchCase: false,
      wholeWord: false,
      useRegex: false,
      fileMask: '',
      includeCode: true,
      includeComments: false,
      includeStrings: false
    });
    assert.deepStrictEqual(codeOnly.map((r) => r.line), [1, 2]);
    assert.strictEqual(codeOnly[0].character, 6);
    assert.strictEqual(codeOnly[0].length, 4);

    const none = await filterResultsByCodeContext(results, {
      matchCase: false,
      wholeWord: false,
      useRegex: false,
      fileMask: '',
      includeCode: false,
      includeComments: false,
      includeStrings: false
    });
    assert.strictEqual(none.length, 0);
  });

  test('drops unsupported language results when strings are excluded', async () => {
    const results: SearchResult[] = [
      {
        uri: 'file:///test/foo.yml',
        fileName: 'foo.yml',
        relativePath: 'foo.yml',
        line: 0,
        character: 10,
        length: 4,
        preview: '- name: Run unit tests',
        previewMatchRange: { start: 10, end: 14 },
        previewMatchRanges: [{ start: 10, end: 14 }],
        matchRanges: [{ start: 10, end: 14 }]
      }
    ];

    const filtered = await filterResultsByCodeContext(results, {
      matchCase: false,
      wholeWord: false,
      useRegex: false,
      fileMask: '',
      includeCode: true,
      includeComments: true,
      includeStrings: false
    });

    assert.strictEqual(filtered.length, 0);
  });
});
