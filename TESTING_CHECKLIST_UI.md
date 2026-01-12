# Visual Regression Testing Checklist - Issues #96 & #98

## Font Rendering & Quality (Issue #96)

### Zoom Levels
Test at each zoom level to verify font rendering, color distinction, and layout:

- [ ] **100% Zoom** - Default VS Code zoom
  - [ ] Fonts render clearly with JetBrains Mono
  - [ ] Color distinction is clear (primary #3B82F6 vs muted colors)
  - [ ] File paths are readable at 11px (normal) / 10px (narrow)
  - [ ] Result items are properly spaced

- [ ] **125% Zoom** - Common on high-DPI displays
  - [ ] Fonts remain sharp and readable
  - [ ] No layout breaking or overlap
  - [ ] Color contrast remains distinguishable
  - [ ] Tooltips display correctly

- [ ] **150% Zoom** - High accessibility setting
  - [ ] All text remains legible
  - [ ] Icons scale appropriately
  - [ ] No content clipping or overflow
  - [ ] Interactive elements remain clickable

## Responsive Layout (Issue #98)

### Sidebar Width Tests

- [ ] **250px Width** (Narrow Sidebar)
  - [ ] `narrow-layout` class applied automatically
  - [ ] All controls visible without horizontal scroll
  - [ ] File paths truncate with ellipsis
  - [ ] Search input remains functional
  - [ ] Reduced padding (4px) applied
  - [ ] Smaller font sizes (12px body, 10px paths)

- [ ] **350px Width** (Transition Point)
  - [ ] Layout switches between narrow/normal appropriately
  - [ ] No jarring transitions during resize
  - [ ] All features remain accessible

- [ ] **500px Width** (Comfortable Sidebar)
  - [ ] `normal-layout` class applied
  - [ ] Default spacing and fonts used
  - [ ] File paths display more content
  - [ ] Results feel spacious but not wasteful

- [ ] **800px+ Width** (Panel/Tab View)
  - [ ] `wide-layout` class applied
  - [ ] Increased padding for better readability
  - [ ] Maximum usability with ample space
  - [ ] Preview panel takes advantage of width

## Interaction Patterns (Issue #96)

### File Operations

- [ ] **Filename Clicks**
  - [ ] Clicking filename opens file in editor directly
  - [ ] Hover shows underline and primary color
  - [ ] Cursor changes to pointer
  - [ ] No conflict with collapse/expand arrow

- [ ] **Result Item Clicks**
  - [ ] Single click on result item shows preview
  - [ ] Double click on result item opens file in editor
  - [ ] Active state highlights properly
  - [ ] Preview updates smoothly

- [ ] **Preview Panel Toggle**
  - [ ] New icon (`close_fullscreen`) is more intuitive than minus
  - [ ] Toggle button remains accessible
  - [ ] Drag handle works for resizing
  - [ ] Panel state persists across searches

### Removed Elements

- [ ] **No "Open to Editor" Button**
  - [ ] Button completely removed from results
  - [ ] No orphaned CSS or event listeners
  - [ ] Context menu still offers "Open in Editor"

## Color Quality (Issue #96)

### Visual Hierarchy

- [ ] **Primary Color** (#3B82F6)
  - [ ] Clear and distinct from background
  - [ ] Works well for active states
  - [ ] Not too bright or overwhelming

- [ ] **Background Colors**
  - [ ] Main bg (#09090b) provides deep contrast
  - [ ] Surface bg (#18181b) distinguishes panels
  - [ ] Border color (#27272a) creates subtle separation

- [ ] **Text Colors**
  - [ ] Foreground (#e4e4e7) is highly readable
  - [ ] Muted text (#a1a1aa) provides clear hierarchy
  - [ ] File paths have good contrast for quick scanning

- [ ] **Syntax Highlighting**
  - [ ] Code preview colors remain distinct
  - [ ] Match highlights stand out clearly
  - [ ] No red text issues

## Tooltip & Path Display (Issue #96)

- [ ] **File Path Tooltips**
  - [ ] Hover on file path shows full path
  - [ ] Hover on filename shows "Click to open file"
  - [ ] Tooltips don't obscure important content
  - [ ] Tooltips dismiss appropriately

- [ ] **Path Truncation**
  - [ ] Long paths truncate with ellipsis
  - [ ] Most significant part (filename/parent dir) visible
  - [ ] Monospace font makes paths scannable
  - [ ] Truncation adapts to width (10px in narrow, 11px normal)

## Cross-Platform Testing

### Operating Systems

- [ ] **macOS**
  - [ ] Font rendering is crisp
  - [ ] Colors match design expectations
  - [ ] Sidebar resizing works smoothly

- [ ] **Windows**
  - [ ] JetBrains Mono loads correctly
  - [ ] ClearType renders fonts properly
  - [ ] High DPI scaling works

- [ ] **Linux**
  - [ ] Font fallbacks work if needed
  - [ ] Colors render consistently
  - [ ] Responsive layouts function

## Performance

- [ ] **Layout Updates**
  - [ ] ResizeObserver doesn't cause lag
  - [ ] Width detection is instant
  - [ ] CSS class changes are smooth

- [ ] **Large Result Sets**
  - [ ] Virtual scrolling still performs well
  - [ ] Responsive classes don't affect performance
  - [ ] Memory usage remains acceptable

## Accessibility

- [ ] **Keyboard Navigation**
  - [ ] All interactions work without mouse
  - [ ] Focus indicators are visible
  - [ ] Tab order is logical

- [ ] **Screen Readers**
  - [ ] Filenames announce correctly
  - [ ] Interactive elements have ARIA labels
  - [ ] State changes are announced

## Known Issues to Verify Fixed

From Issue #96:

- [x] Directory path no longer takes excessive space
- [x] Fonts bundled with extension (JetBrains Mono)
- [x] Colors improved to match quality design
- [x] File path appears below filename with tooltip
- [x] Replace controls relocated (kept in preview actions)
- [x] Open to Editor button removed (click filename instead)
- [x] Single-click on result toggles preview
- [x] Double-click opens file
- [x] Better preview toggle icon (not "minus")

From Issue #98:

- [x] UI comfortable at 300px+ sidebar width
- [x] No horizontal scrolling required
- [x] Paths truncate intelligently
- [x] Compact layout automatically activates
- [x] All controls remain accessible

## Manual Test Scenarios

### Scenario 1: Narrow Sidebar Workflow
1. Open Rifler in sidebar
2. Resize sidebar to ~300px
3. Perform search with multiple results
4. Verify all controls are accessible
5. Click filename to open file
6. Toggle preview panel
7. Verify no horizontal scrolling needed

### Scenario 2: High Zoom Workflow
1. Set VS Code zoom to 150%
2. Open Rifler in panel view
3. Perform complex search
4. Verify fonts remain sharp
5. Check color distinction at high magnification
6. Test all interactive elements

### Scenario 3: Rapid Width Changes
1. Open Rifler with active search results
2. Rapidly resize from narrow to wide
3. Verify smooth transitions
4. Check for layout breaking
5. Ensure no console errors

## Success Criteria

All checkboxes above should be checked before considering Issues #96 and #98 resolved.

## Notes

- Test with real searches containing varied file types
- Use diverse codebases (large and small)
- Test theme switching (if applicable)
- Monitor browser console for errors during testing
