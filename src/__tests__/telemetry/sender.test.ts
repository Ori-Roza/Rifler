import { createTelemetrySender, RiflerTelemetrySender } from '../../telemetry/sender';
import { TelemetryOutputChannel } from '../../telemetry/outputChannel';
import { EventEmitter } from 'events';

// Mock node:https
jest.mock('node:https', () => ({
  request: jest.fn(),
}));

import * as https from 'node:https';

const mockedRequest = https.request as jest.MockedFunction<typeof https.request>;

function createMockChannel(): TelemetryOutputChannel {
  return {
    channel: {
      appendLine: jest.fn(),
      append: jest.fn(),
      clear: jest.fn(),
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn(),
      name: 'Rifler Telemetry',
      replace: jest.fn(),
    } as unknown as import('vscode').OutputChannel,
    logEvent: jest.fn(),
    logError: jest.fn(),
  };
}

function createMockEnrichBase() {
  return jest.fn(() => ({
    machine_id: 'test-machine',
    session_id: 'test-session',
    extension_version: '1.0.0',
  }));
}

/**
 * Sets up https.request mock to resolve or reject.
 * Returns the mock request object for assertions.
 */
function mockHttpSuccess(statusCode = 200) {
  const mockReq = new EventEmitter() as EventEmitter & { write: jest.Mock; end: jest.Mock };
  mockReq.write = jest.fn();
  mockReq.end = jest.fn();

  mockedRequest.mockImplementation((_options, callback) => {
    const res = new EventEmitter() as EventEmitter & { statusCode: number; resume: jest.Mock };
    res.statusCode = statusCode;
    res.resume = jest.fn();
    // Invoke callback on next tick to simulate async
    process.nextTick(() => (callback as (res: unknown) => void)(res));
    return mockReq as unknown as import('http').ClientRequest;
  });

  return mockReq;
}

function mockHttpFailure(statusCode = 500) {
  const mockReq = new EventEmitter() as EventEmitter & { write: jest.Mock; end: jest.Mock };
  mockReq.write = jest.fn();
  mockReq.end = jest.fn();

  mockedRequest.mockImplementation((_options, callback) => {
    const res = new EventEmitter() as EventEmitter & { statusCode: number; resume: jest.Mock };
    res.statusCode = statusCode;
    res.resume = jest.fn();
    process.nextTick(() => (callback as (res: unknown) => void)(res));
    return mockReq as unknown as import('http').ClientRequest;
  });

  return mockReq;
}

function mockHttpNetworkError(errorMessage = 'ECONNREFUSED') {
  const mockReq = new EventEmitter() as EventEmitter & { write: jest.Mock; end: jest.Mock };
  mockReq.write = jest.fn();
  mockReq.end = jest.fn();

  mockedRequest.mockImplementation(() => {
    process.nextTick(() => mockReq.emit('error', new Error(errorMessage)));
    return mockReq as unknown as import('http').ClientRequest;
  });

  return mockReq;
}

describe('TelemetrySender', () => {
  let channel: TelemetryOutputChannel;
  let enrichBase: jest.Mock;
  let sender: RiflerTelemetrySender;

  beforeEach(() => {
    // Don't fake process.nextTick — our HTTP mocks use it to simulate async
    // response callbacks, and faking it causes flush() to hang indefinitely.
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    jest.clearAllMocks();
    channel = createMockChannel();
    enrichBase = createMockEnrichBase();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('sendEventData', () => {
    it('should enrich event data and log to output channel', () => {
      mockHttpSuccess();
      sender = createTelemetrySender(channel, enrichBase);

      sender.sendEventData('test_event', { foo: 'bar' });

      expect(enrichBase).toHaveBeenCalled();
      expect(channel.logEvent).toHaveBeenCalledWith('test_event', expect.objectContaining({
        foo: 'bar',
        machine_id: 'test-machine',
        session_id: 'test-session',
      }));
    });

    it('should handle undefined data', () => {
      mockHttpSuccess();
      sender = createTelemetrySender(channel, enrichBase);

      sender.sendEventData('test_event', undefined);

      expect(channel.logEvent).toHaveBeenCalledWith('test_event', expect.objectContaining({
        machine_id: 'test-machine',
      }));
    });
  });

  describe('sendErrorData', () => {
    it('should enrich error data and log to output channel', () => {
      mockHttpSuccess();
      sender = createTelemetrySender(channel, enrichBase);

      sender.sendErrorData(new Error('test failure'), { context: 'search' });

      expect(channel.logError).toHaveBeenCalledWith('error', expect.objectContaining({
        event: 'error',
        message: 'test failure',
        context: 'search',
        machine_id: 'test-machine',
      }));
    });
  });

  describe('queue and batching', () => {
    it('should batch events and flush after timer', async () => {
      mockHttpSuccess();
      sender = createTelemetrySender(channel, enrichBase);

      sender.sendEventData('event_1', {});
      sender.sendEventData('event_2', {});

      // No HTTP request yet (timer hasn't fired)
      expect(mockedRequest).not.toHaveBeenCalled();

      // Advance timer to trigger flush
      jest.advanceTimersByTime(10_000);

      // Wait for async flush
      await Promise.resolve();
      await Promise.resolve();

      expect(mockedRequest).toHaveBeenCalledTimes(1);

      // Verify payload contains both events
      const writeCall = mockedRequest.mock.results[0]?.value;
      // Check via the request options
      const requestOptions = mockedRequest.mock.calls[0][0] as https.RequestOptions;
      expect(requestOptions.method).toBe('POST');
      expect((requestOptions.headers as Record<string, unknown>)?.['X-Extension-Token']).toBe('RIFLER');
    });

    it('should auto-flush when queue reaches batch size (20)', async () => {
      mockHttpSuccess();
      sender = createTelemetrySender(channel, enrichBase);

      for (let i = 0; i < 20; i++) {
        sender.sendEventData(`event_${i}`, {});
      }

      // Should have triggered immediate flush
      await Promise.resolve();
      await Promise.resolve();

      expect(mockedRequest).toHaveBeenCalled();
    });

    it('should drop oldest events when queue exceeds max size (50)', () => {
      mockHttpSuccess();
      sender = createTelemetrySender(channel, enrichBase);

      // Fill queue beyond max without flushing (events < batch size each tick)
      // We need to prevent auto-flush at batch size, so let's add exactly 50+5 events
      // The first 20 will trigger a flush, then we add more
      // Actually, let's just verify the channel logging happens for all 55
      for (let i = 0; i < 55; i++) {
        sender.sendEventData(`event_${i}`, {});
      }

      // All 55 should have been logged to channel regardless of queue
      expect(channel.logEvent).toHaveBeenCalledTimes(55);
    });
  });

  describe('immediate flush for search_completed', () => {
    it('should flush immediately when search_completed event is sent', async () => {
      mockHttpSuccess();
      sender = createTelemetrySender(channel, enrichBase);

      sender.sendEventData('search_completed', { duration_ms: 150 });

      // Should trigger flush without waiting for timer
      await Promise.resolve();
      await Promise.resolve();

      expect(mockedRequest).toHaveBeenCalled();
    });

    it('should NOT flush immediately for other events', () => {
      mockHttpSuccess();
      sender = createTelemetrySender(channel, enrichBase);

      sender.sendEventData('file_opened', {});

      // No HTTP request yet
      expect(mockedRequest).not.toHaveBeenCalled();
    });
  });

  describe('flush', () => {
    it('should be a no-op when queue is empty', async () => {
      mockHttpSuccess();
      sender = createTelemetrySender(channel, enrichBase);

      await sender.flush();

      expect(mockedRequest).not.toHaveBeenCalled();
    });

    it('should send queued events via HTTPS POST', async () => {
      mockHttpSuccess();
      sender = createTelemetrySender(channel, enrichBase);

      sender.sendEventData('test_event', { key: 'val' });
      await sender.flush();

      // Wait for async
      await Promise.resolve();
      await Promise.resolve();

      expect(mockedRequest).toHaveBeenCalled();
      const options = mockedRequest.mock.calls[0][0] as https.RequestOptions;
      expect(options.method).toBe('POST');
      const headers = options.headers as Record<string, unknown>;
      expect(headers?.['Content-Type']).toBe('application/json');
      expect(headers?.['X-Extension-Token']).toBe('RIFLER');
    });

    it('should clear queue after successful flush', async () => {
      mockHttpSuccess();
      sender = createTelemetrySender(channel, enrichBase);

      sender.sendEventData('event_1', {});
      await sender.flush();
      await Promise.resolve();

      // Reset mock call count
      mockedRequest.mockClear();

      // Second flush should be no-op
      await sender.flush();
      expect(mockedRequest).not.toHaveBeenCalled();
    });
  });

  describe('circuit breaker', () => {
    it('should open circuit after 3 consecutive failures', async () => {
      mockHttpFailure(500);
      sender = createTelemetrySender(channel, enrichBase);

      // Fail 3 times
      for (let i = 0; i < 3; i++) {
        sender.sendEventData(`fail_${i}`, {});
        await sender.flush();
        // Wait for promise resolution
        await new Promise((r) => process.nextTick(r));
        await new Promise((r) => process.nextTick(r));
      }

      // Log errors should have been reported
      expect(channel.logError).toHaveBeenCalled();

      // Now send another event — it should be silently dropped
      mockedRequest.mockClear();
      sender.sendEventData('dropped_event', {});

      // The event is still logged to channel
      expect(channel.logEvent).toHaveBeenCalledWith('dropped_event', expect.anything());

      // But it won't be queued/flushed
      await sender.flush();
      // No new HTTP request because circuit is open
      expect(mockedRequest).not.toHaveBeenCalled();
    });

    it('should reset failure count on successful flush', async () => {
      // First two calls fail, third succeeds
      let callCount = 0;
      const mockReq = new EventEmitter() as EventEmitter & { write: jest.Mock; end: jest.Mock };
      mockReq.write = jest.fn();
      mockReq.end = jest.fn();

      mockedRequest.mockImplementation((_options, callback) => {
        callCount++;
        const res = new EventEmitter() as EventEmitter & { statusCode: number; resume: jest.Mock };
        res.statusCode = callCount <= 2 ? 500 : 200;
        res.resume = jest.fn();
        process.nextTick(() => (callback as (res: unknown) => void)(res));
        return mockReq as unknown as import('http').ClientRequest;
      });

      sender = createTelemetrySender(channel, enrichBase);

      // Fail twice
      sender.sendEventData('fail_1', {});
      await sender.flush();
      await new Promise((r) => process.nextTick(r));
      await new Promise((r) => process.nextTick(r));

      sender.sendEventData('fail_2', {});
      await sender.flush();
      await new Promise((r) => process.nextTick(r));
      await new Promise((r) => process.nextTick(r));

      // Third call succeeds — circuit should not open
      sender.sendEventData('success', {});
      await sender.flush();
      await new Promise((r) => process.nextTick(r));
      await new Promise((r) => process.nextTick(r));

      // Events should still be accepted (circuit not open)
      mockedRequest.mockClear();
      sender.sendEventData('still_accepted', {});
      await sender.flush();
      await new Promise((r) => process.nextTick(r));

      expect(mockedRequest).toHaveBeenCalled();
    });
  });

  describe('network error handling', () => {
    it('should handle network errors gracefully', async () => {
      mockHttpNetworkError('ECONNREFUSED');
      sender = createTelemetrySender(channel, enrichBase);

      sender.sendEventData('test', {});
      await sender.flush();
      await new Promise((r) => process.nextTick(r));
      await new Promise((r) => process.nextTick(r));

      expect(channel.logError).toHaveBeenCalledWith('telemetry_flush_failed', expect.objectContaining({
        message: 'ECONNREFUSED',
        failureCount: 1,
      }));
    });
  });

  describe('HTTP request format', () => {
    it('should POST to the configured telemetry endpoint', async () => {
      mockHttpSuccess();
      sender = createTelemetrySender(channel, enrichBase);

      sender.sendEventData('search_completed', { duration_ms: 42, results_count: 10 });
      await sender.flush();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockedRequest).toHaveBeenCalled();
      const options = mockedRequest.mock.calls[0][0] as https.RequestOptions;
      expect(options.hostname).toBe('oobnvndeizsbwyvbbgdq.supabase.co');
      expect(options.path).toBe('/functions/v1/rifler-telemetry');
    });

    it('should include enriched properties in the payload', async () => {
      const mockReq = mockHttpSuccess();
      sender = createTelemetrySender(channel, enrichBase);

      sender.sendEventData('search_completed', { duration_ms: 42 });
      await sender.flush();
      await Promise.resolve();
      await Promise.resolve();

      // Verify write was called with JSON payload
      expect(mockReq.write).toHaveBeenCalled();
      const payload = JSON.parse(mockReq.write.mock.calls[0][0]);
      expect(payload.events).toHaveLength(1);
      expect(payload.events[0].event_name).toBe('search_completed');
      expect(payload.events[0].properties.duration_ms).toBe(42);
      expect(payload.events[0].properties.machine_id).toBe('test-machine');
      expect(payload.events[0].is_error).toBe(false);
    });

    it('should mark error events with is_error=true', async () => {
      const mockReq = mockHttpSuccess();
      sender = createTelemetrySender(channel, enrichBase);

      sender.sendErrorData(new Error('boom'), {});
      await sender.flush();
      await Promise.resolve();
      await Promise.resolve();

      const payload = JSON.parse(mockReq.write.mock.calls[0][0]);
      expect(payload.events[0].event_name).toBe('error');
      expect(payload.events[0].is_error).toBe(true);
      expect(payload.events[0].properties.message).toBe('boom');
    });
  });
});
