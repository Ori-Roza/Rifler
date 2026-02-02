/**
 * Security Tests for Webview Security Module
 * 
 * Tests XSS protection and HTML sanitization.
 */

import {
  escapeHtml,
  sanitizeHighlightedHtml,
  sanitizeFilePath,
  isSafeClassName,
  safeDataAttribute,
  safeElement,
} from '../webviewSecurity';

describe('Webview Security', () => {
  describe('escapeHtml', () => {
    test('Should escape < and >', () => {
      const malicious = '<script>alert("XSS")</script>';
      const escaped = escapeHtml(malicious);
      expect(escaped).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
      expect(escaped).not.toContain('<script>');
    });

    test('Should escape quotes', () => {
      const input = 'He said "hello" and \'goodbye\'';
      const escaped = escapeHtml(input);
      expect(escaped).toContain('&quot;');
      expect(escaped).toContain('&#039;');
    });

    test('Should escape ampersands', () => {
      const input = 'A & B';
      const escaped = escapeHtml(input);
      expect(escaped).toBe('A &amp; B');
    });

    test('Should handle empty string', () => {
      expect(escapeHtml('')).toBe('');
    });

    test('Should handle non-string input', () => {
      expect(escapeHtml(null as any)).toBe('null');
      expect(escapeHtml(123 as any)).toBe('123');
    });
  });

  describe('sanitizeHighlightedHtml', () => {
    test('Should remove script tags', () => {
      const malicious = '<span class="hljs-keyword">const</span><script>alert("XSS")</script>';
      const sanitized = sanitizeHighlightedHtml(malicious);
      expect(sanitized).not.toContain('<script>');
      expect(sanitized).not.toContain('alert');
    });

    test('Should preserve hljs- classes', () => {
      const highlighted = '<span class="hljs-keyword">const</span>';
      const sanitized = sanitizeHighlightedHtml(highlighted);
      expect(sanitized).toContain('hljs-keyword');
      expect(sanitized).toContain('<span');
    });

    test('Should remove non-hljs classes from span tags', () => {
      const mixed = '<span class="malicious-class hljs-string">text</span>';
      const sanitized = sanitizeHighlightedHtml(mixed);
      expect(sanitized).toContain('hljs-string');
      expect(sanitized).not.toContain('malicious-class');
    });

    test('Should remove event handlers', () => {
      const dangerous = '<span onclick="alert(1)" class="hljs-keyword">const</span>';
      const sanitized = sanitizeHighlightedHtml(dangerous);
      expect(sanitized).not.toContain('onclick');
      expect(sanitized).toContain('hljs-keyword');
    });

    test('Should remove dangerous tags but keep span', () => {
      const dangerous = '<iframe src="evil"></iframe><span class="hljs-string">safe</span>';
      const sanitized = sanitizeHighlightedHtml(dangerous);
      expect(sanitized).not.toContain('iframe');
      expect(sanitized).toContain('hljs-string');
    });

    test('Should handle empty input', () => {
      expect(sanitizeHighlightedHtml('')).toBe('');
    });

    test('Should handle non-string input', () => {
      expect(sanitizeHighlightedHtml(null as any)).toBe('');
      expect(sanitizeHighlightedHtml(undefined as any)).toBe('');
    });
  });

  describe('sanitizeFilePath', () => {
    test('Should escape HTML in file paths', () => {
      const malicious = 'file<script>.ts';
      const sanitized = sanitizeFilePath(malicious);
      expect(sanitized).not.toContain('<script>');
      expect(sanitized).toContain('&lt;script&gt;');
    });

    test('Should remove null bytes', () => {
      const pathWithNull = 'file\0.txt';
      const sanitized = sanitizeFilePath(pathWithNull);
      expect(sanitized).not.toContain('\0');
    });

    test('Should handle normal paths', () => {
      const normalPath = 'src/components/App.tsx';
      const sanitized = sanitizeFilePath(normalPath);
      expect(sanitized).toBe(normalPath);
    });
  });

  describe('isSafeClassName', () => {
    test('Should accept valid class names', () => {
      expect(isSafeClassName('valid-class')).toBe(true);
      expect(isSafeClassName('result_item')).toBe(true);
      expect(isSafeClassName('hljs-keyword')).toBe(true);
    });

    test('Should reject class names with special characters', () => {
      expect(isSafeClassName('class;name')).toBe(false);
      expect(isSafeClassName('class name')).toBe(false);
      expect(isSafeClassName('class<script>')).toBe(false);
    });

    test('Should reject empty or invalid input', () => {
      expect(isSafeClassName('')).toBe(false);
      expect(isSafeClassName(null as any)).toBe(false);
    });

    test('Should reject class names starting with digit', () => {
      expect(isSafeClassName('1class')).toBe(false);
      expect(isSafeClassName('-9class')).toBe(false);
    });
  });

  describe('safeDataAttribute', () => {
    test('Should escape quotes in attribute values', () => {
      const value = 'value with "quotes"';
      const safe = safeDataAttribute(value);
      expect(safe).toContain('&quot;');
      expect(safe).not.toContain('"');
    });

    test('Should escape HTML entities', () => {
      const value = '<tag>content</tag>';
      const safe = safeDataAttribute(value);
      expect(safe).toContain('&lt;');
      expect(safe).toContain('&gt;');
    });
  });

  describe('safeElement', () => {
    test('Should build safe HTML element', () => {
      const html = safeElement('div', { class: 'test' }, 'content');
      expect(html).toBe('<div class="test">content</div>');
    });

    test('Should escape attribute values', () => {
      const html = safeElement('a', { href: '"><script>alert(1)</script>' }, 'link');
      expect(html).not.toContain('<script>');
      expect(html).toContain('&quot;');
    });

    test('Should reject invalid tag names', () => {
      expect(() => safeElement('div<script>', {}, '')).toThrow('Invalid HTML tag');
    });

    test('Should skip invalid attribute names', () => {
      const html = safeElement('div', { 'on<click': 'evil()' }, 'test');
      expect(html).not.toContain('on<click');
    });
  });

  describe('Integration: XSS Attack Scenarios', () => {
    test('Should prevent XSS via malicious filename', () => {
      const maliciousFilename = 'file<img src=x onerror=alert(1)>.ts';
      const safe = sanitizeFilePath(maliciousFilename);
      // After escaping, dangerous HTML is neutralized
      expect(safe).toContain('&lt;img');
      expect(safe).toContain('&gt;');
      // Even though "onerror=" string exists, it's inside escaped HTML and can't execute
      expect(safe).not.toContain('<img'); // No actual img tag
    });

    test('Should prevent XSS via search result content', () => {
      const maliciousContent = 'const x = "<script>alert(document.cookie)</script>";';
      const safe = escapeHtml(maliciousContent);
      expect(safe).not.toContain('<script>');
      expect(safe).toContain('&lt;script&gt;');
    });

    test('Should prevent attribute injection in element building', () => {
      const userInput = '" onload="alert(1)"';
      const html = safeElement('div', { 'data-value': userInput }, 'test');
      // Quotes are escaped, preventing attribute breaking
      expect(html).toContain('&quot;');
      // The string "onload=" exists but is safely inside an escaped attribute value
      expect(html).not.toContain('" onload="'); // No unescaped quote-space-onload pattern
    });
  });
});
