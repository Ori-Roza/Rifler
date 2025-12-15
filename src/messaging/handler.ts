import * as vscode from 'vscode';
import { IncomingMessage } from './types';

/**
 * Type definition for message handler functions
 */
export type MessageHandlerFn = (message: IncomingMessage | Record<string, unknown>) => Promise<void>;

/**
 * Unified message handler for webview messages
 * Provides a registry pattern for message type handlers
 */
export class MessageHandler {
  private handlers: Map<string, MessageHandlerFn> = new Map();

  constructor(private panel: vscode.WebviewPanel | vscode.WebviewView) {}

  /**
   * Register a handler for a specific message type
   */
  registerHandler(type: string, handler: MessageHandlerFn): void {
    this.handlers.set(type, handler);
  }

  /**
   * Handle an incoming message by dispatching to the registered handler
   */
  async handle(message: IncomingMessage): Promise<void> {
    const handler = this.handlers.get(message.type);

    if (!handler) {
      console.warn(`No handler registered for message type: ${message.type}`);
      return;
    }

    try {
      await handler(message);
    } catch (error) {
      console.error(`Error handling message type '${message.type}':`, error);
      this.sendError(`Failed to handle ${message.type}: ${error}`);
    }
  }

  /**
   * Send a message to the webview
   */
  postMessage(message: Record<string, unknown>): void {
    // Support both WebviewPanel and WebviewView
    if ('webview' in this.panel) {
      (this.panel as vscode.WebviewPanel).webview.postMessage(message);
    } else {
      (this.panel as vscode.WebviewView).webview.postMessage(message);
    }
  }

  /**
   * Send an error message to the webview
   */
  private sendError(message: string): void {
    this.postMessage({
      type: 'error',
      message
    });
  }

  /**
   * Get the underlying webview from either panel or view
   */
  get webview(): vscode.Webview {
    if ('webview' in this.panel) {
      return (this.panel as vscode.WebviewPanel).webview;
    } else {
      return (this.panel as vscode.WebviewView).webview;
    }
  }
}
