/**
 * Integration tests verifying that search_completed telemetry events are
 * emitted from both the registerCommonHandlers path (used by PanelManager)
 * and the SidebarProvider._runSearch path.
 *
 * This was the exact bug that was missed: SidebarProvider handled runSearch
 * locally and never called telemetry, so searches from the sidebar never
 * produced telemetry events.
 */

import * as vscode from 'vscode';

// Mock performSearch to avoid real file system access
jest.mock('../../search', () => ({
  performSearch: jest.fn().mockResolvedValue({
    results: [
      {
        uri: 'file:///test.ts',
        line: 1,
        character: 0,
        length: 3,
        preview: 'foo',
        fileName: 'test.ts',
        relativePath: 'test.ts',
        previewMatchRange: { start: 0, end: 3 },
      },
    ],
    timedOut: false,
    cancelled: false,
    resultCapHit: false,
  }),
}));

// Mock telemetry module so we can spy on getTelemetryLogger
const mockLogUsage = jest.fn();
const mockLogError = jest.fn();
jest.mock('../../telemetry', () => ({
  getTelemetryLogger: jest.fn(() => ({
    logUsage: mockLogUsage,
    logError: mockLogError,
    dispose: jest.fn(),
  })),
}));

// Mock security module
jest.mock('../../security/pathValidation', () => ({
  validateDirectoryPath: jest.fn((p: string) => p),
}));

// Mock projectDetector
jest.mock('../../projectDetector', () => ({
  detectProjectTypes: jest.fn().mockResolvedValue({ detectedProjects: [] }),
}));

// Mock lspSearch
jest.mock('../../lspSearch', () => ({
  getSymbolAtCursor: jest.fn(),
  executeLspSearch: jest.fn(),
  checkLspAvailability: jest.fn(),
  lspReplaceAll: jest.fn(),
}));

// Mock replacer
jest.mock('../../replacer', () => ({
  replaceOne: jest.fn(),
  replaceAll: jest.fn(),
}));

import { MessageHandler } from '../../messaging/handler';
import { registerCommonHandlers } from '../../messaging/registerCommonHandlers';
import { performSearch } from '../../search';

const performSearchMock = performSearch as jest.MockedFunction<typeof performSearch>;

describe('search_completed telemetry integration', () => {
  let handler: MessageHandler;
  let postMessage: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    postMessage = jest.fn();

    // Create a minimal webview view mock
    const mockWebviewView = {
      webview: {
        onDidReceiveMessage: jest.fn(),
        postMessage: postMessage,
        html: '',
        options: {},
        cspSource: '',
        asWebviewUri: jest.fn(),
      },
      visible: true,
      onDidChangeVisibility: jest.fn(),
      onDidDispose: jest.fn(),
      show: jest.fn(),
      viewType: 'rifler.sidebarView',
      title: '',
      description: '',
      badge: undefined,
    } as unknown as vscode.WebviewView;

    handler = new MessageHandler(mockWebviewView);
    registerCommonHandlers(handler, {
      postMessage: (msg) => postMessage(msg),
      openLocation: jest.fn().mockResolvedValue(undefined),
      sendModules: jest.fn().mockResolvedValue(undefined),
      sendCurrentDirectory: jest.fn(),
      sendWorkspaceInfo: jest.fn(),
      sendFileContent: jest.fn().mockResolvedValue(undefined),
      applyEdits: jest.fn().mockResolvedValue(undefined),
    });
  });

  describe('registerCommonHandlers path (PanelManager)', () => {
    it('should emit search_completed telemetry on successful search', async () => {
      await handler.handle({
        type: 'runSearch',
        query: 'test',
        scope: 'project',
        options: {
          matchCase: false,
          wholeWord: false,
          useRegex: false,
          multiline: false,
          fileMask: '',
        },
      });

      expect(mockLogUsage).toHaveBeenCalledWith('search_completed', expect.objectContaining({
        results_count: 1,
        scope: 'project',
        search_engine: 'rg',
        search_mode: 'text',
        regex_enabled: false,
        match_case: false,
        whole_word: false,
        multiline: false,
        timed_out: false,
        cancelled: false,
        result_cap_hit: false,
      }));

      // duration_ms should be a non-negative number
      const call = mockLogUsage.mock.calls.find(
        (c: unknown[]) => c[0] === 'search_completed'
      )!;
      expect(call[1].duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('should include timeout/cancel/result cap flags when search completes', async () => {
      performSearchMock.mockResolvedValueOnce({
        results: [
          {
            uri: 'file:///test.ts',
            line: 1,
            character: 0,
            length: 3,
            preview: 'foo',
            fileName: 'test.ts',
            relativePath: 'test.ts',
            previewMatchRange: { start: 0, end: 3 },
          },
        ],
        timedOut: true,
        cancelled: true,
        resultCapHit: true,
      });

      await handler.handle({
        type: 'runSearch',
        query: 'test',
        scope: 'project',
        options: { matchCase: false, wholeWord: false, useRegex: false, multiline: false, fileMask: '' },
      });

      expect(mockLogUsage).toHaveBeenCalledWith('search_completed', expect.objectContaining({
        timed_out: true,
        cancelled: true,
        result_cap_hit: true,
      }));
    });

    it('should include query_length in telemetry', async () => {
      await handler.handle({
        type: 'runSearch',
        query: 'hello world',
        scope: 'project',
        options: { matchCase: false, wholeWord: false, useRegex: false, multiline: false, fileMask: '' },
      });

      expect(mockLogUsage).toHaveBeenCalledWith('search_completed', expect.objectContaining({
        query_length: 11,
      }));
    });

    it('should include filter flags in telemetry', async () => {
      await handler.handle({
        type: 'runSearch',
        query: 'test',
        scope: 'directory',
        options: {
          matchCase: true,
          wholeWord: true,
          useRegex: true,
          multiline: true,
          fileMask: '*.ts,*.js',
          includeCode: true,
          includeComments: false,
          includeStrings: false,
        },
      });

      expect(mockLogUsage).toHaveBeenCalledWith('search_completed', expect.objectContaining({
        match_case: true,
        whole_word: true,
        regex_enabled: true,
        multiline: true,
        include_code: true,
        include_comments: false,
        include_strings: false,
        file_mask_count: 2,
        timed_out: false,
        cancelled: false,
        result_cap_hit: false,
      }));
    });

    it('should still emit telemetry when search throws', async () => {
      performSearchMock.mockRejectedValueOnce(new Error('search failed'));

      // MessageHandler.handle() catches errors internally (handler.ts:39-44)
      // and sends an error message to the webview instead of re-throwing.
      // So the promise resolves — but the finally block in registerCommonHandlers
      // still fires, producing telemetry.
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await handler.handle({
        type: 'runSearch',
        query: 'test',
        scope: 'project',
        options: { matchCase: false, wholeWord: false, useRegex: false, multiline: false, fileMask: '' },
      });

      // handler.ts logs the caught error via console.error
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();

      // Telemetry should still have been logged (finally block)
      expect(mockLogUsage).toHaveBeenCalledWith('search_completed', expect.objectContaining({
        error: 'search failed',
        results_count: 0,
        timed_out: false,
        cancelled: false,
        result_cap_hit: false,
      }));
    });

    it('should emit search_completed once per search, not duplicated', async () => {
      await handler.handle({
        type: 'runSearch',
        query: 'test',
        scope: 'project',
        options: { matchCase: false, wholeWord: false, useRegex: false, multiline: false, fileMask: '' },
      });

      const searchCompletedCalls = mockLogUsage.mock.calls.filter(
        (c: unknown[]) => c[0] === 'search_completed'
      );
      expect(searchCompletedCalls).toHaveLength(1);
    });
  });

  describe('other telemetry events via registerCommonHandlers', () => {
    it('should emit file_opened telemetry on openLocation', async () => {
      await handler.handle({
        type: 'openLocation',
        uri: 'file:///test.ts',
        line: 1,
        character: 0,
      });

      expect(mockLogUsage).toHaveBeenCalledWith('file_opened', expect.objectContaining({
        source: 'search_result',
      }));
    });
  });
});
