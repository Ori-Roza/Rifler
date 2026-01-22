import * as assert from 'assert';
import * as vscode from 'vscode';
import { StateStore } from '../state/StateStore';

describe('StateStore Tests', () => {
  let mockContext: vscode.ExtensionContext;
  let workspaceStateUpdate: jest.Mock;
  let workspaceStateGet: jest.Mock;
  let configGet: jest.Mock;

  beforeEach(() => {
    configGet = jest.fn((key: string, defaultValue?: any) => {
      switch (key) {
        case 'persistenceScope':
          return 'workspace';
        case 'persistSearchState':
          return true;
        case 'results.showCollapsed':
          return false;
        case 'searchHistory.maxEntries':
          return 5;
        default:
          return defaultValue;
      }
    });

    (vscode.workspace.getConfiguration as unknown as jest.Mock).mockReturnValue({
      get: configGet,
      update: jest.fn().mockResolvedValue(undefined)
    });

    // Create a mock extension context with proper mock implementation
    workspaceStateUpdate = jest.fn().mockResolvedValue(undefined);
    workspaceStateGet = jest.fn((key: string, defaultValue?: any) => defaultValue);

    const mockWorkspaceState = {
      get: workspaceStateGet,
      update: workspaceStateUpdate,
      keys: () => []
    };

    const mockGlobalState = {
      get: (key: string, defaultValue?: any) => defaultValue,
      update: async () => {},
      keys: () => []
    };

    mockContext = {
      globalState: mockGlobalState,
      workspaceState: mockWorkspaceState
    } as unknown as vscode.ExtensionContext;
  });

  describe('Search History', () => {
    test('should record searches and trim to maxEntries (default 5)', () => {
      const store = new StateStore(mockContext);

      for (let i = 0; i < 6; i++) {
        store.recordSearch({
          query: `q${i}`,
          scope: 'project',
          options: { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' }
        });
      }

      const history = store.getSearchHistory();
      assert.strictEqual(history.length, 5);
      assert.strictEqual(history[0].query, 'q5');
      assert.strictEqual(history[4].query, 'q1');
      expect(workspaceStateUpdate).toHaveBeenCalled();
    });

    test('should dedupe by query (case-insensitive) and keep the newest entry', () => {
      const store = new StateStore(mockContext);
      store.recordSearch({
        query: 'Same',
        scope: 'project',
        options: { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' }
      });
      store.recordSearch({
        query: 'same',
        scope: 'directory',
        directoryPath: '/tmp',
        options: { matchCase: true, wholeWord: true, useRegex: false, fileMask: '*.ts' }
      });

      const history = store.getSearchHistory();
      assert.strictEqual(history.length, 1);
      assert.strictEqual(history[0].query, 'same');
      assert.strictEqual(history[0].scope, 'directory');
      assert.strictEqual(history[0].directoryPath, '/tmp');
      assert.strictEqual(history[0].options.matchCase, true);
    });

    test('should record multiline option and query rows', () => {
      const store = new StateStore(mockContext);
      store.recordSearch({
        query: 'foo\nbar',
        scope: 'project',
        options: { matchCase: false, wholeWord: false, useRegex: true, multiline: true, fileMask: '' },
        queryRows: 3
      });

      const history = store.getSearchHistory();
      assert.strictEqual(history[0].options.multiline, true);
      assert.strictEqual(history[0].queryRows, 3);
    });

    test('should clear history and persist the cleared list', () => {
      const store = new StateStore(mockContext);
      store.recordSearch({
        query: 'to-clear',
        scope: 'project',
        options: { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' }
      });
      store.clearSearchHistory();
      const history = store.getSearchHistory();
      assert.strictEqual(history.length, 0);
      expect(workspaceStateUpdate).toHaveBeenCalledWith('rifler.searchHistory', []);
    });
  });

  describe('Results Show Collapsed Setting', () => {
    test('should allow setting resultsShowCollapsed to true', () => {
      const store = new StateStore(mockContext);
      store.setResultsShowCollapsed(true);
      assert.strictEqual(store.getResultsShowCollapsed(), true);
    });

    test('should allow setting resultsShowCollapsed back to false', () => {
      const store = new StateStore(mockContext);
      store.setResultsShowCollapsed(true);
      assert.strictEqual(store.getResultsShowCollapsed(), true);
      store.setResultsShowCollapsed(false);
      assert.strictEqual(store.getResultsShowCollapsed(), false);
    });
  });

  describe('Sidebar Visibility', () => {
    test('should initialize sidebar as not visible', () => {
      const store = new StateStore(mockContext);
      assert.strictEqual(store.getSidebarVisible(), false);
    });

    test('should allow setting sidebar visibility', () => {
      const store = new StateStore(mockContext);
      store.setSidebarVisible(true);
      assert.strictEqual(store.getSidebarVisible(), true);
    });
  });

  describe('Minimized State', () => {
    test('should initialize as not minimized', () => {
      const store = new StateStore(mockContext);
      assert.strictEqual(store.isMinimized(), false);
    });

    test('should allow setting minimized state', () => {
      const store = new StateStore(mockContext);
      store.setMinimized(true);
      assert.strictEqual(store.isMinimized(), true);
    });
  });

  describe('Preview Panel Collapsed State', () => {
    test('should initialize preview panel as not collapsed', () => {
      const store = new StateStore(mockContext);
      assert.strictEqual(store.getPreviewPanelCollapsed(), false);
    });

    test('should allow setting preview panel collapsed state', () => {
      const store = new StateStore(mockContext);
      store.setPreviewPanelCollapsed(true);
      assert.strictEqual(store.getPreviewPanelCollapsed(), true);
    });
  });

  describe('Visibility Change Callbacks', () => {
    test('should register and trigger visibility callbacks', () => {
      const store = new StateStore(mockContext);
      let callbackTriggered = false;
      let visibilityValue = false;

      store.onSidebarVisibilityChange((visible) => {
        callbackTriggered = true;
        visibilityValue = visible;
      });

      store.setSidebarVisible(true);
      assert.strictEqual(callbackTriggered, true);
      assert.strictEqual(visibilityValue, true);
    });

    test('should trigger multiple registered callbacks', () => {
      const store = new StateStore(mockContext);
      let callback1Triggered = false;
      let callback2Triggered = false;

      store.onSidebarVisibilityChange(() => {
        callback1Triggered = true;
      });

      store.onSidebarVisibilityChange(() => {
        callback2Triggered = true;
      });

      store.setSidebarVisible(true);
      assert.strictEqual(callback1Triggered, true);
      assert.strictEqual(callback2Triggered, true);
    });
  });
});
