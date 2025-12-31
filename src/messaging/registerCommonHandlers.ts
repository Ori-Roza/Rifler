import * as vscode from 'vscode';
import { MessageHandler } from './handler';
import { performSearch } from '../search';
import { replaceOne, replaceAll } from '../replacer';
import { validateRegex, validateFileMask, SearchOptions, SearchScope } from '../utils';
import { StateStore } from '../state/StateStore';

export interface CommonHandlerDeps {
  postMessage: (message: Record<string, unknown>) => void;
  openLocation: (uri: string, line: number, character: number) => Promise<void>;
  sendModules: () => Promise<void>;
  sendCurrentDirectory: () => void;
  sendWorkspaceInfo: () => void;
  sendFileContent: (uri: string, query: string, options: SearchOptions, activeIndex?: number) => Promise<void>;
  applyEdits: (uri: string, content: string) => Promise<void>;
  stateStore?: StateStore;
}

export function registerCommonHandlers(handler: MessageHandler, deps: CommonHandlerDeps) {
  handler.registerHandler('runSearch', async (message) => {
    const msg = message as { query: string; scope: SearchScope; options: SearchOptions; directoryPath?: string; modulePath?: string; };
    console.log('[Rifler] runSearch handler called:', {
      query: msg.query,
      scope: msg.scope,
      hasDirectoryPath: !!msg.directoryPath,
      directoryPath: msg.directoryPath,
      options: msg.options
    });
    const results = await performSearch(
      msg.query,
      msg.scope,
      msg.options,
      msg.directoryPath,
      msg.modulePath
    );
    console.log('[Rifler] Search returned', results.length, 'results');
    deps.postMessage({ type: 'searchResults', results, maxResults: 10000 });
  });

  handler.registerHandler('openLocation', async (message) => {
    const msg = message as { uri: string; line: number; character: number; };
    await deps.openLocation(msg.uri, msg.line, msg.character);
  });

  handler.registerHandler('getModules', async () => {
    await deps.sendModules();
  });

  handler.registerHandler('getCurrentDirectory', async () => {
    deps.sendCurrentDirectory();
  });

  handler.registerHandler('getWorkspaceInfo', async () => {
    deps.sendWorkspaceInfo();
  });

  handler.registerHandler('validateDirectory', async (message) => {
    const msg = message as { directoryPath: string };
    console.log('[Rifler Backend] Validating directory:', msg.directoryPath);
    try {
      const uri = vscode.Uri.file(msg.directoryPath);
      const stat = await vscode.workspace.fs.stat(uri);
      const exists = stat.type === vscode.FileType.Directory;
      console.log('[Rifler Backend] Directory exists:', exists);
      deps.postMessage({ type: 'directoryValidationResult', exists });
    } catch (error) {
      console.log('[Rifler Backend] Directory validation error:', error);
      deps.postMessage({ type: 'directoryValidationResult', exists: false });
    }
  });

  handler.registerHandler('getFileContent', async (message) => {
    const msg = message as { uri: string; query: string; options: SearchOptions; activeIndex?: number; };
    await deps.sendFileContent(msg.uri, msg.query, msg.options, msg.activeIndex);
  });

  handler.registerHandler('applyEdits', async (message) => {
    const msg = message as { uri: string; content: string };
    await deps.applyEdits(msg.uri, msg.content);
  });

  handler.registerHandler('replaceOne', async (message) => {
    const msg = message as { uri: string; line: number; character: number; length: number; replaceText: string };
    await replaceOne(msg.uri, msg.line, msg.character, msg.length, msg.replaceText);
  });

  handler.registerHandler('replaceAll', async (message) => {
    const msg = message as { query: string; replaceText: string; scope: SearchScope; options: SearchOptions; directoryPath?: string; modulePath?: string; };
    await replaceAll(
      msg.query,
      msg.replaceText,
      msg.scope,
      msg.options,
      msg.directoryPath,
      msg.modulePath,
      async () => {
        // After replace, re-run search and post updated results
        const results = await performSearch(
          msg.query,
          msg.scope,
          msg.options,
          msg.directoryPath,
          msg.modulePath
        );
        deps.postMessage({ type: 'searchResults', results, maxResults: 10000 });
      }
    );
  });

  handler.registerHandler('validateRegex', async (message) => {
    const msg = message as { pattern: string; useRegex: boolean };
    const result = validateRegex(msg.pattern, msg.useRegex);
    deps.postMessage({ type: 'validationResult', field: 'regex', isValid: result.isValid, error: result.error });
  });

  handler.registerHandler('validateFileMask', async (message) => {
    const msg = message as { fileMask: string };
    const result = validateFileMask(msg.fileMask);
    deps.postMessage({ type: 'validationResult', field: 'fileMask', isValid: result.isValid, message: result.message, fallbackToAll: result.fallbackToAll });
  });

  handler.registerHandler('__diag_ping', async () => {
    console.log('Received webview diag ping');
  });

  // Test-only: echo search completion back to webview so e2e hooks can resolve
  handler.registerHandler('__test_searchCompleted', async (message) => {
    const msg = message as { results?: unknown[] };
    deps.postMessage({ type: '__test_searchCompleted', results: msg.results });
  });

  handler.registerHandler('executeCommand', async (message) => {
    const msg = message as { command: string; args?: unknown[] };
    await vscode.commands.executeCommand(msg.command, ...(msg.args || []));
  });

  handler.registerHandler('error', async (message) => {
    const msg = message as { message: string; source?: string; lineno?: number; colno?: number; error?: unknown };
    console.error('Webview error:', msg.message, msg);
  });

  handler.registerHandler('previewPanelToggled', async (message) => {
    const msg = message as { collapsed: boolean };
    if (deps.stateStore) {
      deps.stateStore.setPreviewPanelCollapsed(msg.collapsed);
    }
  });
}
