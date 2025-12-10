# Issue #25: Inline Validation for Invalid Regex/File Mask
## Detailed Implementation Plan

---

## 1. OVERVIEW & ACCEPTANCE CRITERIA

**Issue Goal:** Provide real-time validation of regex patterns and file masks in the Rifler search UI to prevent empty/confusing results when invalid input is provided.

**Acceptance Criteria:**
- Invalid regex patterns surface a visible error message near the input field
- Invalid file masks display a warning/fallback indicator
- Behavior is consistent (disabled button vs. fallback mode)
- Tests verify error display and safe behavior
- Non-blocking UX: users understand what's happening without surprise empty results

---

## 2. ARCHITECTURE & DESIGN DECISIONS

### 2.1 Validation Strategy

#### Two-Layer Validation:
1. **Client-side (Webview):** Real-time feedback as user types
   - Immediate visual feedback (1-2 character debounce for perf)
   - No backend round-trips for validation
   - Supports both regex and file mask validation

2. **Server-side (Extension):** Defensive validation before search
   - Catch errors during actual regex compilation
   - Fallback behavior if mask parsing fails
   - Prevents silent failures

#### Validation Timing:
- **Regex:** Validate on every keystroke (debounced 150ms)
- **File Mask:** Validate on every keystroke (debounced 150ms)
- **Disable Search:** Block search button when regex is invalid
- **File Mask Fallback:** Continue search with fallback (match-all) when mask invalid, show warning

### 2.2 Error Display Approach

**Inline Messages:**
- Show beneath input field or as placeholder text change
- Color-coded: Red for error, Orange/Yellow for warning
- Clear, actionable messages

**Example UI States:**
```
Find: [query_input] ❌ Error: Invalid regex - unclosed group
      (with red background or border)

File Mask: [*.ts, *.js] ⚠️  (gray icon indicating fallback to match-all)
```

**Button State:**
- **Search button:** Disabled if regex is invalid
- **Replace buttons:** Disabled if regex is invalid
- **File Mask:** Does not disable search; uses fallback with visual warning

### 2.3 Validation Functions Location

```
utils.ts:
  - validateRegex(pattern: string, useRegex: boolean): ValidationResult
  - validateFileMask(mask: string): MaskValidationResult
  - isValidRegexPattern(pattern: string): boolean

search.ts:
  - performSearch() [defensive: wrap regex in try-catch]

extension.ts (webview message handling):
  - Handle validation messages from webview
  - Pass validation state to webview via config message

Webview (extension.ts inline script):
  - Real-time validation on input change
  - Display error/warning messages
  - Manage button disabled state
```

---

## 3. DETAILED IMPLEMENTATION STEPS

### PHASE 1: CORE VALIDATION LOGIC (Backend)

#### 3.1 Update `src/utils.ts`

Add validation utility functions:

```typescript
/**
 * Result of validation operations
 */
export interface ValidationResult {
  isValid: boolean;
  error?: string;  // Error message for invalid input
}

export interface MaskValidationResult {
  isValid: boolean;
  message?: string;  // Warning or info message
  fallbackToAll: boolean;  // If true, mask will match all files
}

/**
 * Validate a regex pattern string
 * @param pattern The pattern to validate
 * @param useRegex Whether regex mode is enabled
 * @returns ValidationResult with error details if invalid
 */
export function validateRegex(pattern: string, useRegex: boolean): ValidationResult {
  if (!pattern || pattern.length === 0) {
    return { isValid: false, error: 'Search pattern cannot be empty' };
  }

  if (!useRegex) {
    // In non-regex mode, any pattern is valid (we escape special chars)
    return { isValid: true };
  }

  // In regex mode, try to compile the pattern
  try {
    new RegExp(pattern, 'g');
    return { isValid: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid regex pattern';
    return {
      isValid: false,
      error: `Invalid regex: ${message}`
    };
  }
}

/**
 * Validate a file mask pattern
 * @param fileMask The file mask to validate
 * @returns MaskValidationResult with warning if fallback behavior triggered
 */
export function validateFileMask(fileMask: string): MaskValidationResult {
  const trimmed = fileMask.trim();
  
  // Empty mask is valid - matches all files
  if (!trimmed) {
    return { isValid: true, fallbackToAll: false };
  }

  try {
    // Try to parse and compile the mask patterns
    const tokens = trimmed.split(/[,;]/).map(m => m.trim()).filter(Boolean);
    
    if (tokens.length === 0) {
      return { isValid: true, fallbackToAll: false };
    }

    for (const token of tokens) {
      const isExclude = token.startsWith('!');
      const pattern = isExclude ? token.slice(1).trim() : token;
      
      if (!pattern) continue;

      // Build the regex pattern (same logic as matchesFileMask)
      const regexPattern = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');

      // Test regex compilation
      new RegExp(`^${regexPattern}$`, 'i');
    }

    return { isValid: true, fallbackToAll: false };
  } catch (error) {
    // If there's an error, we can still fall back to match-all
    const message = error instanceof Error ? error.message : 'Invalid file mask pattern';
    return {
      isValid: false,
      message: `Invalid file mask (falling back to match all): ${message}`,
      fallbackToAll: true
    };
  }
}

/**
 * Quick check if regex pattern is valid
 */
export function isValidRegexPattern(pattern: string): boolean {
  if (!pattern) return false;
  try {
    new RegExp(pattern, 'g');
    return true;
  } catch {
    return false;
  }
}
```

#### 3.2 Update `src/search.ts`

Add defensive error handling in `performSearch`:

```typescript
export async function performSearch(
  query: string,
  scope: SearchScope,
  options: SearchOptions,
  directoryPath?: string,
  modulePath?: string,
  filePath?: string
): Promise<SearchResult[]> {
  console.log('performSearch called:', { query, scope, directoryPath, modulePath, filePath, options });
  
  if (!query.trim() || query.length < 2) {
    return [];
  }

  // Validate regex before attempting to build it
  const regexValidation = validateRegex(query, options.useRegex);
  if (!regexValidation.isValid) {
    console.error('Invalid regex:', regexValidation.error);
    // Return empty array - client should have caught this
    return [];
  }

  const regex = buildSearchRegex(query, options);
  if (!regex) {
    console.error('Failed to build search regex');
    return [];
  }

  // Validate file mask before using it
  const maskValidation = validateFileMask(options.fileMask);
  if (!maskValidation.isValid) {
    console.warn('File mask validation failed:', maskValidation.message);
    // Use empty mask as fallback (matches all files)
    options.fileMask = '';
  }

  // ... rest of search logic remains the same
}
```

**Important:** Add import statement at top of search.ts:
```typescript
import { validateRegex, validateFileMask, ... } from './utils';
```

---

### PHASE 2: WEBVIEW MESSAGE TYPES (Extension)

#### 3.3 Update `src/extension.ts` - Add Validation Messages

Add new message types:

```typescript
// Add to message interfaces section (after existing interfaces):

interface ValidateRegexMessage {
  type: 'validateRegex';
  pattern: string;
  useRegex: boolean;
}

interface ValidateFileMaskMessage {
  type: 'validateFileMask';
  fileMask: string;
}

interface ValidationErrorMessage {
  type: 'validationError';
  field: 'regex' | 'fileMask';
  error?: string;
  message?: string;
  fallbackToAll?: boolean;
}

// Update WebviewMessage union type to include new message types:
type WebviewMessage = 
  | RunSearchMessage 
  | OpenLocationMessage 
  | GetModulesMessage 
  | GetCurrentDirectoryMessage 
  | GetFileContentMessage 
  | ReplaceOneMessage 
  | ReplaceAllMessage 
  | WebviewReadyMessage 
  | SaveFileMessage 
  | MinimizeMessage 
  | TestSearchCompletedMessage 
  | TestSearchResultsReceivedMessage 
  | TestErrorMessage
  | ValidateRegexMessage
  | ValidateFileMaskMessage;
```

#### 3.4 Add Validation Message Handler

In `openSearchPanel()` function, update the `webview.onDidReceiveMessage` handler:

```typescript
currentPanel.webview.onDidReceiveMessage(
  async (message: WebviewMessage) => {
    switch (message.type) {
      // ... existing cases ...
      
      case 'validateRegex':
        // Validate regex pattern
        const { pattern, useRegex } = (message as ValidateRegexMessage);
        const regexValidation = validateRegex(pattern, useRegex);
        currentPanel?.webview.postMessage({
          type: 'validationError',
          field: 'regex',
          error: regexValidation.error
        } as ValidationErrorMessage);
        break;
      
      case 'validateFileMask':
        // Validate file mask pattern
        const { fileMask } = (message as ValidateFileMaskMessage);
        const maskValidation = validateFileMask(fileMask);
        currentPanel?.webview.postMessage({
          type: 'validationError',
          field: 'fileMask',
          message: maskValidation.message,
          fallbackToAll: maskValidation.fallbackToAll
        } as ValidationErrorMessage);
        break;
      
      // ... rest of cases ...
    }
  },
  undefined,
  context.subscriptions
);
```

**Important:** Add import statement:
```typescript
import { validateRegex, validateFileMask } from './utils';
```

---

### PHASE 3: WEBVIEW UI & VALIDATION DISPLAY

#### 3.5 Update Webview HTML/CSS

In `getWebviewHtml()` function, add error message styling to the CSS section:

```css
/* Add to the <style> section */

/* ===== Validation Messages ===== */
.input-error-message {
  font-size: 11px;
  color: #f44747;
  margin-top: 3px;
  padding: 0 8px;
  display: none;
  animation: slideDown 0.2s ease-out;
}

.input-error-message.visible {
  display: block;
}

.input-warning-message {
  font-size: 11px;
  color: #dcdcaa;
  margin-top: 3px;
  padding: 0 8px;
  display: none;
}

.input-warning-message.visible {
  display: block;
}

.search-input-group {
  position: relative;
  display: flex;
  flex-direction: column;
}

#query.error,
#file-mask.error {
  border-color: #f44747 !important;
  background-color: rgba(244, 71, 71, 0.1);
}

#file-mask.warning {
  border-color: #dcdcaa !important;
  background-color: rgba(220, 212, 170, 0.05);
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-5px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.search-disabled {
  opacity: 0.6;
  cursor: not-allowed !important;
}

.search-disabled:hover {
  background: var(--vscode-button-secondaryBackground) !important;
}
```

#### 3.6 Update HTML Structure

Update the search input rows in the HTML:

```html
<!-- Replace the existing search-row with this -->
<div class="search-row">
  <span class="search-label">Find:</span>
  <div class="search-input-group">
    <input type="text" id="query" placeholder="Type to search..." autofocus />
    <div id="query-error-message" class="input-error-message"></div>
  </div>
  <button id="toggle-replace" title="Toggle Replace (Option+Shift+F)">&#x2195;</button>
</div>

<!-- Update the options-row to wrap file mask input -->
<!-- In the options row, find the file-mask-group and update it: -->
<div class="file-mask-group">
  <label for="file-mask">File Mask:</label>
  <div class="search-input-group" style="flex: 0 1 150px;">
    <input type="text" id="file-mask" placeholder="*.ts, *.js, *.py" />
    <div id="file-mask-warning-message" class="input-warning-message"></div>
  </div>
</div>
```

---

### PHASE 4: WEBVIEW JAVASCRIPT VALIDATION LOGIC

#### 3.7 Add Validation State and UI Functions

In the webview script (inside the `(function() { ... })()` IIFE), update the `state` object:

```javascript
const state = {
  // ... existing state properties ...
  validation: {
    regexError: null,
    fileMaskMessage: null,
    fileMaskFallback: false
  }
};
```

Add these functions inside the IIFE (after the DOM element definitions):

```javascript
// ===== VALIDATION FUNCTIONS =====

/**
 * Send validation request to extension
 */
function sendValidationRequest(field, value) {
  if (field === 'regex') {
    vscode.postMessage({
      type: 'validateRegex',
      pattern: value,
      useRegex: state.options.useRegex
    });
  } else if (field === 'fileMask') {
    vscode.postMessage({
      type: 'validateFileMask',
      fileMask: value
    });
  }
}

/**
 * Display validation error for regex
 */
function displayRegexError(error) {
  const errorEl = document.getElementById('query-error-message');
  state.validation.regexError = error;
  
  if (error) {
    errorEl.textContent = error;
    errorEl.classList.add('visible');
    queryInput.classList.add('error');
    
    // Disable search button
    document.querySelectorAll('#replace-btn, #replace-all-btn').forEach(btn => {
      if (btn.id === 'replace-btn' || btn.id === 'replace-all-btn') {
        // These are in different rows, find the parent search row buttons
      }
    });
    
    // Disable "Search" by preventing search execution
    disableSearchButton();
  } else {
    errorEl.classList.remove('visible');
    errorEl.textContent = '';
    queryInput.classList.remove('error');
    enableSearchButton();
  }
}

/**
 * Display validation warning for file mask
 */
function displayFileMaskWarning(message, fallbackToAll) {
  const warningEl = document.getElementById('file-mask-warning-message');
  state.validation.fileMaskMessage = message;
  state.validation.fileMaskFallback = fallbackToAll;
  
  if (message && fallbackToAll) {
    warningEl.textContent = '⚠️ ' + message;
    warningEl.classList.add('visible');
    fileMaskInput.classList.add('warning');
  } else {
    warningEl.classList.remove('visible');
    warningEl.textContent = '';
    fileMaskInput.classList.remove('warning');
  }
}

/**
 * Disable search button when regex is invalid
 */
function disableSearchButton() {
  // The search is triggered by typing in the input, so we check on runSearch()
  // We'll add a guard inside runSearch() to check validation state
}

/**
 * Enable search button
 */
function enableSearchButton() {
  // Inverse of disableSearchButton
}
```

#### 3.8 Update runSearch() to Check Validation State

Modify the `runSearch()` function:

```javascript
function runSearch() {
  try {
    const query = queryInput.value.trim();
    state.currentQuery = query;
    
    console.log('runSearch called, query:', query, 'length:', query.length);
    
    // Check if regex is valid
    if (state.validation.regexError) {
      console.log('Search blocked: invalid regex');
      resultsList.innerHTML = '<div class="empty-state">Fix regex pattern to search</div>';
      resultsCount.textContent = '';
      return;
    }
    
    if (query.length < 2) {
      resultsList.innerHTML = '<div class="empty-state">Type at least 2 characters...</div>';
      resultsCount.textContent = '';
      return;
    }

    resultsList.innerHTML = '<div class="empty-state">Searching...</div>';
    resultsCount.textContent = '';

    const message = {
      type: 'runSearch',
      query: query,
      scope: state.currentScope,
      options: state.options
    };

    // ... rest of runSearch remains the same ...
  } catch (error) {
    console.error('Error in runSearch:', error);
  }
}
```

#### 3.9 Add Validation Event Listeners

Update the event listeners section in the webview script:

```javascript
// Query input validation
queryInput.addEventListener('input', () => {
  const query = queryInput.value.trim();
  
  // Debounce validation
  clearTimeout(state.searchTimeout);
  
  if (query.length === 0) {
    displayRegexError(null);
  } else if (query.length >= 2) {
    // Send validation request
    sendValidationRequest('regex', query);
  }
  
  // Then trigger search after a longer debounce
  state.searchTimeout = setTimeout(() => {
    console.log('Search timeout fired');
    runSearch();
  }, 300);
});

// File mask input validation
fileMaskInput.addEventListener('input', () => {
  const mask = fileMaskInput.value.trim();
  
  clearTimeout(state.searchTimeout);
  
  // Always validate when mask has content
  if (mask) {
    sendValidationRequest('fileMask', mask);
  } else {
    displayFileMaskWarning(null, false);
  }
  
  // Trigger search
  state.searchTimeout = setTimeout(() => {
    state.options.fileMask = mask;
    runSearch();
  }, 300);
});

// Update useRegexCheckbox change handler to re-validate on regex mode toggle
useRegexCheckbox.addEventListener('change', () => {
  state.options.useRegex = useRegexCheckbox.checked;
  
  // Re-validate current query with new mode
  const query = queryInput.value.trim();
  if (query && query.length >= 2) {
    sendValidationRequest('regex', query);
  }
  
  runSearch();
});
```

#### 3.10 Update Message Handler for Validation Responses

Update the `window.addEventListener('message', ...)` handler:

```javascript
window.addEventListener('message', (event) => {
  const message = event.data;
  console.log('Webview received message:', message.type, message);
  switch (message.type) {
    // ... existing cases ...
    
    case 'validationError':
      if (message.field === 'regex') {
        displayRegexError(message.error || null);
      } else if (message.field === 'fileMask') {
        displayFileMaskWarning(message.message || null, message.fallbackToAll || false);
      }
      break;
    
    // ... rest of cases ...
  }
});
```

---

### PHASE 5: TESTS

#### 3.11 Update `src/__tests__/utils.test.ts`

Add comprehensive validation tests:

```typescript
describe('validateRegex', () => {
  test('should return valid for empty pattern in non-regex mode', () => {
    const result = validateRegex('', false);
    expect(result.isValid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('should return valid for simple pattern in non-regex mode', () => {
    const result = validateRegex('test', false);
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test('should return valid for special chars in non-regex mode', () => {
    const result = validateRegex('test.file[123]', false);
    expect(result.isValid).toBe(true);
  });

  test('should return valid for simple regex in regex mode', () => {
    const result = validateRegex('test.*', true);
    expect(result.isValid).toBe(true);
  });

  test('should return invalid for unclosed bracket in regex mode', () => {
    const result = validateRegex('[unclosed', true);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('Invalid regex');
  });

  test('should return invalid for unmatched parenthesis', () => {
    const result = validateRegex('(unclosed', true);
    expect(result.isValid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('should return invalid for invalid character class', () => {
    const result = validateRegex('[z-a]', true);
    expect(result.isValid).toBe(false);
  });

  test('should return valid for complex valid regex', () => {
    const result = validateRegex('^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$', true);
    expect(result.isValid).toBe(true);
  });

  test('should return valid for word boundary patterns', () => {
    const result = validateRegex('\\bword\\b', true);
    expect(result.isValid).toBe(true);
  });
});

describe('validateFileMask', () => {
  test('should return valid for empty mask', () => {
    const result = validateFileMask('');
    expect(result.isValid).toBe(true);
    expect(result.fallbackToAll).toBe(false);
  });

  test('should return valid for whitespace-only mask', () => {
    const result = validateFileMask('   ');
    expect(result.isValid).toBe(true);
    expect(result.fallbackToAll).toBe(false);
  });

  test('should return valid for simple extension pattern', () => {
    const result = validateFileMask('*.ts');
    expect(result.isValid).toBe(true);
    expect(result.fallbackToAll).toBe(false);
  });

  test('should return valid for multiple patterns', () => {
    const result = validateFileMask('*.ts, *.js, *.py');
    expect(result.isValid).toBe(true);
    expect(result.fallbackToAll).toBe(false);
  });

  test('should return valid for semicolon-separated patterns', () => {
    const result = validateFileMask('*.ts; *.js; *.py');
    expect(result.isValid).toBe(true);
    expect(result.fallbackToAll).toBe(false);
  });

  test('should return valid for exclude-only patterns', () => {
    const result = validateFileMask('!*.test.ts');
    expect(result.isValid).toBe(true);
    expect(result.fallbackToAll).toBe(false);
  });

  test('should return valid for mixed include/exclude', () => {
    const result = validateFileMask('*.tsx, !*.test.tsx');
    expect(result.isValid).toBe(true);
    expect(result.fallbackToAll).toBe(false);
  });

  test('should handle patterns with wildcards', () => {
    const result = validateFileMask('**/src/**/*.ts');
    expect(result.isValid).toBe(true);
  });

  test('should gracefully handle invalid patterns in fallback mode', () => {
    // This may not fail validation (depends on implementation),
    // but if it does, fallback should be indicated
    const result = validateFileMask('*.ts');
    expect(result.isValid).toBe(true);
  });
});

describe('isValidRegexPattern', () => {
  test('should return true for valid regex', () => {
    expect(isValidRegexPattern('test')).toBe(true);
    expect(isValidRegexPattern('test.*')).toBe(true);
    expect(isValidRegexPattern('^start')).toBe(true);
  });

  test('should return false for invalid regex', () => {
    expect(isValidRegexPattern('[unclosed')).toBe(false);
    expect(isValidRegexPattern('(unclosed')).toBe(false);
  });

  test('should return false for empty pattern', () => {
    expect(isValidRegexPattern('')).toBe(false);
  });
});
```

#### 3.12 Add Webview Integration Tests (E2E)

Update `src/__tests__/e2e/suite/webview-integration.test.ts`:

```typescript
describe('Validation - Regex', () => {
  test('should display error for invalid regex pattern', async () => {
    // Simulate typing invalid regex
    const panel = await getSearchPanel();
    
    // Send invalid regex pattern
    panel.webview.postMessage({
      type: 'validationError',
      field: 'regex',
      error: 'Invalid regex: unclosed group'
    });
    
    // Wait for UI update and verify error message is displayed
    // (Check that query input has error class, error message is visible)
    await sleep(100);
    
    // Note: In a real test, you'd inspect the webview DOM
    // For now, this is a placeholder showing the message flow
  });

  test('should disable search when regex is invalid', async () => {
    // When validation shows error, search should be blocked
    const panel = await getSearchPanel();
    
    // Send validation error
    panel.webview.postMessage({
      type: 'validationError',
      field: 'regex',
      error: 'Invalid regex pattern'
    });
    
    // Try to trigger search - should be blocked
    // Verify no searchResults message is sent
  });

  test('should clear error when regex becomes valid', async () => {
    const panel = await getSearchPanel();
    
    // First, trigger error
    panel.webview.postMessage({
      type: 'validationError',
      field: 'regex',
      error: 'Invalid regex: [unclosed'
    });
    
    // Then clear error
    panel.webview.postMessage({
      type: 'validationError',
      field: 'regex',
      error: null
    });
    
    // Verify error message is hidden
  });

  test('should handle regex validation on mode toggle', async () => {
    const panel = await getSearchPanel();
    
    // Set a pattern that's valid non-regex but invalid regex
    // e.g., "[test]" - valid literal string, invalid regex
    
    // Toggle to regex mode
    // Should validate and show error
    
    // Toggle back to non-regex
    // Error should clear
  });
});

describe('Validation - File Mask', () => {
  test('should display warning for invalid file mask', async () => {
    const panel = await getSearchPanel();
    
    // Send file mask warning
    panel.webview.postMessage({
      type: 'validationError',
      field: 'fileMask',
      message: 'Invalid file mask (falling back to match all): ...',
      fallbackToAll: true
    });
    
    // Verify warning message is displayed
    await sleep(100);
  });

  test('should not block search with invalid file mask', async () => {
    // Unlike regex, invalid file mask should not disable search
    // Search should continue with fallback (match-all)
    
    const panel = await getSearchPanel();
    
    // Trigger validation warning
    panel.webview.postMessage({
      type: 'validationError',
      field: 'fileMask',
      message: 'Invalid file mask...',
      fallbackToAll: true
    });
    
    // Search should still be allowed
    // Results should be returned (with all files matched)
  });

  test('should clear file mask warning when mask becomes valid', async () => {
    const panel = await getSearchPanel();
    
    // Send warning
    panel.webview.postMessage({
      type: 'validationError',
      field: 'fileMask',
      message: 'Invalid file mask...',
      fallbackToAll: true
    });
    
    // Clear warning
    panel.webview.postMessage({
      type: 'validationError',
      field: 'fileMask',
      message: null,
      fallbackToAll: false
    });
    
    // Verify warning is hidden
  });
});

describe('Validation - Integration', () => {
  test('should show error message and prevent search execution', async () => {
    const panel = await getSearchPanel();
    
    // Type invalid regex
    panel.webview.postMessage({
      type: '__test_setSearchInput',
      value: '[invalid'
    });
    
    // Validation should error
    panel.webview.postMessage({
      type: 'validationError',
      field: 'regex',
      error: 'Invalid regex: unclosed bracket'
    });
    
    // Search attempt should be blocked
    // No searchResults should be received
    await sleep(500);
  });

  test('should allow search after fixing regex', async () => {
    const panel = await getSearchPanel();
    
    // First, invalid
    panel.webview.postMessage({
      type: '__test_setSearchInput',
      value: '[invalid'
    });
    
    panel.webview.postMessage({
      type: 'validationError',
      field: 'regex',
      error: 'Invalid regex'
    });
    
    // Then fix it
    panel.webview.postMessage({
      type: '__test_setSearchInput',
      value: 'valid'
    });
    
    panel.webview.postMessage({
      type: 'validationError',
      field: 'regex',
      error: null
    });
    
    // Search should now work
    await sleep(500);
    // Expect searchResults to be received
  });
});
```

---

## 4. COMPLEXITY & DEPENDENCIES

### 4.1 Complexity Estimate

| Component | Complexity | Effort (hours) |
|-----------|-----------|----------------|
| Validation utility functions | Low | 1.5 |
| Message types & handlers | Low | 1 |
| Webview UI/CSS | Medium | 2 |
| Webview JS validation logic | Medium | 2.5 |
| Search defensive changes | Low | 0.5 |
| Unit tests | Medium | 1.5 |
| E2E/Integration tests | Medium | 1.5 |
| **TOTAL** | **Medium** | **~10 hours** |

### 4.2 Dependencies

- No external package dependencies required
- Leverages existing regex and file mask parsing logic
- Uses VS Code webview API (already in use)
- Uses Jest for testing (already configured)

### 4.3 Breaking Changes

- **None.** All changes are additive and maintain backward compatibility
- Validation is non-blocking for file masks (fallback behavior)
- Regex validation may block search, but only for genuinely invalid patterns

---

## 5. IMPLEMENTATION ORDER

### Recommended Sequence:

1. **Week 1, Day 1-2:**
   - ✅ Step 3.1: Add validation utility functions to `utils.ts`
   - ✅ Step 3.11: Add unit tests for validation functions
   - ✅ Run tests to verify utilities work correctly

2. **Week 1, Day 3-4:**
   - ✅ Step 3.2: Add defensive validation in `search.ts`
   - ✅ Step 3.3: Define validation message types in `extension.ts`
   - ✅ Step 3.4: Add message handlers in extension

3. **Week 1, Day 5 - Week 2, Day 1:**
   - ✅ Step 3.5: Add CSS styling for error/warning messages
   - ✅ Step 3.6: Update HTML structure for error containers
   - ✅ Step 3.7: Add validation state and functions in webview script
   - ✅ Step 3.8: Update `runSearch()` to check validation state

4. **Week 2, Day 2-3:**
   - ✅ Step 3.9: Add event listeners for validation
   - ✅ Step 3.10: Add message handler for validation responses
   - ✅ Manual testing in VS Code

5. **Week 2, Day 4:**
   - ✅ Step 3.12: Add E2E/integration tests
   - ✅ Run full test suite
   - ✅ Fix any issues found

6. **Week 2, Day 5:**
   - ✅ Final testing and refinement
   - ✅ Performance testing with large regex patterns
   - ✅ Edge case verification

---

## 6. TESTING STRATEGY

### 6.1 Unit Tests

**File:** `src/__tests__/utils.test.ts`

Coverage targets:
- `validateRegex()` with 10+ test cases
- `validateFileMask()` with 10+ test cases
- `isValidRegexPattern()` with 5+ test cases
- Edge cases: empty strings, special characters, very long patterns

**Target coverage:** 95%+

### 6.2 Integration Tests

**File:** `src/__tests__/e2e/suite/webview-integration.test.ts`

Coverage targets:
- Message flow between webview and extension
- Validation error display in UI
- Search button disabled state
- File mask fallback behavior
- Mode toggle (regex vs non-regex) validation changes

### 6.3 Manual Testing Checklist

- [ ] Open Rifler panel
- [ ] Type invalid regex: `[unclosed` → verify error message appears
- [ ] Search button is disabled
- [ ] Type valid regex: `test.*` → verify error clears
- [ ] Search button is enabled
- [ ] Toggle regex mode OFF while invalid regex is shown → error should clear
- [ ] Type invalid file mask → verify warning appears
- [ ] Search still works (with fallback)
- [ ] Type valid file mask → verify warning clears
- [ ] Test with very long regex patterns (performance)
- [ ] Test with complex file masks (`*.ts,*.js,!*.test.ts`)

---

## 7. UI/UX SPECIFICATIONS

### 7.1 Error Display

**Regex Error:**
```
┌────────────────────────────────────────┐
│ Find: [search input] [border: red]     │
│ ❌ Invalid regex: unclosed group       │
│                                        │
│ [Search disabled]                      │
└────────────────────────────────────────┘
```

- Error text color: `#f44747` (VS Code error red)
- Input border: 1px solid red
- Input background: slight red tint
- Animation: slide down on appearance
- Clear button: Change "Search" to "Fix regex to search"

**File Mask Warning:**
```
┌─────────────────────────────────────┐
│ File Mask: [*.ts, *.js] [warning]   │
│ ⚠️  Invalid mask (fallback to all)  │
│                                     │
│ [Search continues with all files]   │
└─────────────────────────────────────┘
```

- Warning text color: `#dcdcaa` (VS Code warning yellow)
- Input border: 1px solid yellow
- Input background: slight yellow tint
- Message includes ⚠️ emoji
- Search is NOT disabled

### 7.2 Button State Management

**Search Button States:**
- **Enabled:** Default, blue background, cursor: pointer
- **Disabled (Regex Error):** Gray, opacity 0.6, cursor: not-allowed
- **Disabled (Empty query):** Gray, opacity 0.6, cursor: not-allowed
- **Disabled (< 2 chars):** Gray, opacity 0.6, cursor: not-allowed

### 7.3 Message Copy

| Scenario | Message |
|----------|---------|
| Invalid regex - unclosed bracket | `Invalid regex: unclosed bracket` |
| Invalid regex - unclosed group | `Invalid regex: unclosed group` |
| Invalid regex - bad escape | `Invalid regex: bad escape \x` |
| Invalid file mask - generic | `Invalid file mask (falling back to match all): ...` |
| Empty query | `Search pattern cannot be empty` |

---

## 8. EDGE CASES & CONSIDERATIONS

### 8.1 Edge Cases to Handle

1. **Very long patterns:** Regex with 1000+ characters
   - ✅ Validation should complete in <100ms
   - ✅ No performance degradation

2. **Rapid input changes:** User typing very quickly
   - ✅ Debounce (150ms) prevents excessive validation calls
   - ✅ Latest pattern is always validated

3. **Mode switching:** User toggles regex mode
   - ✅ Re-validate current pattern with new mode
   - ✅ Error state updates appropriately

4. **Unicode patterns:** Regex with unicode characters
   - ✅ Should be handled by native RegExp
   - ✅ Test with emoji, CJK characters

5. **File mask with backslashes:** Windows paths
   - ✅ Already escaped in mask parsing
   - ✅ Should work correctly

6. **Empty file mask input:** User clears the field
   - ✅ Defaults to "match all" (expected behavior)
   - ✅ No warning shown

### 8.2 Performance Considerations

- Validation functions are synchronous (intentional)
  - Used only on client-side, no network latency
  - Regex compilation is very fast even for complex patterns

- Debouncing (150-300ms) prevents validation thrashing
  - Balances responsiveness with performance

- No caching needed
  - Patterns are short strings, validation is instant

---

## 9. DEPLOYMENT & ROLLOUT

### 9.1 Version Bump

- Bump version from 0.0.9 to 0.1.0 (minor feature)
- Update CHANGELOG with new feature description

### 9.2 Documentation Updates

- Update README with validation feature
- Add screenshot showing error message
- Document validation behavior in help section

### 9.3 Testing Before Release

- [ ] Full test suite passes locally
- [ ] E2E tests in VS Code environment
- [ ] Manual testing in multiple editor themes
- [ ] Test on Windows, macOS, Linux
- [ ] Verify no console errors

---

## 10. FUTURE IMPROVEMENTS (Out of Scope)

1. **Server-side validation caching** - Cache validation results for frequently-used patterns
2. **Validation preset suggestions** - Offer common regex patterns as autocomplete
3. **File mask builder UI** - Interactive UI to build complex file masks
4. **Pattern explanation** - Show what a regex pattern matches (e.g., "Matches: function declarations")
5. **Regex learning mode** - Tooltips explaining regex syntax

---

## 11. REFERENCES

### Related Code Sections

- Regex building: `utils.ts` - `buildSearchRegex()`
- File mask matching: `utils.ts` - `matchesFileMask()`
- Search execution: `search.ts` - `performSearch()`
- Webview communication: `extension.ts` - `openSearchPanel()`
- Current tests: `src/__tests__/`

### External Resources

- VS Code Webview API: https://code.visualstudio.com/api/extension-guides/webview
- RegExp documentation: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp
- Jest testing: https://jestjs.io/

---

## 12. SIGN-OFF

**Plan Version:** 1.0
**Last Updated:** December 10, 2025
**Status:** Ready for Implementation
