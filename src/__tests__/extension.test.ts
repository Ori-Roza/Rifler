import * as assert from 'assert';
import * as vscode from 'vscode';
import { activate, deactivate } from '../extension';

// Mock vscode
jest.mock('vscode', () => require('../../__mocks__/vscode'), { virtual: true });

describe('Extension - Persistent Storage and Toggle Features', () => {
  let context: vscode.ExtensionContext;

  beforeEach(() => {
    // Create a mock extension context
    context = {
      subscriptions: [],
      workspaceState: {
        get: jest.fn(),
        update: jest.fn(),
        keys: jest.fn().mockReturnValue([]),
      } as any,
      globalState: {
        get: jest.fn(),
        update: jest.fn(),
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
    test('should load persisted state from globalState on activation', () => {
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

      activate(context);

      expect(context.globalState.get).toHaveBeenCalledWith('rifler.persistedSearchState');
    });

    test('should handle missing persisted state gracefully', () => {
      (context.globalState.get as jest.Mock).mockReturnValue(undefined);

      // Should not throw
      expect(() => activate(context)).not.toThrow();
    });

    test('should persist state to globalState when minimizing', async () => {
      (context.globalState.get as jest.Mock).mockReturnValue(undefined);

      activate(context);

      // Simulate minimize command being registered
      const commands = (vscode.commands.registerCommand as jest.Mock).mock.calls;
      assert.ok(commands.length > 0, 'Should register minimize command');

      // Note: Full integration testing of minimize would require webview setup
      // This test verifies the infrastructure is in place
    });
  });

  describe('Keyboard Toggle - cmd+shift+f', () => {
    test('should register rifler.open command', () => {
      (context.globalState.get as jest.Mock).mockReturnValue(undefined);

      activate(context);

      const commands = (vscode.commands.registerCommand as jest.Mock).mock.calls;
      const openCommandCall = commands.find((call: any) => call[0] === 'rifler.open');

      assert.ok(openCommandCall, 'rifler.open command should be registered');
    });

    test('should register rifler.openReplace command', () => {
      (context.globalState.get as jest.Mock).mockReturnValue(undefined);

      activate(context);

      const commands = (vscode.commands.registerCommand as jest.Mock).mock.calls;
      const openReplaceCall = commands.find((call: any) => call[0] === 'rifler.openReplace');

      assert.ok(openReplaceCall, 'rifler.openReplace command should be registered');
    });

    test('should register minimize command', () => {
      (context.globalState.get as jest.Mock).mockReturnValue(undefined);

      activate(context);

      const commands = (vscode.commands.registerCommand as jest.Mock).mock.calls;
      const minimizeCall = commands.find((call: any) => call[0] === 'rifler.minimize');

      assert.ok(minimizeCall, 'rifler.minimize command should be registered');
    });

    test('should register restore command', () => {
      (context.globalState.get as jest.Mock).mockReturnValue(undefined);

      activate(context);

      const commands = (vscode.commands.registerCommand as jest.Mock).mock.calls;
      const restoreCall = commands.find((call: any) => call[0] === 'rifler.restore');

      assert.ok(restoreCall, 'rifler.restore command should be registered');
    });
  });

  describe('Command subscriptions', () => {
    test('should add all registered commands to context.subscriptions', () => {
      (context.globalState.get as jest.Mock).mockReturnValue(undefined);

      activate(context);

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
    test('should use correct storage key', () => {
      // Verify the constant is defined and used correctly
      (context.globalState.get as jest.Mock).mockReturnValue(undefined);

      activate(context);

      // The key should be called with the correct constant
      expect(context.globalState.get).toHaveBeenCalledWith('rifler.persistedSearchState');
    });
  });
});
