import * as vscode from 'vscode';

export interface TelemetryOutputChannel {
  channel: vscode.OutputChannel;
  logEvent: (eventName: string, properties: Record<string, unknown>) => void;
  logError: (eventName: string, properties: Record<string, unknown>) => void;
}

export function createTelemetryOutputChannel(): TelemetryOutputChannel {
  const channel = vscode.window.createOutputChannel('Rifler Telemetry');

  const log = (prefix: string, eventName: string, properties: Record<string, unknown>) => {
    const timestamp = new Date().toISOString();
    channel.appendLine(`${timestamp} ${prefix} ${eventName} ${JSON.stringify(properties)}`);
  };

  return {
    channel,
    logEvent: (eventName, properties) => log('[event]', eventName, properties),
    logError: (eventName, properties) => log('[error]', eventName, properties),
  };
}
