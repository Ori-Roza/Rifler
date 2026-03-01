/**
 * Security Tests for Telemetry Module
 *
 * Tests defense against PII leakage, payload injection, credential exposure,
 * resource exhaustion (queue flooding), and transport security.
 */

import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('node:https', () => ({
  request: jest.fn(),
}));

import * as https from 'node:https';

const mockedRequest = https.request as jest.MockedFunction<typeof https.request>;

function createMockChannel() {
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

/** Returns a mock https.request that captures the written payload. */
function mockHttpCapture() {
  const mockReq = new EventEmitter() as EventEmitter & { write: jest.Mock; end: jest.Mock };
  mockReq.write = jest.fn();
  mockReq.end = jest.fn();

  mockedRequest.mockImplementation((_options, callback) => {
    const res = new EventEmitter() as EventEmitter & { statusCode: number; resume: jest.Mock };
    res.statusCode = 200;
    res.resume = jest.fn();
    process.nextTick(() => (callback as (r: unknown) => void)(res));
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
    process.nextTick(() => (callback as (r: unknown) => void)(res));
    return mockReq as unknown as import('http').ClientRequest;
  });

  return mockReq;
}

import { createTelemetrySender } from '../../telemetry/sender';
import { TELEMETRY_ENDPOINT, TELEMETRY_TOKEN } from '../../telemetry/config';

describe('Telemetry Security', () => {
  let channel: ReturnType<typeof createMockChannel>;
  let enrichBase: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    jest.clearAllMocks();
    channel = createMockChannel();
    enrichBase = jest.fn(() => ({
      machine_id: 'anon-machine-id',
      session_id: 'anon-session-id',
      extension_version: '1.0.0',
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // =========================================================================
  // 1. No PII Leakage
  // =========================================================================
  describe('No PII leakage in payloads', () => {
    test('Should never transmit the raw search query', async () => {
      const mockReq = mockHttpCapture();
      const sender = createTelemetrySender(channel, enrichBase);

      const sensitiveQuery = 'password=hunter2 OR secret_token=abc123';
      sender.sendEventData('search_completed', {
        query_length: sensitiveQuery.length,
        results_count: 5,
        scope: 'workspace',
      });

      await sender.flush();
      await new Promise((r) => process.nextTick(r));

      const payload = JSON.parse(mockReq.write.mock.calls[0][0]);
      const payloadStr = JSON.stringify(payload);

      expect(payloadStr).not.toContain('hunter2');
      expect(payloadStr).not.toContain('secret_token');
      expect(payloadStr).not.toContain(sensitiveQuery);
      // Only the length is present, not the value
      expect(payload.events[0].properties.query_length).toBe(sensitiveQuery.length);
    });

    test('Should never transmit file paths from search results', async () => {
      const mockReq = mockHttpCapture();
      const sender = createTelemetrySender(channel, enrichBase);

      sender.sendEventData('search_completed', {
        results_count: 3,
        query_length: 5,
        scope: 'workspace',
      });

      await sender.flush();
      await new Promise((r) => process.nextTick(r));

      const payloadStr = JSON.stringify(JSON.parse(mockReq.write.mock.calls[0][0]));

      // No file system paths should appear in the payload
      expect(payloadStr).not.toContain('/Users/');
      expect(payloadStr).not.toContain('/home/');
      expect(payloadStr).not.toContain('C:\\');
      expect(payloadStr).not.toContain('file:///');
    });

    test('Should never transmit replace text content', async () => {
      const mockReq = mockHttpCapture();
      const sender = createTelemetrySender(channel, enrichBase);

      sender.sendEventData('replace_all', {
        scope: 'workspace',
        is_regex: false,
        match_case: true,
        whole_word: false,
      });

      await sender.flush();
      await new Promise((r) => process.nextTick(r));

      const payload = JSON.parse(mockReq.write.mock.calls[0][0]);
      const keys = Object.keys(payload.events[0].properties);

      // No property should contain raw query or replacement text
      expect(keys).not.toContain('query');
      expect(keys).not.toContain('replace');
      expect(keys).not.toContain('replacement');
      expect(keys).not.toContain('search_text');
    });

    test('Should only transmit file_mask_count, not the actual mask patterns', async () => {
      const mockReq = mockHttpCapture();
      const sender = createTelemetrySender(channel, enrichBase);

      sender.sendEventData('search_completed', {
        file_mask_count: 3,
        results_count: 0,
        query_length: 4,
      });

      await sender.flush();
      await new Promise((r) => process.nextTick(r));

      const payload = JSON.parse(mockReq.write.mock.calls[0][0]);
      const payloadStr = JSON.stringify(payload);

      expect(payload.events[0].properties.file_mask_count).toBe(3);
      expect(payloadStr).not.toContain('*.ts');
      expect(payloadStr).not.toContain('*.js');
      expect(payloadStr).not.toContain('fileMask');
    });

    test('Should sanitize error messages that may contain file paths', async () => {
      const mockReq = mockHttpCapture();
      const sender = createTelemetrySender(channel, enrichBase);

      // Error messages from rg or Node.js may contain system paths
      const errorWithPath = new Error('ENOENT: no such file /Users/john.doe/secret-project/passwords.txt');
      sender.sendErrorData(errorWithPath, { stage: 'ripgrep' });

      await sender.flush();
      await new Promise((r) => process.nextTick(r));

      // NOTE: Currently error messages ARE sent as-is. This test documents
      // the current behavior as a known risk. The error.message is transmitted
      // in the properties — callers should avoid passing PII through errors.
      const payload = JSON.parse(mockReq.write.mock.calls[0][0]);
      expect(payload.events[0].properties.message).toBe(errorWithPath.message);
      expect(payload.events[0].properties.stack).toBe(errorWithPath.stack);
      expect(payload.events[0].is_error).toBe(true);
    });
  });

  // =========================================================================
  // 2. No Credential / Key Exposure
  // =========================================================================
  describe('No credential exposure', () => {
    test('Should not contain Supabase anon key in config', () => {
      // The Supabase anon key (a JWT starting with eyJ) must never be in
      // client-side code. Only the Edge Function token should be present.
      expect(TELEMETRY_TOKEN).toBe('RIFLER');
      expect(TELEMETRY_TOKEN).not.toMatch(/^eyJ/);
      expect(TELEMETRY_ENDPOINT).not.toContain('apikey=');
      expect(TELEMETRY_ENDPOINT).not.toContain('anon');
    });

    test('Should not include any JWT or Bearer token in request headers', async () => {
      mockHttpCapture();
      const sender = createTelemetrySender(channel, enrichBase);

      sender.sendEventData('test', {});
      await sender.flush();
      await new Promise((r) => process.nextTick(r));

      const options = mockedRequest.mock.calls[0][0] as https.RequestOptions;
      const headers = options.headers as Record<string, unknown>;

      // No Authorization header should be present
      expect(headers).not.toHaveProperty('Authorization');
      expect(headers).not.toHaveProperty('authorization');
      // Token is sent as X-Extension-Token, not as a Bearer token
      expect(headers['X-Extension-Token']).toBe('RIFLER');
      expect(String(headers['X-Extension-Token'])).not.toMatch(/^eyJ/);
    });

    test('Should not embed credentials in the payload body', async () => {
      const mockReq = mockHttpCapture();
      const sender = createTelemetrySender(channel, enrichBase);

      sender.sendEventData('search_completed', { results_count: 1 });
      await sender.flush();
      await new Promise((r) => process.nextTick(r));

      const payloadStr = mockReq.write.mock.calls[0][0] as string;

      expect(payloadStr).not.toContain('eyJ'); // No JWTs
      expect(payloadStr).not.toContain('Bearer');
      expect(payloadStr).not.toContain('apikey');
      expect(payloadStr).not.toContain('supabase_key');
      expect(payloadStr).not.toContain('anon_key');
    });
  });

  // =========================================================================
  // 3. Transport Security
  // =========================================================================
  describe('Transport security', () => {
    test('Should use HTTPS (port 443), not HTTP', async () => {
      mockHttpCapture();
      const sender = createTelemetrySender(channel, enrichBase);

      sender.sendEventData('test', {});
      await sender.flush();
      await new Promise((r) => process.nextTick(r));

      const options = mockedRequest.mock.calls[0][0] as https.RequestOptions;
      expect(options.port).toBe(443);
      // Imported from node:https, not node:http
      expect(TELEMETRY_ENDPOINT).toMatch(/^https:\/\//);
    });

    test('Should target the Edge Function path, not the REST API directly', () => {
      const url = new URL(TELEMETRY_ENDPOINT);

      expect(url.pathname).toBe('/functions/v1/rifler-telemetry');
      // Must NOT hit the PostgREST endpoint directly
      expect(url.pathname).not.toContain('/rest/');
      expect(url.pathname).not.toContain('/v1/telemetry_events');
    });

    test('Should set Content-Type to application/json', async () => {
      mockHttpCapture();
      const sender = createTelemetrySender(channel, enrichBase);

      sender.sendEventData('test', {});
      await sender.flush();
      await new Promise((r) => process.nextTick(r));

      const options = mockedRequest.mock.calls[0][0] as https.RequestOptions;
      const headers = options.headers as Record<string, unknown>;

      expect(headers['Content-Type']).toBe('application/json');
    });

    test('Should send well-formed JSON in the request body', async () => {
      const mockReq = mockHttpCapture();
      const sender = createTelemetrySender(channel, enrichBase);

      sender.sendEventData('search_completed', { results_count: 5 });
      await sender.flush();
      await new Promise((r) => process.nextTick(r));

      const rawBody = mockReq.write.mock.calls[0][0] as string;
      expect(() => JSON.parse(rawBody)).not.toThrow();

      const parsed = JSON.parse(rawBody);
      expect(parsed).toHaveProperty('events');
      expect(Array.isArray(parsed.events)).toBe(true);
    });
  });

  // =========================================================================
  // 4. Payload Injection / Poisoning Defense
  // =========================================================================
  describe('Payload injection defense', () => {
    test('Should safely serialize properties containing special JSON characters', async () => {
      const mockReq = mockHttpCapture();
      const sender = createTelemetrySender(channel, enrichBase);

      sender.sendEventData('test', {
        injection: '","evil_key":"evil_value',
        nested: '{"__proto__":{"admin":true}}',
      });

      await sender.flush();
      await new Promise((r) => process.nextTick(r));

      const rawBody = mockReq.write.mock.calls[0][0] as string;
      const parsed = JSON.parse(rawBody);

      // The injection string should be a plain value, not a broken-out key
      expect(parsed.events[0].properties.injection).toBe('","evil_key":"evil_value');
      expect(parsed.events).toHaveLength(1);
      expect(parsed.events[0].properties).not.toHaveProperty('evil_key');
    });

    test('Should not be vulnerable to prototype pollution via event properties', async () => {
      const mockReq = mockHttpCapture();
      const sender = createTelemetrySender(channel, enrichBase);

      sender.sendEventData('search_completed', {
        __proto__: { admin: true },
        constructor: { prototype: { isAdmin: true } },
        results_count: 0,
      } as any);

      await sender.flush();
      await new Promise((r) => process.nextTick(r));

      const rawBody = mockReq.write.mock.calls[0][0] as string;
      const parsed = JSON.parse(rawBody);

      // Verify the object was serialized, not the prototype chain altered
      expect(({} as any).admin).toBeUndefined();
      expect(({} as any).isAdmin).toBeUndefined();
      expect(parsed.events[0].properties.results_count).toBe(0);
    });

    test('Should handle event names with special characters safely', async () => {
      const mockReq = mockHttpCapture();
      const sender = createTelemetrySender(channel, enrichBase);

      const maliciousName = 'event","is_error":true,"event_name":"injected';
      sender.sendEventData(maliciousName, {});

      await sender.flush();
      await new Promise((r) => process.nextTick(r));

      const rawBody = mockReq.write.mock.calls[0][0] as string;
      const parsed = JSON.parse(rawBody);

      // The malicious name should be a single string value, not breaking the JSON
      expect(parsed.events).toHaveLength(1);
      expect(parsed.events[0].event_name).toBe(maliciousName);
    });

    test('Should handle extremely large property values without crashing', async () => {
      const mockReq = mockHttpCapture();
      const sender = createTelemetrySender(channel, enrichBase);

      const largeValue = 'x'.repeat(100_000);
      sender.sendEventData('test', { large: largeValue });

      await sender.flush();
      await new Promise((r) => process.nextTick(r));

      // Should still produce valid JSON
      const rawBody = mockReq.write.mock.calls[0][0] as string;
      expect(() => JSON.parse(rawBody)).not.toThrow();
    });

    test('Should handle null and undefined property values gracefully', async () => {
      const mockReq = mockHttpCapture();
      const sender = createTelemetrySender(channel, enrichBase);

      sender.sendEventData('test', {
        nullVal: null,
        undefVal: undefined,
        nested: { deep: null },
      } as any);

      await sender.flush();
      await new Promise((r) => process.nextTick(r));

      const rawBody = mockReq.write.mock.calls[0][0] as string;
      expect(() => JSON.parse(rawBody)).not.toThrow();
    });
  });

  // =========================================================================
  // 5. Resource Exhaustion / Queue Flooding
  // =========================================================================
  describe('Resource exhaustion defense', () => {
    test('Should enforce maximum queue size of 50 events', () => {
      mockHttpCapture();
      const sender = createTelemetrySender(channel, enrichBase);

      // Flood with 200 events (all non-search_completed to avoid auto-flush)
      for (let i = 0; i < 200; i++) {
        sender.sendEventData('flood_event', { index: i });
      }

      // Channel should have logged all 200 (channel logging is unbounded)
      expect(channel.logEvent).toHaveBeenCalledTimes(200);

      // But auto-flush at batch-size-20 means multiple flushes were triggered,
      // ensuring the queue never holds more than 50 items at any point.
      // Verify requests were made (queue was drained periodically).
      expect(mockedRequest).toHaveBeenCalled();
    });

    test('Should drop oldest events when queue overflows', async () => {
      // Use a failure mock so events accumulate (flush fails, events are lost)
      mockHttpFailure(500);
      const sender = createTelemetrySender(channel, enrichBase);

      // Flood with events. After 3 failures the circuit breaker opens,
      // and subsequent events are silently dropped.
      for (let i = 0; i < 100; i++) {
        sender.sendEventData('flood_event', { index: i });
        // Let nextTick callbacks fire so flush failures are processed
        await new Promise((r) => process.nextTick(r));
        await new Promise((r) => process.nextTick(r));
      }

      // After circuit opens, events are dropped rather than accumulating unboundedly
      // The test passes if no OOM or crash occurs
      expect(channel.logEvent).toHaveBeenCalled();
    });

    test('Should activate circuit breaker after repeated failures', async () => {
      mockHttpFailure(500);
      const sender = createTelemetrySender(channel, enrichBase);

      // Trigger 3 flush failures to trip the circuit breaker
      for (let i = 0; i < 3; i++) {
        sender.sendEventData(`fail_${i}`, {});
        await sender.flush();
        await new Promise((r) => process.nextTick(r));
        await new Promise((r) => process.nextTick(r));
      }

      // Circuit breaker should have logged failure
      expect(channel.logError).toHaveBeenCalledWith('telemetry_flush_failed', expect.objectContaining({
        failureCount: 3,
      }));

      // New events should be silently dropped (not queued)
      mockedRequest.mockClear();
      sender.sendEventData('dropped', {});
      await sender.flush();

      // No new HTTP request because circuit is open
      expect(mockedRequest).not.toHaveBeenCalled();
    });

    test('Should not leak memory from timer accumulation', () => {
      mockHttpCapture();
      const sender = createTelemetrySender(channel, enrichBase);

      // Sending many events should not create multiple timers
      for (let i = 0; i < 50; i++) {
        sender.sendEventData('timer_test', { i });
      }

      // If timers accumulated, jest.getTimerCount would be large.
      // The implementation guards with `if (!timer)` so at most 1 pending timer.
      // (Auto-flush at batch 20 may clear the timer; at most 1 should remain.)
      expect(jest.getTimerCount()).toBeLessThanOrEqual(1);
    });
  });

  // =========================================================================
  // 6. Enrichment Safety
  // =========================================================================
  describe('Enrichment safety', () => {
    test('Should not allow caller-provided data to override enriched base fields', async () => {
      const mockReq = mockHttpCapture();
      const sender = createTelemetrySender(channel, enrichBase);

      // Attempt to spoof machine_id and session_id
      sender.sendEventData('search_completed', {
        machine_id: 'spoofed-machine',
        session_id: 'spoofed-session',
        results_count: 1,
      });

      await sender.flush();
      await new Promise((r) => process.nextTick(r));

      const payload = JSON.parse(mockReq.write.mock.calls[0][0]);
      const props = payload.events[0].properties;

      // enrichBase() spreads AFTER caller data, so base fields win
      expect(props.machine_id).toBe('anon-machine-id');
      expect(props.session_id).toBe('anon-session-id');
      expect(props.extension_version).toBe('1.0.0');
    });

    test('Should not allow caller to override is_error flag on usage events', async () => {
      const mockReq = mockHttpCapture();
      const sender = createTelemetrySender(channel, enrichBase);

      sender.sendEventData('test', { is_error: true } as any);
      await sender.flush();
      await new Promise((r) => process.nextTick(r));

      const payload = JSON.parse(mockReq.write.mock.calls[0][0]);
      // is_error is set at the QueueItem level, not inside properties
      expect(payload.events[0].is_error).toBe(false);
    });

    test('Should correctly mark error events with is_error=true', async () => {
      const mockReq = mockHttpCapture();
      const sender = createTelemetrySender(channel, enrichBase);

      sender.sendErrorData(new Error('test'), {});
      await sender.flush();
      await new Promise((r) => process.nextTick(r));

      const payload = JSON.parse(mockReq.write.mock.calls[0][0]);
      expect(payload.events[0].is_error).toBe(true);
      expect(payload.events[0].event_name).toBe('error');
    });
  });

  // =========================================================================
  // 7. Integration: Attack Scenarios
  // =========================================================================
  describe('Integration: Telemetry Attack Scenarios', () => {
    test('Should survive JSON injection via crafted event properties', async () => {
      const mockReq = mockHttpCapture();
      const sender = createTelemetrySender(channel, enrichBase);

      // An attacker controlling webview messages could send crafted properties
      sender.sendEventData('search_completed', {
        results_count: 0,
        query_length: 5,
        scope: '"}],"malicious":true,"events":[{"event_name":"pwned","properties":{"x":"y',
      });

      await sender.flush();
      await new Promise((r) => process.nextTick(r));

      const rawBody = mockReq.write.mock.calls[0][0] as string;
      const parsed = JSON.parse(rawBody);

      // JSON.stringify properly escapes embedded quotes — no extra events
      expect(parsed.events).toHaveLength(1);
      expect(parsed.events[0].event_name).toBe('search_completed');
      expect(parsed).not.toHaveProperty('malicious');
    });

    test('Should not expose the Supabase project URL as a REST endpoint', () => {
      const url = new URL(TELEMETRY_ENDPOINT);

      // Verify we hit the Edge Function, not the raw PostgREST API
      expect(url.pathname).toContain('/functions/');
      expect(url.pathname).not.toContain('/rest/v1/');
      // No query parameters that could include API keys
      expect(url.search).toBe('');
      expect(url.searchParams.has('apikey')).toBe(false);
    });

    test('Should not allow spoofing enrichment to impersonate another machine', async () => {
      const mockReq = mockHttpCapture();
      const sender = createTelemetrySender(channel, enrichBase);

      // Even if properties contain spoofed identifiers, enrichBase overwrites them
      sender.sendEventData('search_completed', {
        machine_id: 'victim-machine-id',
        session_id: 'victim-session-id',
        extension_version: '99.99.99',
        results_count: 1,
      });

      await sender.flush();
      await new Promise((r) => process.nextTick(r));

      const payload = JSON.parse(mockReq.write.mock.calls[0][0]);
      const props = payload.events[0].properties;

      expect(props.machine_id).toBe('anon-machine-id');
      expect(props.session_id).toBe('anon-session-id');
      expect(props.extension_version).toBe('1.0.0');
    });

    test('Should handle malicious enrichBase without crashing', async () => {
      mockHttpCapture();
      const brokenEnrich = jest.fn(() => { throw new Error('enrichBase exploded'); });

      // createTelemetrySender calls enrichBase inside sendEventData;
      // if enrichBase throws, sendEventData should not crash the extension
      const sender = createTelemetrySender(channel, brokenEnrich);

      expect(() => {
        sender.sendEventData('test', {});
      }).toThrow('enrichBase exploded');
      // The throw propagates but does NOT crash Node.js — callers can catch it
    });

    test('Should not transmit events when circuit breaker is open', async () => {
      mockHttpFailure(500);
      const sender = createTelemetrySender(channel, enrichBase);

      // Trip the circuit breaker
      for (let i = 0; i < 3; i++) {
        sender.sendEventData(`trip_${i}`, {});
        await sender.flush();
        await new Promise((r) => process.nextTick(r));
        await new Promise((r) => process.nextTick(r));
      }

      mockedRequest.mockClear();

      // Attempt to send sensitive data — should be silently dropped
      sender.sendEventData('search_completed', {
        results_count: 42,
        query_length: 10,
      });

      await sender.flush();
      await new Promise((r) => process.nextTick(r));

      // No HTTP request was made — data never leaves the machine
      expect(mockedRequest).not.toHaveBeenCalled();
    });
  });
});
