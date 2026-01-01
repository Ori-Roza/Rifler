import * as vscode from 'vscode';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as path from 'path';
import * as readline from 'readline';
import { SearchOptions, SearchResult, EXCLUDE_DIRS } from './utils';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { rgPath } = require('@vscode/ripgrep');

interface RipgrepSearchParams {
  query: string;
  options: SearchOptions;
  fileMask: string;
  roots: string[];
  maxResults: number;
  workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;
}

type RipgrepMatchEvent = {
  type: 'match';
  data: {
    path: { text: string };
    lines: { text: string };
    line_number: number;
    submatches: Array<{ start: number; end: number }>;
  };
};

type RipgrepJsonEvent = RipgrepMatchEvent | { type: string; data?: unknown };

function buildGlobArgs(fileMask: string): string[] {
  const args: string[] = [];

  const trimmed = fileMask.trim();
  if (trimmed) {
    const tokens = trimmed.split(/[,;]/).map((m) => m.trim()).filter(Boolean);
    for (const token of tokens) {
      const isExclude = token.startsWith('!');
      const pattern = isExclude ? token.slice(1).trim() : token;
      if (!pattern) continue;
      const glob = isExclude ? `!${pattern}` : pattern;
      args.push('--glob', glob);
    }
  }

  for (const exclude of EXCLUDE_DIRS) {
    args.push('--glob', `!${exclude}/**`);
  }

  return args;
}

function toRelativePath(filePath: string, workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined): string {
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return path.basename(filePath);
  }

  const normalizedFilePath = path.normalize(filePath);
  for (const folder of workspaceFolders) {
    const folderPath = path.normalize(folder.uri.fsPath);
    if (
      normalizedFilePath === folderPath ||
      normalizedFilePath.startsWith(folderPath + path.sep)
    ) {
      const rel = path.relative(folderPath, normalizedFilePath);
      return rel || path.basename(filePath);
    }
  }

  return path.basename(filePath);
}

function mapMatchToResult(evt: RipgrepMatchEvent, workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined): SearchResult | null {
  const filePath = evt.data.path.text;
  const lineText = evt.data.lines.text.replace(/\r?\n$/, '');
  const submatches = evt.data.submatches || [];
  if (submatches.length === 0) return null;

  const leadingWhitespace = lineText.length - lineText.trimStart().length;
  const preview = lineText.trim();

  const previewMatchRanges = submatches.map((m) => {
    const start = Math.max(0, m.start - leadingWhitespace);
    const end = Math.max(0, m.end - leadingWhitespace);
    return { start, end };
  });

  const first = submatches[0];

  return {
    uri: vscode.Uri.file(filePath).toString(),
    fileName: path.basename(filePath),
    relativePath: toRelativePath(filePath, workspaceFolders),
    line: Math.max(0, evt.data.line_number - 1),
    character: first.start,
    length: Math.max(0, first.end - first.start),
    preview,
    previewMatchRange: previewMatchRanges[0],
    previewMatchRanges
  };
}

function isMatchEvent(evt: RipgrepJsonEvent): evt is RipgrepMatchEvent {
  return evt.type === 'match';
}

export function startRipgrepSearch(params: RipgrepSearchParams): { promise: Promise<SearchResult[]>; cancel: () => void } {
  const { query, options, fileMask, roots, maxResults, workspaceFolders } = params;

  const args: string[] = ['--json', '--no-config'];

  if (!options.useRegex) {
    args.push('--fixed-strings');
  }

  if (!options.matchCase) {
    args.push('--ignore-case');
  }

  if (options.wholeWord) {
    args.push('--word-regexp');
  }

  args.push(...buildGlobArgs(fileMask));

  args.push('-e', query, '--', ...roots);

  const child: ChildProcessWithoutNullStreams = spawn(rgPath as string, args, {
    windowsHide: true
  });

  const results: SearchResult[] = [];
  let done = false;

  const cleanup = (): void => {
    done = true;
    child.removeAllListeners();
    child.stdout.removeAllListeners();
    child.stderr.removeAllListeners();
  };

  const cancel = (): void => {
    if (!done) {
      child.kill();
      cleanup();
    }
  };

  const promise = new Promise<SearchResult[]>((resolve, reject) => {
    const rl = readline.createInterface({ input: child.stdout });

    rl.on('line', (line: string) => {
      if (done) return;
      let parsed: RipgrepJsonEvent;
      try {
        parsed = JSON.parse(line) as RipgrepJsonEvent;
      } catch {
        return;
      }

      if (!isMatchEvent(parsed)) return;
      const result = mapMatchToResult(parsed, workspaceFolders);
      if (!result) return;

      results.push(result);
      if (results.length >= maxResults) {
        cancel();
        resolve(results);
      }
    });

    child.on('error', (err) => {
      if (done) return;
      cleanup();
      reject(err);
    });

    child.stderr.on('data', () => {
      // Ignore stderr noise from ripgrep (e.g., broken pipes on cancel)
    });

    child.on('close', (code, signal) => {
      if (done) return;
      cleanup();
      if (signal) {
        resolve(results);
        return;
      }
      // ripgrep exits 0 when matches found, 1 when none found
      if (code === 0 || code === 1) {
        resolve(results);
      } else {
        reject(new Error(`ripgrep exited with code ${code}`));
      }
    });
  });

  return { promise, cancel };
}
