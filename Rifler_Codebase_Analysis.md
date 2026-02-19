# Rifler Codebase Analysis

## Overview
Rifler is a VS Code extension (v1.2.3) that provides fast, ripgrep-powered search with a rich webview UI. It supports sidebar, bottom panel, and editor-tab modes, plus LSP-backed "Find Usages" searches. The extension uses TypeScript for the backend and a vanilla HTML/CSS/JS webview (highlight.js for syntax highlighting).

## Architecture
- Extension entry: `src/extension.ts`
- Search core: `src/search.ts`, `src/rgSearch.ts` (ripgrep), `src/lspSearch.ts` (LSP)
- Replace: `src/replacer.ts`
- State/UI: `src/services/PanelManager.ts`, `src/state/StateStore.ts`, `src/views/ViewManager.ts`
- Sidebar: `src/sidebar/SidebarProvider.ts`
- Messaging: `src/messaging/handler.ts`, `src/messaging/registerCommonHandlers.ts`
- Webview: `src/webview/index.html`, `src/webview/styles.css`, `src/webview/script.js`

## Implemented Features
- Fast search using ripgrep with JS fallback
- Regex, match-case, whole-word, file mask filtering
- Smart excludes based on project detection
- Code context filtering (code/comments/strings)
- LSP usage search (references/definitions/implementations/type definitions)
- Replace one/all
- Search history and persisted state
- Results grouping with collapse/expand and virtualization
- Preview panel with inline editing + local find/replace
- Sidebar / bottom / editor-tab view modes

## Missing / Planned Features
- QuickPick mode (Issue #44): fully planned, not implemented

## Security Findings (from SECURITY_AUDIT_REPORT.md)
- Path traversal validation for directory scope: missing (fixed in current work)
- Replace operations outside workspace: missing (fixed in current work)
- Webview HTML escaping: inconsistent (hardened in current work)

## Test Coverage Highlights
- Unit tests: search, utils, replacer, state store, LSP search, code context filtering
- E2E tests: search, replace, sidebar, preview, UI state and navigation
- Known gaps: placeholder E2E tests for continuous arrow navigation; minimal unit tests for webview logic

## CI/CD
- PR checks: lint, unit tests, build, E2E tests (Ubuntu + Windows)
- Release pipeline: build + publish to VS Code Marketplace + OpenVSX
- Security audit pipeline: npm audit, dependency review, CodeQL, Scorecard

## Single Most Important Missing Feature
QuickPick search mode (Issue #44). It would enable keyboard-first searching without opening the webview and is already fully planned with reusable backend logic.
