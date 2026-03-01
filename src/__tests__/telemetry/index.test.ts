import * as vscode from 'vscode';

// We need to re-import the module fresh for each test because it has
// module-level state (telemetryLogger, sender, outputChannel).
// We also mock the sender to avoid real HTTP calls.

jest.mock('../../telemetry/sender', () => ({
  createTelemetrySender: jest.fn(() => ({
    sendEventData: jest.fn(),
    sendErrorData: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { createTelemetrySender } from '../../telemetry/sender';
import { initTelemetry, getTelemetryLogger, disposeTelemetry, showTelemetryOutput } from '../../telemetry';

const mockedCreateSender = createTelemetrySender as jest.MockedFunction<typeof createTelemetrySender>;

function createMockContext(): vscode.ExtensionContext {
  return {
    subscriptions: [],
    extensionUri: vscode.Uri.parse('file:///test'),
    extensionPath: '/test',
    globalState: {
      get: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      keys: jest.fn().mockReturnValue([]),
      setKeysForSync: jest.fn(),
    },
    workspaceState: {
      get: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      keys: jest.fn().mockReturnValue([]),
    },
    secrets: {
      get: jest.fn(),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn(),
    },
    globalStorageUri: vscode.Uri.parse('file:///global-storage'),
    storageUri: vscode.Uri.parse('file:///storage'),
    logUri: vscode.Uri.parse('file:///logs'),
    extensionMode: 3, // ExtensionMode.Production
    environmentVariableCollection: {} as unknown as vscode.GlobalEnvironmentVariableCollection,
    storagePath: '/storage',
    globalStoragePath: '/global-storage',
    logPath: '/logs',
    asAbsolutePath: jest.fn((p) => `/test/${p}`),
    extension: {} as unknown as vscode.Extension<unknown>,
    languageModelAccessInformation: {} as unknown as vscode.LanguageModelAccessInformation,
  } as unknown as vscode.ExtensionContext;
}

describe('Telemetry Index', () => {
  let context: vscode.ExtensionContext;
  let mockSender: ReturnType<typeof createTelemetrySender>;

  beforeEach(() => {
    jest.clearAllMocks();
    context = createMockContext();

    mockSender = {
      sendEventData: jest.fn(),
      sendErrorData: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined),
    };
    mockedCreateSender.mockReturnValue(mockSender);
  });

  describe('initTelemetry', () => {
    it('should create output channel and sender', () => {
      initTelemetry(context);

      expect(vscode.window.createOutputChannel).toHaveBeenCalledWith('Rifler Telemetry');
      expect(mockedCreateSender).toHaveBeenCalled();
    });

    it('should add logger and channel to context subscriptions', () => {
      initTelemetry(context);

      // Should push telemetryLogger and output channel
      expect(context.subscriptions.length).toBeGreaterThanOrEqual(2);
    });

    it('should create sender with enrichBase that includes machine_id and session_id', () => {
      initTelemetry(context);

      const enrichBase = mockedCreateSender.mock.calls[0][1];
      const enriched = enrichBase();
      expect(enriched).toEqual(expect.objectContaining({
        machine_id: 'test-machine-id',
        session_id: 'test-session-id',
      }));
    });
  });

  describe('getTelemetryLogger', () => {
    it('should return the logger after init', () => {
      initTelemetry(context);

      const logger = getTelemetryLogger();
      expect(logger).toBeDefined();
      expect(typeof logger?.logUsage).toBe('function');
      expect(typeof logger?.logError).toBe('function');
    });

    it('logUsage should delegate to sender.sendEventData', () => {
      initTelemetry(context);

      const logger = getTelemetryLogger()!;
      logger.logUsage('test_event', { key: 'value' });

      expect(mockSender.sendEventData).toHaveBeenCalledWith('test_event', { key: 'value' });
    });

    it('logError should delegate to sender.sendErrorData', () => {
      initTelemetry(context);

      const logger = getTelemetryLogger()!;
      const error = new Error('test error');
      logger.logError(error, { context: 'test' });

      expect(mockSender.sendErrorData).toHaveBeenCalledWith(error, { context: 'test' });
    });
  });

  describe('disposeTelemetry', () => {
    it('should flush the sender on dispose', async () => {
      initTelemetry(context);

      await disposeTelemetry();

      expect(mockSender.flush).toHaveBeenCalled();
    });
  });

  describe('showTelemetryOutput', () => {
    it('should call show on the output channel', () => {
      initTelemetry(context);

      showTelemetryOutput();

      const mockChannel = (vscode.window.createOutputChannel as jest.Mock).mock.results[0].value;
      expect(mockChannel.show).toHaveBeenCalledWith(true);
    });
  });

  describe('shim logger behavior', () => {
    it('logUsage with search_completed should reach sender', () => {
      initTelemetry(context);
      const logger = getTelemetryLogger()!;

      logger.logUsage('search_completed', {
        duration_ms: 150,
        results_count: 42,
        scope: 'project',
      });

      expect(mockSender.sendEventData).toHaveBeenCalledWith('search_completed', {
        duration_ms: 150,
        results_count: 42,
        scope: 'project',
      });
    });

    it('logUsage with undefined data should still call sender', () => {
      initTelemetry(context);
      const logger = getTelemetryLogger()!;

      logger.logUsage('extension_activated', undefined);

      expect(mockSender.sendEventData).toHaveBeenCalledWith('extension_activated', undefined);
    });
  });
});
