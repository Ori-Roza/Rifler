# Security Integration Guide

This guide shows how to integrate the new security modules into the existing Rifler codebase.

## Overview

Two new security modules have been created:
- `src/security/pathValidation.ts` - Path traversal protection
- `src/security/webviewSecurity.ts` - XSS protection for webview

## Integration Steps

### 1. Path Validation in Search Operations

**File:** `src/search.ts`

**Current vulnerable code:**
```typescript
export async function resolveSearchRoots(
  workspaceFolders: vscode.WorkspaceFolder[] | undefined,
  directoryPath?: string
): Promise<string[]> {
  if (directoryPath) {
    // VULNERABLE: No validation of directory path
    return [directoryPath];
  }
  // ...
}
```

**Secured code:**
```typescript
import { validateDirectoryPath } from './security/pathValidation';

export async function resolveSearchRoots(
  workspaceFolders: vscode.WorkspaceFolder[] | undefined,
  directoryPath?: string
): Promise<string[]> {
  if (directoryPath) {
    try {
      // SECURE: Validate and sanitize directory path
      const safePath = validateDirectoryPath(directoryPath);
      return [safePath];
    } catch (error) {
      // Log security violation
      console.error('Security: Directory path validation failed', error);
      throw new Error('Invalid directory path: must be within workspace');
    }
  }
  // ...
}
```

---

### 2. URI Validation in Replace Operations

**File:** `src/replacer.ts`

**Current vulnerable code:**
```typescript
export async function replaceOne(
  uriString: string,
  line: number,
  // ...
): Promise<void> {
  // VULNERABLE: No validation of URI
  const uri = vscode.Uri.parse(uriString);
  const document = await vscode.workspace.openTextDocument(uri);
  // ... perform replacement
}
```

**Secured code:**
```typescript
import { validateUriString, isUriSafe } from './security/pathValidation';

export async function replaceOne(
  uriString: string,
  line: number,
  // ...
): Promise<void> {
  // SECURE: Validate URI before operations
  if (!validateUriString(uriString)) {
    throw new Error('Security: URI must be a file:// URI within workspace');
  }
  
  const uri = vscode.Uri.parse(uriString);
  
  // Double-check after parsing
  if (!isUriSafe(uri)) {
    throw new Error('Security: Attempted to replace file outside workspace');
  }
  
  const document = await vscode.workspace.openTextDocument(uri);
  // ... perform replacement
}

export async function replaceAll(
  replacements: Array<{ uriString: string; /* ... */ }>
): Promise<void> {
  // SECURE: Validate all URIs before batch operation
  for (const replacement of replacements) {
    if (!validateUriString(replacement.uriString)) {
      throw new Error('Security: All URIs must be within workspace');
    }
  }
  
  // Proceed with replacements only if all URIs are safe
  // ...
}
```

---

### 3. XSS Protection in Webview

**File:** `src/webview/script.js`

**Current vulnerable code:**
```javascript
function renderSearchResult(result) {
  const html = `
    <div class="result-item">
      <div class="result-file">${result.filePath}</div>
      <div class="result-line">${result.lineNumber}</div>
      <div class="result-content">${highlightMatch(result.content)}</div>
    </div>
  `;
  container.innerHTML += html;
}

function highlightMatch(content) {
  // Uses highlight.js
  return hljs.highlightAuto(content).value;
}
```

**Secured code:**
```javascript
// Import security functions (or copy them to script.js)
import { escapeHtml, sanitizeHighlightedHtml, sanitizeFilePath } from '../security/webviewSecurity';

function renderSearchResult(result) {
  // SECURE: Escape all user-provided content
  const safeFilePath = sanitizeFilePath(result.filePath);
  const safeLineNumber = escapeHtml(String(result.lineNumber));
  const safeContent = sanitizeHighlightedHtml(highlightMatch(result.content));
  
  const html = `
    <div class="result-item">
      <div class="result-file">${safeFilePath}</div>
      <div class="result-line">${safeLineNumber}</div>
      <div class="result-content">${safeContent}</div>
    </div>
  `;
  container.innerHTML += html;
}

function highlightMatch(content) {
  // SECURE: Sanitize highlight.js output before use
  const highlighted = hljs.highlightAuto(content).value;
  return sanitizeHighlightedHtml(highlighted);
}
```

**Alternative approach using textContent (safer):**
```javascript
function renderSearchResult(result) {
  const resultDiv = document.createElement('div');
  resultDiv.className = 'result-item';
  
  const fileDiv = document.createElement('div');
  fileDiv.className = 'result-file';
  fileDiv.textContent = result.filePath; // Safe: textContent auto-escapes
  
  const lineDiv = document.createElement('div');
  lineDiv.className = 'result-line';
  lineDiv.textContent = result.lineNumber;
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'result-content';
  contentDiv.innerHTML = sanitizeHighlightedHtml(highlightMatch(result.content));
  
  resultDiv.appendChild(fileDiv);
  resultDiv.appendChild(lineDiv);
  resultDiv.appendChild(contentDiv);
  container.appendChild(resultDiv);
}
```

---

### 4. Safe Data Attributes in Webview

**Current vulnerable code:**
```javascript
function addDataAttributes(element, result) {
  // VULNERABLE: No escaping of data attributes
  element.setAttribute('data-uri', result.uri);
  element.setAttribute('data-line', result.line);
}
```

**Secured code:**
```javascript
import { safeDataAttribute } from '../security/webviewSecurity';

function addDataAttributes(element, result) {
  // SECURE: Validate and sanitize before setting attributes
  element.setAttribute('data-uri', safeDataAttribute(result.uri));
  element.setAttribute('data-line', safeDataAttribute(String(result.line)));
}
```

---

## Testing the Integration

Run security tests:
```bash
npm test -- src/security/__tests__
```

Run E2E tests with malicious inputs:
```bash
npm run test:e2e
```

## Verification Checklist

After integration, verify:

- [ ] Directory scope rejects paths with `../`
- [ ] Replace operations reject URIs outside workspace
- [ ] Filenames with `<script>` tags are escaped in UI
- [ ] Search results with HTML entities display correctly
- [ ] Data attributes don't break with quotes or HTML
- [ ] No console errors about CSP violations
- [ ] All existing tests still pass

## Rollout Plan

1. **Phase 1** (Low risk): Add path validation to new features only
2. **Phase 2** (Medium risk): Add XSS protection to webview rendering
3. **Phase 3** (High risk): Add validation to existing search/replace operations
4. **Phase 4** (Monitoring): Add telemetry for security violations

## Backward Compatibility

These changes are **breaking** for:
- Workspaces that use `..` in directory scope (now rejected)
- Extensions that try to replace files outside workspace (now blocked)

Add user-facing error messages explaining the security restrictions:

```typescript
vscode.window.showErrorMessage(
  'Rifler: Directory path must be within workspace. ' +
  'Path traversal (..) is not allowed for security reasons.'
);
```

## Performance Impact

Expected performance impact: **< 1ms per operation**

Path validation is lightweight:
- `path.normalize()`: ~0.1ms
- `path.relative()`: ~0.1ms
- Workspace check loop: ~0.1ms per folder

XSS escaping is also lightweight:
- `escapeHtml()`: ~0.01ms per string
- `sanitizeHighlightedHtml()`: ~1ms for typical file

## Additional Resources

- [SECURITY_AUDIT_REPORT.md](./SECURITY_AUDIT_REPORT.md) - Full security audit
- [VS Code Extension Security Best Practices](https://code.visualstudio.com/api/extension-guides/webview#security)
- [OWASP Path Traversal](https://owasp.org/www-community/attacks/Path_Traversal)
- [OWASP XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
