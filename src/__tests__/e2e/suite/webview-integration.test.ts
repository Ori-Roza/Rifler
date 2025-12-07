import * as assert from 'assert';
import { after, before } from 'mocha';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Import actual search/replace functions to test them directly
import { performSearch } from '../../../search';
import { replaceOne, replaceAll } from '../../../replacer';

// Slow mode helper - set E2E_SLOW_MODE=true to see each step
const SLOW_MODE = process.env.E2E_SLOW_MODE === 'true';
const STEP_DELAY = SLOW_MODE ? 3000 : 0;

// Use process.stdout.write for synchronous output that won't be buffered
function log(message: string) {
  process.stdout.write(message + '\n');
}

async function step(description: string) {
  log(`\n🔹 STEP: ${description}`);
  if (SLOW_MODE) {
    log(`   ⏳ Pausing for ${STEP_DELAY}ms...`);
    await new Promise(resolve => setTimeout(resolve, STEP_DELAY));
  }
}

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
  log("Hello, World!");
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
    this.timeout(30000);

    await step('Searching for unique term in test file');
    log(`   📁 File: ${testFilePath}`);
    log(`   🔍 Query: "unique_search_term_12345"`);

    const results = await performSearch(
      'unique_search_term_12345',
      'file',
      { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' },
      undefined,
      undefined,
      testFilePath
    );

    await step(`Verifying results (found ${results.length} matches)`);
    log(`   📊 Results: ${JSON.stringify(results, null, 2)}`);

    // Assert we found exactly one result
    assert.strictEqual(results.length, 1, 'Should find exactly one occurrence of unique term');
    log('   ✅ Found exactly 1 result');

    assert.ok(results[0].uri.includes('test-search-file.ts'), 'Result should be from test file');
    log('   ✅ Result is from correct file');

    assert.ok(results[0].line >= 0, 'Result should have a valid line number');
    log(`   ✅ Line number: ${results[0].line}`);
  });

  test('performSearch should find multiple occurrences', async function() {
    this.timeout(30000);

    await step('Searching for "test" which appears multiple times');
    log(`   📁 File: ${testFilePath}`);

    const results = await performSearch(
      'test',
      'file',
      { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' },
      undefined,
      undefined,
      testFilePath
    );

    await step(`Found ${results.length} occurrences`);
    log(`   📊 Match count: ${results.length}`);

    // Assert we found multiple results
    assert.ok(results.length > 1, `Should find multiple occurrences of "test", found: ${results.length}`);
    log('   ✅ Multiple occurrences found');
  });

  test('performSearch should respect case sensitivity', async function() {
    this.timeout(30000);

    await step('Searching for "TestClass" with case sensitivity enabled');
    log(`   📁 File: ${testFilePath}`);
    log('   🔍 Query: "TestClass" (matchCase: true)');

    const caseSensitiveResults = await performSearch(
      'TestClass',
      'file',
      { matchCase: true, wholeWord: false, useRegex: false, fileMask: '' },
      undefined,
      undefined,
      testFilePath
    );

    log(`   📊 Found ${caseSensitiveResults.length} result(s)`);

    await step('Searching for "testclass" (wrong case) with case sensitivity');
    log('   🔍 Query: "testclass" (matchCase: true)');

    const wrongCaseResults = await performSearch(
      'testclass',
      'file',
      { matchCase: true, wholeWord: false, useRegex: false, fileMask: '' },
      undefined,
      undefined,
      testFilePath
    );

    log(`   📊 Found ${wrongCaseResults.length} result(s)`);

    await step('Verifying case sensitivity works correctly');
    assert.ok(caseSensitiveResults.length >= 1, 'Should find TestClass with correct case');
    log('   ✅ "TestClass" found with correct case');

    assert.strictEqual(wrongCaseResults.length, 0, 'Should not find testclass with case mismatch');
    log('   ✅ "testclass" not found (case mismatch)');
  });

  test('performSearch should support regex patterns', async function() {
    this.timeout(30000);

    await step('Searching with regex pattern');
    log(`   📁 File: ${testFilePath}`);
    log('   🔍 Query: "test.*message" (useRegex: true)');

    const results = await performSearch(
      'test.*message',
      'file',
      { matchCase: false, wholeWord: false, useRegex: true, fileMask: '' },
      undefined,
      undefined,
      testFilePath
    );

    log(`   📊 Found ${results.length} result(s)`);
    assert.ok(results.length >= 1, 'Should find matches for regex pattern');
    log('   ✅ Regex pattern matched');
  });

  test('performSearch should return empty for non-existent text', async function() {
    this.timeout(30000);

    await step('Searching for non-existent text');
    log(`   📁 File: ${testFilePath}`);
    log('   🔍 Query: "this_text_definitely_does_not_exist_xyz789"');

    const results = await performSearch(
      'this_text_definitely_does_not_exist_xyz789',
      'file',
      { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' },
      undefined,
      undefined,
      testFilePath
    );

    log(`   📊 Found ${results.length} result(s)`);
    assert.strictEqual(results.length, 0, 'Should return empty array for non-existent text');
    log('   ✅ Empty results for non-existent text');
  });

  test('performSearch should search in directory scope', async function() {
    this.timeout(30000);

    await step('Searching with directory scope');
    log(`   📁 Directory: ${testWorkspaceFolder.uri.fsPath}`);
    log('   🔍 Query: "unique_search_term_12345"');
    log('   🌐 Scope: directory');

    const results = await performSearch(
      'unique_search_term_12345',
      'directory',
      { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' },
      testWorkspaceFolder.uri.fsPath,
      undefined,
      undefined
    );

    log(`   📊 Found ${results.length} result(s)`);
    assert.ok(results.length >= 1, 'Should find term in directory scope');
    log('   ✅ Term found in directory scope');
  });

  test('performSearch should search in project scope', async function() {
    this.timeout(30000);

    await step('Searching with project scope');
    log('   🔍 Query: "unique_search_term_12345"');
    log('   🌐 Scope: project (entire workspace)');

    const results = await performSearch(
      'unique_search_term_12345',
      'project',
      { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' },
      undefined,
      undefined,
      undefined
    );

    log(`   📊 Found ${results.length} result(s)`);
    assert.ok(results.length >= 1, 'Should find term in project scope');
    log('   ✅ Term found in project scope');
  });

  // ============================================================================
  // ACTUAL REPLACE FUNCTIONALITY TESTS
  // ============================================================================

  test('replaceOne should replace text at specific location', async function() {
    this.timeout(30000);

    await step('Creating test file for replacement');
    const replaceTestFilePath = path.join(testWorkspaceFolder.uri.fsPath, 'replace-test.ts');
    const originalContent = 'const original = "replace_me_123";';
    fs.writeFileSync(replaceTestFilePath, originalContent);
    log(`   📁 Created: ${replaceTestFilePath}`);
    log(`   📝 Content: ${originalContent}`);

    try {
      await step('Searching for text to replace');
      log('   🔍 Query: "replace_me_123"');

      const searchResults = await performSearch(
        'replace_me_123',
        'file',
        { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' },
        undefined,
        undefined,
        replaceTestFilePath
      );

      assert.strictEqual(searchResults.length, 1, 'Should find the text to replace');
      log(`   ✅ Found at line ${searchResults[0].line}, col ${searchResults[0].character}`);

      const result = searchResults[0];

      await step('Performing replacement');
      log('   🔄 Replacing "replace_me_123" → "replaced_text_456"');

      await replaceOne(
        result.uri,
        result.line,
        result.character,
        result.length,
        'replaced_text_456'
      );

      // Wait for file system to update
      await new Promise(resolve => setTimeout(resolve, 500));

      await step('Verifying file was modified');
      const newContent = fs.readFileSync(replaceTestFilePath, 'utf8');
      log(`   📝 New content: ${newContent}`);

      assert.ok(newContent.includes('replaced_text_456'), 'File should contain replaced text');
      log('   ✅ New text found in file');

      assert.ok(!newContent.includes('replace_me_123'), 'File should not contain original text');
      log('   ✅ Original text no longer in file');

    } finally {
      // Cleanup
      if (fs.existsSync(replaceTestFilePath)) {
        fs.unlinkSync(replaceTestFilePath);
      }
    }
  });

  test('replaceAll should replace all occurrences', async function() {
    this.timeout(30000);

    await step('Creating test file with multiple occurrences');
    const replaceAllTestFilePath = path.join(testWorkspaceFolder.uri.fsPath, 'replace-all-test.ts');
    const originalContent = `const a = "word_to_replace";
const b = "word_to_replace";
const c = "word_to_replace";`;
    fs.writeFileSync(replaceAllTestFilePath, originalContent);
    log(`   📁 Created: ${replaceAllTestFilePath}`);
    log(`   📝 Content has 3 occurrences of "word_to_replace"`);

    let refreshCalled = false;
    const mockRefresh = async () => { refreshCalled = true; };

    try {
      await step('Performing replaceAll operation');
      log('   🔄 Replacing all "word_to_replace" → "new_word"');

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

      await step('Verifying all occurrences were replaced');
      const newContent = fs.readFileSync(replaceAllTestFilePath, 'utf8');
      const newWordCount = (newContent.match(/new_word/g) || []).length;
      const oldWordCount = (newContent.match(/word_to_replace/g) || []).length;

      log(`   📊 New word count: ${newWordCount}, Old word count: ${oldWordCount}`);

      assert.strictEqual(newWordCount, 3, 'Should have replaced all 3 occurrences');
      log('   ✅ All 3 occurrences replaced');

      assert.strictEqual(oldWordCount, 0, 'Should have no remaining original occurrences');
      log('   ✅ No original text remaining');

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
    this.timeout(30000);

    await step('Executing rifler.open command');
    await vscode.commands.executeCommand('rifler.open');
    await new Promise(resolve => setTimeout(resolve, 1000));

    await step('Checking if Rifler panel was opened');
    const riflerTabs = vscode.window.tabGroups.all
      .flatMap(tg => tg.tabs)
      .filter(tab => tab.label.includes('Rifler'));

    log(`   📊 Rifler tabs found: ${riflerTabs.length}`);
    assert.ok(riflerTabs.length >= 1, 'Rifler panel should be opened');
    log('   ✅ Rifler panel is open');
  });

  test('rifler.openReplace command should execute without error', async function() {
    this.timeout(30000);

    await step('Executing rifler.openReplace command');
    await vscode.commands.executeCommand('rifler.openReplace');
    await new Promise(resolve => setTimeout(resolve, 1000));

    await step('Checking if Rifler panel was opened for replace');
    const riflerTabs = vscode.window.tabGroups.all
      .flatMap(tg => tg.tabs)
      .filter(tab => tab.label.includes('Rifler'));

    log(`   📊 Rifler tabs found: ${riflerTabs.length}`);
    assert.ok(riflerTabs.length >= 1, 'Rifler panel should be opened for replace');
    log('   ✅ Rifler panel is open for replace');
  });

  // ============================================================================
  // CONFIGURATION TESTS
  // ============================================================================

  test('Configuration should be readable', async function() {
    this.timeout(30000);

    await step('Reading Rifler configuration');
    const config = vscode.workspace.getConfiguration('rifler');
    const keybinding = config.get<string>('replaceInPreviewKeybinding');

    log(`   ⚙️  Keybinding value: "${keybinding}"`);
    assert.ok(keybinding, 'Should be able to read configuration');
    log('   ✅ Configuration is readable');

    assert.ok(typeof keybinding === 'string', 'Keybinding should be a string');
    log('   ✅ Keybinding is a string');
  });

  // ============================================================================
  // SEARCH RESULT FORMAT TESTS
  // ============================================================================

  test('Search results should have correct structure', async function() {
    this.timeout(30000);

    await step('Searching for "helloWorld" to check result structure');
    const results = await performSearch(
      'helloWorld',
      'file',
      { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' },
      undefined,
      undefined,
      testFilePath
    );

    log(`   📊 Found ${results.length} result(s)`);
    assert.ok(results.length >= 1, 'Should find helloWorld function');

    const result = results[0];

    await step('Verifying result structure and properties');
    // Verify result structure
    assert.ok('uri' in result, 'Result should have uri property');
    log(`   ✅ uri: ${result.uri.substring(0, 50)}...`);

    assert.ok('line' in result, 'Result should have line property');
    log(`   ✅ line: ${result.line}`);

    assert.ok('character' in result, 'Result should have character property');
    log(`   ✅ character: ${result.character}`);

    assert.ok('length' in result, 'Result should have length property');
    log(`   ✅ length: ${result.length}`);

    assert.ok('preview' in result, 'Result should have preview property');
    log(`   ✅ preview: "${result.preview.substring(0, 50)}..."`);

    await step('Verifying property types');
    // Verify types
    assert.strictEqual(typeof result.uri, 'string', 'uri should be string');
    assert.strictEqual(typeof result.line, 'number', 'line should be number');
    assert.strictEqual(typeof result.character, 'number', 'character should be number');
    assert.strictEqual(typeof result.length, 'number', 'length should be number');
    assert.strictEqual(typeof result.preview, 'string', 'preview should be string');
    log('   ✅ All property types correct');

    await step('Verifying property values');
    // Verify values make sense
    assert.ok(result.line >= 0, 'line should be non-negative');
    assert.ok(result.character >= 0, 'character should be non-negative');
    assert.strictEqual(result.length, 'helloWorld'.length, 'length should match search term');
    log('   ✅ All property values valid');
  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  test('Search should handle empty query gracefully', async function() {
    this.timeout(30000);

    await step('Searching with empty query');
    log('   🔍 Query: "" (empty string)');

    const results = await performSearch(
      '',
      'file',
      { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' },
      undefined,
      undefined,
      testFilePath
    );

    log(`   📊 Results: ${results.length}`);
    assert.strictEqual(results.length, 0, 'Empty query should return no results');
    log('   ✅ Empty query handled gracefully');
  });

  test('Search should handle very short query gracefully', async function() {
    this.timeout(30000);

    await step('Searching with single character query');
    log('   🔍 Query: "a" (single character)');

    const results = await performSearch(
      'a',
      'file',
      { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' },
      undefined,
      undefined,
      testFilePath
    );

    log(`   📊 Results: ${results.length}`);
    assert.strictEqual(results.length, 0, 'Single character query should return no results');
    log('   ✅ Short query handled gracefully');
  });

  test('Search should handle invalid regex gracefully', async function() {
    this.timeout(30000);

    await step('Searching with invalid regex pattern');
    log('   🔍 Query: "[invalid(regex" (invalid regex)');

    const results = await performSearch(
      '[invalid(regex',
      'file',
      { matchCase: false, wholeWord: false, useRegex: true, fileMask: '' },
      undefined,
      undefined,
      testFilePath
    );

    log(`   📊 Results: ${results.length}`);
    assert.strictEqual(results.length, 0, 'Invalid regex should return no results without crashing');
    log('   ✅ Invalid regex handled gracefully');
  });
});
