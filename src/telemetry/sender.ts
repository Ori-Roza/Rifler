import * as https from 'node:https';
import { TELEMETRY_ENDPOINT, TELEMETRY_TOKEN } from './config';
import { TelemetryOutputChannel } from './outputChannel';

type TelemetryPayload = {
  event_name: string;
  properties: Record<string, unknown>;
  is_error?: boolean;
};

interface QueueItem extends TelemetryPayload {}

interface CircuitBreakerState {
  consecutiveFailures: number;
  blockedUntil: number;
}

export interface RiflerTelemetrySender extends vscode.TelemetrySender {
  flush(): Promise<void>;
}

import * as vscode from 'vscode';

const MAX_QUEUE_SIZE = 50;
const FLUSH_INTERVAL_MS = 10_000;
const MAX_BATCH_SIZE = 20;
const FAILURE_THRESHOLD = 3;
const BLOCK_DURATION_MS = 5 * 60_000;

export function createTelemetrySender(
  channel: TelemetryOutputChannel,
  enrichBase: () => Record<string, unknown>
): RiflerTelemetrySender {
  let queue: QueueItem[] = [];
  let timer: NodeJS.Timeout | undefined;
  const breaker: CircuitBreakerState = { consecutiveFailures: 0, blockedUntil: 0 };

  const scheduleFlush = () => {
    if (!timer) {
      timer = setTimeout(async () => {
        timer = undefined;
        await flush();
      }, FLUSH_INTERVAL_MS);
    }
  };

  const addToQueue = (item: QueueItem) => {
    if (Date.now() < breaker.blockedUntil) {
      return; // Circuit is open; drop events silently
    }

    if (queue.length >= MAX_QUEUE_SIZE) {
      queue.shift();
    }
    queue.push(item);
    if (queue.length >= MAX_BATCH_SIZE) {
      void flush();
    } else {
      scheduleFlush();
    }
  };

  const postBatch = async (batch: QueueItem[]): Promise<void> => {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({ events: batch });
      const url = new URL(TELEMETRY_ENDPOINT);

      const options: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'X-Extension-Token': TELEMETRY_TOKEN,
        },
      };

      const req = https.request(options, (res) => {
        // Consume the response body so the socket can be reused / freed.
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          const code = res.statusCode ?? 0;
          reject(new Error(`Telemetry POST failed with status ${code}`));
        }
      });

      req.on('error', (err) => reject(err));
      req.write(payload);
      req.end();
    });
  };

  const flush = async (): Promise<void> => {
    if (queue.length === 0) return;
    const batch = queue.slice(0, MAX_BATCH_SIZE);
    queue = queue.slice(batch.length);

    try {
      await postBatch(batch);
      breaker.consecutiveFailures = 0;
    } catch (err) {
      breaker.consecutiveFailures += 1;
      if (breaker.consecutiveFailures >= FAILURE_THRESHOLD) {
        breaker.blockedUntil = Date.now() + BLOCK_DURATION_MS;
      }
      channel.logError('telemetry_flush_failed', {
        message: err instanceof Error ? err.message : String(err),
        failureCount: breaker.consecutiveFailures,
      });
    }

    if (queue.length > 0) {
      scheduleFlush();
    }
  };

  const enrich = (properties: Record<string, unknown>) => ({
    ...properties,
    ...enrichBase(),
  });

  const sender: RiflerTelemetrySender = {
    sendEventData: (eventName, data) => {
      const props = enrich(data ?? {});
      channel.logEvent(eventName, props);
      addToQueue({ event_name: eventName, properties: props, is_error: false });
      if (eventName === 'search_completed') {
        void flush();
      }
    },
    sendErrorData: (error, data) => {
      const props = enrich({ message: error?.message, ...(data ?? {}) });
      channel.logError('error', { event: 'error', ...props });
      addToQueue({ event_name: 'error', properties: props, is_error: true });
    },
    flush,
  };

  return sender;
}
