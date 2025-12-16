# Preview Collapse/Expand Toggle Feature - Test Documentation

## Overview
This document describes the test suites for the preview collapse/expand toggle feature that allows users to quickly collapse and restore the preview panel using a single button next to the divider.

## Test Files

### 1. Unit Tests: `src/__tests__/previewToggle.test.ts`
Comprehensive unit tests for the preview height state management logic. **34 tests total.**

#### Test Categories

##### Preview Height Clamping (3 tests)
- Validates that preview height is clamped to minimum (80px)
- Ensures heights above minimum are preserved
- Respects maximum preview height based on container size

##### Collapse/Expand Toggle Logic (6 tests)
- Tests identification of collapsed/expanded states
- Validates collapse to minimum and expand to last height
- Handles default height fallback when no prior expanded height exists

##### Last Expanded Height Tracking (4 tests)
- Ensures `lastExpandedHeight` updates when dragging above minimum
- Prevents update when dragging to or below minimum
- Validates persistence of stored expanded height
- Confirms collapse button does not overwrite stored height

##### Button State Management (4 tests)
- Shows "-" button when preview is expanded
- Shows "+" button when preview is collapsed
- Validates button text changes during state transitions

##### Toggle Button Click Behavior (4 tests)
- Expanding from collapsed state restores to `lastExpandedHeight`
- Collapsing from expanded state sets to minimum height
- Uses default height if no prior expanded height exists
- Confirms repeated expand clicks restore to same height (idempotent)

##### State Persistence (5 tests)
- Persists `previewHeight` and `lastExpandedHeight` to webview state
- Correctly restores from persisted state on initialization
- Handles missing persisted state gracefully with defaults

##### Drag Resize Interaction (3 tests)
- Updates `lastExpandedHeight` when dragging to larger heights
- Updates `lastExpandedHeight` when dragging to smaller but still expanded heights
- Does NOT update `lastExpandedHeight` when dragging to minimum

##### Window Resize Behavior (2 tests)
- Clamps preview height when container resizes
- Preserves `lastExpandedHeight` across window resizes

##### Edge Cases (4 tests)
- Handles zero and negative heights (clamped to minimum)
- Handles very large heights (clamped to maximum)
- Handles fractional pixel heights

### 2. E2E Tests: `src/__tests__/e2e/suite/previewToggle.test.ts`

#### Preview Toggle E2E Tests (6 tests)
- Validates webview panel creation
- Verifies HTML structure includes toggle button with correct ID and label
- Confirms button positioning on right side of divider (flex-end)
- Validates dragging area does not use blue focus color

#### Preview Toggle Integration Tests (6 tests)
- Tests interaction with search results updates (heights preserved)
- Validates collapse after drag resize
- Validates expand after drag to minimum
- Tests state persistence across panel reopen
- Confirms button clicks don't trigger drag behavior
- Validates button text updates on state transitions

## Running the Tests

### Run all preview toggle unit tests:
```bash
npm test -- src/__tests__/previewToggle.test.ts
```

### Run all tests (including preview toggle):
```bash
npm test
```

### Run tests with coverage:
```bash
npm test -- --coverage
```

### Run E2E tests:
```bash
npm run test:e2e
```

## Key Features Tested

1. **Single Toggle Button**
   - Shows "-" when expanded (above minimum height)
   - Shows "+" when collapsed (at minimum height)
   - Positioned on the right side of the divider

2. **Collapse Behavior**
   - Sets preview to minimum height (80px)
   - Preserves last expanded height in `lastExpandedHeight` state
   - Does not update `lastExpandedHeight` when collapsing

3. **Expand Behavior**
   - Restores to `lastExpandedHeight` if previously stored
   - Uses default height (240px) if no prior expanded height
   - Remains idempotent (repeated clicks restore same height)

4. **Drag Resize Integration**
   - Updates `lastExpandedHeight` when dragging above minimum
   - Does not update when dragging to/below minimum
   - Allows normal drag behavior when button not involved

5. **State Persistence**
   - Persists both `previewHeight` and `lastExpandedHeight` to webview state
   - Restores on panel reopen
   - Handles missing state gracefully with defaults

6. **Visual Feedback**
   - Button text changes dynamically
   - No blue hover/drag color on divider (maintains widget-border color)
   - Button properly positioned and accessible

## Constants Used in Tests

```javascript
const MIN_PANEL_HEIGHT = 80;        // Minimum results panel height
const PREVIEW_MIN_HEIGHT = 80;      // Minimum preview panel height
const DEFAULT_PREVIEW_HEIGHT = 240; // Default preview height (55% of container)
const RESIZER_HEIGHT = 22;          // Height of divider with controls
```

## Test Execution Flow Example

```
User opens panel
↓
Initialize: previewHeight = 240, lastExpandedHeight = 240
↓
User drags divider → previewHeight = 300, lastExpandedHeight = 300
↓
User clicks "-" button → previewHeight = 80, lastExpandedHeight = 300 (unchanged)
Button text changes: "-" → "+"
↓
User clicks "+" button → previewHeight = 300 (restored from lastExpandedHeight)
Button text changes: "+" → "-"
↓
State persisted for next panel open
```

## Notes for Developers

- All height values are in pixels
- Heights are clamped to prevent invalid states (min=80px, max=container-80px)
- The `lastExpandedHeight` acts as a "memory" of the user's preferred expanded size
- Button state ("+"/"-") is derived from current `previewHeight`, not stored separately
- Drag and button interactions are mutually exclusive (stopPropagation prevents interference)

## Future Test Enhancements

1. Add webview DOM manipulation tests using jsdom or similar
2. Add tests for keyboard shortcuts (if added in future)
3. Add performance tests for rapid collapse/expand cycles
4. Add tests for multi-monitor/high-DPI scenarios
5. Add accessibility tests (ARIA labels, keyboard navigation)
