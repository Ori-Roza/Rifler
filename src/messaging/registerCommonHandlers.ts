import { MessageHandler } from './handler';
import { performSearch } from '../search';
import { replaceOne, replaceAll } from '../replacer';
import { validateRegex, validateFileMask, SearchOptions, SearchScope } from '../utils';

export interface CommonHandlerDeps {
  postMessage: (message: Record<string, unknown>) => void;
  openLocation: (uri: string, line: number, character: number) => Promise<void>;
  sendModules: () => Promise<void>;
  sendCurrentDirectory: () => void;
  sendFileContent: (uri: string, query: string, options: SearchOptions, activeIndex?: number) => Promise<void>;
  saveFile: (uri: string, content: string) => Promise<void>;
}

export function registerCommonHandlers(handler: MessageHandler, deps: CommonHandlerDeps) {
  handler.registerHandler('runSearch', async (message) => {
    const msg = message as { query: string; scope: SearchScope; options: SearchOptions; directoryPath?: string; modulePath?: string; filePath?: string; };
    const results = await performSearch(
      msg.query,
      msg.scope,
      msg.options,
      msg.directoryPath,
      msg.modulePath,
      msg.filePath
    );
    deps.postMessage({ type: 'searchResults', results, maxResults: 10000 });
  });

  handler.registerHandler('openLocation', async (message) => {
    const msg = message as { uri: string; line: number; character: number; };
    await deps.openLocation(msg.uri, msg.line, msg.character);
  });

  handler.registerHandler('getModules', async () => {
    await deps.sendModules();
  });

  handler.registerHandler('getCurrentDirectory', async () => {
    deps.sendCurrentDirectory();
  });

  handler.registerHandler('getFileContent', async (message) => {
    const msg = message as { uri: string; query: string; options: SearchOptions; activeIndex?: number; };
    await deps.sendFileContent(msg.uri, msg.query, msg.options, msg.activeIndex);
  });

  handler.registerHandler('saveFile', async (message) => {
    const msg = message as { uri: string; content: string };
    await deps.saveFile(msg.uri, msg.content);
  });

  handler.registerHandler('replaceOne', async (message) => {
    const msg = message as { uri: string; line: number; character: number; length: number; replaceText: string };
    await replaceOne(msg.uri, msg.line, msg.character, msg.length, msg.replaceText);
  });

  handler.registerHandler('replaceAll', async (message) => {
    const msg = message as { query: string; replaceText: string; scope: SearchScope; options: SearchOptions; directoryPath?: string; modulePath?: string; filePath?: string; };
    await replaceAll(
      msg.query,
      msg.replaceText,
      msg.scope,
      msg.options,
      msg.directoryPath,
      msg.modulePath,
      msg.filePath,
      async () => {
        // After replace, re-run search and post updated results
        const results = await performSearch(
          msg.query,
          msg.scope,
          msg.options,
          msg.directoryPath,
          msg.modulePath,
          msg.filePath
        );
        deps.postMessage({ type: 'searchResults', results, maxResults: 10000 });
      }
    );
  });

  handler.registerHandler('validateRegex', async (message) => {
    const msg = message as { pattern: string; useRegex: boolean };
    const result = validateRegex(msg.pattern, msg.useRegex);
    deps.postMessage({ type: 'validationResult', field: 'regex', isValid: result.isValid, error: result.error });
  });

  handler.registerHandler('validateFileMask', async (message) => {
    const msg = message as { fileMask: string };
    const result = validateFileMask(msg.fileMask);
    deps.postMessage({ type: 'validationResult', field: 'fileMask', isValid: result.isValid, message: result.message, fallbackToAll: result.fallbackToAll });
  });

  handler.registerHandler('__diag_ping', async () => {
    console.log('Received webview diag ping');
  });

  handler.registerHandler('error', async (message) => {
    const msg = message as { message: string; source?: string; lineno?: number; colno?: number; error?: unknown };
    console.error('Webview error:', msg.message, msg);
  });
}
