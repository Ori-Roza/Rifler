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
});
