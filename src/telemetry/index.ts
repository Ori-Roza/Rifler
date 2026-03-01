import * as vscode from 'vscode';
import { createTelemetryOutputChannel } from './outputChannel';
import { createTelemetrySender, RiflerTelemetrySender } from './sender';

let telemetryLogger: vscode.TelemetryLogger | undefined;
let sender: RiflerTelemetrySender | undefined;
let outputChannel: vscode.OutputChannel | undefined;

export function initTelemetry(context: vscode.ExtensionContext): void {
  // Always create the real sender so events reach our own backend.
  // vscode.env.isTelemetryEnabled reflects the user's VS Code telemetry
  // setting, but that controls Microsoft telemetry — not ours.  The
  // Extension Development Host may also report `false` even when the
  // parent VS Code has telemetry set to "all".
  const output = createTelemetryOutputChannel();
  outputChannel = output.channel;

  const enrichBase = () => ({
    machine_id: vscode.env.machineId,
    session_id: vscode.env.sessionId,
    extension_version: vscode.extensions.getExtension('Ori-Roza.rifler')?.packageJSON.version,
  });

  sender = createTelemetrySender(output, enrichBase);
  // Use the shim logger that delegates directly to our sender so every
  // event (usage + error) reaches the backend regardless of the VS Code
  // telemetryLevel setting.
  telemetryLogger = createShimTelemetryLogger(sender);

  context.subscriptions.push(telemetryLogger, output.channel);
}

export function getTelemetryLogger(): vscode.TelemetryLogger | undefined {
  return telemetryLogger;
}

export function showTelemetryOutput(): void {
  outputChannel?.show(true);
}

export async function disposeTelemetry(): Promise<void> {
  if (sender) {
    await sender.flush();
  }
  telemetryLogger?.dispose();
}

function createShimTelemetryLogger(overrides?: { sendEventData?: (eventName: string, data?: Record<string, unknown>) => void; sendErrorData?: (error: Error, data?: Record<string, unknown>) => void }): vscode.TelemetryLogger {
  const noop = () => {};
  const sendEventData = overrides?.sendEventData ?? noop;
  const sendErrorData = overrides?.sendErrorData ?? noop;
  return {
    logUsage: (eventName: string, data?: Record<string, unknown>) => sendEventData(eventName, data),
    logError: (error: Error, data?: Record<string, unknown>) => sendErrorData(error, data),
    dispose: () => {}
  } as vscode.TelemetryLogger;
}
