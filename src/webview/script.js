// Rifler Webview Script
// Extracted from extension.ts as part of Phase 1 refactoring (Issue #46)

(function() {
  const state = {
    results: [],
    activeIndex: -1,
    currentScope: 'project',
    modules: [],
    currentDirectory: '',
    currentQuery: '',
    fileContent: null,
    lastPreview: null,
    searchTimeout: null,
    replaceKeybinding: 'ctrl+shift+r',
    maxResultsCap: 10000,
    options: {
      matchCase: false,
      wholeWord: false,
      useRegex: false,
      fileMask: ''
    }
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

  // DOM Elements
  const queryInput = document.getElementById('query');
  const replaceRow = document.getElementById('replace-row');
  const replaceInput = document.getElementById('replace-input');
  const replaceBtn = document.getElementById('replace-btn');
  const replaceAllBtn = document.getElementById('replace-all-btn');
  const closeSearchBtn = document.getElementById('close-search');
  const toggleReplaceBtn = document.getElementById('toggle-replace');
  const resultsList = document.getElementById('results-list');
  const resultsCount = document.getElementById('results-count');
  const previewContent = document.getElementById('preview-content');
  const previewFilename = document.getElementById('preview-filename');
  const scopeTabs = document.querySelectorAll('.scope-tab');
  const directoryInputWrapper = document.getElementById('directory-input-wrapper');
  const moduleInputWrapper = document.getElementById('module-input-wrapper');
  const directoryInput = document.getElementById('directory-input');
  const moduleSelect = document.getElementById('module-select');
  const matchCaseToggle = document.getElementById('match-case');
  const wholeWordToggle = document.getElementById('whole-word');
  const useRegexToggle = document.getElementById('use-regex');
  const fileMaskInput = document.getElementById('file-mask');
  const fileMaskBtn = document.getElementById('file-mask-btn');
  const fileMaskDropdown = document.getElementById('file-mask-dropdown');
  const fileMaskLabel = document.getElementById('file-mask-label');

  const scopeFileBtn = document.getElementById('scope-file');
  const fileInputWrapper = document.getElementById('file-input-wrapper');
  const fileInput = document.getElementById('file-input');
  const previewActions = document.getElementById('preview-actions');
  const replaceInFileBtn = document.getElementById('replace-in-file-btn');
  const fileEditor = document.getElementById('file-editor');
  const editorContainer = document.getElementById('editor-container');
  const editorBackdrop = document.getElementById('editor-backdrop');
  const editorLineNumbers = document.getElementById('editor-line-numbers');

  const resultsPanel = document.getElementById('results-panel');
  const panelResizer = document.getElementById('panel-resizer');
  const previewPanel = document.getElementById('preview-panel');
  const mainContent = document.querySelector('.main-content');

  let VIRTUAL_ROW_HEIGHT = 46;
  const VIRTUAL_OVERSCAN = 8;
  let measuredRowHeight = 0;
  const virtualContent = document.createElement('div');
  virtualContent.id = 'results-virtual-content';
  virtualContent.style.position = 'relative';
  virtualContent.style.width = '100%';

  const resultsPlaceholder = document.createElement('div');
  resultsPlaceholder.className = 'empty-state';
  resultsPlaceholder.style.display = 'none';

  resultsList.innerHTML = '';
  resultsList.appendChild(virtualContent);
  resultsList.appendChild(resultsPlaceholder);
  
  const replaceWidget = document.getElementById('replace-widget');
  const localSearchInput = document.getElementById('local-search-input');
  const localReplaceInput = document.getElementById('local-replace-input');
  const localMatchCount = document.getElementById('local-match-count');
  const localReplaceBtn = document.getElementById('local-replace-btn');
  const localReplaceAllBtn = document.getElementById('local-replace-all-btn');
  const localReplaceClose = document.getElementById('local-replace-close');
  const localPrevBtn = document.getElementById('local-prev-btn');
  const localNextBtn = document.getElementById('local-next-btn');

  console.log('DOM Elements loaded:', {
    queryInput: !!queryInput,
    resultsList: !!resultsList,
    previewContent: !!previewContent
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
    return langMap[ext] || null;
  }

  var localMatches = [];
  var localMatchIndex = 0;
  var searchBoxFocusedOnStartup = false;

  requestAnimationFrame(() => {
    queryInput.focus();
    searchBoxFocusedOnStartup = true;
  });

  vscode.postMessage({ type: 'webviewReady' });
  vscode.postMessage({ type: 'getModules' });
  vscode.postMessage({ type: 'getCurrentDirectory' });

  function toggleReplace() {
    const isVisible = replaceRow.classList.toggle('visible');
    toggleReplaceBtn.classList.toggle('active', isVisible);
    if (isVisible) {
      if (queryInput.value.trim()) {
        replaceInput.focus();
      } else {
        queryInput.focus();
      }
    } else {
      queryInput.focus();
    }
  }

  toggleReplaceBtn.addEventListener('click', toggleReplace);

  closeSearchBtn.addEventListener('click', () => {
    queryInput.value = '';
    state.results = [];
    state.activeIndex = -1;
    handleSearchResults([], { skipAutoLoad: true });
    
    vscode.postMessage({ type: 'clearState' });
    
    vscode.postMessage({ type: 'minimize', state: {} });
  });

  fileMaskBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileMaskDropdown.classList.toggle('visible');
    if (fileMaskDropdown.classList.contains('visible')) {
      fileMaskInput.focus();
    }
  });

  document.addEventListener('click', (e) => {
    if (!fileMaskDropdown.contains(e.target) && e.target !== fileMaskBtn) {
      fileMaskDropdown.classList.remove('visible');
    }
  });

  function updateFileMaskLabel() {
    const value = fileMaskInput.value.trim();
    if (value) {
      fileMaskLabel.textContent = value;
      fileMaskBtn.classList.add('has-value');
    } else {
      fileMaskLabel.textContent = 'File mask';
      fileMaskBtn.classList.remove('has-value');
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && e.code === 'KeyF') {
      e.preventDefault();
      toggleReplace();
    }
  });

  replaceBtn.addEventListener('click', replaceOne);
  replaceAllBtn.addEventListener('click', replaceAll);
  
  replaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (e.metaKey || e.ctrlKey) {
        replaceAll();
      } else {
        replaceOne();
      }
    }
  });

  function triggerReplaceInFile() {
    if (!state.fileContent) return;
    
    if (!isEditMode) {
      enterEditMode();
    }
    
    localSearchInput.value = state.currentQuery || '';
    localReplaceInput.value = '';
    
    replaceWidget.classList.add('visible');
    localSearchInput.focus();
    localSearchInput.select();
    
    updateLocalMatches();
  }

  replaceInFileBtn.addEventListener('click', triggerReplaceInFile);
  
  localReplaceClose.addEventListener('click', () => {
    replaceWidget.classList.remove('visible');
    localMatches = [];
    localMatchIndex = 0;
    updateHighlights();
    if (isEditMode) {
      fileEditor.focus();
    }
  });

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
      replaceWidget.classList.remove('visible');
      localMatches = [];
      updateHighlights();
      if (isEditMode) {
        fileEditor.focus();
      }
    }
  });

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
      replaceWidget.classList.remove('visible');
      localMatches = [];
      updateHighlights();
      if (isEditMode) {
        fileEditor.focus();
      }
    }
  });

  localReplaceBtn.addEventListener('click', triggerLocalReplace);
  localReplaceAllBtn.addEventListener('click', triggerLocalReplaceAll);
  localPrevBtn.addEventListener('click', () => navigateLocalMatch(-1));
  localNextBtn.addEventListener('click', () => navigateLocalMatch(1));

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
    
    var match = localMatches[localMatchIndex];
    var content = fileEditor.value;
    var newContent = content.substring(0, match.start) + localReplaceInput.value + content.substring(match.end);
    
    fileEditor.value = newContent;
    state.fileContent.content = newContent;
    
    saveFile();
    
    updateLocalMatches();
    updateHighlights();
    
    if (localMatches.length > 0) {
      if (localMatchIndex >= localMatches.length) {
        localMatchIndex = 0;
      }
      localMatchCount.textContent = (localMatchIndex + 1) + ' of ' + localMatches.length;
    }
  }

  function triggerLocalReplaceAll() {
    if (localMatches.length === 0) return;
    
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
      
      localMatchCount.textContent = 'Replaced ' + count;
    } catch (e) {
    }
  }

  let isEditMode = false;
  let saveTimeout = null;

  previewContent.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    
    enterEditMode();
  });

  function enterEditMode() {
    if (!state.fileContent || isEditMode) return;
    
    const scrollTop = previewContent.scrollTop;
    
    isEditMode = true;
    editorContainer.classList.add('visible');
    fileEditor.value = state.fileContent.content;
    updateHighlights();
    
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fileEditor.scrollTop = scrollTop;
        if (editorBackdrop) editorBackdrop.scrollTop = scrollTop;
        if (editorLineNumbers) editorLineNumbers.scrollTop = scrollTop;
        
        fileEditor.focus({ preventScroll: true });
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

  function exitEditMode() {
    if (!isEditMode) return;
    
    saveFile();
    
    isEditMode = false;
    editorContainer.classList.remove('visible');
    
    renderFilePreview(state.fileContent);
  }

  fileEditor.addEventListener('input', () => {
    updateHighlights();
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      saveFile();
    }, 1000);
  });

  fileEditor.addEventListener('blur', (e) => {
    if (e.relatedTarget && (replaceWidget.contains(e.relatedTarget) || e.relatedTarget === replaceWidget)) {
      return;
    }
    
    if (saveTimeout) clearTimeout(saveTimeout);
    exitEditMode();
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
    if (state.activeIndex < 0 || state.activeIndex >= state.results.length) return;
    const result = state.results[state.activeIndex];
    const replaceText = replaceInput.value;
    const replacedUri = result.uri;
    
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

    resultsCount.textContent = state.results.length + ' results';
    
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
      if (state.activeIndex >= 0) {
        loadFileContent(state.results[state.activeIndex]);
      }
    }
    
    setTimeout(runSearch, 200);
  }

  function replaceAll() {
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
    
    if (queryInput.value.trim().length === 0) {
      previewContent.innerHTML = '<div class="empty-state">No results</div>';
      previewFilename.textContent = '';
      showPlaceholder('Type to search...');
      resultsCount.textContent = '';
      state.results = [];
      state.activeIndex = -1;
      state.currentQuery = '';
      state.fileContent = null;
      state.lastPreview = null;
      
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

  matchCaseToggle.addEventListener('click', () => {
    state.options.matchCase = !state.options.matchCase;
    matchCaseToggle.classList.toggle('active', state.options.matchCase);
    runSearch();
  });

  wholeWordToggle.addEventListener('click', () => {
    state.options.wholeWord = !state.options.wholeWord;
    wholeWordToggle.classList.toggle('active', state.options.wholeWord);
    runSearch();
  });

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

  fileMaskInput.addEventListener('input', () => {
    clearTimeout(state.searchTimeout);
    
    updateFileMaskLabel();
    
    clearTimeout(validationDebounceTimeout);
    validationDebounceTimeout = setTimeout(() => {
      validateFileMaskPattern();
    }, 150);

    state.searchTimeout = setTimeout(() => {
      state.options.fileMask = fileMaskInput.value;
      runSearch();
    }, 300);
  });

  let isResizing = false;
  let startY = 0;
  let startHeight = 0;
  const MIN_PANEL_HEIGHT = 80;
  const RESIZER_HEIGHT = 4;

  const savedWebviewState = vscode.getState();
  if (savedWebviewState && savedWebviewState.resultsPanelHeight) {
    resultsPanel.style.height = savedWebviewState.resultsPanelHeight + 'px';
  }

  panelResizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    startY = e.clientY;
    startHeight = resultsPanel.offsetHeight;
    panelResizer.classList.add('dragging');
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    
    const containerHeight = mainContent.offsetHeight - RESIZER_HEIGHT;
    const deltaY = e.clientY - startY;
    let newHeight = startHeight + deltaY;
    
    newHeight = Math.max(MIN_PANEL_HEIGHT, newHeight);
    newHeight = Math.min(containerHeight - MIN_PANEL_HEIGHT, newHeight);
    
    resultsPanel.style.height = newHeight + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    panelResizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    
    const currentState = vscode.getState() || {};
    vscode.setState({
      ...currentState,
      resultsPanelHeight: resultsPanel.offsetHeight
    });
    
    scheduleVirtualRender();
  });

  scopeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      scopeTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.currentScope = tab.dataset.scope;
      updateScopeInputs();
      runSearch();
    });
  });

  directoryInput.addEventListener('input', () => {
    clearTimeout(state.searchTimeout);
    state.searchTimeout = setTimeout(() => {
      runSearch();
    }, 500);
  });

  moduleSelect.addEventListener('change', runSearch);

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
      } else {
        queryInput.focus();
        queryInput.select();
      }
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
      case 'fileContent':
        handleFileContent(message);
        break;
      case 'showReplace':
        if (!replaceRow.classList.contains('visible')) {
          toggleReplace();
        } else {
          if (queryInput.value.trim()) {
            replaceInput.focus();
            replaceInput.select();
          } else {
            queryInput.focus();
            queryInput.select();
          }
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
          
          vscode.postMessage({
            type: 'validationResult',
            field: 'regex',
            isValid: message.isValid,
            error: message.error
          });
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
          
          vscode.postMessage({
            type: 'validationResult',
            field: 'fileMask',
            isValid: message.isValid,
            message: message.message,
            fallbackToAll: message.fallbackToAll
          });
        }
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
          updateFileMaskLabel();
          
          scopeTabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.scope === state.currentScope);
          });
          if (state.currentScope === 'file') {
            scopeFileBtn.style.display = 'block';
          }
          updateScopeInputs();
          
          if (s.showReplace && !replaceRow.classList.contains('visible')) {
            toggleReplace();
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
            showReplace: replaceRow.classList.contains('visible')
          }
        });
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
    }
  });

  function updateScopeInputs() {
    directoryInputWrapper.classList.remove('visible');
    moduleInputWrapper.classList.remove('visible');
    fileInputWrapper.classList.remove('visible');
    
    if (state.currentScope === 'directory') {
      directoryInputWrapper.classList.add('visible');
    } else if (state.currentScope === 'module') {
      moduleInputWrapper.classList.add('visible');
    } else if (state.currentScope === 'file') {
      fileInputWrapper.classList.add('visible');
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

  let virtualRenderPending = false;

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
      const query = queryInput.value.trim();
      state.currentQuery = query;
      
      console.log('runSearch called, query:', query, 'length:', query.length);
      
      if (query.length < 2) {
        showPlaceholder('Type at least 2 characters...');
        resultsCount.textContent = '';
        return;
      }

      if (state.options.useRegex) {
        try {
          new RegExp(query);
        } catch (e) {
          showPlaceholder('Invalid regex pattern');
          resultsCount.textContent = '';
          return;
        }
      }

      showPlaceholder('Searching...');
      resultsCount.textContent = '';

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

    resultsCount.textContent = results.length + (state.maxResultsCap && results.length >= state.maxResultsCap ? '+' : '') + ' results';

    vscode.postMessage({ type: '__test_searchCompleted', results: results });

    if (results.length === 0) {
      showPlaceholder('No results found');
      previewContent.innerHTML = '<div class="empty-state">No results</div>';
      previewFilename.textContent = '';
      return;
    }

    hidePlaceholder();
    renderResultsVirtualized();
    
    if (!options.skipAutoLoad && state.activeIndex >= 0) {
      loadFileContent(state.results[state.activeIndex]);
    }
  }

  function renderResultsVirtualized() {
    if (state.results.length === 0) return;

    const total = state.results.length;
    const viewportHeight = resultsList.clientHeight || 1;
    const scrollTop = resultsList.scrollTop;
    const start = Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN);
    const end = Math.min(total, Math.ceil((scrollTop + viewportHeight) / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN);

    virtualContent.style.height = (total * VIRTUAL_ROW_HEIGHT) + 'px';

    const fragment = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      fragment.appendChild(renderResultRow(state.results[i], i));
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

  function renderResultRow(result, index) {
    const isActive = index === state.activeIndex;
    const item = document.createElement('div');
    item.className = 'result-item' + (isActive ? ' active' : '');
    item.dataset.index = String(index);
    item.style.position = 'absolute';
    item.style.top = (index * VIRTUAL_ROW_HEIGHT) + 'px';
    item.style.left = '0';
    item.style.right = '0';

    const previewHtml = highlightMatchSafe(
      result.preview,
      result.previewMatchRange.start,
      result.previewMatchRange.end
    );

    const fullPath = result.relativePath || result.fileName;
    item.innerHTML = '<div class="result-header">' +
        '<div class="result-file" title="' + escapeAttr(fullPath) + '">' +
          '<span class="result-filename">' + escapeHtml(fullPath) + '</span>' +
          '<span class="result-location">:' + (result.line + 1) + '</span>' +
        '</div>' +
        '<button class="open-in-editor-btn" data-index="' + index + '" title="Open in Editor (Ctrl+Enter)">' +
          '&nearr;' +
        '</button>' +
      '</div>' +
      '<div class="result-preview">' + previewHtml + '</div>';

    item.addEventListener('click', (e) => {
      const target = e.target;
      if (target && target.classList && target.classList.contains('open-in-editor-btn')) return;
      const idx = parseInt(item.dataset.index, 10);
      setActiveIndex(idx);
    });

    item.addEventListener('dblclick', (e) => {
      const target = e.target;
      if (target && target.classList && target.classList.contains('open-in-editor-btn')) return;
      openActiveResult();
    });

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const idx = parseInt(item.dataset.index, 10);
      showContextMenu(e, idx);
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

  function ensureActiveVisible() {
    if (state.activeIndex < 0) return;
    const top = state.activeIndex * VIRTUAL_ROW_HEIGHT;
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

  function handleFileContent(message) {
    state.fileContent = message;
    state.lastPreview = message;
    previewFilename.textContent = message.fileName;
    
    previewActions.style.display = 'flex';
    
    if (isEditMode) {
      fileEditor.value = message.content;
      updateLocalMatches();
      updateHighlights();
    } else {
      renderFilePreview(message);
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
          copyToClipboard(result.relativePath || result.fileName);
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
    const lines = fileData.content.split('\n');
    const currentResult = state.results[state.activeIndex];
    const currentLine = currentResult ? currentResult.line : -1;

    const language = getLanguageFromFilename(fileData.fileName);
    
    let highlightedContent = '';
    if (typeof hljs !== 'undefined' && language) {
      try {
        highlightedContent = hljs.highlight(fileData.content, { language: language }).value;
      } catch (e) {
        highlightedContent = escapeHtml(fileData.content);
      }
    } else {
      highlightedContent = escapeHtml(fileData.content);
    }
    
    const highlightedLines = highlightedContent.split('\n');

    let html = '';
    lines.forEach((line, idx) => {
      const lineMatches = fileData.matches.filter(m => m.line === idx);
      const hasMatch = lineMatches.length > 0;
      const isCurrentLine = idx === currentLine;

      let lineClass = 'code-line';
      if (isCurrentLine) lineClass += ' current-match';
      else if (hasMatch) lineClass += ' has-match';

      let lineContent = highlightedLines[idx] || escapeHtml(line) || ' ';
      
      if (hasMatch && !lineContent.includes('class="match"')) {
      }

      html += '<div class="' + lineClass + '" data-line="' + idx + '">' +
        '<span class="line-number">' + (idx + 1) + '</span>' +
        '<span class="line-content">' + lineContent + '</span>' +
      '</div>';
    });

    previewContent.innerHTML = html;

    if (currentLine >= 0) {
      const currentLineEl = previewContent.querySelector('[data-line="' + currentLine + '"]');
      if (currentLineEl) {
        currentLineEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }

    previewContent.querySelectorAll('.code-line').forEach(lineEl => {
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

  function highlightMatchSafe(rawText, start, end) {
    if (start < 0 || end <= start || start >= rawText.length) return escapeHtml(rawText);
    end = Math.min(end, rawText.length);
    const before = escapeHtml(rawText.substring(0, start));
    const match = escapeHtml(rawText.substring(start, end));
    const after = escapeHtml(rawText.substring(end));
    return before + '<span class="match">' + match + '</span>' + after;
  }
})();
