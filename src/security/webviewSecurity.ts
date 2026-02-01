/**
 * Webview Security Module
 * 
 * Provides HTML sanitization and XSS protection for webview content.
 * Use these functions before setting innerHTML to prevent code injection.
 */

/**
 * Security: Escape HTML special characters to prevent XSS.
 * Use this for ANY user-provided content before inserting into DOM.
 * 
 * @param text - Raw text that may contain malicious HTML
 * @returns Safely escaped text suitable for innerHTML
 */
export function escapeHtml(text: string): string {
  if (typeof text !== 'string') {
    return String(text);
  }
  
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Security: Sanitize syntax-highlighted HTML from highlight.js.
 * Removes dangerous elements/attributes while preserving styling spans.
 * 
 * This is necessary because highlight.js may produce HTML with user input,
 * and malicious filenames/paths could inject script tags.
 * 
 * NOTE: This function is designed to run in the webview context where DOM APIs are available.
 * For server-side use, consider using a library like DOMPurify or jsdom.
 * 
 * @param highlightedHtml - HTML from highlight.js library
 * @returns Sanitized HTML with only safe span tags and class attributes
 */
export function sanitizeHighlightedHtml(highlightedHtml: string): string {
  if (typeof highlightedHtml !== 'string') {
    return '';
  }
  
  // Simple regex-based sanitization (safe for highlight.js output)
  // This removes any tags except <span> and removes dangerous attributes
  let sanitized = highlightedHtml;
  
  // Remove all script tags and their content
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  
  // Remove dangerous tags (keeping their content)
  sanitized = sanitized.replace(/<(iframe|object|embed|link|meta|style)[^>]*>/gi, '');
  sanitized = sanitized.replace(/<\/(iframe|object|embed|link|meta|style)>/gi, '');
  
  // Remove event handler attributes
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*[^\s>]*/gi, '');
  
  // Remove dangerous attributes from span tags
  sanitized = sanitized.replace(/<span([^>]*)>/gi, (match, attrs) => {
    // Only keep class attribute with hljs- prefix
    const classMatch = attrs.match(/class\s*=\s*["']([^"']*)["']/i);
    if (classMatch) {
      const classes = classMatch[1].split(' ').filter((c: string) => c.startsWith('hljs-'));
      if (classes.length > 0) {
        return `<span class="${escapeHtml(classes.join(' '))}">`;
      }
    }
    return '<span>';
  });
  
  // Remove any remaining non-span tags (except closing tags)
  sanitized = sanitized.replace(/<(?!\/?(span\b)[^>]*>)[^>]+>/gi, '');
  
  return sanitized;
}

/**
 * Security: Sanitize file path for display.
 * Escapes HTML and removes any dangerous characters.
 * 
 * @param filePath - File path from search results
 * @returns Safe file path suitable for display
 */
export function sanitizeFilePath(filePath: string): string {
  if (typeof filePath !== 'string') {
    return '';
  }
  
  // Escape HTML first
  let safe = escapeHtml(filePath);
  
  // Remove any null bytes (can cause issues in some contexts)
  safe = safe.replace(/\0/g, '');
  
  return safe;
}

/**
 * Security: Validate that a string is a safe CSS class name.
 * Prevents CSS injection attacks via class attribute.
 * 
 * @param className - Proposed class name
 * @returns true if safe, false if dangerous
 */
export function isSafeClassName(className: string): boolean {
  if (typeof className !== 'string' || className.length === 0) {
    return false;
  }
  
  // Class names should only contain: a-z, A-Z, 0-9, -, _
  // Must not start with digit or hyphen-digit
  const safePattern = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
  return safePattern.test(className);
}

/**
 * Security: Create a safe data attribute value.
 * Escapes quotes and HTML entities to prevent attribute breaking.
 * 
 * @param value - Value to use in data-* attribute
 * @returns Safe attribute value (pre-escaped, ready for double quotes)
 */
export function safeDataAttribute(value: string): string {
  if (typeof value !== 'string') {
    return String(value);
  }
  
  // Escape double quotes and HTML entities
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Security: Build a safe HTML element with escaped content.
 * Safer alternative to building HTML strings manually.
 * 
 * Example:
 *   safeElement('div', {class: 'result'}, escapeHtml(userInput))
 * 
 * @param tag - HTML tag name
 * @param attrs - Attributes object (keys = names, values = values)
 * @param content - Inner content (should already be escaped)
 * @returns Complete HTML element string
 */
export function safeElement(
  tag: string,
  attrs: Record<string, string>,
  content: string = ''
): string {
  // Validate tag name (alphanumeric only)
  if (!/^[a-zA-Z0-9]+$/.test(tag)) {
    throw new Error(`Invalid HTML tag: ${tag}`);
  }
  
  let html = `<${tag}`;
  
  // Add attributes (with validation)
  for (const [key, value] of Object.entries(attrs)) {
    // Validate attribute name
    if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(key)) {
      continue; // Skip invalid attributes
    }
    
    // Escape attribute value
    const escaped = safeDataAttribute(value);
    html += ` ${key}="${escaped}"`;
  }
  
  html += `>${content}</${tag}>`;
  return html;
}
