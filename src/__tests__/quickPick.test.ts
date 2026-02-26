import * as vscode from 'vscode';
import { quickPickCommand } from '../commands/quickPick';
import { quickPickReplaceCommand } from '../commands/quickPickReplace';
import { performSearch } from '../search';
import { replaceOne } from '../replacer';
import { CommandContext } from '../commands/types';

jest.mock('../search', () => ({
  performSearch: jest.fn()
}));

jest.mock('../replacer', () => ({
  replaceAll: jest.fn(),
  replaceOne: jest.fn()
}));

const performSearchMock = performSearch as jest.MockedFunction<typeof performSearch>;

const createContext = (): CommandContext => ({
  extensionContext: { subscriptions: [], extensionUri: vscode.Uri.parse('file:///extension') } as unknown as vscode.ExtensionContext,
  panelManager: {} as any,
  viewManager: { openView: jest.fn() } as any,
  sidebarProvider: {} as any,
  getSidebarVisible: () => false,
  onSidebarVisibilityChange: () => {},
  getBottomVisible: () => false,
  onBottomVisibilityChange: () => {}
});

describe('quickPickCommand', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates and shows a QuickPick with toggle buttons', async () => {
    performSearchMock.mockResolvedValue([]);
    await quickPickCommand(createContext());

    const created = (vscode.window.createQuickPick as jest.Mock).mock.results[0].value;
    expect(created.show).toHaveBeenCalled();
    expect(created.buttons).toHaveLength(3);
  });

  it('runs search when value changes and opens selection', async () => {
    const onDidChangeValue = jest.fn();
    const onDidAccept = jest.fn();
    const onDidHide = jest.fn();
    const onDidTriggerButton = jest.fn();
    (vscode.window.createQuickPick as jest.Mock).mockReturnValueOnce({
      title: '',
      placeholder: '',
      matchOnDescription: false,
      matchOnDetail: false,
      ignoreFocusOut: false,
      busy: false,
      value: '',
      items: [],
      buttons: [],
      selectedItems: [],
      onDidChangeValue,
      onDidAccept,
      onDidHide,
      onDidTriggerButton,
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn()
    });

    const result = {
      uri: 'file:///test.ts',
      fileName: 'test.ts',
      relativePath: 'test.ts',
      line: 3,
      character: 5,
      length: 3,
      preview: 'const foo = 1;',
      previewMatchRange: { start: 6, end: 9 }
    };
    performSearchMock.mockResolvedValue([result]);

    await quickPickCommand(createContext());

    const created = (vscode.window.createQuickPick as jest.Mock).mock.results[0].value;
    const changeHandler = onDidChangeValue.mock.calls[0][0];
    changeHandler('foo');
    jest.runAllTimers();
    await Promise.resolve();
    expect(performSearchMock).toHaveBeenCalled();

    created.selectedItems = [{ label: 'test.ts', description: '4:6', detail: 'const foo = 1;', result }];
    const acceptHandler = onDidAccept.mock.calls[0][0];
    await acceptHandler();

    expect(vscode.workspace.openTextDocument).toHaveBeenCalled();
    expect(vscode.window.showTextDocument).toHaveBeenCalled();
  });

  it('toggles options when buttons are triggered', async () => {
    const onDidChangeValue = jest.fn();
    const onDidAccept = jest.fn();
    const onDidHide = jest.fn();
    const onDidTriggerButton = jest.fn();
    (vscode.window.createQuickPick as jest.Mock).mockReturnValueOnce({
      title: '',
      placeholder: '',
      matchOnDescription: false,
      matchOnDetail: false,
      ignoreFocusOut: false,
      busy: false,
      value: '',
      items: [],
      buttons: [],
      selectedItems: [],
      onDidChangeValue,
      onDidAccept,
      onDidHide,
      onDidTriggerButton,
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn()
    });

    performSearchMock.mockResolvedValue([]);
    await quickPickCommand(createContext());

    const created = (vscode.window.createQuickPick as jest.Mock).mock.results[0].value;
    const triggerHandler = onDidTriggerButton.mock.calls[0][0];
    const firstButton = created.buttons[0];

    created.value = 'toggle';

    triggerHandler(firstButton);
    jest.runAllTimers();
    await Promise.resolve();
    expect(performSearchMock).toHaveBeenCalled();
  });

  it('adds overflow item and opens webview on accept', async () => {
    const onDidChangeValue = jest.fn();
    const onDidAccept = jest.fn();
    const onDidHide = jest.fn();
    const onDidTriggerButton = jest.fn();
    (vscode.window.createQuickPick as jest.Mock).mockReturnValueOnce({
      title: '',
      placeholder: '',
      matchOnDescription: false,
      matchOnDetail: false,
      ignoreFocusOut: false,
      busy: false,
      value: '',
      items: [],
      buttons: [],
      selectedItems: [],
      onDidChangeValue,
      onDidAccept,
      onDidHide,
      onDidTriggerButton,
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn()
    });

    const result = {
      uri: 'file:///test.ts',
      fileName: 'test.ts',
      relativePath: 'test.ts',
      line: 3,
      character: 5,
      length: 3,
      preview: 'const foo = 1;',
      previewMatchRange: { start: 6, end: 9 }
    };
    performSearchMock.mockResolvedValue(Array.from({ length: 50 }, () => result));

    const ctx = createContext();
    await quickPickCommand(ctx);

    const created = (vscode.window.createQuickPick as jest.Mock).mock.results[0].value;
    const changeHandler = onDidChangeValue.mock.calls[0][0];
    changeHandler('foo');
    jest.runAllTimers();
    await Promise.resolve();

    expect(created.items).toHaveLength(51);
    expect(created.items[50].label).toContain('Show all results in Rifler');

    created.value = 'foo';
    created.selectedItems = [created.items[50]];
    const acceptHandler = onDidAccept.mock.calls[0][0];
    await acceptHandler();

    expect(created.hide).toHaveBeenCalled();
    expect(ctx.viewManager.openView).toHaveBeenCalledWith({
      initialQuery: 'foo',
      initialQueryFocus: false
    });
  });

  it('does not add overflow item when results below cap', async () => {
    const onDidChangeValue = jest.fn();
    const onDidAccept = jest.fn();
    const onDidHide = jest.fn();
    const onDidTriggerButton = jest.fn();
    (vscode.window.createQuickPick as jest.Mock).mockReturnValueOnce({
      title: '',
      placeholder: '',
      matchOnDescription: false,
      matchOnDetail: false,
      ignoreFocusOut: false,
      busy: false,
      value: '',
      items: [],
      buttons: [],
      selectedItems: [],
      onDidChangeValue,
      onDidAccept,
      onDidHide,
      onDidTriggerButton,
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn()
    });

    const result = {
      uri: 'file:///test.ts',
      fileName: 'test.ts',
      relativePath: 'test.ts',
      line: 3,
      character: 5,
      length: 3,
      preview: 'const foo = 1;',
      previewMatchRange: { start: 6, end: 9 }
    };
    performSearchMock.mockResolvedValue(Array.from({ length: 2 }, () => result));

    await quickPickCommand(createContext());

    const created = (vscode.window.createQuickPick as jest.Mock).mock.results[0].value;
    const changeHandler = onDidChangeValue.mock.calls[0][0];
    changeHandler('foo');
    jest.runAllTimers();
    await Promise.resolve();

    expect(created.items).toHaveLength(2);
    expect(created.items.some((item: { label: string }) => item.label.includes('Show all results in Rifler'))).toBe(false);
  });
});

describe('quickPickReplaceCommand', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs replace one flow from selection', async () => {
    const onDidChangeValue = jest.fn();
    const onDidAccept = jest.fn();
    const onDidHide = jest.fn();
    const onDidTriggerButton = jest.fn();
    (vscode.window.createQuickPick as jest.Mock).mockReturnValueOnce({
      title: '',
      placeholder: '',
      matchOnDescription: false,
      matchOnDetail: false,
      ignoreFocusOut: false,
      busy: false,
      value: '',
      items: [],
      buttons: [],
      selectedItems: [],
      onDidChangeValue,
      onDidAccept,
      onDidHide,
      onDidTriggerButton,
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn()
    });

    const result = {
      uri: 'file:///test.ts',
      fileName: 'test.ts',
      relativePath: 'test.ts',
      line: 3,
      character: 5,
      length: 3,
      preview: 'const foo = 1;',
      previewMatchRange: { start: 6, end: 9 }
    };
    performSearchMock.mockResolvedValue([result]);
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue('bar');
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({ label: 'Replace One' });

    await quickPickReplaceCommand(createContext());

    const created = (vscode.window.createQuickPick as jest.Mock).mock.results[0].value;
    const changeHandler = onDidChangeValue.mock.calls[0][0];
    changeHandler('foo');
    jest.runAllTimers();
    await Promise.resolve();

    created.value = 'foo';
    created.selectedItems = [{ label: 'test.ts', description: '4:6', detail: 'const foo = 1;', result }];
    const acceptHandler = onDidAccept.mock.calls[0][0];
    await acceptHandler();

    expect(replaceOne).toHaveBeenCalled();
  });

  it('opens webview replace when overflow item is accepted', async () => {
    const onDidChangeValue = jest.fn();
    const onDidAccept = jest.fn();
    const onDidHide = jest.fn();
    const onDidTriggerButton = jest.fn();
    (vscode.window.createQuickPick as jest.Mock).mockReturnValueOnce({
      title: '',
      placeholder: '',
      matchOnDescription: false,
      matchOnDetail: false,
      ignoreFocusOut: false,
      busy: false,
      value: '',
      items: [],
      buttons: [],
      selectedItems: [],
      onDidChangeValue,
      onDidAccept,
      onDidHide,
      onDidTriggerButton,
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn()
    });

    const result = {
      uri: 'file:///test.ts',
      fileName: 'test.ts',
      relativePath: 'test.ts',
      line: 3,
      character: 5,
      length: 3,
      preview: 'const foo = 1;',
      previewMatchRange: { start: 6, end: 9 }
    };
    performSearchMock.mockResolvedValue(Array.from({ length: 50 }, () => result));

    const ctx = createContext();
    await quickPickReplaceCommand(ctx);

    const created = (vscode.window.createQuickPick as jest.Mock).mock.results[0].value;
    const changeHandler = onDidChangeValue.mock.calls[0][0];
    changeHandler('foo');
    jest.runAllTimers();
    await Promise.resolve();

    created.value = 'foo';
    created.selectedItems = [created.items[50]];
    const acceptHandler = onDidAccept.mock.calls[0][0];
    await acceptHandler();

    expect(created.hide).toHaveBeenCalled();
    expect(ctx.viewManager.openView).toHaveBeenCalledWith({
      initialQuery: 'foo',
      initialQueryFocus: false,
      showReplace: true
    });
    expect(replaceOne).not.toHaveBeenCalled();
  });
});
