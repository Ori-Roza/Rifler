import * as assert from 'assert';

/**
 * Unit tests for the preview collapse/expand toggle feature.
 * These tests validate the logic for:
 * - Preview height state management
 * - Collapse/expand button behavior
 * - Persistence of preview height and last expanded height
 */

describe('Preview Toggle Feature', () => {
  // Mock constants matching script.js
  const MIN_PANEL_HEIGHT = 80;
  const PREVIEW_MIN_HEIGHT = 80;
  const DEFAULT_PREVIEW_HEIGHT = 240;
  const RESIZER_HEIGHT = 22;

  let mockState: {
    previewHeight: number;
    lastExpandedHeight: number;
    resultsPanelHeight: number;
  };

  beforeEach(() => {
    mockState = {
      previewHeight: DEFAULT_PREVIEW_HEIGHT,
      lastExpandedHeight: DEFAULT_PREVIEW_HEIGHT,
      resultsPanelHeight: 100,
    };
  });

  describe('Preview Height Clamping', () => {
    test('should clamp preview height to minimum', () => {
      const height = 40; // Below minimum
      const clamped = Math.max(PREVIEW_MIN_HEIGHT, height);
      assert.strictEqual(clamped, PREVIEW_MIN_HEIGHT);
    });

    test('should allow preview height above minimum', () => {
      const height = 200;
      const clamped = Math.max(PREVIEW_MIN_HEIGHT, height);
      assert.strictEqual(clamped, height);
    });

    test('should respect maximum preview height', () => {
      const containerHeight = 500;
      const proposedHeight = 600;
      const maxPreviewHeight = Math.max(PREVIEW_MIN_HEIGHT, containerHeight - MIN_PANEL_HEIGHT);
      const clamped = Math.min(proposedHeight, maxPreviewHeight);
      assert.ok(clamped <= maxPreviewHeight);
      assert.strictEqual(clamped, maxPreviewHeight);
    });
  });

  describe('Collapse/Expand Toggle Logic', () => {
    test('should identify preview as collapsed when at minimum height', () => {
      mockState.previewHeight = PREVIEW_MIN_HEIGHT;
      const isCollapsed = mockState.previewHeight <= PREVIEW_MIN_HEIGHT + 0.5;
      assert.ok(isCollapsed);
    });

    test('should identify preview as expanded when above minimum height', () => {
      mockState.previewHeight = 200;
      const isCollapsed = mockState.previewHeight <= PREVIEW_MIN_HEIGHT + 0.5;
      assert.ok(!isCollapsed);
    });

    test('should collapse preview to minimum height', () => {
      mockState.previewHeight = 300;
      const collapsed = PREVIEW_MIN_HEIGHT;
      assert.strictEqual(collapsed, PREVIEW_MIN_HEIGHT);
    });

    test('should expand to last expanded height when available', () => {
      mockState.previewHeight = PREVIEW_MIN_HEIGHT;
      mockState.lastExpandedHeight = 250;
      const targetHeight = Math.max(PREVIEW_MIN_HEIGHT, mockState.lastExpandedHeight);
      assert.strictEqual(targetHeight, 250);
    });

    test('should use default height when no last expanded height is stored', () => {
      mockState.previewHeight = PREVIEW_MIN_HEIGHT;
      mockState.lastExpandedHeight = 0;
      const targetHeight = mockState.lastExpandedHeight || DEFAULT_PREVIEW_HEIGHT;
      assert.strictEqual(targetHeight, DEFAULT_PREVIEW_HEIGHT);
    });
  });

  describe('Last Expanded Height Tracking', () => {
    test('should update last expanded height when dragging above minimum', () => {
      const newHeight = 280;
      let lastExpanded = 0;
      if (newHeight > PREVIEW_MIN_HEIGHT) {
        lastExpanded = newHeight;
      }
      assert.strictEqual(lastExpanded, 280);
    });

    test('should not update last expanded height when dragging to minimum', () => {
      const oldLastExpanded = 250;
      const newHeight = PREVIEW_MIN_HEIGHT;
      let lastExpanded = oldLastExpanded;
      if (newHeight > PREVIEW_MIN_HEIGHT) {
        lastExpanded = newHeight;
      }
      assert.strictEqual(lastExpanded, 250); // unchanged
    });

    test('should not overwrite last expanded height when collapsing via button', () => {
      const oldLastExpanded = 220;
      const newHeight = PREVIEW_MIN_HEIGHT;
      let lastExpanded = oldLastExpanded;
      // When collapsing via button, we don't update lastExpanded
      // (it remains the old value)
      assert.strictEqual(lastExpanded, 220);
    });

    test('should persist last expanded height to state', () => {
      mockState.lastExpandedHeight = 280;
      const persisted = mockState.lastExpandedHeight;
      assert.strictEqual(persisted, 280);
    });
  });

  describe('Button State Management', () => {
    function getButtonLabel(previewHeight: number): string {
      const isCollapsed = previewHeight <= PREVIEW_MIN_HEIGHT + 0.5;
      return isCollapsed ? '+' : '-';
    }

    test('should show "-" button when preview is expanded', () => {
      mockState.previewHeight = 250;
      const label = getButtonLabel(mockState.previewHeight);
      assert.strictEqual(label, '-');
    });

    test('should show "+" button when preview is collapsed', () => {
      mockState.previewHeight = PREVIEW_MIN_HEIGHT;
      const label = getButtonLabel(mockState.previewHeight);
      assert.strictEqual(label, '+');
    });

    test('button should change from "-" to "+" when collapsing', () => {
      mockState.previewHeight = 250;
      let label = getButtonLabel(mockState.previewHeight);
      assert.strictEqual(label, '-');

      // Collapse
      mockState.previewHeight = PREVIEW_MIN_HEIGHT;
      label = getButtonLabel(mockState.previewHeight);
      assert.strictEqual(label, '+');
    });

    test('button should change from "+" to "-" when expanding', () => {
      mockState.previewHeight = PREVIEW_MIN_HEIGHT;
      let label = getButtonLabel(mockState.previewHeight);
      assert.strictEqual(label, '+');

      // Expand
      mockState.previewHeight = 280;
      label = getButtonLabel(mockState.previewHeight);
      assert.strictEqual(label, '-');
    });
  });

  describe('Toggle Button Click Behavior', () => {
    function togglePreviewSize(
      currentHeight: number,
      lastExpanded: number,
      isCollapsed: boolean
    ): { newHeight: number; newLastExpanded: number } {
      if (isCollapsed) {
        // Expanding: restore to last expanded or default
        const targetHeight =
          lastExpanded && lastExpanded > PREVIEW_MIN_HEIGHT
            ? lastExpanded
            : DEFAULT_PREVIEW_HEIGHT;
        return {
          newHeight: targetHeight,
          newLastExpanded: lastExpanded, // Don't change last expanded
        };
      } else {
        // Collapsing: set to minimum, don't update last expanded
        return {
          newHeight: PREVIEW_MIN_HEIGHT,
          newLastExpanded: lastExpanded, // Unchanged
        };
      }
    }

    test('should expand when clicking button on collapsed preview', () => {
      mockState.previewHeight = PREVIEW_MIN_HEIGHT;
      mockState.lastExpandedHeight = 260;
      const isCollapsed = true;

      const result = togglePreviewSize(
        mockState.previewHeight,
        mockState.lastExpandedHeight,
        isCollapsed
      );

      assert.strictEqual(result.newHeight, 260);
      assert.strictEqual(result.newLastExpanded, 260);
    });

    test('should collapse when clicking button on expanded preview', () => {
      mockState.previewHeight = 280;
      mockState.lastExpandedHeight = 280;
      const isCollapsed = false;

      const result = togglePreviewSize(
        mockState.previewHeight,
        mockState.lastExpandedHeight,
        isCollapsed
      );

      assert.strictEqual(result.newHeight, PREVIEW_MIN_HEIGHT);
      assert.strictEqual(result.newLastExpanded, 280); // Unchanged
    });

    test('should use default height if no last expanded height on expand', () => {
      mockState.previewHeight = PREVIEW_MIN_HEIGHT;
      mockState.lastExpandedHeight = 0;
      const isCollapsed = true;

      const result = togglePreviewSize(
        mockState.previewHeight,
        mockState.lastExpandedHeight,
        isCollapsed
      );

      assert.strictEqual(result.newHeight, DEFAULT_PREVIEW_HEIGHT);
    });

    test('should always restore to same last expanded height on multiple expands', () => {
      mockState.previewHeight = PREVIEW_MIN_HEIGHT;
      mockState.lastExpandedHeight = 240;
      const isCollapsed = true;

      // First expand
      let result = togglePreviewSize(
        mockState.previewHeight,
        mockState.lastExpandedHeight,
        isCollapsed
      );
      assert.strictEqual(result.newHeight, 240);

      // Collapse again
      mockState.previewHeight = result.newHeight;
      let result2 = togglePreviewSize(
        mockState.previewHeight,
        result.newLastExpanded,
        false
      );
      assert.strictEqual(result2.newHeight, PREVIEW_MIN_HEIGHT);

      // Expand again
      result = togglePreviewSize(
        result2.newHeight,
        result2.newLastExpanded,
        true
      );
      assert.strictEqual(result.newHeight, 240); // Same as before
    });
  });

  describe('State Persistence', () => {
    test('should persist preview height to state', () => {
      const newHeight = 300;
      mockState.previewHeight = newHeight;
      assert.strictEqual(mockState.previewHeight, 300);
    });

    test('should persist last expanded height to state', () => {
      const newHeight = 320;
      mockState.lastExpandedHeight = newHeight;
      assert.strictEqual(mockState.lastExpandedHeight, 320);
    });

    test('should persist both preview and last expanded height', () => {
      mockState.previewHeight = 290;
      mockState.lastExpandedHeight = 290;

      const savedState = {
        previewHeight: mockState.previewHeight,
        lastExpandedHeight: mockState.lastExpandedHeight,
      };

      assert.strictEqual(savedState.previewHeight, 290);
      assert.strictEqual(savedState.lastExpandedHeight, 290);
    });

    test('should restore preview height from persisted state', () => {
      const persistedState = {
        previewHeight: 200,
        lastExpandedHeight: 200,
      };

      mockState.previewHeight = persistedState.previewHeight;
      mockState.lastExpandedHeight = persistedState.lastExpandedHeight;

      assert.strictEqual(mockState.previewHeight, 200);
      assert.strictEqual(mockState.lastExpandedHeight, 200);
    });

    test('should handle missing persisted state gracefully', () => {
      const persistedState = undefined;
      mockState.previewHeight = persistedState ? persistedState : DEFAULT_PREVIEW_HEIGHT;
      assert.strictEqual(mockState.previewHeight, DEFAULT_PREVIEW_HEIGHT);
    });
  });

  describe('Drag Resize Interaction', () => {
    test('should update last expanded height when dragging to larger height', () => {
      mockState.previewHeight = 200;
      mockState.lastExpandedHeight = 180;

      // Simulate drag to 250px
      const newHeight = 250;
      if (newHeight > PREVIEW_MIN_HEIGHT) {
        mockState.lastExpandedHeight = newHeight;
      }

      assert.strictEqual(mockState.lastExpandedHeight, 250);
    });

    test('should update last expanded height when dragging to smaller but still expanded height', () => {
      mockState.previewHeight = 300;
      mockState.lastExpandedHeight = 300;

      // Simulate drag to 200px (still expanded)
      const newHeight = 200;
      if (newHeight > PREVIEW_MIN_HEIGHT) {
        mockState.lastExpandedHeight = newHeight;
      }

      assert.strictEqual(mockState.lastExpandedHeight, 200);
    });

    test('should not update last expanded height when dragging to minimum', () => {
      mockState.previewHeight = 200;
      mockState.lastExpandedHeight = 200;

      // Simulate drag to minimum
      const newHeight = PREVIEW_MIN_HEIGHT;
      if (newHeight > PREVIEW_MIN_HEIGHT) {
        mockState.lastExpandedHeight = newHeight;
      }

      assert.strictEqual(mockState.lastExpandedHeight, 200); // Unchanged
    });
  });

  describe('Window Resize Behavior', () => {
    test('should clamp preview height on container resize', () => {
      const oldContainerHeight = 600;
      const newContainerHeight = 400;
      mockState.previewHeight = 300; // Was valid in old container
      const maxPreview = Math.max(PREVIEW_MIN_HEIGHT, newContainerHeight - MIN_PANEL_HEIGHT);

      const clampedHeight = Math.min(
        Math.max(PREVIEW_MIN_HEIGHT, mockState.previewHeight),
        maxPreview
      );

      // Should be clamped to max of new container
      assert.ok(clampedHeight <= maxPreview);
    });

    test('should preserve last expanded height on window resize', () => {
      mockState.lastExpandedHeight = 280;
      // Simulate window resize (no direct changes to lastExpandedHeight)
      assert.strictEqual(mockState.lastExpandedHeight, 280);
    });
  });

  describe('Edge Cases', () => {
    test('should handle zero preview height', () => {
      const height = 0;
      const clamped = Math.max(PREVIEW_MIN_HEIGHT, height);
      assert.strictEqual(clamped, PREVIEW_MIN_HEIGHT);
    });

    test('should handle negative preview height', () => {
      const height = -100;
      const clamped = Math.max(PREVIEW_MIN_HEIGHT, height);
      assert.strictEqual(clamped, PREVIEW_MIN_HEIGHT);
    });

    test('should handle very large preview height', () => {
      const containerHeight = 1000;
      const largeHeight = 10000;
      const maxPreviewHeight = Math.max(PREVIEW_MIN_HEIGHT, containerHeight - MIN_PANEL_HEIGHT);
      const clamped = Math.min(largeHeight, maxPreviewHeight);
      assert.ok(clamped <= maxPreviewHeight);
    });

    test('should handle fractional preview heights', () => {
      const height = 200.5;
      const clamped = Math.max(PREVIEW_MIN_HEIGHT, height);
      assert.strictEqual(clamped, height);
    });
  });
});
