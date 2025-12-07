import * as assert from 'assert';
import { after, before } from 'mocha';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Import actual search/replace functions to test them directly
import { performSearch } from '../../../search';
import { replaceOne, replaceAll } from '../../../replacer';

suite('Rifler Functional E2E Tests', () => {
  let testWorkspaceFolder: vscode.WorkspaceFolder;
  let testFilePath: string;
  let testContent: string;

  before(async () => {
    // Get workspace folder
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder available');
    }
    testWorkspaceFolder = workspaceFolder;

    // Create a test file with known content for search testing
    testFilePath = path.join(testWorkspaceFolder.uri.fsPath, 'test-search-file.ts');
    testContent = `// Test file for E2E testing
function helloWorld() {
  console.log("Hello, World!");
  const message = "test message";
  return message;
}

class TestClass {
  private testProperty: string = "test value";

  public testMethod(): string {
    return this.testProperty;
  }
}

const testVariable = "searchable content";
const anotherTest = "more test data";
const findMe = "unique_search_term_12345";
`;

    fs.writeFileSync(testFilePath, testContent);
  });

  after(async () => {
    // Clean up test file
    try {
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  // ============================================================================
  // ACTUAL SEARCH FUNCTIONALITY TESTS
  // ============================================================================

  test('performSearch should find text in a specific file', async function() {
    this.timeout(10000);

    // Search for a unique term we know exists in the test file
    const results = await performSearch(
      'unique_search_term_12345',
      'file',
      { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' },
      undefined,
      undefined,
      testFilePath
    );

    // Assert we found exactly one result
    assert.strictEqual(results.length, 1, 'Should find exactly one occurrence of unique term');
    assert.ok(results[0].uri.includes('test-search-file.ts'), 'Result should be from test file');
    assert.ok(results[0].line >= 0, 'Result should have a valid line number');
  });

  test('performSearch should find multiple occurrences', async function() {
    this.timeout(10000);

    // Search for "test" which appears multiple times
    const results = await performSearch(
      'test',
      'file',
      { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' },
      undefined,
      undefined,
      testFilePath
    );

    // Assert we found multiple results
    assert.ok(results.length > 1, `Should find multiple occurrences of "test", found: ${results.length}`);
  });

  test('performSearch should respect case sensitivity', async function() {
    this.timeout(10000);

    // Search for "TestClass" with case sensitivity
    const caseSensitiveResults = await performSearch(
      'TestClass',
      'file',
      { matchCase: true, wholeWord: false, useRegex: false, fileMask: '' },
      undefined,
      undefined,
      testFilePath
    );

    // Search for "testclass" with case sensitivity (should not find)
    const wrongCaseResults = await performSearch(
      'testclass',
      'file',
      { matchCase: true, wholeWord: false, useRegex: false, fileMask: '' },
      undefined,
      undefined,
      testFilePath
    );

    assert.ok(caseSensitiveResults.length >= 1, 'Should find TestClass with correct case');
    assert.strictEqual(wrongCaseResults.length, 0, 'Should not find testclass with case mismatch');
  });

  test('performSearch should support regex patterns', async function() {
    this.timeout(10000);

    // Search using regex pattern for "test.*message"
    const results = await performSearch(
      'test.*message',
      'file',
      { matchCase: false, wholeWord: false, useRegex: true, fileMask: '' },
      undefined,
      undefined,
      testFilePath
    );

    assert.ok(results.length >= 1, 'Should find matches for regex pattern');
  });

  test('performSearch should return empty for non-existent text', async function() {
    this.timeout(10000);

    const results = await performSearch(
      'this_text_definitely_does_not_exist_xyz789',
      'file',
      { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' },
      undefined,
      undefined,
      testFilePath
    );

    assert.strictEqual(results.length, 0, 'Should return empty array for non-existent text');
  });

  test('performSearch should search in directory scope', async function() {
    this.timeout(15000);

    const results = await performSearch(
      'unique_search_term_12345',
      'directory',
      { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' },
      testWorkspaceFolder.uri.fsPath,
      undefined,
      undefined
    );

    assert.ok(results.length >= 1, 'Should find term in directory scope');
  });

  test('performSearch should search in project scope', async function() {
    this.timeout(15000);

    const results = await performSearch(
      'unique_search_term_12345',
      'project',
      { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' },
      undefined,
      undefined,
      undefined
    );

    assert.ok(results.length >= 1, 'Should find term in project scope');
  });

  // ============================================================================
  // ACTUAL REPLACE FUNCTIONALITY TESTS
  // ============================================================================

  test('replaceOne should replace text at specific location', async function() {
    this.timeout(15000);

    // Create a separate file for replace testing (don't modify the main test file)
    const replaceTestFilePath = path.join(testWorkspaceFolder.uri.fsPath, 'replace-test.ts');
    const originalContent = 'const original = "replace_me_123";';
    fs.writeFileSync(replaceTestFilePath, originalContent);

    try {
      // First, search to find the location
      const searchResults = await performSearch(
        'replace_me_123',
        'file',
        { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' },
        undefined,
        undefined,
        replaceTestFilePath
      );

      assert.strictEqual(searchResults.length, 1, 'Should find the text to replace');

      const result = searchResults[0];

      // Perform the replacement
      await replaceOne(
        result.uri,
        result.line,
        result.character,
        result.length,
        'replaced_text_456'
      );

      // Wait for file system to update
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify the replacement happened
      const newContent = fs.readFileSync(replaceTestFilePath, 'utf8');
      assert.ok(newContent.includes('replaced_text_456'), 'File should contain replaced text');
      assert.ok(!newContent.includes('replace_me_123'), 'File should not contain original text');

    } finally {
      // Cleanup
      if (fs.existsSync(replaceTestFilePath)) {
        fs.unlinkSync(replaceTestFilePath);
      }
    }
  });

  test('replaceAll should replace all occurrences', async function() {
    this.timeout(20000);

    // Create a file with multiple occurrences
    const replaceAllTestFilePath = path.join(testWorkspaceFolder.uri.fsPath, 'replace-all-test.ts');
    const originalContent = `const a = "word_to_replace";
const b = "word_to_replace";
const c = "word_to_replace";`;
    fs.writeFileSync(replaceAllTestFilePath, originalContent);

    let refreshCalled = false;
    const mockRefresh = async () => { refreshCalled = true; };

    try {
      // Perform replace all
      await replaceAll(
        'word_to_replace',
        'new_word',
        'file',
        { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' },
        undefined,
        undefined,
        replaceAllTestFilePath,
        mockRefresh
      );

      // Wait for file system to update
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify all replacements happened
      const newContent = fs.readFileSync(replaceAllTestFilePath, 'utf8');
      const newWordCount = (newContent.match(/new_word/g) || []).length;
      const oldWordCount = (newContent.match(/word_to_replace/g) || []).length;

      assert.strictEqual(newWordCount, 3, 'Should have replaced all 3 occurrences');
      assert.strictEqual(oldWordCount, 0, 'Should have no remaining original occurrences');

    } finally {
      // Cleanup
      if (fs.existsSync(replaceAllTestFilePath)) {
        fs.unlinkSync(replaceAllTestFilePath);
      }
    }
  });

  // ============================================================================
  // COMMAND EXECUTION TESTS
  // ============================================================================

  test('rifler.open command should execute without error', async function() {
    this.timeout(10000);

    // This tests that the command is properly registered and can be executed
    await vscode.commands.executeCommand('rifler.open');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check that a Rifler panel was opened
    const riflerTabs = vscode.window.tabGroups.all
      .flatMap(tg => tg.tabs)
      .filter(tab => tab.label.includes('Rifler'));

    assert.ok(riflerTabs.length >= 1, 'Rifler panel should be opened');
  });

  test('rifler.openReplace command should execute without error', async function() {
    this.timeout(10000);

    await vscode.commands.executeCommand('rifler.openReplace');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check that a Rifler panel was opened
    const riflerTabs = vscode.window.tabGroups.all
      .flatMap(tg => tg.tabs)
      .filter(tab => tab.label.includes('Rifler'));

    assert.ok(riflerTabs.length >= 1, 'Rifler panel should be opened for replace');
  });

  // ============================================================================
  // CONFIGURATION TESTS
  // ============================================================================

  test('Configuration should be readable', async function() {
    const config = vscode.workspace.getConfiguration('rifler');
    const keybinding = config.get<string>('replaceInPreviewKeybinding');

    assert.ok(keybinding, 'Should be able to read configuration');
    assert.ok(typeof keybinding === 'string', 'Keybinding should be a string');
  });

  // ============================================================================
  // SEARCH RESULT FORMAT TESTS
  // ============================================================================

  test('Search results should have correct structure', async function() {
    this.timeout(10000);

    const results = await performSearch(
      'helloWorld',
      'file',
      { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' },
      undefined,
      undefined,
      testFilePath
    );

    assert.ok(results.length >= 1, 'Should find helloWorld function');

    const result = results[0];

    // Verify result structure
    assert.ok('uri' in result, 'Result should have uri property');
    assert.ok('line' in result, 'Result should have line property');
    assert.ok('character' in result, 'Result should have character property');
    assert.ok('length' in result, 'Result should have length property');
    assert.ok('preview' in result, 'Result should have preview property');

    // Verify types
    assert.strictEqual(typeof result.uri, 'string', 'uri should be string');
    assert.strictEqual(typeof result.line, 'number', 'line should be number');
    assert.strictEqual(typeof result.character, 'number', 'character should be number');
    assert.strictEqual(typeof result.length, 'number', 'length should be number');
    assert.strictEqual(typeof result.preview, 'string', 'preview should be string');

    // Verify values make sense
    assert.ok(result.line >= 0, 'line should be non-negative');
    assert.ok(result.character >= 0, 'character should be non-negative');
    assert.strictEqual(result.length, 'helloWorld'.length, 'length should match search term');
  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  test('Search should handle empty query gracefully', async function() {
    const results = await performSearch(
      '',
      'file',
      { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' },
      undefined,
      undefined,
      testFilePath
    );

    assert.strictEqual(results.length, 0, 'Empty query should return no results');
  });

  test('Search should handle very short query gracefully', async function() {
    const results = await performSearch(
      'a',
      'file',
      { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' },
      undefined,
      undefined,
      testFilePath
    );

    assert.strictEqual(results.length, 0, 'Single character query should return no results');
  });

  test('Search should handle invalid regex gracefully', async function() {
    const results = await performSearch(
      '[invalid(regex',
      'file',
      { matchCase: false, wholeWord: false, useRegex: true, fileMask: '' },
      undefined,
      undefined,
      testFilePath
    );

    assert.strictEqual(results.length, 0, 'Invalid regex should return no results without crashing');
  });
});
