import { getRipgrepCommandCandidates } from '../rgSearch';

describe('getRipgrepCommandCandidates', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    const vscode = require('vscode');
    vscode.extensions.getExtension.mockReturnValue({ extensionMode: vscode.ExtensionMode.Test });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('includes override first when provided', () => {
    process.env.RIFLER_RG_PATH = '/tmp/fake-rg';

    const candidates = getRipgrepCommandCandidates();

    expect(candidates[0]).toBe('/tmp/fake-rg');
    expect(candidates).toContain('rg');
  });

  test('ignores override outside dev/test', () => {
    process.env.RIFLER_RG_PATH = '/tmp/fake-rg';
    const vscode = require('vscode');
    vscode.extensions.getExtension.mockReturnValue({ extensionMode: vscode.ExtensionMode.Production });

    const candidates = getRipgrepCommandCandidates();

    expect(candidates[0]).not.toBe('/tmp/fake-rg');
    expect(candidates).toContain('rg');
  });

  test('includes vscode appRoot candidates when available', () => {
    delete process.env.RIFLER_RG_PATH;

    const candidates = getRipgrepCommandCandidates();

    // our vscode jest mock sets env.appRoot to /tmp/vscode-app-root
    // Normalize paths for cross-platform comparison (Windows uses backslashes)
    const normalized = candidates.map(c => c.replace(/\\/g, '/'));
    expect(normalized.some((c) => c.includes('/tmp/vscode-app-root'))).toBe(true);
    expect(candidates).toContain('rg');
  });
});
