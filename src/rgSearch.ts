import * as vscode from 'vscode';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { SearchOptions, SearchResult, EXCLUDE_DIRS } from './utils';

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

export function getRipgrepCommandCandidates(): string[] {
  const exeName = process.platform === 'win32' ? 'rg.exe' : 'rg';

  // Test/diagnostic override. Allows E2E to simulate a broken/wrong-format rg.
  const override = process.env.RIFLER_RG_PATH?.trim();

  const appRoot = (vscode.env as unknown as { appRoot?: string } | undefined)?.appRoot;

  const candidates: string[] = [];

  if (override) {
    candidates.push(override);
  }

  if (appRoot) {
    // VS Code installs vary: sometimes @vscode/ripgrep is under node_modules,
    // sometimes it is unpacked alongside an asar.
    candidates.push(path.join(appRoot, 'node_modules', '@vscode', 'ripgrep', 'bin', exeName));
    candidates.push(path.join(appRoot, 'node_modules.asar.unpacked', '@vscode', 'ripgrep', 'bin', exeName));
  }

  // Last resort: try PATH.
  candidates.push('rg');

  // Deduplicate while preserving order.
  return Array.from(new Set(candidates));
}

function isRetryableSpawnError(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOEXEC' || code === 'EACCES';
}

function fileSeemsPresent(cmd: string): boolean {
  // Only pre-check absolute paths. For `rg` (PATH) we must attempt spawn.
  if (!path.isAbsolute(cmd)) return true;
  try {
    return fs.existsSync(cmd);
  } catch {
    return true;
  }
}

async function spawnWithFallback(
  commands: string[],
  args: string[]
): Promise<{ child: ChildProcessWithoutNullStreams; command: string }> {
  const attempts = commands.filter(fileSeemsPresent);
  const errors: Array<{ command: string; error: unknown }> = [];

  for (const command of attempts) {
    try {
      const child = spawn(command, args, { windowsHide: true });
      await new Promise<void>((resolve, reject) => {
        const onError = (err: NodeJS.ErrnoException): void => {
          cleanup();
          reject(err);
        };
        const onSpawn = (): void => {
          cleanup();
          resolve();
        };
        const cleanup = (): void => {
          child.removeListener('error', onError);
          child.removeListener('spawn', onSpawn);
        };

        child.once('error', onError);
        child.once('spawn', onSpawn);
      });

      return { child, command };
    } catch (error) {
      errors.push({ command, error });
      if (isRetryableSpawnError(error)) {
        continue;
      }
      throw error;
    }
  }

  const detail = errors
    .map((e) => {
      const code = (e.error as { code?: string } | undefined)?.code;
      const msg = e.error instanceof Error ? e.error.message : String(e.error);
      return `${e.command} (${code || 'unknown'}): ${msg}`;
    })
    .join('; ');

  throw new Error(`Failed to spawn ripgrep. Attempts: ${detail}`);
}

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

  let child: ChildProcessWithoutNullStreams | undefined;
  let cancelled = false;

  const results: SearchResult[] = [];
  let done = false;

  const cleanup = (): void => {
    done = true;
    const proc = child;
    if (!proc) return;
    proc.removeAllListeners();
    proc.stdout.removeAllListeners();
    proc.stderr.removeAllListeners();
  };

  const cancel = (): void => {
    cancelled = true;
    if (!done && child) {
      child.kill();
      cleanup();
    }
  };

  const promise = (async (): Promise<SearchResult[]> => {
    const candidates = getRipgrepCommandCandidates();
    const spawned = await spawnWithFallback(candidates, args);
    child = spawned.child;

    if (cancelled) {
      try {
        child.kill();
      } catch {
        // ignore
      }
      cleanup();
      return results;
    }

    return new Promise<SearchResult[]>((resolve, reject) => {
      if (!child) {
        reject(new Error('ripgrep spawn failed'));
        return;
      }

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
  })();

  return { promise, cancel };
}
