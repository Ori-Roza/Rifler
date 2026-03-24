import * as vscode from 'vscode';
import { MessageHandler } from './handler';
import { performSearch, SearchOutcome } from '../search';
import { replaceOne, replaceAll } from '../replacer';
import { validateRegex, validateFileMask, SearchOptions, SearchScope, SearchResult } from '../utils';
import { getTelemetryLogger } from '../telemetry';
import { validateDirectoryPath } from '../security/pathValidation';
import { StateStore } from '../state/StateStore';
import { detectProjectTypes } from '../projectDetector';
import {
  getSymbolAtCursor,
  executeLspSearch,
  checkLspAvailability,
  lspReplaceAll,
  LspSearchMode,
} from '../lspSearch';

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

let lastSearchTelemetry: Record<string, unknown> | undefined;

export function registerCommonHandlers(handler: MessageHandler, deps: CommonHandlerDeps) {
  handler.registerHandler('runSearch', async (message) => {
    const msg = message as { query: string; scope: SearchScope; options: SearchOptions; directoryPath?: string; modulePath?: string; smartExcludesEnabled?: boolean; exclusionPatterns?: string };

    const telemetryLogger = getTelemetryLogger();

    const startTime = Date.now();

    const mergedFileMask = (msg.smartExcludesEnabled && msg.exclusionPatterns)
      ? (msg.options.fileMask ? `${msg.options.fileMask},${msg.exclusionPatterns}` : msg.exclusionPatterns)
      : (msg.options.fileMask || '');

    if (msg.scope === 'directory' && msg.query?.trim().length > 0 && msg.query.trim().length < 3) {
      deps.postMessage({
        type: 'error',
        message: 'Directory scope requires at least 3 characters.'
      });
      deps.postMessage({ type: 'searchResults', results: [], maxResults: 10000 });
      return;
    }

    let directoryPath = msg.directoryPath;
    if (msg.scope === 'directory' && msg.directoryPath && vscode.workspace.workspaceFolders?.length) {
      try {
        directoryPath = validateDirectoryPath(msg.directoryPath);
      } catch (error) {
        console.warn('[Rifler] Blocking directory scope search due to invalid path:', error);
        deps.postMessage({
          type: 'error',
          message: 'Directory path must be within the workspace.'
        });
        deps.postMessage({ type: 'searchResults', results: [], maxResults: 10000 });
        return;
      }
    }

    let results: SearchResult[] = [];
    let searchError: string | undefined;
    let searchOutcome: SearchOutcome | undefined;
    try {
      searchOutcome = await performSearch(
        msg.query,
        msg.scope,
        { ...msg.options, fileMask: mergedFileMask },
        directoryPath,
        msg.modulePath,
        10000,
        msg.smartExcludesEnabled ?? true
      );
      results = searchOutcome.results;
      console.log('[Rifler] Search returned', results.length, 'results');
    } catch (error) {
      searchError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      const durationMs = Date.now() - startTime;
      const timedOut = searchOutcome?.timedOut ?? false;
      const cancelled = searchOutcome?.cancelled ?? false;
      const resultCapHit = searchOutcome?.resultCapHit ?? false;

      telemetryLogger?.logUsage('search_completed', {
        duration_ms: durationMs,
        results_count: results.length,
        query_length: msg.query?.length ?? 0,
        search_engine: 'rg',
        scope: msg.scope,
        search_mode: 'text',
        regex_enabled: !!msg.options.useRegex,
        match_case: !!msg.options.matchCase,
        whole_word: !!msg.options.wholeWord,
        multiline: !!msg.options.multiline,
        smart_excludes_enabled: msg.smartExcludesEnabled ?? true,
        include_code: msg.options.includeCode ?? true,
        include_comments: msg.options.includeComments ?? true,
        include_strings: msg.options.includeStrings ?? true,
        file_mask_count: (mergedFileMask ? mergedFileMask.split(/[;,]+/).filter(Boolean).length : 0),
        has_exclusion_patterns: !!msg.exclusionPatterns,
        query_rows: (message as { queryRows?: number }).queryRows ?? 1,
        timed_out: timedOut,
        cancelled,
        result_cap_hit: resultCapHit,
        error: searchError,
      });

      lastSearchTelemetry = {
        event: 'search_completed',
        duration_ms: durationMs,
        results_count: results.length,
        query_length: msg.query?.length ?? 0,
        search_engine: 'rg',
        scope: msg.scope,
        search_mode: 'text',
        regex_enabled: !!msg.options.useRegex,
        match_case: !!msg.options.matchCase,
        whole_word: !!msg.options.wholeWord,
        multiline: !!msg.options.multiline,
        smart_excludes_enabled: msg.smartExcludesEnabled ?? true,
        include_code: msg.options.includeCode ?? true,
        include_comments: msg.options.includeComments ?? true,
        include_strings: msg.options.includeStrings ?? true,
        file_mask_count: (mergedFileMask ? mergedFileMask.split(/[;,]+/).filter(Boolean).length : 0),
        has_exclusion_patterns: !!msg.exclusionPatterns,
        query_rows: (message as { queryRows?: number }).queryRows ?? 1,
        timed_out: timedOut,
        cancelled,
        result_cap_hit: resultCapHit,
        error: searchError,
      };
    }

    if (deps.stateStore) {
      deps.stateStore.recordSearch({
        query: msg.query,
        scope: msg.scope,
        directoryPath: msg.directoryPath,
        modulePath: msg.modulePath,
        options: {
          matchCase: !!msg.options.matchCase,
          wholeWord: !!msg.options.wholeWord,
          useRegex: !!msg.options.useRegex,
          fileMask: msg.options.fileMask || '',
          includeCode: msg.options.includeCode ?? true,
          includeComments: msg.options.includeComments ?? true,
          includeStrings: msg.options.includeStrings ?? true
        }
      });
      deps.postMessage({ type: 'searchHistory', entries: deps.stateStore.getSearchHistory() });
    }

    deps.postMessage({ type: 'searchResults', results, maxResults: 10000, telemetry: lastSearchTelemetry });
  });

  handler.registerHandler('__test_clearSearchHistory', async () => {
    if (!deps.stateStore) return;
    deps.stateStore.clearSearchHistory();
    deps.postMessage({ type: 'searchHistory', entries: deps.stateStore.getSearchHistory() });
  });

  handler.registerHandler('clearSearchHistory', async () => {
    console.log('[Rifler Extension] clearSearchHistory handler called');
    if (!deps.stateStore) {
      console.log('[Rifler Extension] No stateStore available');
      return;
    }
    deps.stateStore.clearSearchHistory();
    console.log('[Rifler Extension] History cleared, sending update to webview');
    deps.postMessage({ type: 'searchHistory', entries: deps.stateStore.getSearchHistory() });
  });

  handler.registerHandler('openLocation', async (message) => {
    const msg = message as { uri: string; line: number; character: number; };
    await deps.openLocation(msg.uri, msg.line, msg.character);
    const telemetryLogger = getTelemetryLogger();
    telemetryLogger?.logUsage('file_opened', {
      source: 'search_result',
    });
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

  handler.registerHandler('requestSelectionRefresh', async () => {
    const editor = vscode.window.activeTextEditor;
    let selectedText: string | undefined;

    if (editor && !editor.selection.isEmpty) {
      const rawText = editor.document.getText(editor.selection);
      const trimmedText = rawText.trim();
      if (trimmedText.length >= 2) {
        selectedText = trimmedText;
      }
    }

    if (selectedText) {
      deps.postMessage({ type: 'setSearchQuery', query: selectedText });
    } else {
      deps.postMessage({ type: 'focusSearch' });
    }
  });

  handler.registerHandler('validateDirectory', async (message) => {
    const msg = message as { directoryPath: string };
    console.log('[Rifler Backend] Validating directory:', msg.directoryPath);
    try {
      if (msg.directoryPath && vscode.workspace.workspaceFolders?.length) {
        validateDirectoryPath(msg.directoryPath);
      }
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
    const telemetryLogger = getTelemetryLogger();
    telemetryLogger?.logUsage('replace_one', {
      is_regex: false,
    });
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
        deps.postMessage({ type: 'searchResults', results: results.results, maxResults: 10000 });
      }
    );
    const telemetryLogger = getTelemetryLogger();
    telemetryLogger?.logUsage('replace_all', {
      scope: msg.scope,
      is_regex: !!msg.options.useRegex,
      match_case: !!msg.options.matchCase,
      whole_word: !!msg.options.wholeWord,
    });
  });

  handler.registerHandler('validateRegex', async (message) => {
    const msg = message as { pattern: string; useRegex: boolean; multiline?: boolean };
    const result = validateRegex(msg.pattern, msg.useRegex, !!msg.multiline);
    deps.postMessage({ type: 'validationResult', field: 'regex', isValid: result.isValid, error: result.error });
  });

  handler.registerHandler('validateFileMask', async (message) => {
    const msg = message as { fileMask: string };
    const result = validateFileMask(msg.fileMask);
    deps.postMessage({ type: 'validationResult', field: 'fileMask', isValid: result.isValid, message: result.message, fallbackToAll: result.fallbackToAll });
  });

  // UI-only / client-side state messages (no backend action required).
  // These may be emitted by the webview (especially during E2E automation).
  handler.registerHandler('toggleReplace', async () => {
    // no-op
  });

  handler.registerHandler('validationResult', async () => {
    // no-op
  });

  handler.registerHandler('__diag_ping', async () => {
    console.log('Received webview diag ping');
  });

  // Test-only: echo search completion back to webview so e2e hooks can resolve
  handler.registerHandler('__test_searchCompleted', async (message) => {
    const msg = message as { results?: unknown[] };
    deps.postMessage({
      type: '__test_searchCompleted',
      results: msg.results,
      telemetry: lastSearchTelemetry,
    });
  });

  handler.registerHandler('executeCommand', async (message) => {
    const msg = message as { command: string; args?: unknown[] };
    const allowedCommands = new Set<string>([
      // Intentionally empty until a concrete webview use-case is defined.
    ]);
    if (!allowedCommands.has(msg.command)) {
      console.warn('[Rifler] Blocked executeCommand from webview:', msg.command);
      return;
    }
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

  handler.registerHandler('getProjectExclusions', async () => {
    console.log('[Rifler] getProjectExclusions handler called');
    const detectedProjects = await detectProjectTypes();
    console.log('[Rifler] Detected projects:', detectedProjects);
    
    // Load saved preferences from state if available
    let projects = detectedProjects.detectedProjects;
    if (deps.stateStore) {
      const savedPreferences = deps.stateStore.getProjectExclusionPreferences();
      console.log('[Rifler] Loaded saved preferences:', savedPreferences);
      projects = projects.map(project => ({
        ...project,
        enabled: savedPreferences[project.id] ?? project.enabled
      }));
    }
    
    console.log('[Rifler] Sending projectExclusions message with', projects.length, 'projects');
    deps.postMessage({ type: 'projectExclusions', projects });
  });

  handler.registerHandler('updateProjectExclusions', async (message) => {
    const msg = message as { projects: Array<{ id: string; enabled: boolean }> };
    if (deps.stateStore) {
      const preferences: Record<string, boolean> = {};
      msg.projects.forEach(p => {
        preferences[p.id] = p.enabled;
      });
      deps.stateStore.setProjectExclusionPreferences(preferences);
    }
  });

  // ========================================================================
  // LSP / Usage-Aware Search Handlers
  // ========================================================================

  handler.registerHandler('getSymbolAtCursor', async () => {
    const symbolInfo = getSymbolAtCursor();
    if (!symbolInfo) {
      deps.postMessage({
        type: 'symbolAtCursor',
        symbolName: null,
        languageId: '',
        lspAvailable: false,
      });
      return;
    }

    const lspAvailable = await checkLspAvailability(symbolInfo.uri, symbolInfo.position);
    deps.postMessage({
      type: 'symbolAtCursor',
      symbolName: symbolInfo.symbolName,
      languageId: symbolInfo.languageId,
      lspAvailable,
    });
  });

  handler.registerHandler('lspSearch', async (message) => {
    const msg = message as { lspMode: LspSearchMode };
    const symbolInfo = getSymbolAtCursor();

    if (!symbolInfo) {
      deps.postMessage({
        type: 'searchResults',
        results: [],
        lspMode: msg.lspMode,
        lspInfo: { languageId: '', symbolName: '', confidence: 'partial' as const },
      });
      deps.postMessage({
        type: 'error',
        message: 'No symbol found at cursor position. Place your cursor on a symbol and try again.',
      });
      return;
    }

    const lspAvailable = await checkLspAvailability(symbolInfo.uri, symbolInfo.position);
    if (!lspAvailable) {
      deps.postMessage({
        type: 'searchResults',
        results: [],
        lspMode: msg.lspMode,
        lspInfo: {
          languageId: symbolInfo.languageId,
          symbolName: symbolInfo.symbolName,
          confidence: 'partial',
        },
      });
      deps.postMessage({
        type: 'error',
        message: `Language server not available for ${symbolInfo.languageId}. Falling back to text search.`,
      });
      return;
    }

    console.log(`[Rifler LSP] Searching ${msg.lspMode} for "${symbolInfo.symbolName}" in ${symbolInfo.languageId}`);
    const results = await executeLspSearch(symbolInfo.uri, symbolInfo.position, msg.lspMode);

    // Dynamic languages might miss references
    const dynamicLanguages = new Set(['javascript', 'python', 'ruby', 'php', 'lua']);
    const confidence = dynamicLanguages.has(symbolInfo.languageId) ? 'partial' : 'high';

    deps.postMessage({
      type: 'searchResults',
      results,
      lspMode: msg.lspMode,
      lspInfo: {
        languageId: symbolInfo.languageId,
        symbolName: symbolInfo.symbolName,
        confidence,
      },
    });
  });

  handler.registerHandler('lspReplaceAll', async (message) => {
    const msg = message as { lspMode: LspSearchMode; replaceText: string };
    const symbolInfo = getSymbolAtCursor();

    if (!symbolInfo) {
      deps.postMessage({
        type: 'error',
        message: 'No symbol found at cursor. Cannot perform LSP replace.',
      });
      return;
    }

    const { replacedCount, results } = await lspReplaceAll(
      symbolInfo.uri,
      symbolInfo.position,
      msg.lspMode,
      msg.replaceText
    );

    if (replacedCount > 0) {
      vscode.window.showInformationMessage(
        `Rifler: Replaced ${replacedCount} usage(s) of "${symbolInfo.symbolName}" with "${msg.replaceText}"`
      );
    }

    deps.postMessage({
      type: 'searchResults',
      results,
      lspMode: msg.lspMode,
      lspInfo: {
        languageId: symbolInfo.languageId,
        symbolName: symbolInfo.symbolName,
        confidence: 'high',
      },
    });
  });

  handler.registerHandler('triggerRename', async () => {
    await vscode.commands.executeCommand('editor.action.rename');
  });
}
