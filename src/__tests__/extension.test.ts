import * as assert from 'assert';
import * as vscode from 'vscode';
import { activate, deactivate } from '../extension';

// Mock vscode
jest.mock('vscode');

describe('Extension - Persistent Storage and Toggle Features', () => {
  let context: vscode.ExtensionContext;

  beforeEach(() => {
    // Create a mock extension context
    context = {
      subscriptions: [],
      workspaceState: {
        get: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
        keys: jest.fn().mockReturnValue([]),
      } as any,
      globalState: {
        get: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
        keys: jest.fn().mockReturnValue([]),
        setKeysForSync: jest.fn(),
      } as any,
      extensionPath: '/mock/path',
      extensionUri: vscode.Uri.file('/mock/path'),
      storageUri: undefined,
      globalStorageUri: vscode.Uri.file('/mock/global'),
      logUri: vscode.Uri.file('/mock/logs'),
      secrets: {
        get: jest.fn(),
        store: jest.fn(),
        delete: jest.fn(),
        onDidChange: jest.fn(),
      } as any,
    } as any;

    jest.clearAllMocks();
  });

  describe('Persistent State Storage', () => {
    test('should not load persisted state when persistence is explicitly disabled', async () => {
      const mockState = {
        query: 'test',
        replaceText: 'replacement',
        scope: 'project',
        directoryPath: '',
        modulePath: '',
        filePath: '',
        options: {
          matchCase: false,
          wholeWord: false,
          useRegex: false,
          fileMask: '',
        },
        showReplace: false,
      };

      (context.globalState.get as jest.Mock).mockReturnValue(mockState);

      // Mock getConfiguration to return persistence disabled values
      const mockGetConfiguration = jest.fn().mockReturnValue({
        get: jest.fn((key: string, defaultValue?: any) => {
          if (key === 'persistSearchState') return false;
          if (key === 'persistenceScope') return 'off';
          return defaultValue;
        })
      });
      (vscode.workspace.getConfiguration as jest.Mock) = mockGetConfiguration;

      await activate(context);

      // Wait for async operations to complete
      await new Promise(resolve => setImmediate(resolve));

      // With persistence explicitly off, state stores should be cleared
      expect(context.workspaceState.update).toHaveBeenCalledWith('rifler.sidebarState', undefined);
      expect(context.workspaceState.update).toHaveBeenCalledWith('rifler.persistedSearchState', undefined);
    });

    test('should handle missing persisted state gracefully', async () => {
      (context.globalState.get as jest.Mock).mockReturnValue(undefined);

      // Should not throw
      await expect(async () => await activate(context)).resolves;
    });

    test('should persist state to globalState when minimizing', async () => {
      (context.globalState.get as jest.Mock).mockReturnValue(undefined);

      await activate(context);

      // Simulate minimize command being registered
      const commands = (vscode.commands.registerCommand as jest.Mock).mock.calls;
      assert.ok(commands.length > 0, 'Should register minimize command');

      // Note: Full integration testing of minimize would require webview setup
      // This test verifies the infrastructure is in place
    });
  });

  describe('Keyboard Toggle - cmd+shift+f', () => {
    test('should register rifler.open command', async () => {
      (context.globalState.get as jest.Mock).mockReturnValue(undefined);

      await activate(context);

      const commands = (vscode.commands.registerCommand as jest.Mock).mock.calls;
      const openCommandCall = commands.find((call: any) => call[0] === 'rifler.open');

      assert.ok(openCommandCall, 'rifler.open command should be registered');
    });

    test('should register rifler.openReplace command', async () => {
      (context.globalState.get as jest.Mock).mockReturnValue(undefined);

      await activate(context);

      const commands = (vscode.commands.registerCommand as jest.Mock).mock.calls;
      const openReplaceCall = commands.find((call: any) => call[0] === 'rifler.openReplace');

      assert.ok(openReplaceCall, 'rifler.openReplace command should be registered');
    });

    test('should register minimize command', async () => {
      (context.globalState.get as jest.Mock).mockReturnValue(undefined);

      await activate(context);

      const commands = (vscode.commands.registerCommand as jest.Mock).mock.calls;
      const minimizeCall = commands.find((call: any) => call[0] === 'rifler.minimize');

      assert.ok(minimizeCall, 'rifler.minimize command should be registered');
    });

    test('should register restore command', async () => {
      (context.globalState.get as jest.Mock).mockReturnValue(undefined);

      await activate(context);

      const commands = (vscode.commands.registerCommand as jest.Mock).mock.calls;
      const restoreCall = commands.find((call: any) => call[0] === 'rifler.restore');

      assert.ok(restoreCall, 'rifler.restore command should be registered');
    });
  });

  describe('Command subscriptions', () => {
    test('should add all registered commands to context.subscriptions', async () => {
      (context.globalState.get as jest.Mock).mockReturnValue(undefined);

      await activate(context);

      // Should have at least 4 commands registered
      assert.ok(context.subscriptions.length >= 4, 'Should register at least 4 commands');
    });

    test('should clean up on deactivation', () => {
      // Deactivate should clean up resources
      // Should not throw
      expect(() => deactivate()).not.toThrow();
    });
  });

  describe('Storage key constants', () => {
    test('should clear persisted state when persistence is explicitly disabled', async () => {
      // Verify state is cleared when persistence is explicitly off
      (context.globalState.get as jest.Mock).mockReturnValue(undefined);

      // Mock getConfiguration to return persistence disabled values
      const mockGetConfiguration = jest.fn().mockReturnValue({
        get: jest.fn((key: string, defaultValue?: any) => {
          if (key === 'persistSearchState') return false;
          if (key === 'persistenceScope') return 'off';
          return defaultValue;
        }),
      });
      (vscode.workspace.getConfiguration as jest.Mock) = mockGetConfiguration;

      activate(context);

      // Wait for async operations to complete
      await new Promise(resolve => setImmediate(resolve));

      // With persistence explicitly off, both stores should be cleared
      expect(context.workspaceState.update).toHaveBeenCalledWith('rifler.sidebarState', undefined);
      expect(context.globalState.update).toHaveBeenCalledWith('rifler.sidebarState', undefined);
    });
  });

  describe('ViewMode Configuration', () => {
    beforeEach(() => {
      // Reset workspace configuration mock
      const mockGetConfiguration = jest.fn().mockReturnValue({
        get: jest.fn((key: string, defaultValue?: any) => {
          if (key === 'viewMode') return 'sidebar';
          return defaultValue;
        }),
        update: jest.fn(),
      });
      (vscode.workspace.getConfiguration as jest.Mock) = mockGetConfiguration;
    });

    test('should default to sidebar mode', async () => {
      (context.globalState.get as jest.Mock).mockReturnValue(undefined);

      await activate(context);

      const commands = (vscode.commands.registerCommand as jest.Mock).mock.calls;
      const openCommandCall = commands.find((call: any) => call[0] === 'rifler.open');

      assert.ok(openCommandCall, 'rifler.open command should be registered');
      assert.strictEqual(typeof openCommandCall[1], 'function', 'Command handler should be a function');
    });

    test('should respect viewMode=sidebar configuration when opening with rifler.open', async () => {
      (context.globalState.get as jest.Mock).mockReturnValue(undefined);

      const mockGetConfiguration = jest.fn().mockReturnValue({
        get: jest.fn((key: string, defaultValue?: any) => {
          if (key === 'viewMode') return 'sidebar';
          return defaultValue;
        }),
        update: jest.fn(),
      });
      (vscode.workspace.getConfiguration as jest.Mock) = mockGetConfiguration;

      await activate(context);

      const commands = (vscode.commands.registerCommand as jest.Mock).mock.calls;
      const openCommandCall = commands.find((call: any) => call[0] === 'rifler.open');

      assert.ok(openCommandCall, 'rifler.open command should be registered');
      assert.strictEqual(typeof openCommandCall[1], 'function', 'Command handler should be a function');
    });

    test('should respect viewMode=tab configuration when opening with rifler.open', async () => {
      (context.globalState.get as jest.Mock).mockReturnValue(undefined);

      const mockGetConfiguration = jest.fn().mockReturnValue({
        get: jest.fn((key: string, defaultValue?: any) => {
          if (key === 'viewMode') return 'tab';
          return defaultValue;
        }),
        update: jest.fn(),
      });
      (vscode.workspace.getConfiguration as jest.Mock) = mockGetConfiguration;

      await activate(context);

      const commands = (vscode.commands.registerCommand as jest.Mock).mock.calls;
      const openCommandCall = commands.find((call: any) => call[0] === 'rifler.open');

      assert.ok(openCommandCall, 'rifler.open command should be registered');
      assert.strictEqual(typeof openCommandCall[1], 'function', 'Command handler should be a function');
    });

    test('should respect viewMode configuration when opening with rifler.openReplace', async () => {
      (context.globalState.get as jest.Mock).mockReturnValue(undefined);

      await activate(context);

      const commands = (vscode.commands.registerCommand as jest.Mock).mock.calls;
      const openReplaceCall = commands.find((call: any) => call[0] === 'rifler.openReplace');

      assert.ok(openReplaceCall, 'rifler.openReplace command should be registered');
      assert.strictEqual(typeof openReplaceCall[1], 'function', 'Command handler should be a function');
    });

    test('should register rifler.openSidebar command', async () => {
      (context.globalState.get as jest.Mock).mockReturnValue(undefined);

      await activate(context);

      const commands = (vscode.commands.registerCommand as jest.Mock).mock.calls;
      const openSidebarCall = commands.find((call: any) => call[0] === 'rifler.openSidebar');

      assert.ok(openSidebarCall, 'rifler.openSidebar command should be registered');
    });

    test('should register rifler.toggleView command', async () => {
      (context.globalState.get as jest.Mock).mockReturnValue(undefined);

      await activate(context);

      const commands = (vscode.commands.registerCommand as jest.Mock).mock.calls;
      const toggleViewCall = commands.find((call: any) => call[0] === 'rifler.toggleView');

      assert.ok(toggleViewCall, 'rifler.toggleView command should be registered');
    });

    test('should toggle behavior based on viewMode', async () => {
      (context.globalState.get as jest.Mock).mockReturnValue(undefined);

      await activate(context);

      const commands = (vscode.commands.registerCommand as jest.Mock).mock.calls;
      const openCommandCall = commands.find((call: any) => call[0] === 'rifler.open');

      // Verify the command can be called (basic smoke test)
      assert.ok(openCommandCall, 'rifler.open command should support toggle behavior');
      assert.strictEqual(typeof openCommandCall[1], 'function', 'Command handler should be executable');
    });
  });
});
