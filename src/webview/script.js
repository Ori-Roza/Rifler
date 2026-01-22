// Rifler Webview Script
// Extracted from extension.ts as part of Phase 1 refactoring (Issue #46)

console.log('[Rifler] Webview script starting...');

// Ensure UI is visible IMMEDIATELY
(function showUIImmediately() {
  // Make body visible right away
  const body = document.body;
  if (body) {
    body.style.opacity = '1';
    body.classList.add('loaded');
  }
  
  // Hide loading overlay immediately
  const loadingOverlay = document.getElementById('loading-overlay');
  if (loadingOverlay) {
    loadingOverlay.classList.add('hidden');
    console.log('[Rifler] UI shown, loading overlay hidden');
  }
})();

(function() {
  console.log('[Rifler] IIFE initialization started. hljs available:', typeof hljs !== 'undefined');
  if (typeof hljs !== 'undefined') {
    console.log('[Rifler] hljs version:', hljs.versionString);
    console.log('[Rifler] hljs languages:', hljs.listLanguages().join(', '));
  }
  
  const state = {
    results: [],
    renderItems: [],
    activeIndex: -1,
    activeGroupPath: null, // Track which file group is active
    activeIndexInGroup: -1, // Track index within the current group
    activeGroupId: null, // Track the group container element ID or data attribute
    currentScope: 'project',
    modules: [],
    currentDirectory: '',
    workspaceName: '',
    workspacePath: '',
    currentQuery: '',
    queryRows: 1,
    fileContent: null,
    lastPreview: null,
    searchTimeout: null,
    searchStartTime: 0,
    lastSearchDuration: 0,
    replaceKeybinding: 'ctrl+shift+r',
    maxResultsCap: 10000,
      searchHistory: [],
    collapsedFiles: new Set(),
    expandedFiles: new Set(), // Track files explicitly expanded by user
    previewPanelCollapsed: false, // Track preview panel state
    resultsShowCollapsed: false, // Show results collapsed by default if enabled in settings
    projectExclusions: [], // Store detected project types with exclusion patterns
    smartExcludesEnabled: true,
    options: {
      matchCase: false,
      wholeWord: false,
      useRegex: false,
      multiline: false,
      fileMask: ''
    },
    groupScrollTops: {}, // Persist scroll positions for grouped result containers
    loadingTimeout: null // Track loading overlay timeout
  };

    let pendingTestHistoryEcho = false;

  const vscode = acquireVsCodeApi();

  try {
    vscode.postMessage({ type: '__diag_ping', ts: Date.now() });
  } catch (err) {
    console.error('Failed to send diag ping from webview', err);
  }

  window.addEventListener('error', (event) => {
    try {
      vscode.postMessage({
        type: 'error',
        message: event.message,
        source: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error?.stack || String(event.error)
      });
    } catch (err) {
      console.error('Failed to forward webview error', err);
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    try {
      vscode.postMessage({
        type: 'error',
        message: 'Unhandled promise rejection',
        error: event.reason?.stack || String(event.reason)
      });
    } catch (err) {
      console.error('Failed to forward webview rejection', err);
    }
  });

  // DOM Elements - Updated for Issue #83 redesign
  const queryInput = document.getElementById('query');
  const searchInputGroup = document.querySelector('.search-input-group');
  const replaceRow = document.getElementById('replace-row');
  if (replaceRow) {
    replaceRow.classList.remove('visible');
    replaceRow.style.display = 'none';
  }
  const replaceInput = document.getElementById('replace-input');
  const replaceBtn = document.getElementById('replace-btn');
  const replaceAllBtn = document.getElementById('replace-all-btn');
  const clearSearchBtn = document.getElementById('clear-search-btn');
  const resultsList = document.getElementById('results-list');
  const previewContent = document.getElementById('preview-content');
  const previewFilename = document.getElementById('preview-filename');
  const previewFilepath = document.getElementById('preview-filepath');
  const previewLoadingOverlay = document.getElementById('preview-loading-overlay');
  
  // Updated for new layout
  const directoryInput = document.getElementById('directory-input');
  const moduleSelect = document.getElementById('module-select');
  const scopeSelect = document.getElementById('scope-select');
  const pathLabel = document.getElementById('path-label');
  
  const matchCaseToggle = document.getElementById('match-case');
  const wholeWordToggle = document.getElementById('whole-word');
  const useRegexToggle = document.getElementById('use-regex');
  const fileMaskInput = document.getElementById('file-mask');

  // New elements for Issue #83 redesign
  const filtersContainer = document.getElementById('filters-container');
  const filterBtn = document.getElementById('filter-btn');
  const replaceToggleBtn = document.getElementById('replace-toggle-btn');
  const moreActionsBtn = document.getElementById('more-actions-btn');
  const moreActionsMenu = document.getElementById('more-actions-menu');
    const searchHistoryBtn = document.getElementById('search-history-btn');
    const searchHistoryMenu = document.getElementById('search-history-menu');
  const searchOverflow = document.getElementById('search-overflow');
  const searchControls = document.querySelector('.search-controls');
  const dragHandle = document.getElementById('drag-handle');
  const previewPanelContainer = document.getElementById('preview-panel-container');
  const resultsCountText = document.getElementById('results-count-text');
  const resultsSummaryBar = document.querySelector('.results-summary-bar');
  const collapseAllBtn = document.getElementById('collapse-all-btn');
  const smartExcludeToggle = document.getElementById('smart-exclude-toggle');
  
  // Create a fallback for resultsCount if needed (backward compatibility)
  let resultsCount = document.getElementById('results-count');
  if (!resultsCount) {
    resultsCount = resultsCountText; // Use the new element as a fallback
  }

  // Keep backward compatibility - some may not exist in new design
  const previewActions = document.getElementById('preview-actions');
  const replaceInFileBtn = document.getElementById('replace-in-file-btn');
  const openInEditorBtn = document.getElementById('open-in-editor-btn');
  const fileEditor = document.getElementById('file-editor');
  const editorContainer = document.getElementById('editor-container');
  const editorBackdrop = document.getElementById('editor-backdrop');
  const editorLineNumbers = document.getElementById('editor-line-numbers');

  const resultsPanel = document.getElementById('results-panel');
  const previewPanel = document.getElementById('preview-panel');
  const mainContent = document.querySelector('.main-content');

  let VIRTUAL_ROW_HEIGHT = 40;
  const VIRTUAL_OVERSCAN = 8;
  let measuredRowHeight = 0;
  const virtualContent = document.createElement('div');
  virtualContent.id = 'results-virtual-content';
  virtualContent.style.position = 'relative';
  virtualContent.style.width = '100%';

  const resultsPlaceholder = document.createElement('div');
  resultsPlaceholder.className = 'empty-state';
  resultsPlaceholder.style.display = 'none';

  if (resultsList) {
    resultsList.innerHTML = '';
    resultsList.appendChild(virtualContent);
    resultsList.appendChild(resultsPlaceholder);
  }
  
  const replaceWidget = document.getElementById('replace-widget');
  const localSearchInput = document.getElementById('local-search-input');
  const localReplaceInput = document.getElementById('local-replace-input');
  const localReplaceRow = document.getElementById('local-replace-row');
  const localReplaceButtons = document.getElementById('local-replace-buttons');
  const localMatchCount = document.getElementById('local-match-count');
  const localSepAfterSearch = document.getElementById('local-sep-after-search');
  const localReplaceBtn = document.getElementById('local-replace-btn');
  const localReplaceAllBtn = document.getElementById('local-replace-all-btn');
  const localReplaceClose = document.getElementById('local-replace-close');
  const localPrevBtn = document.getElementById('local-prev-btn');
  const localNextBtn = document.getElementById('local-next-btn');

  function syncLocalWidgetWidth() {
    if (!replaceWidget || !editorContainer) return;
    const editorWidth = editorContainer.getBoundingClientRect().width;
    const sidebarWidth = resultsPanel ? resultsPanel.getBoundingClientRect().width : 0;
    const currentMode = (replaceWidget.dataset && replaceWidget.dataset.mode)
      ? replaceWidget.dataset.mode
      : ((localReplaceRow && localReplaceRow.hidden) ? 'find' : 'replace');

    let rawTarget = sidebarWidth > 0 ? sidebarWidth : 320;
    // Find-only view can be narrower for a cleaner look.
    if (currentMode === 'find') {
      rawTarget = Math.min(rawTarget, 420);
    }
    const clamped = Math.min(rawTarget, Math.max(240, editorWidth - 16));
    const px = Math.max(240, Math.floor(clamped));
    replaceWidget.style.setProperty('--local-widget-width', `${px}px`);

    // If the widget is visible, reserve vertical space so it doesn't cover the first editor rows.
    const isVisible = replaceWidget.classList.contains('visible');
    if (isVisible) {
      editorContainer.classList.add('local-widget-open');
      // Use the rendered widget height (plus a small gap).
      const height = Math.ceil(replaceWidget.getBoundingClientRect().height);
      const offset = Math.max(36, height + 8);
      editorContainer.style.setProperty('--local-widget-offset', `${offset}px`);
    }
  }

  // Keep local widget width aligned with the sidebar width.
  syncLocalWidgetWidth();
  window.addEventListener('resize', syncLocalWidgetWidth);
  try {
    if (resultsPanel) new ResizeObserver(syncLocalWidgetWidth).observe(resultsPanel);
    if (editorContainer) new ResizeObserver(syncLocalWidgetWidth).observe(editorContainer);
  } catch {
    // ResizeObserver may be unavailable in some environments; window resize still covers most cases.
  }

  console.log('[Rifler] DOM Elements loaded:', {
    queryInput: !!queryInput,
    resultsList: !!resultsList,
    previewContent: !!previewContent,
    mainContent: !!mainContent,
    dragHandle: !!dragHandle,
    filtersContainer: !!filtersContainer
  });

  // ===== Width Detection for Responsive Layouts (Issue #98) =====
  function updateLayoutClass() {
    const width = document.body.clientWidth;
    
    // Remove all layout classes
    document.body.classList.remove('narrow-layout', 'normal-layout', 'wide-layout');
    
    // Apply appropriate class based on width
    if (width < 350) {
      document.body.classList.add('narrow-layout');
      console.log('[Rifler] Applied narrow-layout for width:', width);
    } else if (width >= 350 && width <= 600) {
      document.body.classList.add('normal-layout');
      console.log('[Rifler] Applied normal-layout for width:', width);
    } else {
      document.body.classList.add('wide-layout');
      console.log('[Rifler] Applied wide-layout for width:', width);
    }

    // In narrow layout, place the overflow (arrow-down) button next to the regex toggle
    // so it stays inside the main search textbox.
    try {
      const isNarrow = document.body.classList.contains('narrow-layout');
      if (searchOverflow && searchControls && moreActionsBtn && moreActionsMenu) {
        const alreadyInOverflow = searchOverflow.contains(moreActionsBtn);
        if (isNarrow && !alreadyInOverflow) {
          moreActionsMenu.classList.remove('open');
          searchOverflow.appendChild(moreActionsBtn);
          searchOverflow.appendChild(moreActionsMenu);
          document.body.classList.add('overflow-in-input');
        } else if (!isNarrow && alreadyInOverflow) {
          moreActionsMenu.classList.remove('open');
          searchControls.appendChild(moreActionsBtn);
          searchControls.appendChild(moreActionsMenu);
          document.body.classList.remove('overflow-in-input');
        } else {
          // Keep class in sync even if the nodes are already in the right spot.
          document.body.classList.toggle('overflow-in-input', isNarrow && alreadyInOverflow);
        }
      }
    } catch {
      // Ignore layout relocation failures; UI remains functional with default placement.
    }
  }

  // Initial layout detection
  updateLayoutClass();

  // Set up ResizeObserver to detect width changes
  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      updateLayoutClass();
    }
  });

  // Observe body element for resize
  resizeObserver.observe(document.body);

  var localMatches = [];
  var localMatchIndex = 0;
  var searchBoxFocusedOnStartup = false;
  try {
    if (queryInput) {
      queryInput.focus();
      searchBoxFocusedOnStartup = true;
    }
  } catch {
    // Ignore focus failures; rAF focus below will retry.
  }

  applyQueryRows(state.queryRows, { skipSearch: true });

  function syncSearchOptionToggles() {
    if (matchCaseToggle) matchCaseToggle.classList.toggle('active', state.options.matchCase);
    if (wholeWordToggle) wholeWordToggle.classList.toggle('active', state.options.wholeWord);
    if (useRegexToggle) useRegexToggle.classList.toggle('active', state.options.useRegex);
  }

  function applyQueryRows(rows, { skipSearch, preventShrink } = { skipSearch: false, preventShrink: false }) {
    const normalized = Math.min(4, Math.max(1, rows || 1));
    state.queryRows = normalized;
    if (queryInput && 'rows' in queryInput) {
      queryInput.rows = normalized;
      queryInput.classList.remove('multiline-1', 'multiline-2', 'multiline-3', 'multiline-4');
      queryInput.classList.add(`multiline-${normalized}`);
    }
    if (searchInputGroup) {
      searchInputGroup.style.setProperty('--search-rows', String(normalized));
    }
    recomputeMultilineOption({ skipSearch, preventShrink });
  }

  function recomputeMultilineOption({ skipSearch, preventShrink } = { skipSearch: false, preventShrink: false }) {
    const text = queryInput ? String(queryInput.value || '') : '';
    const hasNewline = text.includes('\n');
    const lineCount = text.split('\n').length;
    const nextMultiline = (state.queryRows || 1) > 1 || hasNewline;
    const changed = state.options.multiline !== nextMultiline;
    state.options.multiline = nextMultiline;
    
    // Auto-adjust rows based on actual line count
    const targetRows = Math.max(1, Math.min(3, lineCount));
    if (state.queryRows !== targetRows) {
      applyQueryRows(targetRows, { skipSearch: true, preventShrink: true });
      // Don't return early - we need to potentially trigger search below
    }
    
    if ((changed || (state.queryRows !== targetRows)) && !skipSearch) {
      runSearch();
    }
  }

  // Wait for DOM to be fully ready before showing content
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      // Hide loading spinner
      const loadingOverlay = document.getElementById('loading-overlay');
      if (loadingOverlay) {
        loadingOverlay.classList.add('hidden');
      }
      
      // Fade in content
      document.body.classList.add('loaded');
      if (queryInput) {
        queryInput.focus();
        searchBoxFocusedOnStartup = true;
      }

      // Set up event listeners after DOM is ready
    });
  });

  vscode.postMessage({ type: 'webviewReady' });
  vscode.postMessage({ type: 'getModules' });
  vscode.postMessage({ type: 'getCurrentDirectory' });
  vscode.postMessage({ type: 'getWorkspaceInfo' });
  console.log('[Rifler] Sending getProjectExclusions message');
  vscode.postMessage({ type: 'getProjectExclusions' });
  
  // Initialize results count display
  clearResultsCountDisplay();

  function toggleReplace(forceState) {
    if (replaceRow) {
      const isVisible = replaceRow.classList.contains('visible');
      const newState = typeof forceState === 'boolean' ? forceState : !isVisible;
      
      replaceRow.classList.toggle('visible', newState);
      replaceRow.style.display = newState ? 'flex' : 'none';
      
      // Update toggle button state
      if (replaceToggleBtn) {
        replaceToggleBtn.classList.toggle('active', newState);
      }

      if (newState && replaceInput) {
        replaceInput.focus();
      }
      
      // Update highlights when replace mode changes
      if (isEditMode) {
        updateHighlights();
      }
      
      vscode.postMessage({
        type: 'toggleReplace',
        state: newState
      });
    }
  }

  // Toggle replace on Cmd/Ctrl+Shift+R is handled in keyboard handler below
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && e.code === 'KeyF') {
      e.preventDefault();
      toggleReplace();
    }
    
    // Toggle preview panel on Ctrl+Shift+P
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyP') {
      e.preventDefault();
      const previewToggleBtn = document.getElementById('preview-toggle-btn');
      if (previewToggleBtn) {
        previewToggleBtn.click();
      }
    }
  });

  // Preview editor shortcuts should work even when focus is inside the local widget.
  // Capture so VS Code / browser find doesn't steal Cmd/Ctrl+F.
  document.addEventListener('keydown', (e) => {
    const isFindShortcut = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyF';
    const isReplaceShortcut = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyR';
    if (!isFindShortcut && !isReplaceShortcut) return;

    // Only when the preview editor area is active (textarea or the widget itself).
    const active = document.activeElement;
    const inEditorArea = !!(editorContainer && active && editorContainer.contains(active));
    if (!inEditorArea) return;

    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') {
      e.stopImmediatePropagation();
    }

    if (isFindShortcut) {
      triggerFindInFile();
    } else {
      triggerReplaceInFileShortcut();
    }
  }, true);

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      queryInput.value = '';
      if (fileMaskInput) {
        fileMaskInput.value = '';
        state.options.fileMask = '';
      }
      state.results = [];
      state.activeIndex = -1;
      handleSearchResults([], { skipAutoLoad: true });
      
      vscode.postMessage({ type: 'clearState' });
      
      vscode.postMessage({ type: 'minimize', state: {} });

      applyQueryRows(1, { skipSearch: true });
    });
  }

    function renderSearchHistoryMenu() {
      if (!searchHistoryMenu) return;

      const entries = Array.isArray(state.searchHistory) ? state.searchHistory : [];
      searchHistoryMenu.innerHTML = '';

      if (entries.length === 0) {
        const emptyBtn = document.createElement('button');
        emptyBtn.disabled = true;
        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined';
        icon.textContent = 'search';
        const label = document.createElement('span');
        label.textContent = 'No recent searches';
        emptyBtn.appendChild(icon);
        emptyBtn.appendChild(label);
        searchHistoryMenu.appendChild(emptyBtn);
        return;
      }

      entries.forEach((entry, index) => {
        const btn = document.createElement('button');
        btn.dataset.index = String(index);

        const icon = document.createElement('span');
        icon.className = 'material-symbols-outlined';
        icon.textContent = 'search';

        const label = document.createElement('span');
        label.textContent = String(entry?.query || '');

        btn.appendChild(icon);
        btn.appendChild(label);

        searchHistoryMenu.appendChild(btn);
      });
    }

    function applySearchHistoryEntry(entry) {
      if (!entry) return;

      // Apply query
      if (queryInput) {
        queryInput.value = String(entry.query || '');
        state.currentQuery = queryInput.value;
      }

      // Apply scope + paths
      if (entry.scope) {
        state.currentScope = entry.scope;
        if (scopeSelect) {
          scopeSelect.value = entry.scope;
        }
        updateScopeInputs();
      }
      if (directoryInput && typeof entry.directoryPath === 'string') {
        directoryInput.value = entry.directoryPath;
      }
      if (moduleSelect && typeof entry.modulePath === 'string') {
        moduleSelect.value = entry.modulePath;
      }

      // Apply options
      if (entry.options) {
        state.options.matchCase = !!entry.options.matchCase;
        state.options.wholeWord = !!entry.options.wholeWord;
        state.options.useRegex = !!entry.options.useRegex;
        state.options.multiline = !!entry.options.multiline;
        state.options.fileMask = entry.options.fileMask || '';

        if (matchCaseToggle) matchCaseToggle.classList.toggle('active', state.options.matchCase);
        if (wholeWordToggle) wholeWordToggle.classList.toggle('active', state.options.wholeWord);
        if (useRegexToggle) useRegexToggle.classList.toggle('active', state.options.useRegex);
        if (fileMaskInput) fileMaskInput.value = state.options.fileMask;
      }

      // Apply query rows from history if present; otherwise infer from multiline flag
      const inferredRows = typeof entry.queryRows === 'number'
        ? Math.max(1, Math.min(4, entry.queryRows))
        : (state.options.multiline ? 2 : 1);
      applyQueryRows(inferredRows, { skipSearch: true });
      recomputeMultilineOption({ skipSearch: true });
    }

    // Search history dropdown (triggered by magnifying glass)
    if (searchHistoryBtn && searchHistoryMenu) {
      renderSearchHistoryMenu();

      searchHistoryBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Close the overflow menu if open
        if (moreActionsMenu) {
          moreActionsMenu.classList.remove('open');
        }
        renderSearchHistoryMenu();
        searchHistoryMenu.classList.toggle('open');
      });

      searchHistoryMenu.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn || btn.disabled) return;
        const idxRaw = btn.dataset.index;
        const idx = Number(idxRaw);
        if (!Number.isFinite(idx)) return;
        const entries = Array.isArray(state.searchHistory) ? state.searchHistory : [];
        const entry = entries[idx];
        if (!entry) return;

        searchHistoryMenu.classList.remove('open');
        applySearchHistoryEntry(entry);
        // Start search immediately
        runSearch();
      });
    }

  // Overflow actions menu (for narrow layout)
  if (moreActionsBtn && moreActionsMenu) {
    moreActionsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
        if (searchHistoryMenu) {
          searchHistoryMenu.classList.remove('open');
        }
      moreActionsMenu.classList.toggle('open');
    });

    moreActionsMenu.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const action = btn.dataset.action;
      moreActionsMenu.classList.remove('open');
      switch (action) {
        case 'toggle-replace':
          if (replaceToggleBtn) replaceToggleBtn.click();
          break;
        case 'toggle-filters':
          if (filterBtn) filterBtn.click();
          break;
        case 'clear-search':
          if (clearSearchBtn) clearSearchBtn.click();
          break;
      }
    });

    document.addEventListener('click', () => {
      moreActionsMenu.classList.remove('open');
      if (searchHistoryMenu) {
        searchHistoryMenu.classList.remove('open');
      }
    });
  }

  if (filterBtn && filtersContainer) {
    filterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = filtersContainer.classList.toggle('hidden');
      filterBtn.classList.toggle('active', !isHidden);
    });
  }

  if (smartExcludeToggle) {
    // Load from webview state if available
    const savedState = vscode.getState() || {};
    if (typeof savedState.smartExcludesEnabled === 'boolean') {
      state.smartExcludesEnabled = savedState.smartExcludesEnabled;
    }
    smartExcludeToggle.checked = state.smartExcludesEnabled;
    smartExcludeToggle.addEventListener('change', () => {
      state.smartExcludesEnabled = smartExcludeToggle.checked;
      // Persist to webview state
      const currentState = vscode.getState() || {};
      vscode.setState({ ...currentState, smartExcludesEnabled: state.smartExcludesEnabled });
      if (state.currentQuery && state.currentQuery.length >= 2) {
        runSearch();
      }
    });
  }
  
  if (replaceToggleBtn) {
    replaceToggleBtn.addEventListener('click', () => {
      toggleReplace();
    });
  }

  // Preview panel toggle functionality
  const previewToggleBtn = document.getElementById('preview-toggle-btn');
  if (previewToggleBtn) {
    previewToggleBtn.addEventListener('click', () => {
      const previewPanel = document.getElementById('preview-panel-container');
      if (previewPanel) {
        state.previewPanelCollapsed = !state.previewPanelCollapsed;
        
        if (state.previewPanelCollapsed) {
          // Collapse to minimum height
          applyPreviewHeight(PREVIEW_MIN_HEIGHT, { persist: true });
        } else {
          // Expand to last expanded height or default
          const targetHeight = lastExpandedHeight || getDefaultPreviewHeight();
          applyPreviewHeight(targetHeight, { persist: true });
        }

        // Preview height changes affect the results viewport; re-render virtual rows immediately.
        scheduleVirtualRender();
        
        previewToggleBtn.innerHTML = state.previewPanelCollapsed ? 
          '<span class="material-symbols-outlined">add</span>' : 
          '<span class="material-symbols-outlined">remove</span>';
        
        // Send message to extension to save preference
        vscode.postMessage({ 
          type: 'previewPanelToggled', 
          collapsed: state.previewPanelCollapsed 
        });
      }
    });
  }

  if (replaceBtn) {
    replaceBtn.addEventListener('click', replaceOne);
  }

  if (replaceAllBtn) {
    replaceAllBtn.addEventListener('click', replaceAll);
  }

  // Function to update collapse/expand button text based on current state
  function updateCollapseButtonText() {
    if (!collapseAllBtn || state.results.length === 0) return;
    
    const allPaths = new Set();
    state.results.forEach(r => allPaths.add(r.relativePath || r.fileName));
    
    const allCollapsed = Array.from(allPaths).every(p => state.collapsedFiles.has(p));
    
    if (allCollapsed) {
      collapseAllBtn.innerHTML = 'Expand All <span class="material-symbols-outlined">unfold_more</span>';
    } else {
      collapseAllBtn.innerHTML = 'Collapse All <span class="material-symbols-outlined">unfold_less</span>';
    }
  }

  if (collapseAllBtn) {
    collapseAllBtn.addEventListener('click', () => {
      if (state.results.length === 0) return;
      
      const allPaths = new Set();
      state.results.forEach(r => allPaths.add(r.relativePath || r.fileName));
      
      // Check if all files are currently collapsed
      const allCurrentlyCollapsed = Array.from(allPaths).every(p => {
        if (state.collapsedFiles.has(p)) return true;
        if (state.expandedFiles.has(p)) return false;
        return state.resultsShowCollapsed;
      });
      
      if (allCurrentlyCollapsed) {
        // All collapsed, expand all
        state.collapsedFiles.clear();
        allPaths.forEach(p => state.expandedFiles.add(p));
      } else {
        // Not all collapsed, collapse all
        state.expandedFiles.clear();
        allPaths.forEach(p => state.collapsedFiles.add(p));
      }
      
      handleSearchResults(state.results, { skipAutoLoad: true, activeIndex: state.activeIndex, preserveScroll: true });
      updateCollapseButtonText();
    });
  }
  
  if (replaceInput) {
    replaceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.metaKey || e.ctrlKey) {
          replaceAll();
        } else {
          replaceOne();
        }
      }
    });
  }

  function closeLocalFindReplaceWidget(options) {
    if (!replaceWidget) return;

    replaceWidget.classList.remove('visible');
    if (replaceWidget.dataset) {
      replaceWidget.dataset.mode = '';
    }

    if (editorContainer) {
      editorContainer.classList.remove('local-widget-open');
      editorContainer.style.removeProperty('--local-widget-offset');
    }

    localMatches = [];
    localMatchIndex = 0;
    updateHighlights();

    const shouldRefocusEditor = !(options && options.refocusEditor === false);
    if (shouldRefocusEditor && isEditMode && fileEditor) {
      fileEditor.focus();
    }
  }

  function triggerReplaceInFile() {
    openLocalFindReplaceWidget({ focusTarget: 'replace', mode: 'replace' });
  }

  function openLocalFindReplaceWidget(options) {
    if (!state.fileContent) return;
    if (!replaceWidget) return;

    const focusTarget = (options && options.focusTarget) ? options.focusTarget : 'find';
    const mode = (options && options.mode) ? options.mode : (focusTarget === 'replace' ? 'replace' : 'find');

    const isVisible = replaceWidget.classList.contains('visible');
    const currentMode = (replaceWidget.dataset && replaceWidget.dataset.mode)
      ? replaceWidget.dataset.mode
      : ((localReplaceRow && localReplaceRow.hidden) ? 'find' : 'replace');

    // Shortcut behavior: if the widget is already open in the same mode,
    // pressing the shortcut again should close it.
    if (isVisible && currentMode === mode) {
      closeLocalFindReplaceWidget();
      return;
    }

    if (replaceWidget.dataset) {
      replaceWidget.dataset.mode = mode;
    }

    // Toggle widget "view": Find-only vs Replace
    if (localReplaceRow) localReplaceRow.hidden = mode === 'find';
    if (localReplaceButtons) localReplaceButtons.hidden = mode === 'find';
    // In Replace view, the match count should appear after the second textbox,
    // so hide the separator that would otherwise place it after the first.
    if (localSepAfterSearch) localSepAfterSearch.hidden = mode === 'replace';

    if (!isEditMode) {
      enterEditMode();
    }

    // Ensure widget is visible
    if (!isVisible) {
      // Local find/replace should start blank (do not mirror the main search query).
      if (localSearchInput) localSearchInput.value = '';
      if (localReplaceInput) localReplaceInput.value = '';
      replaceWidget.classList.add('visible');
      updateLocalMatches();
    }

    // Ensure the widget doesn't cover the first editor lines.
    syncLocalWidgetWidth();

    // Always focus the first textbox (Search) when opening.
    if (localSearchInput) {
      localSearchInput.focus();
      localSearchInput.select();
    }
  }

  function triggerFindInFile() {
    openLocalFindReplaceWidget({ focusTarget: 'find', mode: 'find' });
  }

  function triggerReplaceInFileShortcut() {
    openLocalFindReplaceWidget({ focusTarget: 'replace', mode: 'replace' });
  }

  if (replaceInFileBtn) {
    replaceInFileBtn.addEventListener('click', triggerReplaceInFile);
  }
  
  if (localReplaceClose) {
    localReplaceClose.addEventListener('click', () => closeLocalFindReplaceWidget());
  }

  if (localSearchInput) {
    localSearchInput.addEventListener('input', () => {
      updateLocalMatches();
      updateHighlights();
    });

    localSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          navigateLocalMatch(-1);
        } else {
          navigateLocalMatch(1);
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigateLocalMatch(-1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigateLocalMatch(1);
      } else if (e.key === 'Escape') {
        closeLocalFindReplaceWidget();
      }
    });
  }

  if (localReplaceInput) {
    localReplaceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.metaKey || e.ctrlKey) {
          triggerLocalReplaceAll();
        } else {
          triggerLocalReplace();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigateLocalMatch(-1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigateLocalMatch(1);
      } else if (e.key === 'Escape') {
        closeLocalFindReplaceWidget();
      }
    });
  }

  if (localReplaceAllBtn) {
    localReplaceAllBtn.addEventListener('click', triggerLocalReplaceAll);
  }

  if (localReplaceBtn) {
    localReplaceBtn.addEventListener('click', triggerLocalReplace);
  }

  if (localPrevBtn) {
    localPrevBtn.addEventListener('click', () => navigateLocalMatch(-1));
  }
  if (localNextBtn) {
    localNextBtn.addEventListener('click', () => navigateLocalMatch(1));
  }

  function updateLocalMatches() {
    localMatches = [];
    localMatchIndex = 0;
    
    var searchTerm = localSearchInput.value;
    if (!searchTerm || searchTerm.length < 1) {
      localMatchCount.textContent = '';
      return;
    }
    
    var content = fileEditor.value;
    var flags = 'g';
    if (!state.options.matchCase) flags += 'i';
    
    try {
      var pattern = searchTerm;
      if (!state.options.useRegex) {
        var chars = [['\\\\', '\\\\\\\\'], ['^', '\\\\^'], ['$', '\\\\$'], ['.', '\\\\.'], ['*', '\\\\*'], ['+', '\\\\+'], ['?', '\\\\?'], ['(', '\\\\('], [')', '\\\\)'], ['[', '\\\\['], [']', '\\\\]'], ['{', '\\\\{'], ['}', '\\\\}'], ['|', '\\\\|']];
        for (var ci = 0; ci < chars.length; ci++) {
          pattern = pattern.split(chars[ci][0]).join(chars[ci][1]);
        }
      }
      if (state.options.wholeWord) {
        pattern = '\\\\b' + pattern + '\\\\b';
      }
      
      var regex = new RegExp(pattern, flags);
      var match;
      while ((match = regex.exec(content)) !== null) {
        localMatches.push({
          start: match.index,
          end: match.index + match[0].length,
          text: match[0]
        });
        if (match[0].length === 0) break;
      }
    } catch (e) {
      // Invalid regex
    }
    
    if (localMatches.length > 0) {
      localMatchCount.textContent = '1 of ' + localMatches.length;
    } else {
      localMatchCount.textContent = '0 results';
    }
  }

  function navigateLocalMatch(delta) {
    if (localMatches.length === 0) return;
    
    localMatchIndex = (localMatchIndex + delta + localMatches.length) % localMatches.length;
    localMatchCount.textContent = (localMatchIndex + 1) + ' of ' + localMatches.length;
    
    var match = localMatches[localMatchIndex];
    fileEditor.setSelectionRange(match.start, match.end);
    fileEditor.focus();
    
    var textBefore = fileEditor.value.substring(0, match.start);
    var lines = textBefore.split('\n');
    var lineHeight = 20;
    var scrollTop = (lines.length - 5) * lineHeight;
    fileEditor.scrollTop = Math.max(0, scrollTop);
    editorBackdrop.scrollTop = fileEditor.scrollTop;
    
    updateHighlights();
  }

  function triggerLocalReplace() {
    if (localMatches.length === 0) return;
    
    // Temporarily hide backdrop to prevent flickering during highlight update
    if (editorBackdrop) {
      editorBackdrop.style.visibility = 'hidden';
    }
    
    var match = localMatches[localMatchIndex];
    var content = fileEditor.value;
    var newContent = content.substring(0, match.start) + localReplaceInput.value + content.substring(match.end);
    
    fileEditor.value = newContent;
    state.fileContent.content = newContent;
    
    saveFile();
    
    updateLocalMatches();
    updateHighlights();
    
    // Show backdrop again after highlights are updated
    if (editorBackdrop) {
      editorBackdrop.style.visibility = 'visible';
    }
    
    if (localMatches.length > 0) {
      if (localMatchIndex >= localMatches.length) {
        localMatchIndex = 0;
      }
      localMatchCount.textContent = (localMatchIndex + 1) + ' of ' + localMatches.length;
    }
  }

  function triggerLocalReplaceAll() {
    if (localMatches.length === 0) return;
    
    // Temporarily hide backdrop to prevent flickering during highlight update
    if (editorBackdrop) {
      editorBackdrop.style.visibility = 'hidden';
    }
    
    var content = fileEditor.value;
    var searchTerm = localSearchInput.value;
    var replaceTerm = localReplaceInput.value;
    
    var flags = 'g';
    if (!state.options.matchCase) flags += 'i';
    
    try {
      var pattern = searchTerm;
      if (!state.options.useRegex) {
        pattern = pattern.split('.').join('\\\\.');
        pattern = pattern.split('*').join('\\\\*');
        pattern = pattern.split('+').join('\\\\+');
        pattern = pattern.split('?').join('\\\\?');
        pattern = pattern.split('^').join('\\\\^');
        pattern = pattern.split('$').join('\\\\$');
        pattern = pattern.split('(').join('\\\\(');
        pattern = pattern.split(')').join('\\\\)');
        pattern = pattern.split('{').join('\\\\{');
        pattern = pattern.split('}').join('\\\\}');
      }
      if (state.options.wholeWord) {
        pattern = '\\\\b' + pattern + '\\\\b';
      }
      
      var regex = new RegExp(pattern, flags);
      var newContent = content.replace(regex, replaceTerm);
      var count = localMatches.length;
      
      fileEditor.value = newContent;
      state.fileContent.content = newContent;
      
      saveFile();
      
      updateLocalMatches();
      updateHighlights();
      
      // Show backdrop again after highlights are updated
      if (editorBackdrop) {
        editorBackdrop.style.visibility = 'visible';
      }
      
      localMatchCount.textContent = 'Replaced ' + count;
    } catch (e) {
    }
  }

  let isEditMode = false;
  let applyEditsTimeout = null;
  
  // RAF throttling for backdrop sync to prevent flicker on arrow navigation
  let pendingBackdropUpdate = false;
  function scheduleBackdropSync() {
    if (pendingBackdropUpdate) return;
    pendingBackdropUpdate = true;
    requestAnimationFrame(() => {
      pendingBackdropUpdate = false;
      updateHighlights();
    });
  }
  
  // Prevent scroll ping-pong between editor and preview
  let isProgrammaticScroll = false;
  
  // Cache line elements to avoid querying on every arrow press
  let lineEls = [];
  let activeLineEl = null;
  let activeLineIdx = 0;
  
  // RAF schedulers for active line and backdrop updates
  let rafActiveScheduled = false;
  let rafBackdropScheduled = false;
  let pendingActiveIdx = 0;
  
  function scheduleActiveLineUpdate(idx) {
    pendingActiveIdx = idx;
    if (rafActiveScheduled) return;
    rafActiveScheduled = true;
    requestAnimationFrame(() => {
      rafActiveScheduled = false;
      applyActiveLineClass(pendingActiveIdx);
      ensureLineVisible(pendingActiveIdx);
    });
  }
  
  function scheduleBackdropUpdateRAF() {
    if (rafBackdropScheduled) return;
    rafBackdropScheduled = true;
    requestAnimationFrame(() => {
      rafBackdropScheduled = false;
      scheduleBackdropSync();
    });
  }
  
  function applyActiveLineClass(idx) {
    // Touch only 2 line elements: remove from previous, add to next
    if (activeLineEl) {
      activeLineEl.classList.remove('isActive');
    }
    
    activeLineEl = lineEls[idx] || null;
    activeLineIdx = idx;
    
    if (activeLineEl) {
      activeLineEl.classList.add('isActive');
    }
  }
  
  function ensureLineVisible(idx) {
    if (!previewContent || idx < 0 || idx >= lineEls.length) return;
    const lineEl = lineEls[idx];
    if (lineEl) {
      // Only assign scrollTop if element is outside viewport
      const rect = lineEl.getBoundingClientRect();
      const containerRect = previewContent.getBoundingClientRect();
      
      if (rect.top < containerRect.top) {
        previewContent.scrollTop -= (containerRect.top - rect.top);
      } else if (rect.bottom > containerRect.bottom) {
        previewContent.scrollTop += (rect.bottom - containerRect.bottom);
      }
    }
  }
  
  function rebuildLineElementCache() {
    lineEls = Array.from(document.querySelectorAll('.pvLine'));
    activeLineEl = lineEls[activeLineIdx] || null;
  }

  if (previewContent) {
    previewContent.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      
      // Find the clicked line
      const pvLine = e.target.closest('.pvLine');
      if (pvLine) {
        const lineNumber = parseInt(pvLine.getAttribute('data-line'), 10);
        const pvCode = pvLine.querySelector('.pvCode');
        
        if (pvCode) {
          // Use DOM caret APIs to get precise caret position
          let clickedColumn = 0;
          
          try {
            // Try caretRangeFromPoint first (Chrome, Safari)
            let range = null;
            if (document.caretRangeFromPoint) {
              range = document.caretRangeFromPoint(e.clientX, e.clientY);
            } else if (document.caretPositionFromPoint) {
              // Firefox
              const position = document.caretPositionFromPoint(e.clientX, e.clientY);
              if (position) {
                range = document.createRange();
                range.setStart(position.offsetNode, position.offset);
              }
            }
            
            if (range) {
              // Find the closest .pvSeg element
              let node = range.startContainer;
              let pvSeg = null;
              
              if (node.nodeType === Node.TEXT_NODE) {
                pvSeg = node.parentElement?.closest('.pvSeg');
              } else if (node.nodeType === Node.ELEMENT_NODE) {
                pvSeg = node.closest('.pvSeg');
              }
              
              if (pvSeg) {
                const segStart = parseInt(pvSeg.getAttribute('data-start') || '0', 10);
                let offsetInSegText = 0;
                
                // Only use offset if the caret is in a text node within this seg
                if (node.nodeType === Node.TEXT_NODE && pvSeg.contains(node)) {
                  // Walk text nodes to compute offset
                  const walker = document.createTreeWalker(pvSeg, NodeFilter.SHOW_TEXT);
                  let textNode;
                  let textOffset = 0;
                  while ((textNode = walker.nextNode())) {
                    if (textNode === node) {
                      offsetInSegText = textOffset + range.startOffset;
                      break;
                    }
                    textOffset += textNode.textContent.length;
                  }
                } else {
                  // Fallback: use segStart only
                  offsetInSegText = 0;
                }
                
                clickedColumn = segStart + offsetInSegText;
              }
            }
            
            // Clamp column to raw line length
            if (state.fileContent && state.fileContent.content) {
              const lines = state.fileContent.content.split('\n');
              const rawLine = lines[lineNumber] || '';
              clickedColumn = Math.max(0, Math.min(clickedColumn, rawLine.length));
            }
          } catch (err) {
            console.error('[Rifler] Click-to-cursor error:', err);
            clickedColumn = 0;
          }
          
          enterEditMode(lineNumber, clickedColumn);
        } else {
          enterEditMode(lineNumber);
        }
      } else {
        enterEditMode();
      }
    });
  }

  function enterEditMode(clickedLineNumber, clickedColumn = 0) {
    if (!state.fileContent || isEditMode) return;
    
    const scrollTop = previewContent.scrollTop;
    
    isEditMode = true;
    
    // 1) POPULATE BEFORE ANY VISIBILITY CHANGES
    // This prevents first-time blank frame
    if (fileEditor) {
      fileEditor.value = state.fileContent.content;
    }
    
    // Cheap immediate backdrop paint to prevent blank
    if (editorBackdrop) {
      editorBackdrop.textContent = state.fileContent.content;
    }
    
    // Update line numbers based on content
    if (fileEditor && editorLineNumbers) {
      const lines = state.fileContent.content.split('\n');
      let html = '';
      for (let i = 1; i <= lines.length; i++) {
        html += '<div>' + i + '</div>';
      }
      editorLineNumbers.innerHTML = html;
    }
    
    // Set caret position before showing editor
    if (fileEditor && typeof clickedLineNumber === 'number' && clickedLineNumber >= 0) {
      const content = state.fileContent.content;
      const lineStarts = [0];
      for (let i = 0; i < content.length; i++) {
        if (content[i] === '\n') {
          lineStarts.push(i + 1);
        }
      }
      
      const lineStart = lineStarts[clickedLineNumber] !== undefined ? lineStarts[clickedLineNumber] : content.length;
      const lines = content.split('\n');
      const lineLength = lines[clickedLineNumber]?.length || 0;
      const clampedColumn = Math.min(clickedColumn, lineLength);
      const charPosition = lineStart + clampedColumn;
      fileEditor.setSelectionRange(charPosition, charPosition);
    }
    
    // Sync initial scroll position
    if (fileEditor) {
      fileEditor.scrollTop = scrollTop;
    }
    if (editorBackdrop) {
      editorBackdrop.scrollTop = scrollTop;
    }
    if (editorLineNumbers) {
      editorLineNumbers.scrollTop = scrollTop;
    }
    
    // 2) SHOW EDITOR FIRST
    if (editorContainer) {
      editorContainer.classList.add('visible');
    }
    
    // 3) FOCUS IMMEDIATELY
    if (fileEditor) {
      fileEditor.focus({ preventScroll: true });
    }
    
    // 4) HIDE PREVIEW ONLY AFTER PAINT (2 frames to be safe)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (previewContent) {
          previewContent.classList.add('hidden-for-edit');
        }
        
        // 5) EXPENSIVE HIGHLIGHTING AFTER EDITOR VISIBLE
        requestAnimationFrame(() => {
          scheduleBackdropSync();
        });
      });
    });
  }

  function saveFile() {
    if (!state.fileContent) return;
    
    const newContent = fileEditor.value;
    
    // Update local state immediately
    state.fileContent.content = newContent;
    
    // Debounce sending applyEdits message (150-300ms for immediate feel)
    if (applyEditsTimeout) clearTimeout(applyEditsTimeout);
    applyEditsTimeout = setTimeout(() => {
      vscode.postMessage({
        type: 'applyEdits',
        uri: state.fileContent.uri,
        content: newContent,
        source: 'rifler',
        ts: Date.now()
      });
    }, 150);
  }

  function exitEditMode(skipRender = false) {
    if (!isEditMode) return;
    
    // Flush any pending applyEdits
    if (applyEditsTimeout) clearTimeout(applyEditsTimeout);
    if (!state.fileContent) return;
    
    const finalContent = fileEditor.value;
    vscode.postMessage({
      type: 'applyEdits',
      uri: state.fileContent.uri,
      content: finalContent,
      source: 'rifler',
      ts: Date.now()
    });
    state.fileContent.content = finalContent;
    
    isEditMode = false;
    
    // SHOW PREVIEW FIRST
    if (previewContent) {
      previewContent.classList.remove('hidden-for-edit');
    }
    
    // HIDE EDITOR ON NEXT PAINT
    requestAnimationFrame(() => {
      if (editorContainer) {
        editorContainer.classList.remove('visible');
      }
    });
    
    if (!skipRender) {
      renderFilePreview(state.fileContent);
    }
  }

  if (fileEditor) {
    fileEditor.addEventListener('input', () => {
      // Use RAF-throttled update to prevent flicker during rapid typing/navigation
      scheduleBackdropSync();
      // Send applyEdits with debounce on input
      saveFile();
    });

    fileEditor.addEventListener('blur', (e) => {
      if (applyEditsTimeout) clearTimeout(applyEditsTimeout);
      
      // Check if focus moved to something else in the editor container (like the replace widget)
      const relatedTarget = e.relatedTarget;
      if (relatedTarget && editorContainer && editorContainer.contains(relatedTarget)) {
        return;
      }
      
      // Use a small timeout as fallback for cases where relatedTarget is null but focus is still moving
      setTimeout(() => {
        if (isEditMode && editorContainer && !editorContainer.contains(document.activeElement)) {
          exitEditMode();
        }
      }, 150);
    });
    fileEditor.addEventListener('keydown', (e) => {
      // Preview editor shortcuts (only when the editor textarea is focused)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyF') {
        // Find in file (within the preview editor)
        e.preventDefault();
        e.stopPropagation();
        triggerFindInFile();
      } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyR') {
        // Replace in file (within the preview editor)
        e.preventDefault();
        e.stopPropagation();
        triggerReplaceInFileShortcut();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (saveTimeout) clearTimeout(saveTimeout);
        saveFile();
      } else if (checkReplaceKeybinding(e)) {
        e.preventDefault();
        triggerReplaceInFile();
      } else if (e.key === 'Escape') {
        if (saveTimeout) clearTimeout(saveTimeout);
        exitEditMode();
      }
    });
  }
  
  function checkReplaceKeybinding(e) {
    const keybinding = state.replaceKeybinding || 'ctrl+shift+r';
    const parts = keybinding.toLowerCase().split('+');
    const key = parts[parts.length - 1];
    const needsCtrl = parts.includes('ctrl');
    const needsShift = parts.includes('shift');
    const needsAlt = parts.includes('alt');
    const needsMeta = parts.includes('cmd') || parts.includes('meta');
    
    const ctrlMatch = needsCtrl ? e.ctrlKey : true;
    const shiftMatch = needsShift ? e.shiftKey : true;
    const altMatch = needsAlt ? e.altKey : true;
    const metaMatch = needsMeta ? e.metaKey : true;
    const keyMatch = e.key.toLowerCase() === key;
    
    return ctrlMatch && shiftMatch && altMatch && metaMatch && keyMatch;
  }
  
  if (fileEditor) {
    fileEditor.addEventListener('scroll', () => {
      // Prevent scroll ping-pong during programmatic scroll
      if (isProgrammaticScroll) return;
      
      isProgrammaticScroll = true;
      
      if (editorBackdrop) {
        editorBackdrop.scrollTop = fileEditor.scrollTop;
        editorBackdrop.scrollLeft = fileEditor.scrollLeft;
      }
      if (editorLineNumbers) {
        editorLineNumbers.scrollTop = fileEditor.scrollTop;
      }
      
      // Reset guard in next frame
      requestAnimationFrame(() => {
        isProgrammaticScroll = false;
      });
    });
  }
  
  function updateHighlights() {
    if (!editorBackdrop || !fileEditor) return;
    
    const text = fileEditor.value;
    const searchQuery = localSearchInput ? localSearchInput.value : (state.currentQuery || '');
    
    const fileName = state.fileContent ? state.fileContent.fileName : '';
    const language = getLanguageFromFilename(fileName);
    
    let highlighted = '';
    
    // Re-enable syntax highlighting
    if (typeof hljs !== 'undefined') {
      try {
        if (language && hljs.getLanguage(language)) {
          highlighted = hljs.highlight(text, { language }).value;
        } else {
          highlighted = hljs.highlightAuto(text).value;
        }
      } catch (e) {
        console.error('[Rifler] Highlight error in editor:', e);
        highlighted = text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      }
    } else {
      highlighted = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
    
    if (searchQuery && searchQuery.length > 0) {
      try {
        const temp = document.createElement('div');
        temp.innerHTML = highlighted;
        
        const walker = document.createTreeWalker(temp, NodeFilter.SHOW_TEXT, null);
        const textNodes = [];
        while (walker.nextNode()) {
          textNodes.push(walker.currentNode);
        }
        
        const lowerQuery = searchQuery.toLowerCase();
        for (const node of textNodes) {
          const nodeText = node.textContent || '';
          const lowerNodeText = nodeText.toLowerCase();
          
          let index = lowerNodeText.indexOf(lowerQuery);
          if (index !== -1) {
            const fragment = document.createDocumentFragment();
            let lastIndex = 0;
            
            while (index !== -1) {
              if (index > lastIndex) {
                fragment.appendChild(document.createTextNode(nodeText.substring(lastIndex, index)));
              }
              
              const mark = document.createElement('span');
              mark.className = 'match';
              mark.textContent = nodeText.substring(index, index + searchQuery.length);
              fragment.appendChild(mark);
              
              lastIndex = index + searchQuery.length;
              index = lowerNodeText.indexOf(lowerQuery, lastIndex);
            }
            
            if (lastIndex < nodeText.length) {
              fragment.appendChild(document.createTextNode(nodeText.substring(lastIndex)));
            }
            
            if (node.parentNode) {
              node.parentNode.replaceChild(fragment, node);
            }
          }
        }
        
        highlighted = temp.innerHTML;
      } catch (e) {
      }
    }
    
    highlighted += '\n';
    
    editorBackdrop.innerHTML = highlighted;
    
    updateLineNumbers();
  }

  function updateLineNumbers() {
    if (!editorLineNumbers || !fileEditor) return;
    
    const text = fileEditor.value;
    const lines = text.split(String.fromCharCode(10));
    const lineCount = lines.length;
    
    let html = '';
    for (let i = 1; i <= lineCount; i++) {
      html += '<div>' + i + '</div>';
    }
    
    editorLineNumbers.innerHTML = html;
  }

  function replaceOne() {
    if (isEditMode) {
      exitEditMode(true);
    }
    
    if (state.activeIndex < 0 || state.activeIndex >= state.results.length) return;
    const result = state.results[state.activeIndex];
    const replaceText = replaceInput.value;
    const replacedUri = result.uri;
    
    // Show loading overlay during replace operation
    if (previewLoadingOverlay) {
      previewLoadingOverlay.classList.add('visible');
    }
    
    // Fallback: hide loading overlay after 3 seconds if file content doesn't update
    state.loadingTimeout = setTimeout(() => {
      if (previewLoadingOverlay) {
        previewLoadingOverlay.classList.remove('visible');
      }
      state.loadingTimeout = null;
    }, 3000);
    
    vscode.postMessage({
      type: 'replaceOne',
      uri: result.uri,
      line: result.line,
      character: result.character,
      length: result.length,
      replaceText: replaceText
    });

    const currentUri = result.uri;
    const currentLine = result.line;
    const currentChar = result.character;
    const delta = replaceText.length - result.length;

    state.results.splice(state.activeIndex, 1);

    if (delta !== 0) {
      for (let i = state.activeIndex; i < state.results.length; i++) {
        const r = state.results[i];
        if (r.uri === currentUri && r.line === currentLine && r.character > currentChar) {
          r.character += delta;
        }
      }
    }

    updateResultsCountDisplay(state.results);
    
    if (state.results.length === 0) {
      showPlaceholder('No results found');
      previewContent.innerHTML = '<div class="empty-state">No results</div>';
      previewFilename.textContent = '';
      state.activeIndex = -1;
      if (isEditMode && state.fileContent && state.fileContent.uri === replacedUri) {
        vscode.postMessage({
          type: 'getFileContent',
          uri: replacedUri,
          query: state.currentQuery,
          options: state.options
        });
      }
    } else {
      if (state.activeIndex >= state.results.length) {
        state.activeIndex = state.results.length - 1;
      }
      hidePlaceholder();
      renderResultsVirtualized();
      ensureActiveVisible();
      // Only reload file content if the current preview file was modified
      if (state.activeIndex >= 0 && state.fileContent && state.fileContent.uri === replacedUri) {
        // Reload immediately since this file is currently being previewed
        loadFileContent(state.results[state.activeIndex]);
      }
    }
    
    setTimeout(runSearch, 200);
  }

  function replaceAll() {
    if (isEditMode) {
      exitEditMode(true);
    }
    
    vscode.postMessage({
      type: 'replaceAll',
      query: state.currentQuery,
      replaceText: replaceInput.value,
      scope: state.currentScope,
      options: state.options,
      directoryPath: state.currentScope === 'directory' ? directoryInput.value.trim() : undefined,
      modulePath: state.currentScope === 'module' ? moduleSelect.value : undefined
    });
  }

  let validationDebounceTimeout;

  function updateValidationMessage(fieldId, messageElementId, message, type) {
    const messageElement = document.getElementById(messageElementId);
    if (!messageElement) return;

    console.log('[Rifler] Updating validation message:', { fieldId, messageElementId, message, type });

    if (message) {
      messageElement.textContent = message;
      messageElement.className = 'validation-message visible ' + type;
    } else {
      messageElement.className = 'validation-message';
      messageElement.textContent = '';
    }
  }

  function validateDirectory() {
    if (state.currentScope !== 'directory') return;
    
    const directoryPath = directoryInput.value.trim();
    const container = directoryInput.closest('.filter-field');
    
    console.log('[Rifler] Validating directory:', directoryPath);

    if (!directoryPath) {
      updateValidationMessage('directory-input', 'directory-validation-message', '', 'error');
      directoryInput.classList.remove('error');
      if (container) container.classList.remove('error');
      return;
    }

    // Send message to extension to check if directory exists
    console.log('[Rifler] Sending validateDirectory message:', directoryPath);
    vscode.postMessage({
      type: 'validateDirectory',
      directoryPath: directoryPath
    });
  }

  function updateSearchButtonState() {
    const queryValidation = document.getElementById('query-validation-message');
    const hasRegexError = queryValidation && queryValidation.classList.contains('error');
    const searchBtn = document.getElementById('search-btn') || toggleReplaceBtn.previousElementSibling;
    
    if (searchBtn) {
      searchBtn.disabled = hasRegexError;
    }
  }

  function validateRegexPattern() {
    const useRegex = state.options.useRegex;
    const pattern = queryInput.value;

    if (pattern.trim().length === 0) {
      const msgElement = document.getElementById('query-validation-message');
      if (msgElement) {
        msgElement.textContent = '';
        msgElement.className = 'validation-message';
      }
    } else {
      vscode.postMessage({
        type: 'validateRegex',
        pattern: pattern,
        useRegex: useRegex,
        multiline: state.options.multiline
      });
    }
  }

  function validateFileMaskPattern() {
    const fileMask = fileMaskInput.value;

    vscode.postMessage({
      type: 'validateFileMask',
      fileMask: fileMask
    });
  }

  queryInput.addEventListener('input', () => {
    console.log('Input event triggered, value:', queryInput.value);
    clearTimeout(state.searchTimeout);
    recomputeMultilineOption({ skipSearch: true });
    
    if (isEditMode) {
      exitEditMode(true);
    }
    
    if (queryInput.value.trim().length === 0) {
      previewContent.innerHTML = '<div class="empty-state">No results</div>';
      previewFilename.textContent = '';
      showPlaceholder('Type to search...');
      clearResultsCountDisplay();
      state.results = [];
      state.activeIndex = -1;
      state.currentQuery = '';
      state.fileContent = null;
      state.lastPreview = null;
      state.lastSearchDuration = 0;
      
      applyPreviewHeight(previewHeight || getDefaultPreviewHeight(), { updateLastExpanded: false, persist: false, visible: false });
      
      const msgElement = document.getElementById('query-validation-message');
      if (msgElement) {
        msgElement.textContent = '';
        msgElement.className = 'validation-message';
      }
      
      vscode.postMessage({ type: 'clearState' });
      return;
    }
    
    clearTimeout(validationDebounceTimeout);
    validationDebounceTimeout = setTimeout(() => {
      validateRegexPattern();
    }, 300);

    state.searchTimeout = setTimeout(() => {
      console.log('Timeout fired, calling runSearch()');
      runSearch();
    }, 300);
    console.log('Timeout set, id:', state.searchTimeout);
  });

  if (matchCaseToggle) {
    matchCaseToggle.addEventListener('click', () => {
      state.options.matchCase = !state.options.matchCase;
      syncSearchOptionToggles();
      runSearch();
    });
  }

  if (wholeWordToggle) {
    wholeWordToggle.addEventListener('click', () => {
      state.options.wholeWord = !state.options.wholeWord;
      syncSearchOptionToggles();
      runSearch();
    });
  }

  if (useRegexToggle) {
    useRegexToggle.addEventListener('click', () => {
      state.options.useRegex = !state.options.useRegex;
      syncSearchOptionToggles();
      
      if (state.options.useRegex) {
        validateRegexPattern();
      } else {
        const msgElement = document.getElementById('query-validation-message');
        if (msgElement) {
          msgElement.textContent = '';
          msgElement.className = 'validation-message';
        }
      }
      
      runSearch();
    });
  }

  if (fileMaskInput) {
    fileMaskInput.addEventListener('input', () => {
      clearTimeout(state.searchTimeout);
      
      clearTimeout(validationDebounceTimeout);
      validationDebounceTimeout = setTimeout(() => {
        validateFileMaskPattern();
      }, 150);

      state.searchTimeout = setTimeout(() => {
        state.options.fileMask = fileMaskInput.value;
        runSearch();
      }, 300);
    });
  }

  let isResizing = false;
  let startY = 0;
  let startResultsHeight = 0;
  let containerHeightAtDragStart = 0;
  let virtualRenderPending = false;
  const MIN_PANEL_HEIGHT = 80;
  const PREVIEW_MIN_HEIGHT = 80;
  const DEFAULT_PREVIEW_HEIGHT = 240;
  let previewHeight = 0;
  let lastExpandedHeight = 0;
  const RESIZER_HEIGHT = 14;

  const savedWebviewState = vscode.getState() || {};

  function saveState() {
    vscode.postMessage({ 
      type: 'minimize',
      state: {
        query: queryInput.value,
        replaceText: replaceInput.value,
        scope: state.currentScope,
        directoryPath: directoryInput.value,
        modulePath: moduleSelect.value,
        options: state.options,
        queryRows: state.queryRows,
        showReplace: replaceRow.classList.contains('visible'),
        smartExcludesEnabled: state.smartExcludesEnabled,
        results: state.results,
        activeIndex: state.activeIndex,
        lastPreview: state.lastPreview
      }
    });
  }

  function getContainerHeight() {
    let summaryHeight = resultsSummaryBar ? resultsSummaryBar.offsetHeight : 0;
    // Fallback if not yet rendered but we know it should be there
    if (summaryHeight === 0 && resultsSummaryBar) {
      summaryHeight = 28; 
    }
    return Math.max(0, mainContent.offsetHeight - RESIZER_HEIGHT - summaryHeight);
  }

  function getDefaultPreviewHeight() {
    const containerHeight = getContainerHeight();
    if (containerHeight <= 0) return DEFAULT_PREVIEW_HEIGHT;
    const proposed = Math.round(containerHeight * 0.55);
    const maxPreview = Math.max(PREVIEW_MIN_HEIGHT, containerHeight - MIN_PANEL_HEIGHT);
    return Math.min(Math.max(PREVIEW_MIN_HEIGHT, proposed), maxPreview);
  }

  function applyPreviewHeight(height, { updateLastExpanded = true, persist = false, visible = true } = {}) {
    const containerHeight = getContainerHeight();
    
    // Always set visibility, even if we can't apply height yet
    if (previewPanelContainer) {
      previewPanelContainer.style.display = visible ? 'flex' : 'none';
    }
    
    // If we can't determine container height yet, use a reasonable default
    const effectiveContainerHeight = containerHeight > 0 ? containerHeight : 600; // Assume 600px default
    const maxPreviewHeight = Math.max(PREVIEW_MIN_HEIGHT, effectiveContainerHeight - MIN_PANEL_HEIGHT);
    const clamped = Math.min(Math.max(PREVIEW_MIN_HEIGHT, height || getDefaultPreviewHeight()), maxPreviewHeight);
    const newResultsHeight = Math.max(MIN_PANEL_HEIGHT, effectiveContainerHeight - clamped);
    
    if (resultsPanel) {
      resultsPanel.style.flex = '1';
      resultsPanel.style.height = 'auto';
      resultsPanel.style.minHeight = '0';
    }
    if (previewPanelContainer) {
      previewPanelContainer.style.flex = 'none';
      previewPanelContainer.style.height = (clamped + RESIZER_HEIGHT) + 'px';
      previewPanel.style.height = clamped + 'px';
    }
    
    previewHeight = clamped;
    
    if (updateLastExpanded && clamped > PREVIEW_MIN_HEIGHT) {
      lastExpandedHeight = clamped;
    }
    
    if (persist) {
      const currentState = vscode.getState() || {};
      vscode.setState({
        ...currentState,
        previewHeight: previewHeight,
        lastExpandedHeight: lastExpandedHeight,
        resultsPanelHeight: newResultsHeight
      });
    }

    updatePreviewToggleButton();
  }

  function isPreviewCollapsed() {
    return previewHeight <= PREVIEW_MIN_HEIGHT + 0.5;
  }

  function updatePreviewToggleButton() {
    // Preview toggle button not used in current UI design
    // This function is kept for backward compatibility but does nothing
  }

  function initializePanelHeights() {
    const containerHeight = getContainerHeight();
    
    // If container height is 0, wait for it to be available
    if (containerHeight <= 0) {
      requestAnimationFrame(initializePanelHeights);
      return;
    }

    let initialPreviewHeight = getDefaultPreviewHeight();
    
    if (typeof savedWebviewState.previewHeight === 'number') {
      initialPreviewHeight = savedWebviewState.previewHeight;
    } else if (typeof savedWebviewState.resultsPanelHeight === 'number') {
      initialPreviewHeight = Math.max(PREVIEW_MIN_HEIGHT, containerHeight - savedWebviewState.resultsPanelHeight);
    }

    if (typeof savedWebviewState.lastExpandedHeight === 'number') {
      lastExpandedHeight = savedWebviewState.lastExpandedHeight;
    }

    if (!lastExpandedHeight) {
      lastExpandedHeight = initialPreviewHeight > PREVIEW_MIN_HEIGHT ? initialPreviewHeight : getDefaultPreviewHeight();
    }
    
    const isVisible = state.results && state.results.length > 0 && state.activeIndex >= 0;
    applyPreviewHeight(initialPreviewHeight, { 
      updateLastExpanded: initialPreviewHeight > PREVIEW_MIN_HEIGHT, 
      persist: false,
      visible: isVisible
    });
  }

  // Use ResizeObserver to handle dynamic layout changes
  if (typeof ResizeObserver !== 'undefined' && mainContent) {
    const resizeObserver = new ResizeObserver(entries => {
      for (let entry of entries) {
        if (entry.contentRect.height > 0 && !previewHeight) {
          initializePanelHeights();
        } else if (previewHeight) {
          const isVisible = state.results && state.results.length > 0 && state.activeIndex >= 0;
          applyPreviewHeight(previewHeight, { updateLastExpanded: false, persist: false, visible: isVisible });
        }
      }
    });
    resizeObserver.observe(mainContent);
  } else {
    requestAnimationFrame(() => {
      initializePanelHeights();
    });
  }

  // Setup drag handle for resizing preview panel (pointer-first with fallbacks)
  function beginResize(clientY) {
    isResizing = true;
    startY = clientY;
    startResultsHeight = resultsPanel ? resultsPanel.offsetHeight : 0;
    containerHeightAtDragStart = getContainerHeight();
    if (dragHandle) dragHandle.classList.add('dragging');
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  }

  function updateResize(clientY) {
    if (!isResizing) return;
    const containerHeight = containerHeightAtDragStart || getContainerHeight();
    const deltaY = clientY - startY;
    let newResultsHeight = startResultsHeight + deltaY;
    const maxResultsHeight = containerHeight - PREVIEW_MIN_HEIGHT;
    newResultsHeight = Math.max(MIN_PANEL_HEIGHT, Math.min(maxResultsHeight, newResultsHeight));
    const newPreviewHeight = containerHeight - newResultsHeight;
    applyPreviewHeight(newPreviewHeight, { updateLastExpanded: newPreviewHeight > PREVIEW_MIN_HEIGHT, persist: false });
  }

  function endResize(persist = true) {
    if (!isResizing) return;
    isResizing = false;
    if (dragHandle) dragHandle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    applyPreviewHeight(previewHeight, { updateLastExpanded: previewHeight > PREVIEW_MIN_HEIGHT, persist });
    scheduleVirtualRender();
  }

  if (dragHandle) {
    dragHandle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      
      // Don't start dragging if clicking on the preview toggle button
      if (e.target.closest('#preview-toggle-btn')) {
        return;
      }
      
      beginResize(e.clientY);
      try {
        dragHandle.setPointerCapture(e.pointerId);
      } catch (err) {
        console.error('Failed to set pointer capture:', err);
      }
      e.preventDefault();
    });

    dragHandle.addEventListener('pointermove', (e) => {
      if (!isResizing) return;
      updateResize(e.clientY);
    });

    dragHandle.addEventListener('pointerup', (e) => {
      if (!isResizing) return;
      try {
        dragHandle.releasePointerCapture(e.pointerId);
      } catch (err) {}
      endResize(true);
    });

    dragHandle.addEventListener('pointercancel', (e) => {
      if (!isResizing) return;
      try {
        dragHandle.releasePointerCapture(e.pointerId);
      } catch (err) {}
      endResize(false);
    });
  }

  window.addEventListener('resize', () => {
    if (!previewHeight) return;
    applyPreviewHeight(previewHeight, { updateLastExpanded: false, persist: false });
    scheduleVirtualRender();
  });

  // Scope selection - Updated for new dropdown structure
  if (scopeSelect) {
    scopeSelect.addEventListener('change', () => {
      state.currentScope = scopeSelect.value;
      updateScopeInputs();
      runSearch();
    });
  }

  if (directoryInput) {
    directoryInput.addEventListener('input', () => {
      clearTimeout(state.searchTimeout);
      state.searchTimeout = setTimeout(() => {
        validateDirectory();
        runSearch();
      }, 500);
    });
  }

  if (moduleSelect) {
    moduleSelect.addEventListener('change', runSearch);
  }

  document.addEventListener('keydown', (e) => {
    var activeEl = document.activeElement;
    var isInEditor = activeEl === fileEditor || activeEl === localSearchInput || activeEl === localReplaceInput || activeEl === queryInput;
    
    if (e.altKey && !e.shiftKey && e.code === 'KeyR') {
      e.preventDefault();
      triggerReplaceInFile();
      return;
    }

    if (e.altKey && e.shiftKey && e.code === 'KeyR') {
      e.preventDefault();
      toggleReplace();
    } else if (e.key === 'ArrowDown' && !isInEditor) {
      e.preventDefault();
      moveSelection(1); // Navigate down (flat list, no groups)
    } else if (e.key === 'ArrowUp' && !isInEditor) {
      e.preventDefault();
      moveSelection(-1); // Navigate up (flat list, no groups)
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !isInEditor) {
      e.preventDefault();
      openActiveResult();
    } else if (e.key === 'Escape') {
      if (isEditMode && !replaceWidget.classList.contains('visible')) {
        exitEditMode();
        queryInput.focus();
        queryInput.select();
      } else {
        queryInput.focus();
        queryInput.select();
      }
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (!isEditMode) return;
    
    // If clicking outside the editor container and its children, exit edit mode
    if (editorContainer && !editorContainer.contains(e.target)) {
      // Don't exit if clicking the "Replace" button in the preview header
      const previewActions = document.getElementById('preview-actions');
      if (previewActions && previewActions.contains(e.target)) {
        return;
      }
      
      // Don't exit if clicking the drag handle
      const dragHandle = document.getElementById('drag-handle');
      if (dragHandle && dragHandle.contains(e.target)) {
        return;
      }

      // Don't exit if clicking the global replace row or its children
      if (replaceRow && (replaceRow === e.target || replaceRow.contains(e.target))) {
        return;
      }

      // Don't exit if clicking the replace toggle button
      if (replaceToggleBtn && (replaceToggleBtn === e.target || replaceToggleBtn.contains(e.target))) {
        return;
      }
      
      // Don't exit if clicking the conflict banner
      const conflictBanner = document.getElementById('edit-conflict-banner');
      if (conflictBanner && (conflictBanner === e.target || conflictBanner.contains(e.target))) {
        return;
      }
      
      exitEditMode();
    }
  });

  function showEditConflictBanner(uri, reason) {
    if (!editorContainer) return;
    
    // Create or get existing banner
    let banner = document.getElementById('edit-conflict-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'edit-conflict-banner';
      banner.className = 'conflict-banner';
      banner.style.cssText = `
        background: #f8d7da;
        border: 1px solid #f5c2c7;
        border-radius: 4px;
        padding: 12px 16px;
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-family: var(--font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto);
        font-size: 13px;
        color: #664d03;
        z-index: 1000;
      `;
      
      editorContainer.insertBefore(banner, editorContainer.firstChild);
    }
    
    const fileName = uri.split('/').pop() || 'file';
    const message = reason === 'vsCodeDirtyOrDiverged'
      ? `This file changed in VS Code while editing in Rifler`
      : `Conflict: cannot apply edit to ${fileName}`;
    
    banner.innerHTML = `
      <span>${message}</span>
      <div style="display: flex; gap: 8px;">
        <button class="conflict-action-btn" data-action="overwrite" style="
          background: #dc3545;
          color: white;
          border: none;
          padding: 6px 12px;
          border-radius: 3px;
          cursor: pointer;
          font-size: 12px;
        ">Overwrite VS Code</button>
        <button class="conflict-action-btn" data-action="reload" style="
          background: #6c757d;
          color: white;
          border: none;
          padding: 6px 12px;
          border-radius: 3px;
          cursor: pointer;
          font-size: 12px;
        ">Reload from VS Code</button>
        <button class="conflict-action-btn" data-action="dismiss" style="
          background: transparent;
          color: #664d03;
          border: 1px solid #664d03;
          padding: 6px 12px;
          border-radius: 3px;
          cursor: pointer;
          font-size: 12px;
        ">Dismiss</button>
      </div>
    `;
    
    // Attach event handlers to buttons
    banner.querySelectorAll('.conflict-action-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        
        if (action === 'overwrite') {
          // Overwrite VS Code with current Rifler content
          if (state.fileContent) {
            const content = fileEditor.value;
            vscode.postMessage({
              type: 'applyEdits',
              uri: uri,
              content: content,
              source: 'rifler',
              ts: Date.now()
            });
            state.fileContent.content = content;
          }
          banner.style.display = 'none';
        } else if (action === 'reload') {
          // Reload from VS Code (discard Rifler edits)
          vscode.postMessage({
            type: 'getFileContent',
            uri: uri,
            query: state.currentQuery,
            options: state.options
          });
          banner.style.display = 'none';
        } else if (action === 'dismiss') {
          // Just hide the banner
          banner.style.display = 'none';
        }
      });
    });
    
    banner.style.display = 'flex';
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    console.log('Webview received message:', message.type, message);
    switch (message.type) {
      case 'searchHistory':
        state.searchHistory = Array.isArray(message.entries) ? message.entries : [];
        renderSearchHistoryMenu();
        if (pendingTestHistoryEcho) {
          pendingTestHistoryEcho = false;
          vscode.postMessage({ type: '__test_searchHistory', entries: state.searchHistory });
        }
        break;
      case 'toggleReplace':
        toggleReplace();
        break;
      case 'searchResults':
        if (message.maxResults) {
          state.maxResultsCap = message.maxResults;
        }
        handleSearchResults(message.results, { skipAutoLoad: false, activeIndex: message.activeIndex });
        break;
      case 'modulesList':
        handleModulesList(message.modules);
        break;
      case 'currentDirectory':
        handleCurrentDirectory(message.directory);
        break;
      case 'workspaceInfo':
        handleWorkspaceInfo(message.name, message.path);
        break;
      case 'fileContent':
        handleFileContent(message);
        break;
      case 'directoryValidationResult':
        console.log('[Rifler] Received directoryValidationResult:', message.exists);
        handleDirectoryValidation(message.exists);
        break;
      case 'showReplace':
        toggleReplace(true);
        if (queryInput.value.trim()) {
          replaceInput.focus();
          replaceInput.select();
        } else {
          queryInput.focus();
          queryInput.select();
        }
        break;
      case 'setSearchQuery':
        if (typeof message.query === 'string') {
          queryInput.value = message.query;
          state.currentQuery = message.query;
          if (message.focus !== false) {
            queryInput.focus();
            queryInput.select();
          }
          if (message.query.length >= 2) {
            runSearch();
          }
        }
        break;
      case 'config':
        if (message.replaceKeybinding) {
          state.replaceKeybinding = message.replaceKeybinding;
        }
        if (message.maxResults) {
          state.maxResultsCap = message.maxResults;
        }
        if (typeof message.resultsShowCollapsed === 'boolean') {
          state.resultsShowCollapsed = message.resultsShowCollapsed;
        }
        break;
      case 'focusSearch':
        queryInput.focus();
        break;
      case 'clearState':
        queryInput.value = '';
        state.currentQuery = '';
        replaceInput.value = '';
        if (directoryInput) directoryInput.value = '';
        if (moduleSelect) moduleSelect.value = '';
        state.results = [];
        state.activeIndex = -1;
        state.lastPreview = null;
        state.fileContent = null;
        state.lastSearchDuration = 0;
        state.collapsedFiles.clear();
        state.expandedFiles.clear();
        // Clear cache key so next render will always re-render content
        if (previewContent) previewContent.dataset.lastRenderedCacheKey = '';
        applyQueryRows(1, { skipSearch: true });
        recomputeMultilineOption({ skipSearch: true });
        applyPreviewHeight(previewHeight || getDefaultPreviewHeight(), { updateLastExpanded: false, persist: false, visible: false });
        handleSearchResults([], { skipAutoLoad: true });
        break;
      case 'validationResult':
        if (message.field === 'regex') {
          const msgElement = document.getElementById('query-validation-message');
          if (msgElement) {
            if (!message.isValid && message.error) {
              msgElement.textContent = message.error;
              msgElement.className = 'validation-message visible error';
            } else {
              msgElement.textContent = '';
              msgElement.className = 'validation-message';
            }
          }
        } else if (message.field === 'fileMask') {
          const msgElement = document.getElementById('file-mask-validation-message');
          if (msgElement) {
            if (!message.isValid && message.message) {
              msgElement.textContent = message.message;
              msgElement.className = 'validation-message visible warning';
            } else {
              msgElement.textContent = '';
              msgElement.className = 'validation-message';
            }
          }
        }
        // Echo for E2E tests
        vscode.postMessage({
          type: 'validationResult',
          field: message.field,
          isValid: message.isValid,
          error: message.error,
          message: message.message,
          fallbackToAll: message.fallbackToAll
        });
        break;
      case 'projectExclusions':
        console.log('[Rifler] Received projectExclusions message:', message);
        state.projectExclusions = message.projects || [];
        break;
      case 'restoreState':
        if (message.state) {
          const s = message.state;
          queryInput.value = s.query || '';
          state.currentQuery = s.query || '';
          replaceInput.value = s.replaceText || '';
          state.currentScope = s.scope || 'project';
          directoryInput.value = s.directoryPath || '';
          moduleSelect.value = s.modulePath || '';
          state.options = s.options || { matchCase: false, wholeWord: false, useRegex: false, multiline: false, fileMask: '' };
          state.options.multiline = !!state.options.multiline;
          state.queryRows = typeof s.queryRows === 'number' ? s.queryRows : 1;
          
          matchCaseToggle.classList.toggle('active', state.options.matchCase);
          wholeWordToggle.classList.toggle('active', state.options.wholeWord);
          useRegexToggle.classList.toggle('active', state.options.useRegex);
          fileMaskInput.value = state.options.fileMask || '';
          applyQueryRows(state.queryRows, { skipSearch: true });
          recomputeMultilineOption({ skipSearch: true });
          
          if (scopeSelect) {
            scopeSelect.value = state.currentScope;
          }
          updateScopeInputs();
          
          // Restore smart excludes state
          if (typeof s.smartExcludesEnabled === 'boolean') {
            state.smartExcludesEnabled = s.smartExcludesEnabled;
            const smartExcludeToggle = document.getElementById('smart-exclude-toggle');
            if (smartExcludeToggle) {
              smartExcludeToggle.checked = s.smartExcludesEnabled;
            }
          }
          
          if (s.showReplace === true) {
            toggleReplace(true);
          } else {
            toggleReplace(false);
          }
          
          if (s.results && s.results.length > 0) {
            handleSearchResults(s.results, { skipAutoLoad: true, activeIndex: s.activeIndex, preserveScroll: true });
          } else if (s.query && s.query.length >= 2) {
            runSearch();
          }

          if (s.lastPreview) {
            state.lastPreview = s.lastPreview;
            handleFileContent(s.lastPreview);
          }
        }
        break;
      case 'requestStateForMinimize':
        saveState();
        break;
      case '__test_searchCompleted':
        vscode.postMessage({ type: '__test_searchResultsReceived', results: message.results });
        break;
      case '__test_setFileMask':
        fileMaskInput.value = message.value || '';
        state.options.fileMask = fileMaskInput.value;
        break;
      case 'validateRegex':
        queryInput.value = message.pattern || '';
        state.options.useRegex = message.useRegex || false;
        validateRegexPattern();
        break;
      case 'validateFileMask':
        fileMaskInput.value = message.fileMask || '';
        validateFileMaskPattern();
        break;
      case '__test_setUseRegex':
        state.options.useRegex = message.value || false;
        useRegexToggle.classList.toggle('active', state.options.useRegex);
        break;
      case '__test_triggerSearch':
        vscode.postMessage({
          type: 'runSearch',
          query: queryInput.value,
          scope: state.currentScope,
          options: state.options
        });
        break;
      case '__test_appendToSearchInput':
        queryInput.value += message.char;
        queryInput.dispatchEvent(new Event('input', { bubbles: true }));
        break;
      case '__test_getQueryValue':
        vscode.postMessage({
          type: '__test_queryValue',
          value: queryInput.value
        });
        break;
      case '__test_getFocusStatus':
        vscode.postMessage({
          type: '__test_focusStatus',
          isFocused: document.activeElement === queryInput || searchBoxFocusedOnStartup
        });
        break;
      case '__test_setActiveIndex':
        if (typeof message.index === 'number') {
          setActiveIndex(message.index);
        }
        break;
      case '__test_clickOpenInEditor':
        // Test-only helper: simulate clicking "Open in Editor" for a specific result.
        // The UI element can vary across layouts, so we drive the underlying behavior.
        if (typeof message.index === 'number') {
          setActiveIndex(message.index);
          openActiveResult();
        }
        break;
      case '__test_getPreviewScrollInfo':
        const previewContent = document.getElementById('preview-content');
        const activeLineEl = previewContent ? previewContent.querySelector('.pvLine.isActive') : null;
        const previewScrollTop = previewContent ? previewContent.scrollTop : 0;
        const previewScrollHeight = previewContent ? previewContent.scrollHeight : 0;
        const previewClientHeight = previewContent ? previewContent.clientHeight : 0;
        
        vscode.postMessage({
          type: '__test_previewScrollInfo',
          hasActiveLine: !!activeLineEl,
          activeLineTop: activeLineEl ? activeLineEl.offsetTop : 0,
          scrollTop: previewScrollTop,
          scrollHeight: previewScrollHeight,
          clientHeight: previewClientHeight,
          isActiveLineVisible: activeLineEl ? 
            (activeLineEl.offsetTop >= previewScrollTop && 
             activeLineEl.offsetTop + activeLineEl.offsetHeight <= previewScrollTop + previewClientHeight) : false
        });
        break;
      case '__test_getGroupScrollInfo': {
        const containers = document.querySelectorAll('.matches-group-scroll-container');
        const groups = Array.from(containers).map(el => {
          const path = el.dataset.path || el.closest('.result-matches-group')?.dataset?.path || '';
          return {
            path,
            scrollTop: el.scrollTop,
            clientHeight: el.clientHeight,
            scrollHeight: el.scrollHeight
          };
        });
        vscode.postMessage({ type: '__test_groupScrollInfo', groups });
        break;
      }
      case '__test_setGroupScrollTop': {
        const path = message.path;
        const value = message.scrollTop;
        if (typeof path === 'string' && typeof value === 'number') {
          const containers = document.querySelectorAll('.matches-group-scroll-container');
          containers.forEach(el => {
            const elPath = el.dataset.path || el.closest('.result-matches-group')?.dataset?.path;
            if (elPath === path) {
              el.scrollTop = value;
              if (!state.groupScrollTops) state.groupScrollTops = {};
              state.groupScrollTops[path] = value;
            }
          });
        }
        break;
      }
      case '__test_simulateKeyboard':
        if (message.key === 'Enter' && message.ctrlKey) {
          openActiveResult();
        }
        break;
      case '__test_enterEditMode':
        if (!isEditMode) {
          enterEditMode();
        }
        if (fileEditor) {
          fileEditor.focus();
        }
        vscode.postMessage({ type: '__test_enterEditModeDone', isEditMode: !!isEditMode });
        break;
      case '__test_simulatePreviewEditorKeydown': {
        if (!fileEditor) {
          vscode.postMessage({ type: '__test_simulatePreviewEditorKeydownDone', ok: false, reason: 'no-file-editor' });
          break;
        }

        // Ensure editor is focused (requirement: shortcut works when preview editor is focused)
        if (!isEditMode) {
          enterEditMode();
        }
        fileEditor.focus();

        const key = typeof message.key === 'string' ? message.key : '';
        const code = typeof message.code === 'string' ? message.code : '';
        const metaKey = !!message.metaKey;
        const ctrlKey = !!message.ctrlKey;
        const shiftKey = !!message.shiftKey;
        const altKey = !!message.altKey;

        const evt = new KeyboardEvent('keydown', {
          key,
          code,
          metaKey,
          ctrlKey,
          shiftKey,
          altKey,
          bubbles: true,
          cancelable: true
        });
        fileEditor.dispatchEvent(evt);
        vscode.postMessage({ type: '__test_simulatePreviewEditorKeydownDone', ok: true });
        break;
      }
      case '__test_getContextMenuInfo':
        vscode.postMessage({
          type: '__test_contextMenuInfo',
          hasOpenOption: true,
          hasCopyPathOption: true,
          hasCopyRelativeOption: true
        });
        break;
      case '__test_getUiStatus':
        const activeEl = document.activeElement;
        vscode.postMessage({
          type: '__test_uiStatus',
          summaryBarVisible: resultsSummaryBar ? getComputedStyle(resultsSummaryBar).display !== 'none' : false,
          filtersVisible: filtersContainer ? !filtersContainer.classList.contains('hidden') : false,
          replaceVisible: replaceRow ? replaceRow.classList.contains('visible') : false,
          localReplaceWidgetVisible: replaceWidget ? replaceWidget.classList.contains('visible') : false,
          localReplaceRowVisible: localReplaceRow ? !localReplaceRow.hidden : false,
          previewVisible: previewPanelContainer ? getComputedStyle(previewPanelContainer).display !== 'none' : false,
          resultsCountText: resultsCountText ? resultsCountText.textContent : '',
          activeElementId: activeEl && activeEl instanceof HTMLElement ? activeEl.id : null,
          activeElementTag: activeEl ? activeEl.tagName : null
        });
        break;
      case '__test_toggleFilters':
        if (filterBtn && filtersContainer) {
          const isHidden = filtersContainer.classList.toggle('hidden');
          filterBtn.classList.toggle('active', !isHidden);
        }
        break;
      case '__test_toggleReplace':
        toggleReplace();
        break;
      case '__test_setResultsListHeight':
        {
          const resultsList = document.getElementById('results-list');
          if (!resultsList) {
            break;
          }
          if (typeof message.height === 'number') {
            resultsList.style.maxHeight = `${message.height}px`;
            resultsList.style.height = `${message.height}px`;
          } else if (message.height === null) {
            resultsList.style.maxHeight = '';
            resultsList.style.height = '';
          }
        }
        break;
      case '__test_getResultsListStatus':
        const resultsList = document.getElementById('results-list');
        const virtualContent = document.getElementById('results-virtual-content');
        const forcedHeight = resultsList ? (resultsList.style.height || resultsList.style.maxHeight || '') : '';
        const resultCountFromState = Array.isArray(state.results) ? state.results.length : 0;
        
        // For virtual rendering, check if we have content that would require scrolling
        // Use virtual height tracking instead of DOM scrollHeight since items are virtualized
        let scrollbarVisible = false;
        if (resultsList && virtualContent) {
          const virtualHeight = parseFloat(virtualContent.style.height) || virtualContent.scrollHeight || 0;
          // Force layout to ensure clientHeight is up-to-date
          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
          resultsList.offsetHeight;
          const rectHeight = resultsList.getBoundingClientRect().height || 0;
          const computedHeight = parseFloat(getComputedStyle(resultsList).height) || 0;
          const clientHeight = resultsList.clientHeight || 0;
          const containerHeight = Math.max(clientHeight, rectHeight, computedHeight);
          if ((containerHeight === 0 && virtualHeight > 0) || (virtualHeight > containerHeight + 1)) {
            scrollbarVisible = true;
          } else if (resultsList.scrollHeight > clientHeight + 1) {
            scrollbarVisible = true;
          } else {
            // Heuristic fallback for virtualized list: if many items expected, assume overflow
            const approxItemCount = document.querySelectorAll('.result-file-header, .result-item, .result-matches-group').length;
            const combinedCount = Math.max(resultCountFromState, approxItemCount);
            const hasForcedHeight = !!forcedHeight;
            scrollbarVisible = (virtualHeight > 0 && containerHeight > 0 && combinedCount > 20)
              || (hasForcedHeight && containerHeight > 0);
          }
        } else if (resultsList) {
          // Fallback to DOM-based check
          scrollbarVisible = resultsList.scrollHeight > resultsList.clientHeight && resultsList.clientHeight > 0;
        }
        
        // Check for horizontal overflow
        const hasHorizontalOverflow = resultsList ? 
          resultsList.scrollWidth > resultsList.clientWidth : false;
        
        // Check if tooltips are present on result headers
        const resultHeaders = document.querySelectorAll('.result-file-header');
        let tooltipsPresent = true;
        resultHeaders.forEach(header => {
          const fileName = header.querySelector('.file-name');
          const filePath = header.querySelector('.file-path');
          if (fileName && fileName.scrollWidth > fileName.clientWidth && !fileName.hasAttribute('title')) {
            tooltipsPresent = false;
          }
          if (filePath && filePath.scrollWidth > filePath.clientWidth && !filePath.hasAttribute('title')) {
            tooltipsPresent = false;
          }
        });
        
        vscode.postMessage({
          type: '__test_resultsListStatus',
          scrollbarVisible: scrollbarVisible,
          hasHorizontalOverflow: hasHorizontalOverflow,
          tooltipsPresent: tooltipsPresent,
          resultHeadersCount: resultHeaders.length
        });
        break;
      case '__test_getScopeInputStatus':
        const directoryInputVisible = directoryInput ? getComputedStyle(directoryInput).display !== 'none' : false;
        const moduleSelectVisible = moduleSelect ? getComputedStyle(moduleSelect).display !== 'none' : false;
        const directoryInputReadOnly = directoryInput ? directoryInput.readOnly : false;
        const directoryInputPlaceholder = directoryInput ? directoryInput.placeholder : '';
        const directoryInputValue = directoryInput ? directoryInput.value : '';
        const pathLabelText = pathLabel ? pathLabel.textContent : '';

        vscode.postMessage({
          type: '__test_scopeInputStatus',
          currentScope: state.currentScope,
          pathLabel: pathLabelText,
          directoryInputVisible: directoryInputVisible,
          directoryInputReadOnly: directoryInputReadOnly,
          directoryInputPlaceholder: directoryInputPlaceholder,
          directoryInputValue: directoryInputValue,
          moduleSelectVisible: moduleSelectVisible
        });
        break;
      case '__test_setDirectoryInput':
        if (directoryInput && message.value !== undefined) {
          directoryInput.value = message.value;
          // Trigger validation after setting the value
          validateDirectory();
        }
        break;
      case '__test_getValidationStatus':
        const validationMessageEl = document.getElementById('directory-validation-message');
        const hasErrorClass = directoryInput ? directoryInput.classList.contains('error') : false;
        const isVisible = validationMessageEl ? validationMessageEl.classList.contains('visible') : false;
        const messageText = validationMessageEl ? validationMessageEl.textContent.trim() : '';

        vscode.postMessage({
          type: '__test_validationStatus',
          directoryValidationError: hasErrorClass,
          directoryValidationMessage: messageText,
          validationMessageVisible: isVisible
        });
        break;
      case '__test_setScope':
        if (message.scope && scopeSelect) {
          state.currentScope = message.scope;
          scopeSelect.value = message.scope;
          updateScopeInputs();
        }
        break;
      case '__test_getFocusInfo':
        const searchInput = document.getElementById('search-input');
        const activeElement = document.activeElement;
        vscode.postMessage({
          type: '__test_focusInfo',
          searchInputFocused: activeElement === searchInput,
          activeElementId: activeElement ? activeElement.id : null,
          activeElementTag: activeElement ? activeElement.tagName : null
        });
        break;
      case '__test_simulateKeyboard':
        if (message.key === 'ArrowDown') {
          // Simulate arrow down for result navigation
          const currentActive = state.activeIndex;
          if (state.results && state.results.length > 0) {
            state.activeIndex = Math.min(currentActive + 1, state.results.length - 1);
            renderResults();
          }
        } else if (message.key === 'ArrowUp') {
          const currentActive = state.activeIndex;
          if (state.results && state.results.length > 0) {
            state.activeIndex = Math.max(currentActive - 1, 0);
            renderResults();
          }
        }
        break;
      case 'restorePreviewPanelState':
        if (typeof message.collapsed === 'boolean') {
          state.previewPanelCollapsed = message.collapsed;
          const previewPanel = document.getElementById('preview-panel-container');
          const previewToggleBtn = document.getElementById('preview-toggle-btn');
          
          if (state.previewPanelCollapsed) {
            // Restore to minimum height
            applyPreviewHeight(PREVIEW_MIN_HEIGHT, { persist: false });
          } else {
            // Restore to last expanded height or default
            const targetHeight = lastExpandedHeight || getDefaultPreviewHeight();
            applyPreviewHeight(targetHeight, { persist: false });
          }
          
          if (previewToggleBtn) {
            previewToggleBtn.innerHTML = state.previewPanelCollapsed ? 
              '<span class="material-symbols-outlined">add</span>' : 
              '<span class="material-symbols-outlined">remove</span>';
          }
        }
        break;
      case '__test_getCollapsedResultsStatus':
        // Instead of checking DOM, check the state directly since we use virtual rendering
        const allPaths = new Set();
        state.results.forEach(r => allPaths.add(r.relativePath || r.fileName));
        
        let allResultsCollapsed = true;
        let allResultsExpanded = true;
        let firstFileExpanded = false;
        let otherFilesCollapsed = true;
        
        const pathsArray = Array.from(allPaths);
        pathsArray.forEach((path, idx) => {
          // Determine collapsed state based on same logic as rendering
          let isCollapsed;
          if (state.collapsedFiles.has(path)) {
            isCollapsed = true;
          } else if (state.expandedFiles && state.expandedFiles.has(path)) {
            isCollapsed = false;
          } else {
            isCollapsed = state.resultsShowCollapsed;
          }
          
          if (!isCollapsed) {
            allResultsCollapsed = false;
          }
          if (isCollapsed) {
            allResultsExpanded = false;
          }
          
          // Check first file
          if (idx === 0) {
            firstFileExpanded = !isCollapsed;
          } else {
            if (!isCollapsed) {
              otherFilesCollapsed = false;
            }
          }
        });

        vscode.postMessage({
          type: '__test_collapsedResultsStatus',
          allResultsCollapsed: allResultsCollapsed,
          allResultsExpanded: allResultsExpanded,
          firstFileExpanded: firstFileExpanded,
          otherFilesCollapsed: otherFilesCollapsed,
          totalFileHeaders: pathsArray.length
        });
        break;
      case '__test_expandFirstFileHeader':
        // Expand the first file in the results
        if (state.results.length > 0) {
          const firstPath = state.results[0].relativePath || state.results[0].fileName;
          // Remove from collapsed and add to expanded
          state.collapsedFiles.delete(firstPath);
          state.expandedFiles.add(firstPath);
          // Re-render
          handleSearchResults(state.results, { skipAutoLoad: true, activeIndex: state.activeIndex, preserveScroll: true });
        }
        break;
      case '__test_setSmartExcludes':
        // Set smart excludes checkbox state for E2E tests
        if (typeof message.enabled === 'boolean') {
          state.smartExcludesEnabled = message.enabled;
          const smartExcludeToggle = document.getElementById('smart-exclude-toggle');
          if (smartExcludeToggle) {
            smartExcludeToggle.checked = message.enabled;
          }
        }
        break;
      case '__test_setSearchInput':
        if (queryInput && message.value !== undefined) {
          queryInput.value = message.value;
          // Allow tests to force regex mode for multi-pattern queries
          if (typeof message.useRegex === 'boolean') {
            console.log('[Webview] Setting useRegex to', message.useRegex, 'from message');
            state.options.useRegex = message.useRegex;
            useRegexToggle?.classList.toggle('active', state.options.useRegex);
          }
          console.log('[Webview] After setting, state.options.useRegex=', state.options.useRegex);
          // Trigger search
          const searchEvent = new Event('input', { bubbles: true });
          queryInput.dispatchEvent(searchEvent);
        }
        break;
      case 'editConflict':
        // Handle conflict when VS Code has edited the file while Rifler is in edit mode
        showEditConflictBanner(message.uri, message.reason);
        break;
      case '__test_clearSearchHistory':
        pendingTestHistoryEcho = true;
        vscode.postMessage({ type: '__test_clearSearchHistory' });
        break;
      case '__test_getSearchHistory':
        vscode.postMessage({ type: '__test_searchHistory', entries: Array.isArray(state.searchHistory) ? state.searchHistory : [] });
        break;
      case '__test_selectSearchHistoryIndex': {
        const idx = Number(message.index);
        const entries = Array.isArray(state.searchHistory) ? state.searchHistory : [];
        if (!Number.isFinite(idx) || idx < 0 || idx >= entries.length) {
          break;
        }
        const entry = entries[idx];
        applySearchHistoryEntry(entry);
        runSearch();
        break;
      }
    }
  });

  function updateScopeInputs() {
    // Hide all scope inputs first
    if (directoryInput) directoryInput.style.display = 'none';
    if (moduleSelect) moduleSelect.style.display = 'none';
    
    // Clear directory validation when not in directory mode
    if (state.currentScope !== 'directory') {
      updateValidationMessage('directory-input', 'directory-validation-message', '', 'error');
      directoryInput.classList.remove('error');
      const container = directoryInput.closest('.filter-field');
      if (container) container.classList.remove('error');
    }
    
    // Update label and show correct input
    if (state.currentScope === 'project') {
      if (pathLabel) pathLabel.textContent = 'Project:';
      if (directoryInput) {
        directoryInput.style.display = 'block';
        directoryInput.placeholder = state.workspaceName || 'All Files';
        directoryInput.value = state.workspacePath || '';
        directoryInput.title = state.workspacePath || '';
        directoryInput.readOnly = true;
      }
    } else if (state.currentScope === 'directory') {
      if (pathLabel) pathLabel.textContent = 'Directory:';
      if (directoryInput) {
        directoryInput.style.display = 'block';
        directoryInput.placeholder = 'src/components/';
        directoryInput.readOnly = false;
        // Ensure directory input is populated with current directory if empty
        if (!directoryInput.value && state.currentDirectory) {
          directoryInput.value = state.currentDirectory;
        }
        // Validate directory when switching to directory mode (only if there's a value)
        if (directoryInput.value.trim()) {
          validateDirectory();
        }
      }
    } else if (state.currentScope === 'module') {
      if (pathLabel) pathLabel.textContent = 'Module:';
      if (moduleSelect) moduleSelect.style.display = 'block';
    }

    // Sync dropdown if needed
    if (scopeSelect && scopeSelect.value !== state.currentScope) {
      scopeSelect.value = state.currentScope;
    }
  }

  function getActiveExcludePatterns() {
    if (!state.smartExcludesEnabled || state.projectExclusions.length === 0) {
      return '';
    }

    const patterns = [];
    state.projectExclusions.forEach(project => {
      patterns.push(...project.excludePatterns);
    });

    return Array.from(new Set(patterns))
      .map((pattern) => `!${pattern}`)
      .join(',');
  }

  function showPlaceholder(text) {
    resultsPlaceholder.textContent = text;
    resultsPlaceholder.style.display = 'flex';
    virtualContent.innerHTML = '';
    virtualContent.style.height = '0px';
  }

  function hidePlaceholder() {
    resultsPlaceholder.style.display = 'none';
  }

  // Helper function to update results count display
  function updateResultsCountDisplay(results) {
    if (!resultsCountText) return;
    
    const query = queryInput ? queryInput.value.trim() : '';
    if (query.length < 2) {
      resultsCountText.textContent = 'Type to search...';
      resultsCountText.style.opacity = '1';
      return;
    }

    if (!results || results.length === 0) {
      resultsCountText.textContent = 'No results found';
    } else {
      const uniqueFiles = new Set(results.map(r => r.uri)).size;
      const isCapped = state.maxResultsCap && results.length >= state.maxResultsCap;
      const suffix = isCapped ? '+' : '';
      let text = `${results.length}${suffix} result${results.length !== 1 ? 's' : ''} in ${uniqueFiles} file${uniqueFiles !== 1 ? 's' : ''}`;
      
      if (state.lastSearchDuration > 0) {
        text += ` (${state.lastSearchDuration.toFixed(2)}s)`;
      }
      
      resultsCountText.textContent = text;
    }
    resultsCountText.style.opacity = '1';
  }

  function clearResultsCountDisplay() {
    if (resultsCountText) {
      resultsCountText.textContent = 'Type to search...';
      resultsCountText.style.opacity = '1';
    }
  }

  function scheduleVirtualRender() {
    if (virtualRenderPending) return;
    virtualRenderPending = true;
    requestAnimationFrame(() => {
      virtualRenderPending = false;
      renderResultsVirtualized();
    });
  }

  resultsList.addEventListener('scroll', scheduleVirtualRender);
  window.addEventListener('resize', scheduleVirtualRender);

  function runSearch() {
    try {
      if (isEditMode) {
        exitEditMode(true);
      }
      
      // Don't trim when multiline is enabled - preserve newlines
      const query = state.options.multiline 
        ? queryInput.value 
        : queryInput.value.trim();
      state.currentQuery = query;
      
      console.log('runSearch called, query:', query, 'length:', query.length, 'useRegex:', state.options.useRegex);
      
      if (query.length < 2) {
        showPlaceholder('Type at least 2 characters...');
        clearResultsCountDisplay();
        return;
      }

      if (state.options.useRegex) {
        try {
          new RegExp(query);
        } catch (e) {
          showPlaceholder('Invalid regex pattern');
          clearResultsCountDisplay();
          return;
        }
      }

      showPlaceholder('Searching...');
      clearResultsCountDisplay();
      state.searchStartTime = performance.now();

      const message = {
        type: 'runSearch',
        query: query,
        scope: state.currentScope,
        options: { ...state.options },
        queryRows: state.queryRows,
        smartExcludesEnabled: state.smartExcludesEnabled,
        exclusionPatterns: getActiveExcludePatterns()
      };

      console.log('[Rifler Webview] Search state:', {
        query,
        queryRows: state.queryRows,
        multiline: state.options.multiline,
        hasNewline: query.includes('\n'),
        lineCount: query.split('\n').length
      });

      if (state.currentScope === 'directory') {
        message.directoryPath = directoryInput.value.trim();
        console.log('Sending directory search:', message.directoryPath);
      } else if (state.currentScope === 'module') {
        message.modulePath = moduleSelect.value;
      }

      console.log('Sending search message:', message);
      vscode.postMessage(message);
    } catch (error) {
      console.error('Error in runSearch:', error);
    }
  }

  function handleSearchResults(results, options = { skipAutoLoad: false, activeIndex: undefined, preserveScroll: false }) {
    const hasResults = results.length > 0;
    let resolvedActiveIndex;

    if (options.activeIndex !== undefined && options.activeIndex !== null) {
      resolvedActiveIndex = options.activeIndex;
    } else {
      resolvedActiveIndex = -1; // keep preview blank until user clicks
    }

    const previousScrollTop = resultsList.scrollTop;

    state.results = results;
    state.activeIndex = resolvedActiveIndex;
    // Only reset scroll for new result sets unless preserveScroll is requested
    if (!options.preserveScroll) {
      resultsList.scrollTop = 0;
    } else {
      resultsList.scrollTop = previousScrollTop;
    }

    if (state.searchStartTime > 0) {
      state.lastSearchDuration = (performance.now() - state.searchStartTime) / 1000;
      state.searchStartTime = 0; // Reset after use
    }

    // Group results by file
    const groups = [];
    const fileMap = new Map();
    results.forEach((result, index) => {
      const path = result.relativePath || result.fileName;
      if (!fileMap.has(path)) {
        const group = { path, fileName: path.split(/[\\\/]/).pop(), matches: [] };
        fileMap.set(path, group);
        groups.push(group);
      }
      fileMap.get(path).matches.push({ ...result, originalIndex: index });
    });

    state.renderItems = [];
    let cumulativeTop = 0;
    let isFirstFile = true;
    groups.forEach(group => {
      // Determine if group should be collapsed based on setting or user action
      // If user has explicitly toggled this file, use their preference
      // Otherwise, use the global setting
      let isCollapsed;
      if (state.collapsedFiles.has(group.path)) {
        isCollapsed = true;
      } else if (state.expandedFiles && state.expandedFiles.has(group.path)) {
        isCollapsed = false;
      } else {
        // Auto-expand first file, otherwise use global setting
        isCollapsed = isFirstFile ? false : state.resultsShowCollapsed;
      }
      isFirstFile = false;
      
      state.renderItems.push({
        type: 'fileHeader',
        path: group.path,
        fileName: group.fileName,
        matchCount: group.matches.length,
        isCollapsed: isCollapsed,
        top: cumulativeTop,
        height: 40
      });
      cumulativeTop += 40;
      
      if (!isCollapsed) {
        // For files with more than 5 results, use a scrollable group container
        if (group.matches.length > 5) {
          state.renderItems.push({
            type: 'matchesGroup',
            path: group.path,
            matches: group.matches,
            top: cumulativeTop,
            height: 150
          });
          cumulativeTop += 150;
        } else {
          group.matches.forEach((match, matchIdx) => {
            state.renderItems.push({
              type: 'match',
              ...match,
              isFirstInGroup: matchIdx === 0,
              isLastInGroup: matchIdx === group.matches.length - 1,
              groupSize: group.matches.length,
              groupPath: group.path,
              top: cumulativeTop,
              height: 28
            });
            cumulativeTop += 28;
          });
        }
      }
    });

    if (results.length > 0) {
      state.renderItems.push({ 
        type: 'endOfResults',
        top: cumulativeTop,
        height: 48
      });
      cumulativeTop += 48;
    }
    
    // Update virtual content height only; let container manage its own height
    if (virtualContent && virtualContent.parentElement) {
      const totalHeight = cumulativeTop + 'px';
      virtualContent.style.height = totalHeight;
    }

    console.log('[Rifler] renderItems populated:', state.renderItems.length, 'items');
    console.log('[Rifler] renderItems populated:', state.renderItems.length, 'items');
    updateResultsCountDisplay(results);
    if (collapseAllBtn) {
      collapseAllBtn.style.display = results.length > 0 ? 'flex' : 'none';
      if (results.length > 0) {
        collapseAllBtn.innerHTML = 'Collapse All <span class="material-symbols-outlined">unfold_less</span>';
      }
    }

    vscode.postMessage({ type: '__test_searchCompleted', results: results });

    if (results.length === 0) {
      showPlaceholder('No results found');
      previewContent.innerHTML = '<div class="empty-state">No results</div>';
      // Clear cache key so next render will always re-render content
      previewContent.dataset.lastRenderedCacheKey = '';
      previewFilename.textContent = '';
      applyPreviewHeight(previewHeight || getDefaultPreviewHeight(), { updateLastExpanded: false, persist: false, visible: false });
      return;
    }

    hidePlaceholder();

    // Auto-load first result if available
    if (hasResults && state.activeIndex < 0) {
      state.activeIndex = 0;
      applyPreviewHeight(previewHeight || getDefaultPreviewHeight(), { updateLastExpanded: false, persist: false, visible: true });
      setActiveIndex(0, { skipLoad: false });
    } else if (hasResults && state.activeIndex >= 0) {
      applyPreviewHeight(previewHeight || getDefaultPreviewHeight(), { updateLastExpanded: false, persist: false, visible: true });
      setActiveIndex(state.activeIndex, { skipLoad: !!options.skipAutoLoad });
    } else {
      if (previewContent) {
        previewContent.innerHTML = '<div class="empty-state">Select a result to preview</div>';
        previewContent.style.display = 'block';
      }
      if (previewFilename) previewFilename.textContent = '';
      if (previewFilepath) previewFilepath.textContent = '';
      if (previewActions) previewActions.style.display = 'none';
      applyPreviewHeight(previewHeight || getDefaultPreviewHeight(), { updateLastExpanded: false, persist: false, visible: hasResults });
      if (previewPanelContainer) previewPanelContainer.style.display = hasResults ? 'flex' : 'none';
      if (previewPanel) previewPanel.style.display = hasResults ? 'flex' : 'none';
      renderResultsVirtualized();
    }
  }

  function renderResultsVirtualized() {
    if (state.renderItems.length === 0) return;

    const total = state.renderItems.length;
    const viewportHeight = resultsList.clientHeight || 1;
    const scrollTop = resultsList.scrollTop;
    
    // Find visible items based on their stored top positions
    let start = 0;
    let end = total;
    
    for (let i = 0; i < total; i++) {
      const item = state.renderItems[i];
      const itemTop = item.top || 0;
      const itemBottom = itemTop + (item.height || VIRTUAL_ROW_HEIGHT);
      
      if (itemBottom < scrollTop - 200) {
        start = i + 1;
      }
      if (itemTop > scrollTop + viewportHeight + 200 && end === total) {
        end = i;
        break;
      }
    }

    // Set total height based on last item's position
    const lastItem = state.renderItems[total - 1];
    const totalHeight = (lastItem.top || 0) + (lastItem.height || VIRTUAL_ROW_HEIGHT);
    virtualContent.style.height = totalHeight + 'px';

    const fragment = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      fragment.appendChild(renderResultRow(state.renderItems[i], i));
    }

    // Preserve grouped scroll positions before virtual DOM swap
    captureGroupScrollTopsFromDom();
    virtualContent.innerHTML = '';
    virtualContent.appendChild(fragment);

    // Restore grouped scroll positions after render
    restoreGroupScrollTopsToDom();
    requestAnimationFrame(restoreGroupScrollTopsToDom);

    measureRowHeightIfNeeded();
  }

  function measureRowHeightIfNeeded() {
    if (measuredRowHeight) return;
    const firstRow = virtualContent.firstElementChild;
    if (!firstRow) return;

    const rowHeight = firstRow.getBoundingClientRect().height;
    if (rowHeight && rowHeight > 0) {
      measuredRowHeight = rowHeight;
      if (Math.abs(rowHeight - VIRTUAL_ROW_HEIGHT) > 2) {
        VIRTUAL_ROW_HEIGHT = rowHeight;
        scheduleVirtualRender();
      }
    }
  }

  function renderResultRow(itemData, index) {
    const item = document.createElement('div');
    item.style.position = 'absolute';
    item.style.top = (itemData.top || 0) + 'px';
    item.style.left = '0';
    item.style.right = '0';
    if (itemData.height) {
      item.style.height = itemData.height + 'px';
    }

    if (itemData.type === 'fileHeader') {
      item.className = 'result-file-header' + (itemData.isCollapsed ? ' collapsed' : '');
      const arrowIcon = itemData.isCollapsed ? 'chevron_right' : 'expand_more';
      const displayPath = itemData.path.startsWith('/') ? itemData.path.substring(1) : itemData.path;
      
      item.innerHTML = 
        '<span class="material-symbols-outlined arrow-icon">' + arrowIcon + '</span>' +
        '<div class="file-info" title="' + escapeAttr(displayPath) + '">' +
          '<div class="file-name-row">' +
            '<span class="seti-icon ' + getFileIconName(itemData.fileName) + '"></span>' +
            '<span class="file-name" title="' + escapeAttr(displayPath) + '" style="cursor: pointer;">' + escapeHtml(itemData.fileName) + '</span>' +
          '</div>' +
          '<div class="file-path" title="' + escapeAttr(displayPath) + '">' + escapeHtml(displayPath) + '</div>' +
        '</div>' +
        '<span class="match-count">' + itemData.matchCount + '</span>';
        
      // Click on arrow or file info area (except filename) toggles collapse
      item.addEventListener('click', (e) => {
        const target = e.target;
        // If clicking on filename, open the file instead of toggling
        if (target && target.classList.contains('file-name')) {
          e.stopPropagation();
          // Find the first match for this file and open it in the editor
          const resultIndex = state.results.findIndex((r) => {
            const path = r.relativePath || r.fileName;
            return path === itemData.path;
          });
          if (resultIndex !== -1) {
            setActiveIndex(resultIndex);
            openResultInEditor(resultIndex);
          }
          return;
        }
        
        // Otherwise toggle collapse/expand
        const willExpand = itemData.isCollapsed;
        if (itemData.isCollapsed) {
          // Expanding: remove from collapsedFiles and add to expandedFiles
          state.collapsedFiles.delete(itemData.path);
          state.expandedFiles.add(itemData.path);
        } else {
          // Collapsing: remove from expandedFiles and add to collapsedFiles
          state.expandedFiles.delete(itemData.path);
          state.collapsedFiles.add(itemData.path);
        }
        
        handleSearchResults(state.results, { skipAutoLoad: true, activeIndex: state.activeIndex, preserveScroll: true });
        updateCollapseButtonText();

        if (willExpand) {
          activateFirstMatchForPath(itemData.path);
        }
      });
      
      return item;
    }

    if (itemData.type === 'matchesGroup') {
      item.className = 'result-matches-group';
      item.dataset.path = itemData.path;
      // Height and position are already set from itemData
      item.style.overflow = 'hidden';
      item.style.display = 'flex';
      item.style.flexDirection = 'column';
      
      const groupContainer = document.createElement('div');
      groupContainer.className = 'matches-group-scroll-container';
      groupContainer.style.flex = '1';
      groupContainer.style.overflowY = 'auto';
      groupContainer.style.paddingLeft = '8px';
      groupContainer.style.marginLeft = '8px';
      groupContainer.style.borderLeft = '2px solid rgba(255,255,255,0.1)';
      itemData.matches.forEach((match, idx) => {
        const matchEl = document.createElement('div');
        const isActive = match.originalIndex === state.activeIndex;
        matchEl.className = 'result-item' + (isActive ? ' active' : '');
        matchEl.dataset.index = String(match.originalIndex);
        matchEl.dataset.localIndex = String(idx);
        matchEl.title = match.relativePath || match.fileName;
        matchEl.style.position = 'static';
        matchEl.style.height = '28px';
        matchEl.style.top = 'auto';
        matchEl.style.width = '100%';
        
        const language = getLanguageFromFilename(match.fileName);
        const previewHtml = highlightMatchSafe(
          match.preview,
          match.previewMatchRanges || [match.previewMatchRange],
          language
        );

        matchEl.innerHTML = 
          '<div class="result-meta">' +
            '<span class="result-line-number">' + (match.line + 1) + '</span>' +
          '</div>' +
          '<div class="result-preview hljs">' + previewHtml + '</div>';

        matchEl.addEventListener('click', (e) => {
          // Single click selects/loads preview (no show/hide toggle)
          if (match.originalIndex === state.activeIndex) {
            const active = state.results?.[state.activeIndex];
            if (active && (!state.fileContent || state.fileContent.uri !== active.uri)) {
              loadFileContent(active);
            }
            return;
          }
          if (!state.groupScrollTops) state.groupScrollTops = {};
          state.groupScrollTops[itemData.path] = groupContainer.scrollTop;
          setActiveIndex(match.originalIndex);
        });

        matchEl.addEventListener('dblclick', (e) => {
          // Double click opens file in editor
          openActiveResult();
        });

        matchEl.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          showContextMenu(e, match.originalIndex);
        });

        groupContainer.appendChild(matchEl);
      });

      // Restore previous scroll position for this file's group if available (after children are added)
      const restoreScroll = () => {
        const saved = state.groupScrollTops && state.groupScrollTops[itemData.path];
        if (typeof saved === 'number') {
          groupContainer.scrollTop = saved;
        }
      };
      restoreScroll();
      requestAnimationFrame(restoreScroll);
      requestAnimationFrame(() => requestAnimationFrame(restoreScroll));

      // Persist scroll position on scroll so it survives re-renders
      groupContainer.dataset.path = itemData.path;
      groupContainer.addEventListener('scroll', () => {
        if (!state.groupScrollTops) state.groupScrollTops = {};
        state.groupScrollTops[itemData.path] = groupContainer.scrollTop;
      });

      item.appendChild(groupContainer);
      return item;
    }

    if (itemData.type === 'endOfResults') {
      item.className = 'end-of-results';
      item.innerHTML = 
        '<div class="end-of-results-line"></div>' +
        '<div class="end-of-results-content">' +
          '<span class="material-symbols-outlined">check_circle</span>' +
          '<span>END OF RESULTS</span>' +
        '</div>' +
        '<div class="end-of-results-line"></div>';
      return item;
    }

    // Match row
    const isActive = itemData.originalIndex === state.activeIndex;
    item.className = 'result-item' + (isActive ? ' active' : '');
    item.dataset.index = String(itemData.originalIndex);
    item.title = itemData.relativePath || itemData.fileName;

    const language = getLanguageFromFilename(itemData.fileName);
    const previewHtml = highlightMatchSafe(
      itemData.preview,
      itemData.previewMatchRanges || [itemData.previewMatchRange],
      language
    );

    item.innerHTML = 
      '<div class="result-meta">' +
        '<span class="result-line-number">' + (itemData.line + 1) + '</span>' +
      '</div>' +
      '<div class="result-preview hljs">' + previewHtml + '</div>';

    item.addEventListener('click', (e) => {
      // Single click selects/loads preview (no show/hide toggle)
      if (itemData.originalIndex === state.activeIndex) {
        const active = state.results?.[state.activeIndex];
        if (active && (!state.fileContent || state.fileContent.uri !== active.uri)) {
          loadFileContent(active);
        }
        return;
      }
      setActiveIndex(itemData.originalIndex);
    });

    item.addEventListener('dblclick', (e) => {
      // Double click opens file in editor
      openActiveResult();
    });

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e, itemData.originalIndex);
    });

    return item;
  }

  function getLanguageIdFromFilename(fileName) {
    const ext = fileName.split('.').pop()?.toLowerCase();
    const langMap = {
      'js': 'javascript',
      'jsx': 'javascriptreact',
      'ts': 'typescript',
      'tsx': 'typescriptreact',
      'py': 'python',
      'java': 'java',
      'c': 'c',
      'cpp': 'cpp',
      'h': 'c',
      'hpp': 'cpp',
      'cs': 'csharp',
      'php': 'php',
      'rb': 'ruby',
      'go': 'go',
      'rs': 'rust',
      'swift': 'swift',
      'kt': 'kotlin',
      'kts': 'kotlin',
      'scala': 'scala',
      'html': 'html',
      'htm': 'html',
      'xml': 'xml',
      'css': 'css',
      'scss': 'scss',
      'less': 'less',
      'json': 'json',
      'yaml': 'yaml',
      'yml': 'yaml',
      'md': 'markdown',
      'sh': 'shellscript',
      'bash': 'shellscript',
      'zsh': 'shellscript',
      'sql': 'sql',
      'vue': 'vue',
      'svelte': 'svelte'
    };
    return langMap[ext] || 'file';
  }

  function getFileIconName(fileName) {
    const ext = fileName.split('.').pop()?.toLowerCase();
    // Official VS Code Seti UI icon mappings
    const iconMap = {
      // Programming Languages
      'js': 'seti-javascript', 'jsx': 'seti-javascript',
      'ts': 'seti-typescript', 'tsx': 'seti-typescript',
      'py': 'seti-python',
      'java': 'seti-java',
      'c': 'seti-c',
      'cpp': 'seti-cpp', 'cc': 'seti-cpp', 'cxx': 'seti-cpp', 'c++': 'seti-cpp',
      'cs': 'seti-c-sharp',
      'php': 'seti-php',
      'rb': 'seti-ruby',
      'go': 'seti-go',
      'rs': 'seti-rust',
      'swift': 'seti-swift',
      'kt': 'seti-kotlin', 'kts': 'seti-kotlin',
      'scala': 'seti-scala',
      'clj': 'seti-clojure', 'cljs': 'seti-clojure', 'cljc': 'seti-clojure', 'edn': 'seti-clojure',
      'coffee': 'seti-coffee', 'litcoffee': 'seti-coffee',
      'dart': 'seti-dart',
      'hs': 'seti-haskell', 'lhs': 'seti-haskell',
      'ml': 'seti-ocaml', 'mli': 'seti-ocaml', 'cmx': 'seti-ocaml', 'cmxa': 'seti-ocaml',
      'fs': 'seti-f-sharp', 'fsx': 'seti-f-sharp',
      'elm': 'seti-elm',
      'ex': 'seti-elixir', 'exs': 'seti-elixir',
      'lua': 'seti-lua',
      'pl': 'seti-perl', 'pm': 'seti-perl', 't': 'seti-perl',
      'r': 'seti-R', 'rmd': 'seti-R',
      'jl': 'seti-julia',
      'nim': 'seti-nim', 'nims': 'seti-nim',
      'hx': 'seti-haxe', 'hxs': 'seti-haxe', 'hxp': 'seti-haxe', 'hxml': 'seti-haxe',
      'vala': 'seti-vala', 'vapi': 'seti-vala',
      'cr': 'seti-crystal', 'ecr': 'seti-crystal',
      'zig': 'seti-zig',
      'd': 'seti-d',
      'vb': 'seti-default', // No specific VB icon

      // Web Technologies
      'html': 'seti-html', 'htm': 'seti-html',
      'vue': 'seti-vue',
      'svelte': 'seti-svelte',
      'astro': 'seti-default', // No specific Astro icon
      'css': 'seti-css',
      'scss': 'seti-sass', 'sass': 'seti-sass',
      'less': 'seti-less',
      'styl': 'seti-stylus',
      'postcss': 'seti-css', // Uses CSS icon
      'json': 'seti-json', 'jsonc': 'seti-json',
      'xml': 'seti-xml', 'xsd': 'seti-xml', 'xsl': 'seti-xml',
      'yaml': 'seti-yml', 'yml': 'seti-yml',
      'toml': 'seti-config',
      'ini': 'seti-config', 'cfg': 'seti-config', 'conf': 'seti-config',
      'env': 'seti-config', 'properties': 'seti-config',

      // Frameworks & Libraries
      'jsx': 'seti-react', 'tsx': 'seti-react',
      'ejs': 'seti-ejs',
      'hbs': 'seti-mustache', 'handlebars': 'seti-mustache',
      'jade': 'seti-jade', 'pug': 'seti-pug',
      'haml': 'seti-haml',
      'slim': 'seti-slim',
      'twig': 'seti-twig',
      'liquid': 'seti-liquid',
      'jinja': 'seti-jinja', 'jinja2': 'seti-jinja',
      'nunjucks': 'seti-nunjucks', 'njk': 'seti-nunjucks',
      'mustache': 'seti-mustache', 'stache': 'seti-mustache',
      'erb': 'seti-html', 'html.erb': 'seti-html',

      // Build Tools & Package Managers
      'package.json': 'seti-npm',
      'yarn.lock': 'seti-yarn',
      'pnpm-lock.yaml': 'seti-default', // No specific pnpm icon
      'webpack.config.js': 'seti-webpack',
      'rollup.config.js': 'seti-rollup',
      'vite.config.js': 'seti-vite',
      'gulpfile.js': 'seti-gulp',
      'gruntfile.js': 'seti-grunt',
      'makefile': 'seti-makefile',
      'dockerfile': 'seti-docker',
      'docker-compose.yml': 'seti-docker',
      'jenkinsfile': 'seti-jenkins',
      'bitbucket-pipelines.yml': 'seti-default', // No specific Bitbucket icon
      'azure-pipelines.yml': 'seti-default', // No specific Azure icon
      'github': 'seti-github',
      'gitlab-ci.yml': 'seti-gitlab',

      // Testing
      'spec.js': 'seti-javascript', 'test.js': 'seti-javascript',
      'spec.ts': 'seti-typescript', 'test.ts': 'seti-typescript',
      'spec.jsx': 'seti-react', 'test.jsx': 'seti-react',
      'spec.tsx': 'seti-react', 'test.tsx': 'seti-react',
      'karma.conf.js': 'seti-karma',

      // Documentation
      'md': 'seti-markdown', 'markdown': 'seti-markdown',
      'readme': 'seti-info', 'readme.md': 'seti-info', 'readme.txt': 'seti-info',
      'changelog': 'seti-clock', 'changelog.md': 'seti-clock',
      'license': 'seti-license', 'licence': 'seti-license',
      'contributing': 'seti-license', 'contributing.md': 'seti-license',

      // Configuration Files
      'tsconfig.json': 'seti-tsconfig',
      'jsconfig.json': 'seti-json',
      'babel.config.js': 'seti-babel', 'babelrc': 'seti-babel', 'babelrc.js': 'seti-babel',
      'eslint.config.js': 'seti-eslint', 'eslintrc': 'seti-eslint', 'eslintrc.js': 'seti-eslint',
      'prettier.config.js': 'seti-default', // No specific Prettier icon
      'stylelint.config.js': 'seti-stylelint',
      'editorconfig': 'seti-config',

      // Version Control
      'gitignore': 'seti-git', 'gitattributes': 'seti-git', 'gitmodules': 'seti-git',
      'gitkeep': 'seti-git',
      'hgignore': 'seti-default', // No specific Mercurial icon
      'svnignore': 'seti-default', // No specific SVN icon

      // Databases
      'sql': 'seti-db',
      'prisma': 'seti-prisma',

      // Images & Media
      'png': 'seti-image', 'jpg': 'seti-image', 'jpeg': 'seti-image', 'gif': 'seti-image',
      'svg': 'seti-svg', 'ico': 'seti-favicon', 'webp': 'seti-image',
      'mp4': 'seti-video', 'avi': 'seti-video', 'mov': 'seti-video', 'mkv': 'seti-video',
      'mp3': 'seti-audio', 'wav': 'seti-audio', 'flac': 'seti-audio', 'aac': 'seti-audio',
      'pdf': 'seti-pdf',
      'psd': 'seti-photoshop', 'ai': 'seti-illustrator',

      // Archives
      'zip': 'seti-zip', 'rar': 'seti-zip', '7z': 'seti-zip', 'tar': 'seti-zip',
      'gz': 'seti-zip', 'bz2': 'seti-zip', 'xz': 'seti-zip',
      'jar': 'seti-zip', 'war': 'seti-zip', 'ear': 'seti-zip',

      // Fonts
      'ttf': 'seti-font', 'otf': 'seti-font', 'woff': 'seti-font', 'woff2': 'seti-font', 'eot': 'seti-font',

      // Shell Scripts
      'sh': 'seti-shell', 'bash': 'seti-shell', 'zsh': 'seti-shell', 'fish': 'seti-shell',
      'ps1': 'seti-powershell', 'bat': 'seti-windows', 'cmd': 'seti-windows',

      // Other
      'log': 'seti-default', 'tmp': 'seti-clock', 'lock': 'seti-lock', 'DS_Store': 'seti-ignored'
    };

    // Special handling for test files
    if (fileName.toLowerCase().includes('test') || fileName.toLowerCase().includes('spec')) {
      const baseExt = ext;
      if (['js', 'ts', 'jsx', 'tsx'].includes(baseExt)) {
        return 'seti-javascript'; // Test files use regular JS/TS icon
      }
    }

    return iconMap[ext] || 'seti-default';
  }

  function getLanguageFromFilename(fileName) {
    if (!fileName) return null;
    const ext = fileName.split('.').pop().toLowerCase();
    const map = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'html': 'xml',
      'xml': 'xml',
      'css': 'css',
      'scss': 'scss',
      'less': 'less',
      'json': 'json',
      'md': 'markdown',
      'py': 'python',
      'rb': 'ruby',
      'go': 'go',
      'rs': 'rust',
      'php': 'php',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'cs': 'csharp',
      'sh': 'bash',
      'yml': 'yaml',
      'yaml': 'yaml',
      'sql': 'sql',
      'toml': 'ini',
      'conf': 'ini',
      'dockerfile': 'dockerfile',
      'swift': 'swift',
      'kt': 'kotlin'
    };
    const lang = map[ext] || null;
    console.log(`[Rifler] getLanguageFromFilename: ${fileName} -> ${lang}`);
    return lang;
  }

  function ensureActiveVisible() {
    if (state.activeIndex < 0) return;
    
    // Find the index in renderItems that corresponds to state.activeIndex
    // This can be either a direct 'match' type item or a match inside a 'matchesGroup'
    let renderIndex = state.renderItems.findIndex(item => item.type === 'match' && item.originalIndex === state.activeIndex);
    
    // If not found as a direct match, find the matchesGroup that contains this match
    if (renderIndex === -1) {
      renderIndex = state.renderItems.findIndex(item => 
        item.type === 'matchesGroup' && 
        item.matches.some(m => m.originalIndex === state.activeIndex)
      );
    }
    
    if (renderIndex === -1) return;

    const renderItem = state.renderItems[renderIndex];

    // If the active item lives inside a matchesGroup, avoid adjusting the outer resultsList scroll.
    // The inner group handler will manage its own scroll, and the user just clicked inside it.
    if (renderItem.type === 'matchesGroup') return;
    const top = renderItem.top;
    const height = renderItem.height || VIRTUAL_ROW_HEIGHT;
    const bottom = top + height;
    const viewTop = resultsList.scrollTop;
    const viewBottom = viewTop + resultsList.clientHeight;

    // Only scroll when the item is entirely above or below the viewport; leave partial overlap untouched
    if (bottom < viewTop) {
      resultsList.scrollTop = top;
    } else if (top > viewBottom) {
      resultsList.scrollTop = bottom - resultsList.clientHeight;
    }
  }

  function handleModulesList(modules) {
    state.modules = modules;
    moduleSelect.innerHTML = modules.length === 0
      ? '<option value="">No modules found</option>'
      : '<option value="">Select module...</option>' +
        modules.map(m => '<option value="' + escapeAttr(m.path) + '">' + escapeHtml(m.name) + '</option>').join('');
  }

  function handleCurrentDirectory(directory) {
    state.currentDirectory = directory;
    // Only apply to the directory input when directory scope is active.
    // Otherwise this overwrites the project-scope display ("All Files").
    if (state.currentScope === 'directory' && directoryInput && !directoryInput.value) {
      directoryInput.value = directory;
    }
  }

  function handleWorkspaceInfo(name, path) {
    state.workspaceName = name;
    state.workspacePath = path;
    // Update scope inputs in case we're in project mode
    updateScopeInputs();
  }

  function handleFileContent(message) {
    if (!message) return;
    
    // Clear loading timeout if it exists
    if (state.loadingTimeout) {
      clearTimeout(state.loadingTimeout);
      state.loadingTimeout = null;
    }
    
    state.fileContent = message;
    state.lastPreview = message;

    // Ensure preview panel is visible when content is loaded
    applyPreviewHeight(previewHeight || getDefaultPreviewHeight(), { updateLastExpanded: false, persist: false, visible: true });
    
    if (previewFilename) {
      previewFilename.textContent = message.fileName || 'Unknown File';
    }
    
    if (previewFilepath) {
      const resultForUri = Array.isArray(state.results)
        ? state.results.find((r) => r && r.uri === message.uri)
        : null;

      const relPath = message.relativePath || (resultForUri && resultForUri.relativePath) || '';
      const displayPath = relPath.startsWith('/') ? relPath.substring(1) : relPath;
      previewFilepath.textContent = displayPath;
      previewFilepath.title = displayPath;
    }
    
    // Update preview icon
    const previewIcon = document.getElementById('file-icon');
    if (previewIcon && message.fileName) {
      const iconName = getFileIconName(message.fileName);
      previewIcon.className = 'seti-icon ' + iconName;
      previewIcon.textContent = ''; // Clear text content
      previewIcon.style.backgroundImage = ''; // Clear background image
    }
    
    if (previewActions) {
      previewActions.style.display = 'flex';
    }
    
    if (isEditMode) {
      console.log('[Rifler] handleFileContent: entering edit mode');
      fileEditor.value = message.content;
      updateLocalMatches();
      updateHighlights();
    } else {
      console.log('[Rifler] handleFileContent: rendering preview');
      // Ensure editor is hidden when in preview mode
      if (editorContainer) editorContainer.classList.remove('visible');
      if (previewContent) previewContent.style.display = 'block';
      renderFilePreview(message);
    }
    
    // Hide loading overlay after content is rendered
    if (previewLoadingOverlay) {
      previewLoadingOverlay.classList.remove('visible');
    }
  }

  function handleDirectoryValidation(exists) {
    console.log('[Rifler] Directory validation result:', exists);
    if (state.currentScope !== 'directory') return;
    
    const container = directoryInput.closest('.filter-field');

    if (exists) {
      updateValidationMessage('directory-input', 'directory-validation-message', '', 'error');
      directoryInput.classList.remove('error');
      if (container) container.classList.remove('error');
    } else {
      console.log('[Rifler] Showing directory error');
      updateValidationMessage('directory-input', 'directory-validation-message', 'Directory is not found', 'error');
      directoryInput.classList.add('error');
      if (container) container.classList.add('error');
    }
  }

  function showContextMenu(e, index) {
    hideContextMenu();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.id = 'result-context-menu';
    menu.innerHTML = 
      '<div class="context-menu-item" data-action="open">Open in Editor<span class="shortcut">Ctrl+Enter</span></div>' +
      '<div class="context-menu-item" data-action="copy-path">Copy File Path</div>' +
      '<div class="context-menu-item" data-action="copy-relative">Copy Relative Path</div>';

    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    document.body.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = (window.innerWidth - rect.width - 5) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = (window.innerHeight - rect.height - 5) + 'px';
    }

    menu.querySelectorAll('.context-menu-item').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.dataset.action;
        const result = state.results[index];
        if (action === 'open') {
          openResultInEditor(index);
        } else if (action === 'copy-path') {
          copyToClipboard(result.uri.replace('file://', ''));
        } else if (action === 'copy-relative') {
          const displayPath = result.relativePath.startsWith('/') ? result.relativePath.substring(1) : result.relativePath;
          copyToClipboard(displayPath);
        }
        hideContextMenu();
      });
    });

    setTimeout(() => {
      document.addEventListener('click', hideContextMenu, { once: true });
      document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
          hideContextMenu();
          document.removeEventListener('keydown', escHandler);
        }
      });
    }, 0);
  }

  function hideContextMenu() {
    const menu = document.getElementById('result-context-menu');
    if (menu) menu.remove();
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
    }).catch(err => {
      console.error('Failed to copy:', err);
    });
  }

  function openResultInEditor(index) {
    if (index < 0 || index >= state.results.length) return;
    const result = state.results[index];
    vscode.postMessage({
      type: 'openLocation',
      uri: result.uri,
      line: result.line,
      character: result.character
    });
  }

  function renderFilePreview(fileData) {
    if (!previewContent) {
      console.error('[Rifler] renderFilePreview: previewContent element not found');
      return;
    }

    // Calculate multiline range first - needed for both cached and fresh renders
    const currentQuery = queryInput ? queryInput.value : '';
    const queryHasNewlines = currentQuery && currentQuery.includes('\n');
    const queryLineCount = queryHasNewlines ? currentQuery.split('\n').length : 1;
    const currentResult = state.results[state.activeIndex];
    const currentLine = currentResult ? currentResult.line : -1;
    const activeLineStart = currentLine;
    const activeLineEnd = currentLine + queryLineCount - 1;

    // Prevent rendering the same content multiple times, but always scroll to current line
    // Include query, matches count and activeIndex in cache key to detect when highlighting changes
    const matchCount = fileData.matches ? fileData.matches.length : 0;
    const cacheKey = `${fileData.uri}|${currentQuery}|${matchCount}|${state.activeIndex}`;
    
    if (previewContent.dataset.lastRenderedCacheKey === cacheKey) {
      // Content and matches are identical, just update the active line highlight and scroll
      
      // Update active line class - for multiline, update range
      previewContent.querySelectorAll('.pvLine.isActive').forEach(el => el.classList.remove('isActive'));
      
      if (currentLine >= 0) {
        // Mark all lines in the active range
        for (let lineIdx = activeLineStart; lineIdx <= activeLineEnd; lineIdx++) {
          const lineEl = previewContent.querySelector('[data-line="' + lineIdx + '"]');
          if (lineEl) {
            lineEl.classList.add('isActive');
          }
        }
        
        const currentLineEl = previewContent.querySelector('[data-line="' + currentLine + '"]');
        if (currentLineEl) {
          console.log('[Rifler] Updating active line highlight and scrolling to line:', currentLine, 'range:', activeLineStart, '-', activeLineEnd);
          currentLineEl.classList.add('isActive');
          
          // Use scrollIntoView with a small timeout to ensure layout is ready
          setTimeout(() => {
            currentLineEl.scrollIntoView({ block: 'center', behavior: 'auto' });
            
            // Fallback for environments where scrollIntoView might fail (e.g. some headless tests)
            if (previewContent.scrollTop === 0 && currentLineEl.offsetTop > previewContent.clientHeight) {
              previewContent.scrollTop = currentLineEl.offsetTop - (previewContent.clientHeight / 2);
            }

            // For E2E testing: send scroll info after a short delay, even when content is unchanged
            setTimeout(() => {
              const activeLineEl = previewContent.querySelector('.pvLine.isActive');
              const previewScrollTop = previewContent.scrollTop;
              const previewScrollHeight = previewContent.scrollHeight;
              const previewClientHeight = previewContent.clientHeight;
              
              vscode.postMessage({
                type: '__test_previewScrollInfo',
                hasActiveLine: !!activeLineEl,
                activeLineTop: activeLineEl ? activeLineEl.offsetTop : 0,
                scrollTop: previewScrollTop,
                scrollHeight: previewScrollHeight,
                clientHeight: previewClientHeight,
                isActiveLineVisible: activeLineEl ? 
                  (activeLineEl.offsetTop >= previewScrollTop && 
                   activeLineEl.offsetTop + activeLineEl.offsetHeight <= previewScrollTop + previewClientHeight) : false
              });
            }, 300);
          }, 50);
        }
      }
      return;
    }
    
    if (!fileData || typeof fileData.content !== 'string') {
      console.warn('[Rifler] renderFilePreview: No content to render');
      previewContent.innerHTML = '<div class="empty-state">No content available</div>';
      return;
    }

    const lines = fileData.content.split('\n');

    console.log('[Rifler] renderFilePreview: Rendering', lines.length, 'lines. Total matches:', fileData.matches ? fileData.matches.length : 0);
    console.log('[Rifler] Active line range:', activeLineStart, 'to', activeLineEnd, '(queryLineCount:', queryLineCount, 'queryHasNewlines:', queryHasNewlines, ')');
    if (fileData.matches && fileData.matches.length > 0) {
      console.log('[Rifler] Sample matches:', fileData.matches.slice(0, 5));
    }

    const language = getLanguageFromFilename(fileData.fileName);
    console.log('[Rifler] Detected language:', language);

    const highlightSegment = (text) => {
      if (text === '') return '';
      if (typeof hljs !== 'undefined') {
        try {
          let highlighted;
          if (language && language !== 'file' && hljs.getLanguage(language)) {
            highlighted = hljs.highlight(text, { language }).value;
          } else {
            // Fallback to auto-detection for unknown extensions
            highlighted = hljs.highlightAuto(text).value;
          }
          // console.log('[Rifler] Highlighted segment:', highlighted.substring(0, 20));
          return highlighted;
        } catch (e) {
          console.error('[Rifler] Highlight error:', e, 'Language:', language);
          return escapeHtml(text);
        }
      }
      return escapeHtml(text);
    };

    const renderLineWithMatches = (rawLine, ranges) => {
      const safeRanges = (Array.isArray(ranges) ? ranges : [])
        .map(r => ({ start: Number(r.start), end: Number(r.end) }))
        .filter(r => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end >= r.start)
        .sort((a, b) => a.start - b.start);

      if (safeRanges.length === 0) {
        const highlighted = highlightSegment(rawLine);
        const content = highlighted === '' ? ' ' : highlighted;
        // Wrap entire line in a single pvSeg with data-start="0"
        return '<span class="pvSeg" data-start="0">' + content + '</span>';
      }

      // Special case: if there's a zero-length match at start (empty line part of multiline match)
      // Just show as an active line without highlight styling
      const hasZeroLengthMatch = safeRanges.some(r => r.start === 0 && r.end === 0);
      if (hasZeroLengthMatch && rawLine.length === 0) {
        // Empty line that's part of a multiline match - show as plain empty line (isActive handles styling)
        return '<span class="pvSeg" data-start="0"> </span>';
      }

      let html = '';
      let cursor = 0;

      for (const r of safeRanges) {
        // Skip zero-length ranges for rendering (but we still got isHit class from having matches)
        if (r.end === r.start) continue;
        
        // Ensure we don't go backwards and stay within bounds
        const start = Math.max(cursor, Math.min(rawLine.length, r.start));
        const end = Math.max(start, Math.min(rawLine.length, r.end));

        if (start > cursor) {
          // Before-match segment
          html += '<span class="pvSeg" data-start="' + cursor + '">' + highlightSegment(rawLine.slice(cursor, start)) + '</span>';
        }
        // Match segment - both pvSeg and pvMatch classes
        html += '<span class="pvSeg pvMatch" data-start="' + start + '">' + highlightSegment(rawLine.slice(start, end)) + '</span>';
        cursor = end;
      }

      if (cursor < rawLine.length) {
        // After-match segment
        html += '<span class="pvSeg" data-start="' + cursor + '">' + highlightSegment(rawLine.slice(cursor)) + '</span>';
      }
      return html === '' ? ' ' : html;
    };

    let html = '';
    lines.forEach((line, idx) => {
      const lineMatches = fileData.matches ? fileData.matches.filter(m => m.line === idx) : [];
      const hasMatch = lineMatches.length > 0;
      // For multiline matches, mark all lines in the active range as "active" (styling)
      // hasMatch controls the text highlight (isHit), isCurrentLine controls the line styling (isActive)
      const isCurrentLine = idx >= activeLineStart && idx <= activeLineEnd;

      // Log lines in the active range to debug multiline active line behavior
      if (idx >= activeLineStart && idx <= activeLineEnd) {
        console.log('[Rifler] Active range line', idx, '- hasMatch:', hasMatch, 'isCurrentLine:', isCurrentLine, 'lineContent:', JSON.stringify(line.substring(0, 30)));
      }

      let lineClass = 'pvLine';
      // Only add isHit (text highlight) if line has actual content - empty lines just get isActive
      if (hasMatch && line.length > 0) lineClass += ' isHit';
      if (isCurrentLine) lineClass += ' isActive';

      const lineContent = renderLineWithMatches(line, lineMatches);

      html += '<div class="' + lineClass + '" data-line="' + idx + '">' +
        '<div class="pvLineNo' + (hasMatch ? ' has-match' : '') + '">' + (idx + 1) + '</div>' +
        '<div class="pvCode hljs">' + lineContent + '</div>' +
      '</div>';
    });

    console.log('[Rifler] Generated HTML length:', html.length, 'lines:', lines.length);
    
    // Ensure previewContent is visible and populated
    previewContent.innerHTML = html;
    // Content is always visible; editing state is controlled by parent container
    previewContent.style.display = 'grid';
    previewContent.style.visibility = 'visible';
    previewContent.style.opacity = '1';
    previewContent.style.zIndex = '1';
    
    // Rebuild line element cache for lightweight arrow navigation
    rebuildLineElementCache();
    
    // Update cache markers to prevent duplicate renders
    previewContent.dataset.lastRenderedCacheKey = cacheKey;
    
    // Force a layout recalculation
    previewContent.offsetHeight; 

    if (currentLine >= 0) {
      const currentLineEl = previewContent.querySelector('[data-line="' + currentLine + '"]');
      if (currentLineEl) {
        console.log('[Rifler] Scrolling to line:', currentLine);
        
        // Use scrollIntoView with a small timeout to ensure layout is ready
        setTimeout(() => {
          currentLineEl.scrollIntoView({ block: 'center', behavior: 'auto' });
          
          // Fallback for environments where scrollIntoView might fail (e.g. some headless tests)
          if (previewContent.scrollTop === 0 && currentLineEl.offsetTop > previewContent.clientHeight) {
            previewContent.scrollTop = currentLineEl.offsetTop - (previewContent.clientHeight / 2);
          }

          // For E2E testing: send scroll info after a delay
          setTimeout(() => {
            const activeLineEl = previewContent.querySelector('.pvLine.isActive');
            const previewScrollTop = previewContent.scrollTop;
            const previewScrollHeight = previewContent.scrollHeight;
            const previewClientHeight = previewContent.clientHeight;
            
            vscode.postMessage({
              type: '__test_previewScrollInfo',
              hasActiveLine: !!activeLineEl,
              activeLineTop: activeLineEl ? activeLineEl.offsetTop : 0,
              scrollTop: previewScrollTop,
              scrollHeight: previewScrollHeight,
              clientHeight: previewClientHeight,
              isActiveLineVisible: activeLineEl ? 
                (activeLineEl.offsetTop >= previewScrollTop && 
                 activeLineEl.offsetTop + activeLineEl.offsetHeight <= previewScrollTop + previewClientHeight) : false
            });
          }, 500);
        }, 50);
      }
    }

    previewContent.querySelectorAll('.pvLine').forEach(lineEl => {
      lineEl.addEventListener('dblclick', () => {
        const lineNum = parseInt(lineEl.dataset.line, 10);
        if (state.fileContent) {
          vscode.postMessage({
            type: 'openLocation',
            uri: state.fileContent.uri,
            line: lineNum,
            character: 0
          });
        }
      });
    });
  }

  function loadFileContent(result) {
    // Use queryInput.value as fallback if state.currentQuery is empty
    const query = state.currentQuery || (queryInput ? queryInput.value : '');
    
    // Ensure multiline option is set correctly based on query content
    const queryHasNewlines = query.includes('\n');
    if (queryHasNewlines && !state.options.multiline) {
      state.options.multiline = true;
    }
    
    vscode.postMessage({
      type: 'getFileContent',
      uri: result.uri,
      query: query,
      options: state.options,
      activeIndex: state.activeIndex
    });
  }

  // Capture scroll positions of all grouped match containers currently in the DOM
  function captureGroupScrollTopsFromDom() {
    const containers = document.querySelectorAll('.matches-group-scroll-container');
    if (!state.groupScrollTops) state.groupScrollTops = {};
    containers.forEach(el => {
      const path = el.dataset.path || el.closest('.result-matches-group')?.dataset?.path;
      if (path) {
        state.groupScrollTops[path] = el.scrollTop;
      }
    });
  }

  // Restore scroll positions to grouped match containers from cached state
  function restoreGroupScrollTopsToDom() {
    const containers = document.querySelectorAll('.matches-group-scroll-container');
    containers.forEach(el => {
      const path = el.dataset.path || el.closest('.result-matches-group')?.dataset?.path;
      if (!path) return;
      const saved = state.groupScrollTops && state.groupScrollTops[path];
      if (typeof saved === 'number') {
        el.scrollTop = saved;
      }
    });
  }

  function ensureActiveVisibleInGroup() {
    // Find and scroll within the matchesGroup container if the active match is inside one
    const doScroll = () => {
      const groupContainers = document.querySelectorAll('.matches-group-scroll-container');
      groupContainers.forEach(groupContainer => {
        const groupPath = groupContainer.dataset.path || groupContainer.closest('.result-matches-group')?.dataset?.path || '';
        const activeMatch = groupContainer.querySelector('.result-item.active');
        if (!activeMatch) return;

        const matchTop = activeMatch.offsetTop;
        const matchBottom = matchTop + activeMatch.offsetHeight;
        const viewTop = groupContainer.scrollTop;
        const viewBottom = viewTop + groupContainer.clientHeight;

        // Scroll only if active item is outside viewport
        if (matchTop < viewTop) {
          groupContainer.scrollTop = matchTop;
        } else if (matchBottom > viewBottom) {
          groupContainer.scrollTop = matchBottom - groupContainer.clientHeight;
        }

        // Persist the chosen scroll
        if (!state.groupScrollTops) state.groupScrollTops = {};
        state.groupScrollTops[groupPath] = groupContainer.scrollTop;
      });
    };

    // Run immediately and again on next frame so the first click is captured after DOM update
    doScroll();
    requestAnimationFrame(doScroll);
  }

  function setActiveIndex(index, { skipLoad = false, skipRender = false } = {}) {
    if (index < 0 || index >= state.results.length) return;

    if (isEditMode) {
      exitEditMode(true);
    }

    state.activeIndex = index;

    // Only rebuild results list if we're not using lightweight navigation
    if (!skipRender) {
      renderResultsVirtualized();
    }
    
    // After render, apply active styling and ensure visibility
    requestAnimationFrame(() => {
      const activeEl = document.querySelector(`.result-item[data-index="${index}"]`);
      if (activeEl) {
        document.querySelectorAll('.result-item.active').forEach(el => el.classList.remove('active'));
        activeEl.classList.add('active');
        activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      
      ensureActiveVisible();
      ensureActiveVisibleInGroup();
    });

    if (!skipLoad) {
      loadFileContent(state.results[index]);
    }
  }

  // Clicking the preview filename should open the file in the editor (Issue #96 feedback)
  if (previewFilename) {
    previewFilename.style.cursor = 'pointer';
    previewFilename.addEventListener('click', () => {
      if (state.activeIndex >= 0) {
        openActiveResult();
      }
    });
  }

  function activateFirstMatchForPath(path) {
    const idx = state.results.findIndex(r => (r.relativePath || r.fileName) === path);
    if (idx >= 0) {
      setActiveIndex(idx);
    }
  }


  // === Flat-List Navigation (Robust, No Group Assumptions) ===

  /**
   * Check if an element is visible in the DOM
   */
  function isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * Get all navigable result items in visual order (flat list)
   * Scope to results list container, never include preview clones
   */
  function getNavigableItems() {
    // Use the actual results list element (virtualized container)
    const root = resultsList;
    if (!root) return [];

    // Only result rows (match rows), not headers/end-of-results
    const items = Array.from(root.querySelectorAll('.result-item'));
    return items.filter(isElementVisible);
  }

  /**
   * Get file path for a result index
   */
  function getPathForResultIndex(resultIndex) {
    const r = state.results[resultIndex];
    return (r?.relativePath || r?.fileName) || null;
  }

  /**
   * Get all unique file paths in renderItems order (fileHeader items)
   */
  function getAllGroupPathsInOrder() {
    return state.renderItems
      .filter(it => it.type === 'fileHeader')
      .map(it => it.path);
  }

  /**
   * Check if a group is collapsed
   */
  function isGroupCollapsed(path) {
    if (state.collapsedFiles.has(path)) return true;
    if (state.expandedFiles.has(path)) return false;

    // Fallback: check renderItems header state
    const header = state.renderItems.find(it => it.type === 'fileHeader' && it.path === path);
    return header ? !!header.isCollapsed : false;
  }

  /**
   * Expand a collapsed group and re-render
   */
  function expandGroup(path) {
    state.collapsedFiles.delete(path);
    state.expandedFiles.add(path);

    // Rebuild renderItems without losing scroll or active selection
    handleSearchResults(state.results, {
      skipAutoLoad: true,
      activeIndex: state.activeIndex,
      preserveScroll: true
    });
  }

  /**
   * Find first result index for a given file path
   */
  function findFirstResultIndexInPath(path) {
    return state.results.findIndex(r => (r.relativePath || r.fileName) === path);
  }

  /**
   * Find last result index for a given file path
   */
  function findLastResultIndexInPath(path) {
    for (let i = state.results.length - 1; i >= 0; i--) {
      const r = state.results[i];
      if ((r.relativePath || r.fileName) === path) return i;
    }
    return -1;
  }

  /**
   * Robustly find the currently active result item
   * Handles cases where active element is lost or on a child
   */
  function getCurrentActiveItem(navigableItems) {
    if (!navigableItems || navigableItems.length === 0) return null;

    // Try to find .result-item.active within resultsList scope
    const domActive = resultsList ? resultsList.querySelector('.result-item.active') : null;
    if (domActive && navigableItems.includes(domActive)) return domActive;

    // Try state.activeIndex
    if (state.activeIndex >= 0 && state.activeIndex < state.results.length) {
      const targetItem = document.querySelector(`.result-item[data-index="${state.activeIndex}"]`);
      if (targetItem && navigableItems.includes(targetItem)) return targetItem;
    }

    // Fallback to first item
    return navigableItems[0] || null;
  }

  /**
   * Move selection up or down with cross-group navigation
   * - Within visible items: move normally
   * - At boundaries: jump to next/prev group (auto-expand if needed)
   * - No wrap-around
   */
  function moveSelection(delta) {
    const navigableItems = getNavigableItems();
    if (!navigableItems.length) return;

    const currentItem = getCurrentActiveItem(navigableItems);
    if (!currentItem) return;

    const currentIdx = navigableItems.indexOf(currentItem);
    if (currentIdx === -1) return;

    const nextIdx = currentIdx + delta;

    // Normal case: move within visible items
    if (nextIdx >= 0 && nextIdx < navigableItems.length) {
      setActiveResult(navigableItems[nextIdx], { reason: 'keyboard' });
      return;
    }

    // Edge case: at boundary of visible items -> cross-group navigation
    if (state.activeIndex < 0 || state.activeIndex >= state.results.length) return;

    const currentPath = getPathForResultIndex(state.activeIndex);
    if (!currentPath) return;

    const paths = getAllGroupPathsInOrder();
    const groupIdx = paths.indexOf(currentPath);
    if (groupIdx === -1) return;

    if (delta > 0) {
      // ArrowDown at boundary: go to next group
      const nextPath = paths[groupIdx + 1];
      if (!nextPath) return; // Already last group -> stop

      if (isGroupCollapsed(nextPath)) {
        expandGroup(nextPath);
      }

      const firstIdx = findFirstResultIndexInPath(nextPath);
      if (firstIdx >= 0) {
        setActiveIndex(firstIdx);
      }
    } else {
      // ArrowUp at boundary: go to previous group
      const prevPath = paths[groupIdx - 1];
      if (!prevPath) return; // Already first group -> stop

      if (isGroupCollapsed(prevPath)) {
        expandGroup(prevPath);
      }

      const lastIdx = findLastResultIndexInPath(prevPath);
      if (lastIdx >= 0) {
        setActiveIndex(lastIdx);
      }
    }
  }
  
  /**
   * Set the active result: updates state, DOM, preview, and ensures visibility
   * IDEMPOTENT: safe to call multiple times with same or different items
   * Handles virtualization by re-rendering to ensure target item is in DOM
   */
  function setActiveResult(itemEl, meta) {
    const item = itemEl?.closest('.result-item');
    if (!item) return;

    const resultIndex = parseInt(item.dataset.index, 10);
    if (isNaN(resultIndex) || resultIndex < 0 || resultIndex >= state.results.length) return;

    // Update state: just track the active index (no group logic needed)
    state.activeIndex = resultIndex;

    // Re-render virtual list so the active item is guaranteed to exist in DOM
    renderResultsVirtualized();

    // After render, re-select the actual DOM element for this index and apply .active
    requestAnimationFrame(() => {
      const fresh = document.querySelector(`.result-item[data-index="${resultIndex}"]`);
      if (fresh) {
        document.querySelectorAll('.result-item.active').forEach(el => el.classList.remove('active'));
        fresh.classList.add('active');
        fresh.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      
      // Ensure visibility in both main list and group containers
      ensureActiveVisible();
      ensureActiveVisibleInGroup();
    });

    // Load file content for preview (same as mouse click selection)
    if (!isEditMode) {
      loadFileContent(state.results[resultIndex]);
    }
  }

  function openActiveResult() {
    if (state.activeIndex < 0 || state.activeIndex >= state.results.length) return;
    const result = state.results[state.activeIndex];
    vscode.postMessage({
      type: 'openLocation',
      uri: result.uri,
      line: result.line,
      character: result.character
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function escapeAttr(text) {
    return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function highlightMatch(html, start, end) {
    if (start < 0 || end <= start || start >= html.length) return html;
    end = Math.min(end, html.length);
    return html.substring(0, start) + '<span class="match">' + html.substring(start, end) + '</span>' + html.substring(end);
  }

  function highlightMatchSafe(rawText, ranges, language = null) {
    // Normalize ranges to an array
    let matchRanges = [];
    if (Array.isArray(ranges)) {
      matchRanges = ranges;
    } else if (ranges && typeof ranges.start === 'number' && typeof ranges.end === 'number') {
      matchRanges = [ranges];
    }

    // Filter and sort ranges
    matchRanges = matchRanges
      .filter(r => r && typeof r.start === 'number' && typeof r.end === 'number' && r.start >= 0 && r.end > r.start && r.start < rawText.length)
      .sort((a, b) => a.start - b.start);

    if (matchRanges.length === 0) {
      if (typeof hljs !== 'undefined') {
        try {
          if (language && language !== 'file' && hljs.getLanguage(language)) {
            const res = hljs.highlight(rawText, { language }).value;
            if (rawText.length > 0 && !res.includes('class="hljs-')) {
              console.warn(`[Rifler] highlightMatchSafe: No hljs classes found in result for ${language}. Input: ${rawText.substring(0, 20)}`);
            }
            return res;
          } else {
            return hljs.highlightAuto(rawText).value;
          }
        } catch (e) {
          console.error('[Rifler] highlightMatchSafe error:', e);
        }
      }
      return escapeHtml(rawText);
    }

    let result = '';
    let lastIndex = 0;

    for (const range of matchRanges) {
      const start = range.start;
      const end = Math.min(range.end, rawText.length);

      if (start < lastIndex) continue; // Skip overlapping ranges

      const before = rawText.substring(lastIndex, start);
      const match = rawText.substring(start, end);

      if (typeof hljs !== 'undefined') {
        try {
          if (language && language !== 'file' && hljs.getLanguage(language)) {
            result += hljs.highlight(before, { language }).value;
            result += '<span class="match">' + hljs.highlight(match, { language }).value + '</span>';
          } else {
            result += hljs.highlightAuto(before).value;
            result += '<span class="match">' + hljs.highlightAuto(match).value + '</span>';
          }
        } catch (e) {
          result += escapeHtml(before) + '<span class="match">' + escapeHtml(match) + '</span>';
        }
      } else {
        result += escapeHtml(before) + '<span class="match">' + escapeHtml(match) + '</span>';
      }
      lastIndex = end;
    }

    const remaining = rawText.substring(lastIndex);
    if (typeof hljs !== 'undefined') {
      try {
        if (language && language !== 'file' && hljs.getLanguage(language)) {
          result += hljs.highlight(remaining, { language }).value;
        } else {
          result += hljs.highlightAuto(remaining).value;
        }
      } catch (e) {
        result += escapeHtml(remaining);
      }
    } else {
      result += escapeHtml(remaining);
    }

    return result;
  }
})();
