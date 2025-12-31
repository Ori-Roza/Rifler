import * as assert from 'assert';
import * as vscode from 'vscode';
import { StateStore } from '../state/StateStore';

describe('StateStore Tests', () => {
  let mockContext: vscode.ExtensionContext;

  beforeEach(() => {
    // Create a mock extension context with proper mock implementation
    const mockWorkspaceState = {
      get: (key: string, defaultValue?: any) => defaultValue,
      update: async () => {},
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
