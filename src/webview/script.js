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
  console.log('[Rifler] IIFE initialization started');
  
  const state = {
    results: [],
    renderItems: [],
    activeIndex: -1,
    currentScope: 'project',
    modules: [],
    currentDirectory: '',
    workspaceName: '',
    workspacePath: '',
    currentQuery: '',
    fileContent: null,
    lastPreview: null,
    searchTimeout: null,
    searchStartTime: 0,
    lastSearchDuration: 0,
    replaceKeybinding: 'ctrl+shift+r',
    maxResultsCap: 10000,
    collapsedFiles: new Set(),
    previewPanelCollapsed: false, // Track preview panel state
    options: {
      matchCase: false,
      wholeWord: false,
      useRegex: false,
      fileMask: ''
    },
    loadingTimeout: null // Track loading overlay timeout
  };

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
  const fileInput = document.getElementById('file-input');
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
  const dragHandle = document.getElementById('drag-handle');
  const previewPanelContainer = document.getElementById('preview-panel-container');
  const resultsCountText = document.getElementById('results-count-text');
  const resultsSummaryBar = document.querySelector('.results-summary-bar');
  const collapseAllBtn = document.getElementById('collapse-all-btn');
  
  // Create a fallback for resultsCount if needed (backward compatibility)
  let resultsCount = document.getElementById('results-count');
  if (!resultsCount) {
    resultsCount = resultsCountText; // Use the new element as a fallback
  }

  // Keep backward compatibility - some may not exist in new design
  const previewActions = document.getElementById('preview-actions');
  const replaceInFileBtn = document.getElementById('replace-in-file-btn');
  const fileEditor = document.getElementById('file-editor');
  const editorContainer = document.getElementById('editor-container');
  const editorBackdrop = document.getElementById('editor-backdrop');
  const editorLineNumbers = document.getElementById('editor-line-numbers');

  const resultsPanel = document.getElementById('results-panel');
  const previewPanel = document.getElementById('preview-panel');
  const mainContent = document.querySelector('.main-content');

  let VIRTUAL_ROW_HEIGHT = 28;
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
  const localMatchCount = document.getElementById('local-match-count');
  const localReplaceBtn = document.getElementById('local-replace-btn');
  const localReplaceAllBtn = document.getElementById('local-replace-all-btn');
  const localReplaceClose = document.getElementById('local-replace-close');
  const localPrevBtn = document.getElementById('local-prev-btn');
  const localNextBtn = document.getElementById('local-next-btn');

  console.log('[Rifler] DOM Elements loaded:', {
    queryInput: !!queryInput,
    resultsList: !!resultsList,
    previewContent: !!previewContent,
    mainContent: !!mainContent,
    dragHandle: !!dragHandle,
    filtersContainer: !!filtersContainer
  });

  function getLanguageFromFilename(filename) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    const langMap = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
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
      'html': 'xml',
      'htm': 'xml',
      'xml': 'xml',
      'css': 'css',
      'scss': 'scss',
      'less': 'less',
      'json': 'json',
      'yaml': 'yaml',
      'yml': 'yaml',
      'md': 'markdown',
      'sh': 'bash',
      'bash': 'bash',
      'zsh': 'bash',
      'sql': 'sql',
      'vue': 'xml',
      'svelte': 'xml'
    };
    return langMap[ext] || 'file';
  }

  var localMatches = [];
  var localMatchIndex = 0;
  var searchBoxFocusedOnStartup = false;

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

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      queryInput.value = '';
      state.results = [];
      state.activeIndex = -1;
      handleSearchResults([], { skipAutoLoad: true });
      
      vscode.postMessage({ type: 'clearState' });
      
      vscode.postMessage({ type: 'minimize', state: {} });
    });
  }

  if (filterBtn && filtersContainer) {
    filterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = filtersContainer.classList.toggle('hidden');
      filterBtn.classList.toggle('active', !isHidden);
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
      
      const allCollapsed = Array.from(allPaths).every(p => state.collapsedFiles.has(p));
      
      if (allCollapsed) {
        // All collapsed, so expand all
        state.collapsedFiles.clear();
      } else {
        // Not all collapsed, so collapse all
        allPaths.forEach(p => state.collapsedFiles.add(p));
      }
      
      handleSearchResults(state.results, { skipAutoLoad: true, activeIndex: state.activeIndex });
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

  function triggerReplaceInFile() {
    if (!state.fileContent) return;
    
    if (!isEditMode) {
      enterEditMode();
    }
    
    if (replaceWidget) {
      const isVisible = replaceWidget.classList.contains('visible');
      if (isVisible) {
        replaceWidget.classList.remove('visible');
      } else {
        if (localSearchInput) localSearchInput.value = state.currentQuery || '';
        if (localReplaceInput) localReplaceInput.value = '';
        replaceWidget.classList.add('visible');
        if (localSearchInput) {
          localSearchInput.focus();
          localSearchInput.select();
        }
        updateLocalMatches();
      }
    }
  }

  if (replaceInFileBtn) {
    replaceInFileBtn.addEventListener('click', triggerReplaceInFile);
  }
  
  if (localReplaceClose) {
    localReplaceClose.addEventListener('click', () => {
      if (replaceWidget) replaceWidget.classList.remove('visible');
      localMatches = [];
      localMatchIndex = 0;
      updateHighlights();
      if (isEditMode && fileEditor) {
        fileEditor.focus();
      }
    });
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
        if (replaceWidget) replaceWidget.classList.remove('visible');
        localMatches = [];
        updateHighlights();
        if (isEditMode && fileEditor) {
          fileEditor.focus();
        }
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
        if (replaceWidget) replaceWidget.classList.remove('visible');
        localMatches = [];
        updateHighlights();
        if (isEditMode && fileEditor) {
          fileEditor.focus();
        }
      }
    });
  }

  if (localReplaceBtn) {
    localReplaceBtn.addEventListener('click', triggerLocalReplace);
  }
  if (localReplaceAllBtn) {
    localReplaceAllBtn.addEventListener('click', triggerLocalReplaceAll);
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
      localMatchCount.textContent = 'No results';
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
  let saveTimeout = null;

  if (previewContent) {
    previewContent.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      
      enterEditMode();
    });
  }

  function enterEditMode() {
    if (!state.fileContent || isEditMode) return;
    
    const scrollTop = previewContent.scrollTop;
    
    isEditMode = true;
    if (editorContainer) editorContainer.classList.add('visible');
    if (fileEditor) fileEditor.value = state.fileContent.content;
    updateHighlights();
    
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (fileEditor) {
          fileEditor.scrollTop = scrollTop;
          fileEditor.focus({ preventScroll: true });
        }
        if (editorBackdrop) editorBackdrop.scrollTop = scrollTop;
        if (editorLineNumbers) editorLineNumbers.scrollTop = scrollTop;
      });
    });
  }

  function saveFile() {
    if (!state.fileContent) return;
    
    const newContent = fileEditor.value;
    vscode.postMessage({
      type: 'saveFile',
      uri: state.fileContent.uri,
      content: newContent
    });
    
    state.fileContent.content = newContent;
  }

  function exitEditMode(skipRender = false) {
    if (!isEditMode) return;
    
    saveFile();
    
    isEditMode = false;
    if (editorContainer) editorContainer.classList.remove('visible');
    
    if (!skipRender) {
      renderFilePreview(state.fileContent);
    }
  }

  if (fileEditor) {
    fileEditor.addEventListener('input', () => {
      updateHighlights();
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        saveFile();
      }, 1000);
    });

    fileEditor.addEventListener('blur', (e) => {
      if (saveTimeout) clearTimeout(saveTimeout);
      
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
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
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
  
  fileEditor.addEventListener('scroll', () => {
    if (editorBackdrop) {
      editorBackdrop.scrollTop = fileEditor.scrollTop;
      editorBackdrop.scrollLeft = fileEditor.scrollLeft;
    }
    if (editorLineNumbers) {
      editorLineNumbers.scrollTop = fileEditor.scrollTop;
    }
  });
  
  function updateHighlights() {
    if (!editorBackdrop || !fileEditor) return;
    
    const text = fileEditor.value;
    const searchQuery = localSearchInput ? localSearchInput.value : (state.currentQuery || '');
    
    const fileName = state.fileContent ? state.fileContent.fileName : '';
    const language = getLanguageFromFilename(fileName);
    
    let highlighted = '';
    
    if (typeof hljs !== 'undefined' && language) {
      try {
        highlighted = hljs.highlight(text, { language: language }).value;
      } catch (e) {
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
              
              const mark = document.createElement('mark');
              mark.style.background = 'var(--rifler-highlight-strong)';
              mark.style.color = 'inherit';
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
      modulePath: state.currentScope === 'module' ? moduleSelect.value : undefined,
      filePath: state.currentScope === 'file' ? fileInput.value.trim() : undefined
    });
  }

  let validationDebounceTimeout;

  function updateValidationMessage(fieldId, messageElementId, message, type) {
    const messageElement = document.getElementById(messageElementId);
    if (!messageElement) return;

    if (message) {
      messageElement.textContent = message;
      messageElement.className = 'validation-message visible ' + type;
    } else {
      messageElement.className = 'validation-message';
      messageElement.textContent = '';
    }
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
        useRegex: useRegex
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
      matchCaseToggle.classList.toggle('active', state.options.matchCase);
      runSearch();
    });
  }

  if (wholeWordToggle) {
    wholeWordToggle.addEventListener('click', () => {
      state.options.wholeWord = !state.options.wholeWord;
      wholeWordToggle.classList.toggle('active', state.options.wholeWord);
      runSearch();
    });
  }

  if (useRegexToggle) {
    useRegexToggle.addEventListener('click', () => {
      state.options.useRegex = !state.options.useRegex;
      useRegexToggle.classList.toggle('active', state.options.useRegex);
      
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
        filePath: fileInput.value,
        options: state.options,
        showReplace: replaceRow.classList.contains('visible'),
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
    if (containerHeight <= 0) return; // Don't apply if we don't know the container height

    const maxPreviewHeight = Math.max(PREVIEW_MIN_HEIGHT, containerHeight - MIN_PANEL_HEIGHT);
    const clamped = Math.min(Math.max(PREVIEW_MIN_HEIGHT, height), maxPreviewHeight);
    const newResultsHeight = Math.max(MIN_PANEL_HEIGHT, containerHeight - clamped);
    
    if (resultsPanel) {
      resultsPanel.style.flex = '1';
      resultsPanel.style.height = 'auto';
      resultsPanel.style.minHeight = '0';
    }
    if (previewPanelContainer) {
      previewPanelContainer.style.flex = 'none';
      previewPanelContainer.style.height = (clamped + RESIZER_HEIGHT) + 'px';
      previewPanelContainer.style.display = visible ? 'flex' : 'none';
    }
    if (previewPanel) {
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
        runSearch();
      }, 500);
    });
  }

  if (moduleSelect) {
    moduleSelect.addEventListener('change', runSearch);
  }

  document.addEventListener('keydown', (e) => {
    var activeEl = document.activeElement;
    var isInEditor = activeEl === fileEditor || activeEl === localSearchInput || activeEl === localReplaceInput;
    
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
      navigateResults(1);
    } else if (e.key === 'ArrowUp' && !isInEditor) {
      e.preventDefault();
      navigateResults(-1);
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
      
      exitEditMode();
    }
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    console.log('Webview received message:', message.type, message);
    switch (message.type) {
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
        if (fileInput) fileInput.value = '';
        state.results = [];
        state.activeIndex = -1;
        state.lastPreview = null;
        state.lastSearchDuration = 0;
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
      case 'restoreState':
        if (message.state) {
          const s = message.state;
          queryInput.value = s.query || '';
          state.currentQuery = s.query || '';
          replaceInput.value = s.replaceText || '';
          state.currentScope = s.scope || 'project';
          directoryInput.value = s.directoryPath || '';
          moduleSelect.value = s.modulePath || '';
          fileInput.value = s.filePath || '';
          state.options = s.options || { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' };
          
          matchCaseToggle.classList.toggle('active', state.options.matchCase);
          wholeWordToggle.classList.toggle('active', state.options.wholeWord);
          useRegexToggle.classList.toggle('active', state.options.useRegex);
          fileMaskInput.value = state.options.fileMask || '';
          
          if (scopeSelect) {
            scopeSelect.value = state.currentScope;
          }
          updateScopeInputs();
          
          if (s.showReplace === true) {
            toggleReplace(true);
          } else {
            toggleReplace(false);
          }
          
          if (s.results && s.results.length > 0) {
            handleSearchResults(s.results, { skipAutoLoad: true, activeIndex: s.activeIndex });
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
      case '__test_setSearchInput':
        queryInput.value = message.value;
        runSearch();
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
      case '__test_clickOpenInEditor':
        if (typeof message.index === 'number') {
          openResultInEditor(message.index);
        }
        break;
      case '__test_simulateKeyboard':
        if (message.key === 'Enter' && message.ctrlKey) {
          openActiveResult();
        }
        break;
      case '__test_getContextMenuInfo':
        vscode.postMessage({
          type: '__test_contextMenuInfo',
          hasOpenOption: true,
          hasCopyPathOption: true,
          hasCopyRelativeOption: true
        });
        break;
      case '__test_getUiStatus':
        vscode.postMessage({
          type: '__test_uiStatus',
          summaryBarVisible: resultsSummaryBar ? getComputedStyle(resultsSummaryBar).display !== 'none' : false,
          filtersVisible: filtersContainer ? !filtersContainer.classList.contains('hidden') : false,
          replaceVisible: replaceRow ? replaceRow.classList.contains('visible') : false,
          previewVisible: previewPanelContainer ? getComputedStyle(previewPanelContainer).display !== 'none' : false,
          resultsCountText: resultsCountText ? resultsCountText.textContent : ''
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
      case '__test_getResultsListStatus':
        const resultsList = document.getElementById('results-list');
        const scrollbarVisible = resultsList ? 
          getComputedStyle(resultsList).overflowY !== 'hidden' && 
          resultsList.scrollHeight > resultsList.clientHeight : false;
        
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
        const fileInputVisible = fileInput ? getComputedStyle(fileInput).display !== 'none' : false;
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
          moduleSelectVisible: moduleSelectVisible,
          fileInputVisible: fileInputVisible
        });
        break;
      case '__test_setDirectoryInput':
        if (directoryInput && message.value !== undefined) {
          directoryInput.value = message.value;
        }
        break;
      case '__test_setScope':
        if (message.scope && scopeSelect) {
          state.currentScope = message.scope;
          scopeSelect.value = message.scope;
          updateScopeInputs();
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
    }
  });

  function updateScopeInputs() {
    // Hide all scope inputs first
    if (directoryInput) directoryInput.style.display = 'none';
    if (moduleSelect) moduleSelect.style.display = 'none';
    if (fileInput) fileInput.style.display = 'none';
    
    // Update label and show correct input
    if (state.currentScope === 'project') {
      if (pathLabel) pathLabel.textContent = 'Project:';
      if (directoryInput) {
        directoryInput.style.display = 'block';
        directoryInput.placeholder = state.workspaceName || 'All files';
        directoryInput.value = state.workspacePath || '';
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
      }
    } else if (state.currentScope === 'module') {
      if (pathLabel) pathLabel.textContent = 'Module:';
      if (moduleSelect) moduleSelect.style.display = 'block';
    } else if (state.currentScope === 'file') {
      if (pathLabel) pathLabel.textContent = 'File:';
      if (fileInput) fileInput.style.display = 'block';
    }

    // Sync dropdown if needed
    if (scopeSelect && scopeSelect.value !== state.currentScope) {
      scopeSelect.value = state.currentScope;
    }
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
      
      const query = queryInput.value.trim();
      state.currentQuery = query;
      
      console.log('runSearch called, query:', query, 'length:', query.length);
      
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
        options: state.options
      };

      if (state.currentScope === 'directory') {
        message.directoryPath = directoryInput.value.trim();
        console.log('Sending directory search:', message.directoryPath);
      } else if (state.currentScope === 'module') {
        message.modulePath = moduleSelect.value;
      } else if (state.currentScope === 'file') {
        message.filePath = fileInput.value.trim();
      }

      console.log('Sending search message:', message);
      vscode.postMessage(message);
    } catch (error) {
      console.error('Error in runSearch:', error);
    }
  }

  function handleSearchResults(results, options = { skipAutoLoad: false, activeIndex: undefined }) {
    const resolvedActiveIndex = options.activeIndex !== undefined ? options.activeIndex : (results.length > 0 ? 0 : -1);
    state.results = results;
    state.activeIndex = resolvedActiveIndex;
    resultsList.scrollTop = 0;

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
    groups.forEach(group => {
      const isCollapsed = state.collapsedFiles.has(group.path);
      state.renderItems.push({
        type: 'fileHeader',
        path: group.path,
        fileName: group.fileName,
        matchCount: group.matches.length,
        isCollapsed: isCollapsed
      });
      
      if (!isCollapsed) {
        group.matches.forEach(match => {
          state.renderItems.push({
            type: 'match',
            ...match
          });
        });
      }
    });

    if (results.length > 0) {
      state.renderItems.push({ type: 'endOfResults' });
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
      previewFilename.textContent = '';
      applyPreviewHeight(previewHeight || getDefaultPreviewHeight(), { updateLastExpanded: false, persist: false, visible: false });
      return;
    }

    hidePlaceholder();
    renderResultsVirtualized();
    
    if (!options.skipAutoLoad && state.activeIndex >= 0) {
      loadFileContent(state.results[state.activeIndex]);
    }
  }

  function renderResultsVirtualized() {
    if (state.renderItems.length === 0) return;

    const total = state.renderItems.length;
    const viewportHeight = resultsList.clientHeight || 1;
    const scrollTop = resultsList.scrollTop;
    const start = Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN);
    const end = Math.min(total, Math.ceil((scrollTop + viewportHeight) / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN);

    virtualContent.style.height = (total * VIRTUAL_ROW_HEIGHT) + 'px';

    const fragment = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      fragment.appendChild(renderResultRow(state.renderItems[i], i));
    }

    virtualContent.innerHTML = '';
    virtualContent.appendChild(fragment);

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
    item.style.top = (index * VIRTUAL_ROW_HEIGHT) + 'px';
    item.style.left = '0';
    item.style.right = '0';

    if (itemData.type === 'fileHeader') {
      item.className = 'result-file-header' + (itemData.isCollapsed ? ' collapsed' : '');
      const arrowIcon = itemData.isCollapsed ? 'chevron_right' : 'expand_more';
      const displayPath = itemData.path.startsWith('/') ? itemData.path.substring(1) : itemData.path;
      
      item.innerHTML = 
        '<span class="material-symbols-outlined arrow-icon">' + arrowIcon + '</span>' +
        '<span class="seti-icon ' + getFileIconName(itemData.fileName) + '"></span>' +
        '<span class="file-name">' + escapeHtml(itemData.fileName) + '</span>' +
        '<span class="file-path" title="' + escapeAttr(displayPath) + '">' + escapeHtml(displayPath) + '</span>' +
        '<span class="match-count">' + itemData.matchCount + '</span>';
        
      item.addEventListener('click', () => {
        if (state.collapsedFiles.has(itemData.path)) {
          state.collapsedFiles.delete(itemData.path);
        } else {
          state.collapsedFiles.add(itemData.path);
        }
        handleSearchResults(state.results, { skipAutoLoad: true, activeIndex: state.activeIndex });
        updateCollapseButtonText();
      });
      
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
      itemData.previewMatchRange.start,
      itemData.previewMatchRange.end,
      language
    );

    item.innerHTML = 
      '<div class="result-meta">' +
        '<span class="result-line-number">' + (itemData.line + 1) + '</span>' +
      '</div>' +
      '<div class="result-preview hljs">' + previewHtml + '</div>' +
      '<div class="result-actions">' +
        '<button class="open-in-editor-btn" data-index="' + itemData.originalIndex + '" title="Open in Editor (Ctrl+Enter)">' +
          '<span class="material-symbols-outlined">open_in_new</span>' +
        '</button>' +
      '</div>';

    item.addEventListener('click', (e) => {
      const target = e.target;
      if (target && (target.closest('.open-in-editor-btn'))) return;
      setActiveIndex(itemData.originalIndex);
    });

    item.addEventListener('dblclick', (e) => {
      const target = e.target;
      if (target && (target.closest('.open-in-editor-btn'))) return;
      openActiveResult();
    });

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e, itemData.originalIndex);
    });

    const openBtn = item.querySelector('.open-in-editor-btn');
    if (openBtn) {
      openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(openBtn.dataset.index, 10);
        openResultInEditor(idx);
      });
    }

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
    // Return Seti UI icon class names for different file types
    const iconMap = {
      'js': 'seti-javascript', 'jsx': 'seti-javascript',
      'ts': 'seti-typescript', 'tsx': 'seti-typescript',
      'py': 'seti-python',
      'java': 'seti-java',
      'c': 'seti-c', 'cpp': 'seti-cpp', 'cc': 'seti-cpp', 'cxx': 'seti-cpp',
      'cs': 'seti-csharp',
      'php': 'seti-php',
      'rb': 'seti-ruby',
      'go': 'seti-go',
      'rs': 'seti-rust',
      'swift': 'seti-swift',
      'html': 'seti-html',
      'css': 'seti-css',
      'scss': 'seti-css', 'sass': 'seti-css',
      'json': 'seti-json',
      'xml': 'seti-xml',
      'yaml': 'seti-yaml', 'yml': 'seti-yaml',
      'md': 'seti-markdown',
      'dockerfile': 'seti-dockerfile',
      'gitignore': 'seti-git', 'gitattributes': 'seti-git', 'gitmodules': 'seti-git',
      'png': 'seti-image', 'jpg': 'seti-image', 'jpeg': 'seti-image', 'gif': 'seti-image', 'svg': 'seti-image',
      'mp4': 'seti-video', 'avi': 'seti-video', 'mov': 'seti-video',
      'mp3': 'seti-audio', 'wav': 'seti-audio', 'flac': 'seti-audio',
      'zip': 'seti-zip', 'tar': 'seti-zip', 'gz': 'seti-zip', 'rar': 'seti-zip',
      'pdf': 'seti-pdf'
    };
    return iconMap[ext] || 'seti-default'; // Default file icon
  }

  function getFileIconColor(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    // Follow improved_search_code.html: cargo_config.toml is orange, katerc is blue
    if (fileName === 'cargo_config.toml' || ext === 'toml' || ext === 'yaml' || ext === 'yml') return '#f97316'; // orange-400
    if (fileName === 'katerc' || fileName.startsWith('.') || !fileName.includes('.')) return '#60a5fa'; // blue-400
    
    if (ext === 'js' || ext === 'jsx' || ext === 'ts' || ext === 'tsx' || ext === 'css' || ext === 'md') return '#60a5fa'; // blue-400
    return 'var(--vscode-descriptionForeground)';
  }

  function getLanguageFromFilename(fileName) {
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
      'sql': 'sql'
    };
    return map[ext] || null;
  }

  function ensureActiveVisible() {
    if (state.activeIndex < 0) return;
    
    // Find the index in renderItems that corresponds to state.activeIndex
    const renderIndex = state.renderItems.findIndex(item => item.type === 'match' && item.originalIndex === state.activeIndex);
    if (renderIndex === -1) return;

    const top = renderIndex * VIRTUAL_ROW_HEIGHT;
    const bottom = top + VIRTUAL_ROW_HEIGHT;
    const viewTop = resultsList.scrollTop;
    const viewBottom = viewTop + resultsList.clientHeight;
    if (top < viewTop) {
      resultsList.scrollTop = top;
    } else if (bottom > viewBottom) {
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
    directoryInput.value = directory;
  }

  function handleWorkspaceInfo(name, path) {
    state.workspaceName = name;
    state.workspacePath = path;
    // Update scope inputs in case we're in project mode
    updateScopeInputs();
  }

  function handleFileContent(message) {
    if (!message) return;
    
    // Prevent processing the same file content multiple times
    if (state.fileContent && 
        state.fileContent.uri === message.uri && 
        state.fileContent.content === message.content) {
      return;
    }
    
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
      const relPath = message.relativePath || '';
      const displayPath = relPath.startsWith('/') ? relPath.substring(1) : relPath;
      previewFilepath.textContent = displayPath;
      previewFilepath.title = displayPath;
    }
    
    // Update preview icon
    const previewIcon = document.querySelector('.preview-title-group .file-icon');
    if (previewIcon && message.fileName) {
      previewIcon.className = 'seti-icon ' + getFileIconName(message.fileName);
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

    // Prevent rendering the same content multiple times
    if (previewContent.dataset.lastRenderedUri === fileData.uri && 
        previewContent.dataset.lastRenderedContent === fileData.content) {
      return;
    }
    
    if (!fileData || typeof fileData.content !== 'string') {
      console.warn('[Rifler] renderFilePreview: No content to render');
      previewContent.innerHTML = '<div class="empty-state">No content available</div>';
      return;
    }

    const lines = fileData.content.split('\n');
    const currentResult = state.results[state.activeIndex];
    const currentLine = currentResult ? currentResult.line : -1;

    const language = getLanguageFromFilename(fileData.fileName);
    console.log('[Rifler] Detected language:', language);

    const highlightSegment = (text) => {
      if (text === '') return '';
      if (language && typeof hljs !== 'undefined') {
        try {
          return hljs.highlight(text, { language }).value;
        } catch {
          return escapeHtml(text);
        }
      }
      return escapeHtml(text);
    };

    const renderLineWithMatches = (rawLine, ranges) => {
      const safeRanges = (Array.isArray(ranges) ? ranges : [])
        .map(r => ({ start: Number(r.start), end: Number(r.end) }))
        .filter(r => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
        .sort((a, b) => a.start - b.start);

      if (safeRanges.length === 0) {
        const highlighted = highlightSegment(rawLine);
        return highlighted === '' ? ' ' : highlighted;
      }

      let html = '';
      let cursor = 0;

      for (const r of safeRanges) {
        const start = Math.max(0, Math.min(rawLine.length, Math.max(r.start, cursor)));
        const end = Math.max(start, Math.min(rawLine.length, r.end));

        html += highlightSegment(rawLine.slice(cursor, start));
        html += '<span class="pvMatch">' + highlightSegment(rawLine.slice(start, end)) + '</span>';
        cursor = end;
      }

      html += highlightSegment(rawLine.slice(cursor));
      return html === '' ? ' ' : html;
    };

    let html = '';
    lines.forEach((line, idx) => {
      const lineMatches = fileData.matches ? fileData.matches.filter(m => m.line === idx) : [];
      const hasMatch = lineMatches.length > 0;
      const isCurrentLine = idx === currentLine;

      let lineClass = 'pvLine';
      if (hasMatch) lineClass += ' isHit';
      if (isCurrentLine) lineClass += ' isActive';

      const lineContent = renderLineWithMatches(line, lineMatches);

      html += '<div class="' + lineClass + '" data-line="' + idx + '">' +
        '<div class="pvLineNo' + (hasMatch ? ' has-match' : '') + '">' + (idx + 1) + '</div>' +
        '<div class="pvCode">' + lineContent + '</div>' +
      '</div>';
    });

    console.log('[Rifler] Generated HTML length:', html.length, 'lines:', lines.length);
    
    // Ensure previewContent is visible and populated
    previewContent.innerHTML = html;
    previewContent.style.display = 'block';
    previewContent.style.visibility = 'visible';
    previewContent.style.opacity = '1';
    previewContent.style.zIndex = '1';
    
    // Update cache markers to prevent duplicate renders
    previewContent.dataset.lastRenderedUri = fileData.uri;
    previewContent.dataset.lastRenderedContent = fileData.content;
    
    // Force a layout recalculation
    previewContent.offsetHeight; 

    if (currentLine >= 0) {
      const currentLineEl = previewContent.querySelector('[data-line="' + currentLine + '"]');
      if (currentLineEl) {
        console.log('[Rifler] Scrolling to line:', currentLine);
        currentLineEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
    vscode.postMessage({
      type: 'getFileContent',
      uri: result.uri,
      query: state.currentQuery,
      options: state.options,
      activeIndex: state.activeIndex
    });
  }

  function setActiveIndex(index) {
    if (index < 0 || index >= state.results.length) return;

    if (isEditMode) {
      exitEditMode(true);
    }

    state.activeIndex = index;

    renderResultsVirtualized();
    ensureActiveVisible();

    loadFileContent(state.results[index]);
  }

  function navigateResults(delta) {
    if (state.results.length === 0) return;
    let newIndex = state.activeIndex + delta;
    if (newIndex < 0) newIndex = state.results.length - 1;
    if (newIndex >= state.results.length) newIndex = 0;
    setActiveIndex(newIndex);
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

  function highlightMatchSafe(rawText, start, end, language = null) {
    if (start < 0 || end <= start || start >= rawText.length) {
      if (language && typeof hljs !== 'undefined') {
        try {
          return hljs.highlight(rawText, { language }).value;
        } catch (e) {
          return escapeHtml(rawText);
        }
      }
      return escapeHtml(rawText);
    }
    
    end = Math.min(end, rawText.length);
    const before = rawText.substring(0, start);
    const match = rawText.substring(start, end);
    const after = rawText.substring(end);

    if (language && typeof hljs !== 'undefined') {
      try {
        // Highlight parts separately to keep the match span
        const hBefore = hljs.highlight(before, { language }).value;
        const hMatch = hljs.highlight(match, { language }).value;
        const hAfter = hljs.highlight(after, { language }).value;
        return hBefore + '<span class="match">' + hMatch + '</span>' + hAfter;
      } catch (e) {
        // Fallback to basic escaping
      }
    }

    return escapeHtml(before) + '<span class="match">' + escapeHtml(match) + '</span>' + escapeHtml(after);
  }
})();
