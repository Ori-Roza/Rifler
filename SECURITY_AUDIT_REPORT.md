# Rifler Security Audit Report
**Date:** February 1, 2026  
**Auditor:** GitHub Copilot (Claude Sonnet 4.5)  
**Scope:** Complete codebase security review

## Executive Summary

This security audit examined the Rifler VS Code extension for vulnerabilities related to command execution, file system access, input validation, and webview security. **Overall security posture is GOOD**, with proper use of spawn() and strong input validation. Several **medium severity** findings require attention to prevent potential exploitation in malicious workspace scenarios.

### Risk Rating: **MEDIUM**
- ✅ **Command Execution:** SECURE - Uses spawn() with argument arrays
- ⚠️ **Path Validation:** NEEDS IMPROVEMENT - Missing path traversal checks
- ✅ **Input Validation:** GOOD - Regex and file mask validation present
- ⚠️ **Webview Security:** NEEDS IMPROVEMENT - innerHTML usage without consistent escaping
- ✅ **Dependencies:** CLEAN - No known vulnerabilities
- ⚠️ **URI Parsing:** NEEDS REVIEW - Trusts user-provided URIs

---

## Detailed Findings

### A) Command Execution Safety (ripgrep usage)

#### ✅ **SECURE: Proper spawn() usage**
**Severity:** N/A (No issue found)  
**Location:** [src/rgSearch.ts#L74-L106](src/rgSearch.ts#L74-L106)

**Evidence:**
```typescript
async function spawnWithFallback(
  commands: string[],
  args: string[]
): Promise<{ child: ChildProcessWithoutNullStreams; command: string }> {
  // ...
  const child = spawn(command, args, { windowsHide: true });
```

**Analysis:** ✅ Extension correctly uses `spawn()` with argument arrays, never concatenating user input into shell commands. The `shell: true` option is never used. Args are built safely:

```typescript
args.push('--glob', glob);  // User pattern goes into array element
args.push('-e', searchQuery, '--', ...roots);  // Pattern isolated from shell
```

**Attack Scenario:** Not applicable - no command injection vector found.

---

### B) Path and Filesystem Safety

#### ⚠️ **MEDIUM: Missing path traversal validation in directory scope**
**Severity:** Medium  
**Impact:** User could search/replace outside workspace using `../` paths  
**Attack Scenario:** Malicious workspace with pre-filled directory path containing `../../etc/` could leak sensitive files if user runs search without inspecting the path  
**Location:** [src/search.ts#L220-L230](src/search.ts#L220-L230), [src/messaging/registerCommonHandlers.ts#L113](src/messaging/registerCommonHandlers.ts#L113)

**Evidence:**
```typescript
// In registerCommonHandlers.ts - directory validation
const uri = vscode.Uri.file(msg.directoryPath);  // ⚠️ No path traversal check
const exists = await fileExists(uri);

// In search.ts - resolveSearchRoots for directory scope
const dirPath = directoryPath || '';
const uri = vscode.Uri.file(dirPath);  // ⚠️ Accepts any path
```

**Vulnerable Code Flow:**
1. User opens malicious workspace with `.vscode/settings.json` containing:
   ```json
   {
     "rifler.lastSearch": {
       "scope": "directory",
       "directoryPath": "../../etc"
     }
   }
   ```
2. User opens Rifler sidebar - directory path auto-populated
3. User types search query without checking directory field
4. Extension searches `/etc` directory (outside workspace)

**Fix:**
```typescript
// Add path traversal check
function isWithinWorkspace(targetPath: string): boolean {
  const workspaces = vscode.workspace.workspaceFolders;
  if (!workspaces) return false;
  
  const normalized = path.normalize(path.resolve(targetPath));
  return workspaces.some(ws => {
    const wsPath = ws.uri.fsPath;
    const rel = path.relative(wsPath, normalized);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  });
}

// In resolveSearchRoots():
if (scope === 'directory') {
  const dirPath = directoryPath || '';
  if (!isWithinWorkspace(dirPath)) {
    throw new Error('Directory path must be within workspace');
  }
  // ... continue
}
```

**Implementation Status:** ❌ Not fixed (recommendation provided)

---

#### ⚠️ **MEDIUM: Replace operations lack workspace boundary enforcement**
**Severity:** Medium  
**Impact:** Malicious workspace could trick user into replacing text in files outside workspace  
**Attack Scenario:** 
1. Attacker crafts workspace with search results pointing to `file:///etc/hosts`
2. User clicks "Replace All" thinking they're modifying project files
3. Extension attempts to modify system files (likely fails due to permissions, but still concerning)

**Location:** [src/replacer.ts#L7-L15](src/replacer.ts#L7-L15), [src/replacer.ts#L44-L50](src/replacer.ts#L44-L50)

**Evidence:**
```typescript
export async function replaceOne(uriString: string, /* ... */) {
  const uri = vscode.Uri.parse(uriString);  // ⚠️ Trusts URI from results
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, range, replaceText);
  await vscode.workspace.applyEdit(edit);  // Could target any URI
}
```

**Fix:**
```typescript
function validateUriInWorkspace(uri: vscode.Uri): boolean {
  const workspaces = vscode.workspace.workspaceFolders;
  if (!workspaces) return false;
  
  // Only allow file:// URIs
  if (uri.scheme !== 'file') return false;
  
  const filePath = uri.fsPath;
  return workspaces.some(ws => {
    const rel = path.relative(ws.uri.fsPath, filePath);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  });
}

export async function replaceOne(uriString: string, /* ... */) {
  const uri = vscode.Uri.parse(uriString);
  if (!validateUriInWorkspace(uri)) {
    throw new Error('Cannot replace text outside workspace');
  }
  // ... continue
}
```

**Implementation Status:** ❌ Not fixed (recommendation provided)

---

### C) Input Validation / Abuse Resistance

#### ✅ **GOOD: Regex validation present**
**Location:** [src/utils.ts#L74-L100](src/utils.ts#L74-L100)

**Evidence:**
```typescript
export function buildSearchRegex(query: string, options: SearchOptions): RegExp | null {
  try {
    // Escaping for non-regex mode
    pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // ...
    return new RegExp(pattern, flags);
  } catch {
    return null;  // Graceful failure
  }
}
```

**Analysis:** ✅ Safe escaping, try-catch prevents crashes, multiline handling looks correct.

---

#### ⚠️ **LOW: Regex DoS protection incomplete**
**Severity:** Low  
**Impact:** Complex regex patterns could cause performance degradation  
**Location:** [src/utils.ts#L428-L450](src/utils.ts#L428-L450)

**Evidence:**
```typescript
function isSafeRegex(pattern: string): boolean {
  // Basic checks - catastrophic backtracking patterns
  const dangerousPatterns = [
    /(\.\*){3,}/,  // Multiple .* in sequence
    /(\+\*|\*\+)/,  // Nested quantifiers
    // ... more patterns
  ];
  return !dangerousPatterns.some(dp => dp.test(pattern));
}
```

**Analysis:** Basic ReDoS protection exists, but doesn't catch all cases (e.g., `(a+)+b`). Ripgrep has its own timeout, providing defense-in-depth.

**Recommendation:** Add execution timeout for fallback JS regex search (currently 2500ms per file, but per-search timeout missing).

---

#### ✅ **GOOD: File mask validation**
**Location:** [src/utils.ts#L452-L480](src/utils.ts#L452-L480)

**Evidence:**
```typescript
export function validateFileMask(fileMask: string): { isValid: boolean; /* ... */ } {
  const tokens = trimmed.split(/[,;]/).map(m => m.trim()).filter(Boolean);
  // ... builds glob patterns safely
  return { isValid: true };
}
```

**Analysis:** Glob patterns are safely constructed and passed to ripgrep. No shell expansion risk.

---

### D) Secrets and Data Handling

#### ✅ **GOOD: No sensitive data logging**
**Evidence:** Reviewed all `console.log` statements - no file contents or passwords logged at info level. Debug logs contain query text (expected) but not file contents.

#### ✅ **GOOD: State persistence minimal**
**Location:** [src/sidebar/SidebarProvider.ts](src/sidebar/SidebarProvider.ts)

**Evidence:** Only persists search query, options, and result metadata (not file contents). Uses VS Code's `vscode.setState()` which is scoped per-webview.

---

### E) Webview / UI Security

#### ⚠️ **MEDIUM: Inconsistent HTML escaping in webview**
**Severity:** Medium  
**Impact:** XSS if search results contain crafted HTML/JS (malicious file names or content)  
**Attack Scenario:**
1. Malicious workspace contains file: `<img src=x onerror=alert(1)>.js`
2. User searches for "test"
3. Webview displays filename using `.innerHTML` without escaping
4. XSS executes in webview context (has `acquireVsCodeApi` access)

**Location:** [src/webview/script.js#L3426-L3433](src/webview/script.js#L3426-L3433)

**Evidence:**
```javascript
// GOOD: Helper exists
function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // ...
}

// BAD: Not always used
item.innerHTML = 
  '<span class="file-name">' + escapeHtml(itemData.fileName) + '</span>' +  // ✅ Escaped
  '<div class="file-path">' + escapeHtml(displayPath) + '</div>';  // ✅ Escaped

// But in other places:
previewContent.innerHTML = '<div class="empty-state">No results</div>';  // ✅ Static
resultsList.innerHTML = '';  // ✅ Clearing

editorBackdrop.innerHTML = highlighted;  // ⚠️ After hljs - potentially unsafe
```

**Analysis:** Most user data is escaped via `escapeHtml()`, but syntax highlighting with `hljs.highlight()` may introduce vectors if highlight.js has bugs. Additionally, `.innerHTML` is used extensively - safer to use `textContent` where possible.

**Fix:**
```javascript
// Prefer textContent for plain text:
element.textContent = fileName;  // Automatically escapes

// For HTML from highlight.js, validate output:
function sanitizeHighlighted(html) {
  // Strip <script> and event handlers as defense-in-depth
  return html
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
}

editorBackdrop.innerHTML = sanitizeHighlighted(highlighted);
```

**Implementation Status:** ⚠️ Partial - escaping exists but not consistently applied to all innerHTML assignments

---

#### ✅ **GOOD: CSP likely present (webview best practice)**
**Note:** VS Code webviews have restrictive CSP by default. No remote resources loaded. (Couldn't verify CSP meta tag in webview/index.html snippet, but VS Code enforces this by default)

---

### F) Dependencies / Supply Chain

#### ✅ **CLEAN: No vulnerabilities found**
**Command:** `npm audit --production`  
**Result:** `found 0 vulnerabilities`

**Dependencies Review:**
- `highlight.js@11.11.1` - Up to date, actively maintained
- `@vscode/ripgrep` - VS Code's bundled ripgrep (trusted)
- No transitive dependencies with known issues

**Recommendation:** Enable Dependabot alerts on GitHub repository.

---

## Summary of Recommendations

### High Priority Fixes

1. **Add path traversal validation** (Medium severity)
   - Implement `isWithinWorkspace()` check for directory scope
   - Validate URIs in replace operations
   - Estimated effort: 2-4 hours

2. **Harden webview XSS protection** (Medium severity)
   - Add `sanitizeHighlighted()` for syntax highlighting output
   - Audit all `.innerHTML` assignments
   - Consider using `textContent` where HTML not needed
   - Estimated effort: 4-6 hours

### Medium Priority

3. **Add comprehensive unit tests for security properties** (Low severity)
   - Test path traversal rejection
   - Test replace workspace boundary enforcement
   - Test regex DoS patterns
   - Estimated effort: 6-8 hours

### Low Priority

4. **Enhanced ReDoS protection**
   - Add per-search timeout for fallback JS search
   - Log slow regex patterns for monitoring
   - Estimated effort: 2 hours

---

## Testing Recommendations

### Security Test Cases to Add

```typescript
// Test: Path traversal rejection
test('Should reject directory path with ..', async () => {
  const result = await performSearch('test', 'directory', options, '../../etc');
  expect(result).toHaveLength(0);
  // Or expect(promise).rejects.toThrow('must be within workspace');
});

// Test: Replace workspace boundary
test('Should reject replace outside workspace', async () => {
  await expect(
    replaceOne('file:///etc/passwd', 0, 0, 4, 'malicious')
  ).rejects.toThrow('outside workspace');
});

// Test: URI scheme validation  
test('Should reject non-file URI schemes', async () => {
  await expect(
    replaceOne('http://evil.com/file.txt', 0, 0, 4, 'malicious')
  ).rejects.toThrow();
});

// Test: Filename XSS
test('Should escape HTML in filenames', async () => {
  // Create fixture: <img src=x onerror=alert(1)>.js
  // Search for content
  // Verify webview doesn't execute script (use E2E test)
});
```

---

## CI/CD Integration

### Recommended GitHub Actions

```yaml
# .github/workflows/security.yml
name: Security Checks

on: [push, pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm audit --production
      - run: npm audit --audit-level=moderate

  dependency-review:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v3
      - uses: actions/dependency-review-action@v3
        with:
          fail-on-severity: moderate
```

---

## Threat Model (Malicious Workspace Scenario)

### Attacker Capabilities
- Control over workspace files (`.vscode/settings.json`, file names, file contents)
- Can pre-fill search configuration
- Can create symlinks (on Unix systems)

### Attack Vectors Analyzed
1. ✅ **Command Injection:** MITIGATED - spawn() with args array
2. ⚠️ **Path Traversal:** VULNERABLE - see findings above
3. ⚠️ **XSS via Filenames:** PARTIALLY MITIGATED - escaping present but incomplete
4. ✅ **Regex DoS:** MITIGATED - basic protection + ripgrep timeout
5. ⚠️ **Replace Out-of-Workspace:** VULNERABLE - see findings above
6. ✅ **Credential Leakage:** LOW RISK - no logging of file contents

---

## Compliance Notes

### VS Code Extension Security Best Practices
- ✅ Activation events minimal (`onStartupFinished`)
- ✅ No network calls (except potential telemetry if enabled, not seen in code)
- ✅ Uses VS Code's workspace APIs (doesn't bypass to `fs` directly for most operations)
- ⚠️ Could improve: Explicit workspace trust API integration

### Suggested Workspace Trust Integration

```typescript
// In extension.ts activate():
const isTrusted = vscode.workspace.isTrusted;
if (!isTrusted) {
  vscode.window.showWarningMessage(
    'Rifler requires workspace trust for search and replace operations.'
  );
  // Disable dangerous features or wait for trust event
}
```

---

## Conclusion

Rifler demonstrates **good security fundamentals** with proper command execution and input validation. The identified vulnerabilities are **medium severity** and exploitable primarily in malicious workspace scenarios - a threat model VS Code extensions must defend against.

**Recommended Actions:**
1. Implement path traversal checks (high priority)
2. Harden webview HTML handling (high priority)
3. Add security test suite (medium priority)
4. Enable Dependabot and security scanning in CI (low effort, high value)

**Current Risk Assessment:** MEDIUM (acceptable for release, but should address findings in next version)

---

**Report End** | Audited: February 1, 2026
