import * as vscode from 'vscode';
import { createTelemetryOutputChannel } from '../../telemetry/outputChannel';

describe('TelemetryOutputChannel', () => {
  let mockAppendLine: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAppendLine = (vscode.window.createOutputChannel as jest.Mock).mock.results[0]?.value?.appendLine;
    if (!mockAppendLine) {
      // Ensure fresh mock
      (vscode.window.createOutputChannel as jest.Mock).mockReturnValue({
        appendLine: jest.fn(),
        append: jest.fn(),
        clear: jest.fn(),
        show: jest.fn(),
        hide: jest.fn(),
        dispose: jest.fn(),
      });
    }
  });

  it('should create an output channel named "Rifler Telemetry"', () => {
    createTelemetryOutputChannel();
    expect(vscode.window.createOutputChannel).toHaveBeenCalledWith('Rifler Telemetry');
  });

  it('should return a channel, logEvent, and logError', () => {
    const output = createTelemetryOutputChannel();
    expect(output.channel).toBeDefined();
    expect(typeof output.logEvent).toBe('function');
    expect(typeof output.logError).toBe('function');
  });

  it('logEvent should write timestamped [event] line to channel', () => {
    const output = createTelemetryOutputChannel();
    output.logEvent('test_event', { key: 'value' });

    const appendLine = output.channel.appendLine as jest.Mock;
    expect(appendLine).toHaveBeenCalledTimes(1);

    const line = appendLine.mock.calls[0][0] as string;
    expect(line).toContain('[event]');
    expect(line).toContain('test_event');
    expect(line).toContain('"key":"value"');
    // Should start with ISO timestamp
    expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('logError should write timestamped [error] line to channel', () => {
    const output = createTelemetryOutputChannel();
    output.logError('some_error', { message: 'something failed' });

    const appendLine = output.channel.appendLine as jest.Mock;
    expect(appendLine).toHaveBeenCalledTimes(1);

    const line = appendLine.mock.calls[0][0] as string;
    expect(line).toContain('[error]');
    expect(line).toContain('some_error');
    expect(line).toContain('something failed');
  });

  it('should JSON-serialize properties', () => {
    const output = createTelemetryOutputChannel();
    output.logEvent('complex', { nested: { a: 1 }, arr: [1, 2] });

    const appendLine = output.channel.appendLine as jest.Mock;
    const line = appendLine.mock.calls[0][0] as string;
    expect(line).toContain('"nested":{"a":1}');
    expect(line).toContain('"arr":[1,2]');
  });
});
