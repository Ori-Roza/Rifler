import * as vscode from 'vscode';
import { SearchOptions, SearchResult } from './utils';

type Range = { start: number; end: number };

type LanguageConfig = {
  lineComment?: string;
  blockComment?: { start: string; end: string };
  stringDelims: string[];
  tripleStringDelims?: string[];
  supportsRegexLiteral?: boolean;
};

type LineContext = {
  commentRanges: Range[];
  stringRanges: Range[];
};

type ParseState = {
  inBlockComment: boolean;
  inString: boolean;
  stringDelim: string;
};

const SUPPORTED_LANGUAGES = new Set<string>([
  'javascript',
  'javascriptreact',
  'typescript',
  'typescriptreact',
  'python',
  'java'
]);

const LANGUAGE_CONFIGS: Record<string, LanguageConfig> = {
  javascript: {
    lineComment: '//',
    blockComment: { start: '/*', end: '*/' },
    stringDelims: ["'", '"', '`'],
    supportsRegexLiteral: true
  },
  javascriptreact: {
    lineComment: '//',
    blockComment: { start: '/*', end: '*/' },
    stringDelims: ["'", '"', '`'],
    supportsRegexLiteral: true
  },
  typescript: {
    lineComment: '//',
    blockComment: { start: '/*', end: '*/' },
    stringDelims: ["'", '"', '`'],
    supportsRegexLiteral: true
  },
  typescriptreact: {
    lineComment: '//',
    blockComment: { start: '/*', end: '*/' },
    stringDelims: ["'", '"', '`'],
    supportsRegexLiteral: true
  },
  java: {
    lineComment: '//',
    blockComment: { start: '/*', end: '*/' },
    stringDelims: ["'", '"'],
    tripleStringDelims: ['"""']
  },
  python: {
    lineComment: '#',
    stringDelims: ["'", '"'],
    tripleStringDelims: ["'''", '"""']
  }
};

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascriptreact',
  ts: 'typescript',
  tsx: 'typescriptreact',
  py: 'python',
  java: 'java'
};

export async function filterResultsByCodeContext(
  results: SearchResult[],
  options: SearchOptions
): Promise<SearchResult[]> {
  const includeCode = options.includeCode ?? true;
  const includeComments = options.includeComments ?? true;
  const includeStrings = options.includeStrings ?? true;

  if (includeCode && includeComments && includeStrings) {
    return results;
  }

  if (!includeCode && !includeComments && !includeStrings) {
    return [];
  }

  const contextFiltersActive = !(includeCode && includeComments && includeStrings);

  const resultsByFile = new Map<string, SearchResult[]>();
  for (const result of results) {
    const list = resultsByFile.get(result.uri) || [];
    list.push(result);
    resultsByFile.set(result.uri, list);
  }

  const filtered: SearchResult[] = [];

  for (const [uri, fileResults] of resultsByFile.entries()) {
    const languageId = getLanguageIdFromFileName(fileResults[0]?.fileName || '');
    if (!languageId || !SUPPORTED_LANGUAGES.has(languageId)) {
      if (contextFiltersActive && !includeStrings) {
        continue;
      }
      filtered.push(...fileResults);
      continue;
    }

    const config = LANGUAGE_CONFIGS[languageId];
    if (!config) {
      if (contextFiltersActive && !includeStrings) {
        continue;
      }
      filtered.push(...fileResults);
      continue;
    }

    const content = await readFileContent(uri);
    if (!content) {
      filtered.push(...fileResults);
      continue;
    }

    const lines = content.split(/\r?\n/);
    const lineContexts = parseLineContexts(lines, config);

    for (const result of fileResults) {
      const lineIndex = result.line;
      const lineContext = lineContexts[lineIndex];
      if (!lineContext) {
        filtered.push(result);
        continue;
      }

      const lineText = lines[lineIndex] ?? '';
      const leadingWhitespace = lineText.length - lineText.trimStart().length;

      const matchRanges = result.matchRanges || [{ start: result.character, end: result.character + result.length }];
      const allowedIndexes: number[] = [];
      matchRanges.forEach((range, index) => {
        const pos = Math.max(0, range.start);
        if (isInRanges(pos, lineContext.commentRanges)) {
          if (includeComments) allowedIndexes.push(index);
          return;
        }
        if (isInRanges(pos, lineContext.stringRanges)) {
          if (includeStrings) allowedIndexes.push(index);
          return;
        }
        if (includeCode) {
          allowedIndexes.push(index);
        }
      });

      if (allowedIndexes.length === 0) {
        continue;
      }

      const allowedMatchRanges = allowedIndexes.map((idx) => matchRanges[idx]);
      const previewRangesFromRaw = allowedMatchRanges.map((range) => ({
        start: Math.max(0, range.start - leadingWhitespace),
        end: Math.max(0, range.end - leadingWhitespace)
      }));

      const previewMatchRanges = Array.isArray(result.previewMatchRanges) && result.previewMatchRanges.length === matchRanges.length
        ? allowedIndexes.map((idx) => result.previewMatchRanges![idx])
        : previewRangesFromRaw;

      const firstRange = allowedMatchRanges[0];
      const firstPreviewRange = previewMatchRanges[0] || {
        start: Math.max(0, firstRange.start - leadingWhitespace),
        end: Math.max(0, firstRange.end - leadingWhitespace)
      };

      filtered.push({
        ...result,
        character: firstRange.start,
        length: Math.max(0, firstRange.end - firstRange.start),
        matchRanges: allowedMatchRanges,
        previewMatchRanges,
        previewMatchRange: firstPreviewRange
      });
    }
  }

  return filtered;
}

function getLanguageIdFromFileName(fileName: string): string | undefined {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return EXTENSION_TO_LANGUAGE[ext];
}

async function readFileContent(uriString: string): Promise<string> {
  try {
    const uri = vscode.Uri.parse(uriString);
    const data = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(data).toString('utf8');
  } catch {
    return '';
  }
}

function parseLineContexts(lines: string[], config: LanguageConfig): LineContext[] {
  const contexts: LineContext[] = [];
  const state: ParseState = {
    inBlockComment: false,
    inString: false,
    stringDelim: ''
  };

  for (const line of lines) {
    contexts.push(parseLineContext(line, config, state));
  }

  return contexts;
}

function parseLineContext(line: string, config: LanguageConfig, state: ParseState): LineContext {
  const commentRanges: Range[] = [];
  const stringRanges: Range[] = [];
  const length = line.length;

  let i = 0;
  let lastNonSpace = '';

  if (state.inBlockComment && config.blockComment) {
    const endIndex = line.indexOf(config.blockComment.end, i);
    if (endIndex === -1) {
      commentRanges.push({ start: 0, end: length });
      return { commentRanges, stringRanges };
    }
    commentRanges.push({ start: 0, end: endIndex + config.blockComment.end.length });
    i = endIndex + config.blockComment.end.length;
    state.inBlockComment = false;
  }

  if (state.inString) {
    const stringEnd = findStringEnd(line, i, state.stringDelim);
    if (stringEnd === -1) {
      stringRanges.push({ start: 0, end: length });
      return { commentRanges, stringRanges };
    }
    const end = stringEnd + state.stringDelim.length;
    stringRanges.push({ start: 0, end });
    i = end;
    state.inString = false;
    state.stringDelim = '';
  }

  while (i < length) {
    if (config.lineComment && line.startsWith(config.lineComment, i)) {
      commentRanges.push({ start: i, end: length });
      break;
    }

    if (config.blockComment && line.startsWith(config.blockComment.start, i)) {
      const endIndex = line.indexOf(config.blockComment.end, i + config.blockComment.start.length);
      if (endIndex === -1) {
        commentRanges.push({ start: i, end: length });
        state.inBlockComment = true;
        break;
      }
      commentRanges.push({ start: i, end: endIndex + config.blockComment.end.length });
      i = endIndex + config.blockComment.end.length;
      continue;
    }

    const tripleDelim = matchTripleStringDelimiter(line, i, config);
    if (tripleDelim) {
      const endIndex = line.indexOf(tripleDelim, i + tripleDelim.length);
      if (endIndex === -1) {
        stringRanges.push({ start: i, end: length });
        state.inString = true;
        state.stringDelim = tripleDelim;
        break;
      }
      stringRanges.push({ start: i, end: endIndex + tripleDelim.length });
      i = endIndex + tripleDelim.length;
      continue;
    }

    if (config.supportsRegexLiteral && line[i] === '/' && isRegexLiteralStart(line, i, lastNonSpace)) {
      const regexEnd = findRegexLiteralEnd(line, i);
      if (regexEnd === -1) {
        stringRanges.push({ start: i, end: length });
        break;
      }
      stringRanges.push({ start: i, end: regexEnd + 1 });
      i = regexEnd + 1;
      continue;
    }

    const stringDelim = matchStringDelimiter(line, i, config);
    if (stringDelim) {
      const stringEnd = findStringEnd(line, i + stringDelim.length, stringDelim);
      if (stringEnd === -1) {
        stringRanges.push({ start: i, end: length });
        state.inString = true;
        state.stringDelim = stringDelim;
        break;
      }
      stringRanges.push({ start: i, end: stringEnd + stringDelim.length });
      i = stringEnd + stringDelim.length;
      continue;
    }

    if (!isWhitespace(line[i])) {
      lastNonSpace = line[i];
    }
    i += 1;
  }

  return { commentRanges, stringRanges };
}

function matchTripleStringDelimiter(line: string, index: number, config: LanguageConfig): string | undefined {
  const triples = config.tripleStringDelims || [];
  for (const delim of triples) {
    if (line.startsWith(delim, index)) {
      return delim;
    }
  }
  return undefined;
}

function matchStringDelimiter(line: string, index: number, config: LanguageConfig): string | undefined {
  for (const delim of config.stringDelims) {
    if (line.startsWith(delim, index)) {
      return delim;
    }
  }
  return undefined;
}

function findStringEnd(line: string, startIndex: number, delim: string): number {
  const length = line.length;
  if (delim.length > 1) {
    return line.indexOf(delim, startIndex);
  }

  for (let i = startIndex; i < length; i += 1) {
    if (line[i] !== delim) continue;
    if (!isEscaped(line, i)) {
      return i;
    }
  }

  return -1;
}

function isEscaped(line: string, index: number): boolean {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && line[i] === '\\'; i -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function isRegexLiteralStart(line: string, index: number, lastNonSpace: string): boolean {
  const next = line[index + 1];
  if (!next || next === '/' || next === '*') {
    return false;
  }

  if (!lastNonSpace) {
    return true;
  }

  if (/\w/.test(lastNonSpace) || lastNonSpace === ')' || lastNonSpace === ']' || lastNonSpace === '}') {
    return false;
  }

  return true;
}

function findRegexLiteralEnd(line: string, startIndex: number): number {
  let inCharClass = false;
  for (let i = startIndex + 1; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '[') {
      inCharClass = true;
      continue;
    }
    if (ch === ']') {
      inCharClass = false;
      continue;
    }
    if (ch === '/' && !inCharClass) {
      return i;
    }
  }
  return -1;
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t';
}

function isInRanges(pos: number, ranges: Range[]): boolean {
  return ranges.some((range) => pos >= range.start && pos < range.end);
}
