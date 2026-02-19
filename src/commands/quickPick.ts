import * as vscode from 'vscode';
import { CommandContext } from './types';
import { performSearch } from '../search';
import { SearchOptions, SearchResult } from '../utils';

type QuickPickSearchItem = vscode.QuickPickItem & { result?: SearchResult };

export async function quickPickCommand(ctx: CommandContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('rifler');
  const maxItemsRaw = config.get<number>('quickPickMaxItems', 50);
  const maxItems = Math.max(1, Math.floor(maxItemsRaw || 50));
  const includeCode = config.get<boolean>('searchContext.includeCode', true);
  const includeComments = config.get<boolean>('searchContext.includeComments', true);
  const includeStrings = config.get<boolean>('searchContext.includeStrings', true);

  const quickPick = vscode.window.createQuickPick<QuickPickSearchItem>();
  const selectedText = getSelectedText();
  const toggleState = {
    matchCase: false,
    wholeWord: false,
    useRegex: false
  };
  const iconBasePath = vscode.Uri.joinPath(ctx.extensionContext.extensionUri, 'assets', 'quickpick');
  let matchCaseButton = createToggleButton(
    buildIconPath(iconBasePath, 'case-sensitive', toggleState.matchCase),
    'Match Case',
    toggleState.matchCase
  );
  let wholeWordButton = createToggleButton(
    buildIconPath(iconBasePath, 'whole-word', toggleState.wholeWord),
    'Whole Word',
    toggleState.wholeWord
  );
  let useRegexButton = createToggleButton(
    buildIconPath(iconBasePath, 'regex', toggleState.useRegex),
    'Use Regex',
    toggleState.useRegex
  );

  quickPick.title = 'Rifler QuickPick Search';
  quickPick.placeholder = buildQuickPickPlaceholder(toggleState);
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  quickPick.ignoreFocusOut = true;
  quickPick.value = selectedText ?? '';
  quickPick.buttons = [matchCaseButton, wholeWordButton, useRegexButton];

  let searchTimeout: NodeJS.Timeout | undefined;
  let disposed = false;
  let searchCounter = 0;

  const runSearch = async (value: string): Promise<void> => {
    const trimmed = value.trim();
    const currentSearchId = ++searchCounter;
    quickPick.busy = true;

    if (trimmed.length < 2) {
      quickPick.items = [];
      quickPick.busy = false;
      return;
    }

    const options: SearchOptions = {
      matchCase: toggleState.matchCase,
      wholeWord: toggleState.wholeWord,
      useRegex: toggleState.useRegex,
      multiline: false,
      fileMask: '',
      includeCode,
      includeComments,
      includeStrings
    };

    try {
      const results = await performSearch(trimmed, 'project', options, undefined, undefined, maxItems, true);
      if (disposed || currentSearchId !== searchCounter) return;

      quickPick.items = results.slice(0, maxItems).map((result) => toQuickPickItem(result));
    } catch (error) {
      console.error('[Rifler] QuickPick search failed:', error);
      if (disposed || currentSearchId !== searchCounter) return;
      quickPick.items = [];
    } finally {
      if (!disposed && currentSearchId === searchCounter) {
        quickPick.busy = false;
      }
    }
  };

  const scheduleSearch = (value: string): void => {
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }
    searchTimeout = setTimeout(() => runSearch(value), 150);
  };

  quickPick.onDidChangeValue((value) => scheduleSearch(value));
  quickPick.onDidTriggerButton((button) => {
    if (button === matchCaseButton) {
      toggleState.matchCase = !toggleState.matchCase;
    } else if (button === wholeWordButton) {
      toggleState.wholeWord = !toggleState.wholeWord;
    } else if (button === useRegexButton) {
      toggleState.useRegex = !toggleState.useRegex;
    } else {
      return;
    }
    matchCaseButton = createToggleButton(
      buildIconPath(iconBasePath, 'case-sensitive', toggleState.matchCase),
      'Match Case',
      toggleState.matchCase
    );
    wholeWordButton = createToggleButton(
      buildIconPath(iconBasePath, 'whole-word', toggleState.wholeWord),
      'Whole Word',
      toggleState.wholeWord
    );
    useRegexButton = createToggleButton(
      buildIconPath(iconBasePath, 'regex', toggleState.useRegex),
      'Use Regex',
      toggleState.useRegex
    );
    quickPick.buttons = [matchCaseButton, wholeWordButton, useRegexButton];
    quickPick.title = 'Rifler QuickPick Search';
    quickPick.placeholder = buildQuickPickPlaceholder(toggleState);
    scheduleSearch(quickPick.value);
  });
  quickPick.onDidAccept(async () => {
    const selected = quickPick.selectedItems[0];
    if (selected?.result) {
      await openLocation(selected.result.uri, selected.result.line, selected.result.character);
    }
    quickPick.hide();
  });

  quickPick.onDidHide(() => {
    disposed = true;
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }
    quickPick.dispose();
  });

  quickPick.show();
  if (quickPick.value.trim().length >= 2) {
    scheduleSearch(quickPick.value);
  }
}

function toQuickPickItem(result: SearchResult): QuickPickSearchItem {
  const line = result.line + 1;
  const column = result.character + 1;
  const location = `${line}:${column}`;
  return {
    label: result.relativePath || result.fileName,
    description: location,
    detail: result.preview,
    result
  };
}

function createToggleButton(iconPath: vscode.IconPath, label: string, enabled: boolean): vscode.QuickInputButton {
  return {
    iconPath,
    tooltip: enabled ? `${label} (on)` : `${label} (off)`
  };
}

function buildIconPath(basePath: vscode.Uri, id: string, enabled: boolean): { light: vscode.Uri; dark: vscode.Uri } {
  const state = enabled ? 'on' : 'off';
  return {
    light: vscode.Uri.joinPath(basePath, `${id}-${state}-light.svg`),
    dark: vscode.Uri.joinPath(basePath, `${id}-${state}-dark.svg`)
  };
}

function buildQuickPickPlaceholder(toggleState: { matchCase: boolean; wholeWord: boolean; useRegex: boolean }): string {
  const matchCaseLabel = `Aa:${toggleState.matchCase ? 'on' : 'off'}`;
  const wholeWordLabel = `W:${toggleState.wholeWord ? 'on' : 'off'}`;
  const regexLabel = `.*:${toggleState.useRegex ? 'on' : 'off'}`;
  return `Type to search in workspace (${matchCaseLabel} ${wholeWordLabel} ${regexLabel})`;
}

async function openLocation(uriString: string, line: number, character: number): Promise<void> {
  const uri = vscode.Uri.parse(uriString);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  const position = new vscode.Position(line, character);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

function getSelectedText(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  const selection = editor.selection;
  if (selection.isEmpty) return undefined;
  const rawText = editor.document.getText(selection);
  const trimmedText = rawText.trim();
  if (trimmedText.length >= 2) {
    return trimmedText;
  }
  return undefined;
}
