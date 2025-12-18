import { SearchResult, SearchOptions, SearchScope } from '../utils';

// ============================================================================
// Incoming Messages (from Webview to Extension)
// ============================================================================

export interface MinimizeMessage {
  type: 'minimize';
  state: {
    query: string;
    replaceText: string;
    scope: string;
    directoryPath: string;
    modulePath: string;
    filePath: string;
    options: SearchOptions;
    showReplace: boolean;
    showFilters?: boolean;
    results?: SearchResult[];
    activeIndex?: number;
    lastPreview?: any;
  };
}

export interface ValidateRegexMessage {
  type: 'validateRegex';
  pattern: string;
  useRegex: boolean;
}

export interface ValidateFileMaskMessage {
  type: 'validateFileMask';
  fileMask: string;
}

export interface RunSearchMessage {
  type: 'runSearch';
  query: string;
  scope: SearchScope;
  options: SearchOptions;
  directoryPath?: string;
  modulePath?: string;
  filePath?: string;
}

export interface OpenLocationMessage {
  type: 'openLocation';
  uri: string;
  line: number;
  character: number;
}

export interface GetModulesMessage {
  type: 'getModules';
}

export interface GetCurrentDirectoryMessage {
  type: 'getCurrentDirectory';
}

export interface GetFileContentMessage {
  type: 'getFileContent';
  uri: string;
  query: string;
  options: SearchOptions;
  activeIndex?: number;
}

export interface ReplaceOneMessage {
  type: 'replaceOne';
  uri: string;
  line: number;
  character: number;
  length: number;
  replaceText: string;
}

export interface ReplaceAllMessage {
  type: 'replaceAll';
  query: string;
  replaceText: string;
  scope: SearchScope;
  options: SearchOptions;
  directoryPath?: string;
  modulePath?: string;
  filePath?: string;
}

export interface WebviewReadyMessage {
  type: 'webviewReady';
}

export interface SaveFileMessage {
  type: 'saveFile';
  uri: string;
  content: string;
}

// Test-only message types
export interface TestSearchCompletedMessage {
  type: '__test_searchCompleted';
  results: SearchResult[];
}

export interface TestSearchResultsReceivedMessage {
  type: '__test_searchResultsReceived';
  results: SearchResult[];
}

export interface TestErrorMessage {
  type: 'error';
  message: string;
  source?: string;
  lineno?: number;
  colno?: number;
  error?: unknown;
}

export interface DiagPingMessage {
  type: '__diag_ping';
  ts: number;
}

/**
 * Union type of all possible messages from webview to extension
 */
export type IncomingMessage =
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
  | ValidateRegexMessage
  | ValidateFileMaskMessage
  | TestSearchCompletedMessage
  | TestSearchResultsReceivedMessage
  | TestErrorMessage
  | DiagPingMessage;

// ============================================================================
// Outgoing Messages (from Extension to Webview)
// ============================================================================

export interface SearchResultsMessage {
  type: 'searchResults';
  results: SearchResult[];
  activeIndex?: number;
  maxResults?: number;
}

export interface ModulesListMessage {
  type: 'modulesList';
  modules: Array<{ name: string; path: string }>;
}

export interface CurrentDirectoryMessage {
  type: 'currentDirectory';
  directory: string;
}

export interface FileContentMessage {
  type: 'fileContent';
  uri: string;
  content: string;
  fileName: string;
  matches: Array<{ line: number; start: number; end: number }>;
}

export interface ValidationResultMessage {
  type: 'validationResult';
  field: 'regex' | 'fileMask';
  isValid: boolean;
  error?: string;
  message?: string;
  fallbackToAll?: boolean;
}

export interface ConfigMessage {
  type: 'config';
  replaceKeybinding: string;
  maxResults: number;
}

export interface ShowReplaceMessage {
  type: 'showReplace';
}

export interface RestoreStateMessage {
  type: 'restoreState';
  state: MinimizeMessage['state'];
}

export interface SetSearchQueryMessage {
  type: 'setSearchQuery';
  query: string;
}

export interface FocusSearchMessage {
  type: 'focusSearch';
}

export interface ToggleReplaceMessage {
  type: 'toggleReplace';
}

export interface RequestStateForMinimizeMessage {
  type: 'requestStateForMinimize';
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

/**
 * Union type of all possible messages from extension to webview
 */
export type OutgoingMessage =
  | SearchResultsMessage
  | ModulesListMessage
  | CurrentDirectoryMessage
  | FileContentMessage
  | ValidationResultMessage
  | ConfigMessage
  | ShowReplaceMessage
  | RestoreStateMessage
  | SetSearchQueryMessage
  | FocusSearchMessage
  | ToggleReplaceMessage
  | RequestStateForMinimizeMessage
  | ErrorMessage;
