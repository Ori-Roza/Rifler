import * as vscode from 'vscode';
import { MessageHandler } from './handler';
import { performSearch } from '../search';
import { replaceOne, replaceAll } from '../replacer';
import { validateRegex, validateFileMask, SearchOptions, SearchScope } from '../utils';

export interface CommonHandlerDeps {
  postMessage: (message: any) => void;
  openLocation: (uri: string, line: number, character: number) => Promise<void>;
  sendModules: () => Promise<void>;
  sendCurrentDirectory: () => void;
  sendFileContent: (uri: string, query: string, options: SearchOptions, activeIndex?: number) => Promise<void>;
  saveFile: (uri: string, content: string) => Promise<void>;
}

export function registerCommonHandlers(handler: MessageHandler, deps: CommonHandlerDeps) {
  handler.registerHandler('runSearch', async (message: { query: string; scope: SearchScope; options: SearchOptions; directoryPath?: string; modulePath?: string; filePath?: string; }) => {
    const results = await performSearch(
      message.query,
      message.scope,
      message.options,
      message.directoryPath,
      message.modulePath,
      message.filePath
    );
    deps.postMessage({ type: 'searchResults', results, maxResults: 10000 });
  });

  handler.registerHandler('openLocation', async (message: { uri: string; line: number; character: number; }) => {
    await deps.openLocation(message.uri, message.line, message.character);
  });

  handler.registerHandler('getModules', async () => {
    await deps.sendModules();
  });

  handler.registerHandler('getCurrentDirectory', async () => {
    deps.sendCurrentDirectory();
  });

  handler.registerHandler('getFileContent', async (message: { uri: string; query: string; options: SearchOptions; activeIndex?: number; }) => {
    await deps.sendFileContent(message.uri, message.query, message.options, message.activeIndex);
  });

  handler.registerHandler('saveFile', async (message: { uri: string; content: string }) => {
    await deps.saveFile(message.uri, message.content);
  });

  handler.registerHandler('replaceOne', async (message: { uri: string; line: number; character: number; length: number; replaceText: string }) => {
    await replaceOne(message.uri, message.line, message.character, message.length, message.replaceText);
  });

  handler.registerHandler('replaceAll', async (message: { query: string; replaceText: string; scope: SearchScope; options: SearchOptions; directoryPath?: string; modulePath?: string; filePath?: string; }) => {
    await replaceAll(
      message.query,
      message.replaceText,
      message.scope,
      message.options,
      message.directoryPath,
      message.modulePath,
      message.filePath
    );
  });

  handler.registerHandler('validateRegex', async (message: { pattern: string; useRegex: boolean }) => {
    const result = validateRegex(message.pattern, message.useRegex);
    deps.postMessage({ type: 'validationResult', field: 'regex', isValid: result.isValid, error: result.error });
  });

  handler.registerHandler('validateFileMask', async (message: { fileMask: string }) => {
    const result = validateFileMask(message.fileMask);
    deps.postMessage({ type: 'validationResult', field: 'fileMask', isValid: result.isValid, message: result.message, fallbackToAll: result.fallbackToAll });
  });

  handler.registerHandler('__diag_ping', async () => {
    console.log('Received webview diag ping');
  });

  handler.registerHandler('error', async (message: { message: string; source?: string; lineno?: number; colno?: number; error?: unknown }) => {
    console.error('Webview error:', message.message, message);
  });
}
