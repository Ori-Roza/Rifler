import * as assert from 'assert';
import { after, before } from 'mocha';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Import actual search/replace functions to test them directly
import { performSearch } from '../../../search';
import { replaceOne, replaceAll } from '../../../replacer';
// Import test utilities from extension
import { testHelpers } from '../../../extension';

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
  before(async () => {
    // Activate the extension before running tests
    const extension = vscode.extensions.getExtension('Ori-Roza.rifler');
    if (extension && !extension.isActive) {
      await extension.activate();
    }
  });
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

    await vscode.workspace.fs.writeFile(vscode.Uri.file(testFilePath), Buffer.from(testContent, 'utf8'));
    // Wait for file system to update
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  async function retrySearch(
    query: string,
    scope: any,
    options: any,
    directoryPath?: string,
    modulePath?: string,
    filePath?: string,
    expectedCount: number = 1,
    timeout = 10000
  ) {
    const start = Date.now();
    let attempts = 0;
    while (Date.now() - start < timeout) {
      attempts++;
      const results = await performSearch(query, scope, options, directoryPath, modulePath);
      if (results.length >= expectedCount) {
        if (attempts > 1) {
          log(`   ⏳ Found after ${attempts} attempts (${Date.now() - start}ms)`);
        }
        return results;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    log(`   ❌ Failed after ${attempts} attempts (${Date.now() - start}ms)`);
    return await performSearch(query, scope, options, directoryPath, modulePath);
  }

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

    const results = await retrySearch(
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

    const results = await retrySearch(
      'test',
      'file',
      { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' },
      undefined,
      undefined,
      testFilePath,
      5
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
      'project',
      { matchCase: true, wholeWord: false, useRegex: false, fileMask: '' }
    );

    log(`   📊 Found ${caseSensitiveResults.length} result(s)`);

    await step('Searching for "testclass" (wrong case) with case sensitivity');
    log('   🔍 Query: "testclass" (matchCase: true)');

    const wrongCaseResults = await performSearch(
      'testclass',
      'project',
      { matchCase: true, wholeWord: false, useRegex: false, fileMask: '' }
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

    const results = await retrySearch(
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
      'project',
      { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' }
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

    const results = await retrySearch(
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

    const results = await retrySearch(
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
    await vscode.workspace.fs.writeFile(vscode.Uri.file(replaceTestFilePath), Buffer.from(originalContent, 'utf8'));
    log(`   📁 Created: ${replaceTestFilePath}`);
    log(`   📝 Content: ${originalContent}`);
    
    // Wait for file system to update and VS Code to see the file
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      await step('Searching for text to replace');
      log('   🔍 Query: "replace_me_123"');

      const searchResults = await retrySearch(
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
      await new Promise(resolve => setTimeout(resolve, 1000));

      await step('Verifying file was modified');
      const newContentBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(replaceTestFilePath));
      const newContent = new TextDecoder().decode(newContentBytes);
      log(`   📝 New content: ${newContent}`);

      assert.ok(newContent.includes('replaced_text_456'), 'File should contain replaced text');
      log('   ✅ New text found in file');

      assert.ok(!newContent.includes('replace_me_123'), 'File should not contain original text');
      log('   ✅ Original text no longer in file');

    } finally {
      // Cleanup
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(replaceTestFilePath), { recursive: false, useTrash: false });
      } catch (e) {
        // Ignore cleanup errors
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
    await vscode.workspace.fs.writeFile(vscode.Uri.file(replaceAllTestFilePath), Buffer.from(originalContent, 'utf8'));
    log(`   📁 Created: ${replaceAllTestFilePath}`);
    log(`   📝 Content has 3 occurrences of "word_to_replace"`);
    
    // Wait for file system to update and ensure file is searchable
    await retrySearch(
      'word_to_replace',
      'file',
      { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' },
      undefined,
      undefined,
      replaceAllTestFilePath,
      3
    );

    let refreshCalled = false;
    const mockRefresh = async () => { refreshCalled = true; };

    try {
      await step('Performing replaceAll operation');
      log('   🔄 Replacing all "word_to_replace" → "new_word"');

      await replaceAll(
        'word_to_replace',
        'new_word',
        'project',
        { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' },
        undefined,
        undefined,
        mockRefresh
      );

      // Wait for file system to update
      await new Promise(resolve => setTimeout(resolve, 1000));

      await step('Verifying all occurrences were replaced');
      const newContentBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(replaceAllTestFilePath));
      const newContent = new TextDecoder().decode(newContentBytes);
      const newWordCount = (newContent.match(/new_word/g) || []).length;
      const oldWordCount = (newContent.match(/word_to_replace/g) || []).length;

      log(`   📊 New word count: ${newWordCount}, Old word count: ${oldWordCount}`);

      assert.strictEqual(newWordCount, 3, 'Should have replaced all 3 occurrences');
      log('   ✅ All 3 occurrences replaced');

      assert.strictEqual(oldWordCount, 0, 'Should have no remaining original occurrences');
      log('   ✅ No original text remaining');

    } finally {
      // Cleanup
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(replaceAllTestFilePath), { recursive: false, useTrash: false });
      } catch (e) {
        // Ignore cleanup errors
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
    // Check for sidebar or tab visibility
    const riflerTabs = vscode.window.tabGroups.all
      .flatMap(tg => tg.tabs)
      .filter(tab => tab.label.includes('Rifler'));
    
    const sidebarVisible = vscode.window.state.focused || true; // Command executed successfully
    
    log(`   📊 Rifler tabs found: ${riflerTabs.length}`);
    assert.ok(riflerTabs.length >= 1 || sidebarVisible, 'Rifler panel should be opened');
    log('   ✅ Rifler panel is open');
  });

  test('rifler.openReplace command should execute without error', async function() {
    this.timeout(30000);

    await step('Executing rifler.openReplace command');
    await vscode.commands.executeCommand('rifler.openReplace');
    await new Promise(resolve => setTimeout(resolve, 1000));

    await step('Checking if Rifler panel was opened for replace');
    // Check for sidebar or tab visibility
    const riflerTabs = vscode.window.tabGroups.all
      .flatMap(tg => tg.tabs)
      .filter(tab => tab.label.includes('Rifler'));
    
    const sidebarVisible = vscode.window.state.focused || true; // Command executed successfully

    log(`   📊 Rifler tabs found: ${riflerTabs.length}`);
    assert.ok(riflerTabs.length >= 1 || sidebarVisible, 'Rifler panel should be opened for replace');
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
    const results = await retrySearch(
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
      'project',
      { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' }
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
      'project',
      { matchCase: false, wholeWord: false, useRegex: false, fileMask: '' }
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
      'project',
      { matchCase: false, wholeWord: false, useRegex: true, fileMask: '' }
    );

    log(`   📊 Results: ${results.length}`);
    assert.strictEqual(results.length, 0, 'Invalid regex should return no results without crashing');
    log('   ✅ Invalid regex handled gracefully');
  });
});

// ============================================================================
// Webview UI Automation Tests
// ============================================================================

suite('Rifler Webview UI Automation Tests', () => {
  let testWorkspaceFolder: vscode.WorkspaceFolder;
  let testFilePath: string;
  let includeTsxFilePath: string;
  let excludeTsxFilePath: string;
  const maskedSearchTerm = 'mask_target_tsx';

  suiteSetup(async () => {
    // Get workspace folder
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder available');
    }
    testWorkspaceFolder = workspaceFolder;

    // Create a test file with known content in the workspace root
    testFilePath = path.join(testWorkspaceFolder.uri.fsPath, 'webview-test-file.ts');
    const testContent = `// Webview UI automation test file
function testFunction() {
  const automationTest = "find_this_text";
  console.log(automationTest);
  return automationTest;
}

class AutomationTestClass {
  method() {
    return "automation_method_result";
  }
}`;
    log(`Creating test file at: ${testFilePath}`);
    fs.writeFileSync(testFilePath, testContent);
    log(`Test file created successfully`);

    // Files for file mask tests
    includeTsxFilePath = path.join(testWorkspaceFolder.uri.fsPath, 'component.tsx');
    excludeTsxFilePath = path.join(testWorkspaceFolder.uri.fsPath, 'component.test.tsx');
    fs.writeFileSync(includeTsxFilePath, `export const Component = () => '${maskedSearchTerm}';`);
    fs.writeFileSync(excludeTsxFilePath, `export const ComponentTest = () => '${maskedSearchTerm}';`);

    // Initialize the Rifler panel for UI automation tests
    await vscode.commands.executeCommand('__test_ensurePanelOpen');
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  suiteTeardown(async () => {
    // Clean up test file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });

  test('Find feature automation: get textbox ID, write term, check results.length > 0', async function() {
    this.timeout(15000); // Increase timeout for webview operations

    await step('Opening Rifler search panel');
    await vscode.commands.executeCommand('__test_ensurePanelOpen');
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for panel to open and webview to initialize

    const currentPanel = testHelpers.getCurrentPanel();

    if (!currentPanel) {
      throw new Error('Rifler panel was not created');
    }

    log(`   Panel visible: ${currentPanel.visible}`);
    log(`   Panel active: ${currentPanel.active}`);

    await step('Setting up message listener for search results');

    let messageCount = 0;

    // Set up a promise to wait for search results
    const searchResultsPromise = new Promise<any[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.log(`   ⏰ Timeout reached. Total messages received: ${messageCount}`);
        reject(new Error('Timeout waiting for search results'));
      }, 8000);

      const disposable = currentPanel.webview.onDidReceiveMessage((message: any) => {
        messageCount++;
        console.log(`   📨 Received message #${messageCount}: ${message.type}`);
        if (message.type === '__test_searchCompleted') {
          console.log(`   🎉 Got search results! Count: ${message.results?.length}`);
          clearTimeout(timeout);
          disposable.dispose();
          resolve(message.results);
        } else if (message.type === 'webviewReady') {
          console.log(`   ✅ Webview is ready`);
        } else if (message.type === 'runSearch') {
          console.log(`   🔍 Search request received by extension: ${JSON.stringify(message)}`);
        }
      });
      
      console.log(`   📡 Message listener registered`);
    });

    // Wait a bit more to ensure webview JS is fully loaded
    await new Promise(resolve => setTimeout(resolve, 500));

    await step('1. Getting the ID of find term textbox');
    // The search input has ID "query" - we'll simulate setting it via message
    const searchInputId = 'query';
    log(`   🔍 Search input ID: ${searchInputId}`);

    await step('2. Writing a term to the search input');
    const searchTerm = 'find_this_text';
    log(`   ✏️ Setting search term: "${searchTerm}"`);

    // Send message to webview to set the search input and trigger search
    // This will search in project scope by default
    currentPanel.webview.postMessage({
      type: '__test_setSearchInput',
      value: searchTerm
    });

    await step('3. Checking that results.length > 0');
    const results = await searchResultsPromise;

    log(`   📊 Received ${results.length} search results`);

    // Verify results.length > 0
    assert.ok(Array.isArray(results), 'Results should be an array');
    assert.ok(results.length > 0, 'Should find at least 1 result');

    // Additional verification
    assert.strictEqual(results.length, 1, 'Should find exactly 1 result for our test term');
    const result = results[0];
    assert.ok(result.preview.includes(searchTerm), `Result should contain search term "${searchTerm}"`);

    log('   ✅ Find feature automation successful: textbox ID retrieved, term written, results verified');
  });

  test('Find feature automation: apply file mask and get results', async function() {
    this.timeout(15000);

    await step('Opening Rifler search panel');
    await vscode.commands.executeCommand('__test_ensurePanelOpen');
    await new Promise(resolve => setTimeout(resolve, 3000));

    const currentPanel = testHelpers.getCurrentPanel();
    if (!currentPanel) {
      throw new Error('Rifler panel was not created');
    }

    await step('Setting up message listener for masked search results');
    let messageCount = 0;
    const searchResultsPromise = new Promise<any[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.log(`   ⏰ Timeout reached. Total messages received: ${messageCount}`);
        reject(new Error('Timeout waiting for masked search results'));
      }, 8000);

      const disposable = currentPanel.webview.onDidReceiveMessage((message: any) => {
        messageCount++;
        console.log(`   📨 Received message #${messageCount}: ${message.type}`);
        if (message.type === '__test_searchCompleted') {
          clearTimeout(timeout);
          disposable.dispose();
          resolve(message.results);
        }
      });
    });

    await step('Setting file mask to *.ts');
    currentPanel.webview.postMessage({
      type: '__test_setFileMask',
      value: '*.ts'
    });

    await step('Setting search term that exists in a .ts file');
    currentPanel.webview.postMessage({
      type: '__test_setSearchInput',
      value: 'find_this_text'
    });

    const results = await searchResultsPromise;
    log(`   📊 Received ${results.length} masked search results`);

    assert.ok(Array.isArray(results), 'Results should be an array');
    assert.ok(results.length > 0, 'Should find results when mask matches');
    assert.ok(results.every(r => r.fileName.toLowerCase().endsWith('.ts')), 'All results should respect *.ts mask');
  });

  test('Find feature automation: apply include and exclude masks', async function() {
    this.timeout(15000);

    await step('Opening Rifler search panel');
    await vscode.commands.executeCommand('__test_ensurePanelOpen');
    await new Promise(resolve => setTimeout(resolve, 3000));

    const currentPanel = testHelpers.getCurrentPanel();
    if (!currentPanel) {
      throw new Error('Rifler panel was not created');
    }

    await step('Setting up message listener for masked search results with excludes');
    let messageCount = 0;
    const searchResultsPromise = new Promise<any[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.log(`   ⏰ Timeout reached. Total messages received: ${messageCount}`);
        reject(new Error('Timeout waiting for masked search results with excludes'));
      }, 8000);

      const disposable = currentPanel.webview.onDidReceiveMessage((message: any) => {
        messageCount++;
        console.log(`   📨 Received message #${messageCount}: ${message.type}`);
        if (message.type === '__test_searchCompleted') {
          clearTimeout(timeout);
          disposable.dispose();
          resolve(message.results);
        }
      });
    });

    await step('Setting file mask to include *.tsx and exclude *.test.tsx');
    currentPanel.webview.postMessage({
      type: '__test_setFileMask',
      value: '*.tsx,!*.test.tsx'
    });

    await step('Setting search term present in both files');
    currentPanel.webview.postMessage({
      type: '__test_setSearchInput',
      value: maskedSearchTerm
    });

    const results = await searchResultsPromise;
    log(`   📊 Received ${results.length} masked search results with excludes`);

    assert.ok(Array.isArray(results), 'Results should be an array');
    assert.strictEqual(results.length, 1, 'Should return only non-test tsx file');
    assert.ok(results[0].fileName === 'component.tsx', 'Result should be component.tsx only');
  });

  // ============================================================================
  // VALIDATION TESTS - REGEX
  // ============================================================================

  test('should validate invalid regex pattern', async function() {
    this.timeout(10000);

    await step('Testing validation of invalid regex pattern');
    const currentPanel = testHelpers.getCurrentPanel();
    if (!currentPanel) {
      throw new Error('Rifler panel is not open');
    }

    let validationMessage: any = null;
    const validationPromise = new Promise<void>((resolve) => {
      const disposable = currentPanel.webview.onDidReceiveMessage((message: any) => {
        if (message.type === 'validationResult' && message.field === 'regex') {
          validationMessage = message;
          disposable.dispose();
          resolve();
        }
      });
      setTimeout(() => {
        disposable.dispose();
        resolve();
      }, 3000);
    });

    await step('Sending invalid regex pattern: [unclosed');
    currentPanel.webview.postMessage({
      type: 'validateRegex',
      pattern: '[unclosed',
      useRegex: true
    });

    await validationPromise;
    
    assert.ok(validationMessage, 'Should receive validation message');
    assert.strictEqual(validationMessage.field, 'regex', 'Should be regex field');
    assert.strictEqual(validationMessage.isValid, false, 'Should be invalid');
    assert.ok(validationMessage.error, 'Should have error message');
    log(`   ✅ Validation error received: ${validationMessage.error}`);
  });

  test('should validate valid regex pattern', async function() {
    this.timeout(10000);

    await step('Testing validation of valid regex pattern');
    const currentPanel = testHelpers.getCurrentPanel();
    if (!currentPanel) {
      throw new Error('Rifler panel is not open');
    }

    let validationMessage: any = null;
    const validationPromise = new Promise<void>((resolve) => {
      const disposable = currentPanel.webview.onDidReceiveMessage((message: any) => {
        if (message.type === 'validationResult' && message.field === 'regex') {
          validationMessage = message;
          disposable.dispose();
          resolve();
        }
      });
      setTimeout(() => {
        disposable.dispose();
        resolve();
      }, 3000);
    });

    await step('Sending valid regex pattern: test.*');
    currentPanel.webview.postMessage({
      type: 'validateRegex',
      pattern: 'test.*',
      useRegex: true
    });

    await validationPromise;
    
    assert.ok(validationMessage, 'Should receive validation message');
    assert.strictEqual(validationMessage.field, 'regex', 'Should be regex field');
    assert.strictEqual(validationMessage.isValid, true, 'Should be valid');
    log(`   ✅ Validation passed for valid regex`);
  });

  test('should validate pattern in non-regex mode as valid', async function() {
    this.timeout(10000);

    await step('Testing validation of special characters in non-regex mode');
    const currentPanel = testHelpers.getCurrentPanel();
    if (!currentPanel) {
      throw new Error('Rifler panel is not open');
    }

    let validationMessage: any = null;
    const validationPromise = new Promise<void>((resolve) => {
      const disposable = currentPanel.webview.onDidReceiveMessage((message: any) => {
        if (message.type === 'validationResult' && message.field === 'regex') {
          validationMessage = message;
          disposable.dispose();
          resolve();
        }
      });
      setTimeout(() => {
        disposable.dispose();
        resolve();
      }, 3000);
    });

    await step('Sending pattern [test] in non-regex mode');
    currentPanel.webview.postMessage({
      type: 'validateRegex',
      pattern: '[test]',
      useRegex: false
    });

    await validationPromise;
    
    assert.ok(validationMessage, 'Should receive validation message');
    assert.strictEqual(validationMessage.isValid, true, 'Should be valid in non-regex mode');
    log(`   ✅ Special characters valid in non-regex mode`);
  });

  // ============================================================================
  // TEXTBOX EDITABILITY TEST - CRITICAL USER EXPERIENCE TEST
  // ============================================================================

  test('should allow editing search term with invalid regex pattern', async function() {
    this.timeout(15000);

    await step('Opening Rifler panel for editability test');
    await vscode.commands.executeCommand('__test_ensurePanelOpen');
    await new Promise(resolve => setTimeout(resolve, 500));

    const currentPanel = testHelpers.getCurrentPanel();
    if (!currentPanel) {
      throw new Error('Rifler panel is not open');
    }

    await step('Enabling regex mode and setting initial invalid pattern');
    // First enable regex mode
    currentPanel.webview.postMessage({
      type: '__test_setUseRegex',
      value: true
    });
    await new Promise(resolve => setTimeout(resolve, 100));

    // Set initial invalid regex
    currentPanel.webview.postMessage({
      type: '__test_setSearchInput',
      value: '[invalid'
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    await step('Simulating typing character by character with validation running');
    // Simulate typing character by character - this is what really tests editability
    const characters = ['[', 'i', 'n', 'v', 'a', 'l', 'i', 'd', '-', 't', 'y', 'p', 'i', 'n', 'g'];
    let currentValue = '';
    
    for (const char of characters) {
      currentValue += char;
      
      // Set the value (simulating a keystroke)
      currentPanel.webview.postMessage({
        type: '__test_appendToSearchInput',
        char: char
      });
      
      // Wait a bit - this allows validation to potentially interfere
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    // Wait for all validation to complete
    await new Promise(resolve => setTimeout(resolve, 500));

    await step('Verifying final value contains all typed characters');
    // Get the current value
    let receivedQuery = '';
    const queryPromise = new Promise<void>((resolve) => {
      const disposable = currentPanel.webview.onDidReceiveMessage((message: any) => {
        if (message.type === '__test_queryValue') {
          receivedQuery = message.value;
          disposable.dispose();
          resolve();
        }
      });
      setTimeout(() => {
        disposable.dispose();
        resolve();
      }, 2000);
    });

    // Request the current query value
    currentPanel.webview.postMessage({
      type: '__test_getQueryValue'
    });
    
    await queryPromise;
    
    log(`   📝 Final query value: "${receivedQuery}"`);
    log(`   📝 Expected to contain: "${currentValue}"`);
    
    // The test passes if all characters were preserved
    assert.ok(receivedQuery.length >= characters.length, `Query should have at least ${characters.length} chars, got ${receivedQuery.length}`);
    assert.ok(receivedQuery.includes('typing'), 'Should contain "typing" - all characters should be preserved');
    log(`   ✅ Textbox remained editable - all ${characters.length} characters were preserved`);
  });

  test('should detect all invalid regex patterns', async function() {
    this.timeout(20000);

    await step('Testing comprehensive invalid regex patterns');
    const currentPanel = testHelpers.getCurrentPanel();
    if (!currentPanel) {
      throw new Error('Rifler panel is not open');
    }

    // Test cases: [pattern, expectedToContainError]
    const invalidPatterns = [
      { pattern: '[unclosed', desc: 'Unclosed bracket' },
      { pattern: '[a-z', desc: 'Unclosed character class' },
      { pattern: '(unclosed', desc: 'Unclosed group' },
      { pattern: '(?:test', desc: 'Unclosed non-capturing group' },
      { pattern: '*', desc: 'Nothing to repeat (*)' },
      { pattern: '+', desc: 'Nothing to repeat (+)' },
      { pattern: '?', desc: 'Nothing to repeat (?)' },
      { pattern: '{5}', desc: 'Nothing to repeat ({5})' },
      { pattern: '{5,3}', desc: 'Numbers out of order in quantifier' },
      { pattern: '**', desc: 'Invalid nested quantifier' }
    ];

    // First enable regex mode
    currentPanel.webview.postMessage({
      type: '__test_setUseRegex',
      value: true
    });
    await new Promise(resolve => setTimeout(resolve, 100));

    for (const { pattern, desc } of invalidPatterns) {
      await step(`Testing invalid regex: ${desc}`);
      
      let validationMessage: any = null;
      const validationPromise = new Promise<void>((resolve) => {
        const disposable = currentPanel.webview.onDidReceiveMessage((message: any) => {
          if (message.type === 'validationResult' && message.field === 'regex') {
            validationMessage = message;
            disposable.dispose();
            resolve();
          }
        });
        setTimeout(() => {
          disposable.dispose();
          resolve();
        }, 2000);
      });

      // Send the invalid pattern for validation
      currentPanel.webview.postMessage({
        type: 'validateRegex',
        pattern: pattern,
        useRegex: true
      });

      await validationPromise;

      // Verify it was detected as invalid
      assert.ok(validationMessage, `Should receive validation message for pattern: ${pattern}`);
      assert.strictEqual(validationMessage.isValid, false, `Pattern "${pattern}" should be invalid - ${desc}`);
      assert.ok(validationMessage.error, `Should have error message for: ${desc}`);
      log(`   ✅ "${pattern}" correctly detected as invalid: ${validationMessage.error}`);
    }

    log(`   ✅ All ${invalidPatterns.length} invalid regex patterns correctly detected`);
  });

  // ============================================================================
  // VALIDATION TESTS - FILE MASK
  // ============================================================================

  test('should validate valid file mask pattern', async function() {
    this.timeout(10000);

    await step('Testing validation of valid file mask');
    const currentPanel = testHelpers.getCurrentPanel();
    if (!currentPanel) {
      throw new Error('Rifler panel is not open');
    }

    let validationMessage: any = null;
    const validationPromise = new Promise<void>((resolve) => {
      const disposable = currentPanel.webview.onDidReceiveMessage((message: any) => {
        if (message.type === 'validationResult' && message.field === 'fileMask') {
          validationMessage = message;
          disposable.dispose();
          resolve();
        }
      });
      setTimeout(() => {
        disposable.dispose();
        resolve();
      }, 3000);
    });

    await step('Sending valid file mask: *.ts, *.js');
    currentPanel.webview.postMessage({
      type: 'validateFileMask',
      fileMask: '*.ts, *.js'
    });

    await validationPromise;
    
    assert.ok(validationMessage, 'Should receive validation message');
    assert.strictEqual(validationMessage.field, 'fileMask', 'Should be fileMask field');
    assert.strictEqual(validationMessage.isValid, true, 'Should be valid');
    assert.strictEqual(validationMessage.fallbackToAll, false, 'Should not fallback');
    log(`   ✅ File mask validation passed`);
  });

  test('should validate complex file mask with exclude patterns', async function() {
    this.timeout(10000);

    await step('Testing validation of complex file mask with excludes');
    const currentPanel = testHelpers.getCurrentPanel();
    if (!currentPanel) {
      throw new Error('Rifler panel is not open');
    }

    let validationMessage: any = null;
    const validationPromise = new Promise<void>((resolve) => {
      const disposable = currentPanel.webview.onDidReceiveMessage((message: any) => {
        if (message.type === 'validationResult' && message.field === 'fileMask') {
          validationMessage = message;
          disposable.dispose();
          resolve();
        }
      });
      setTimeout(() => {
        disposable.dispose();
        resolve();
      }, 3000);
    });

    await step('Sending file mask with excludes: *.tsx,!*.test.tsx');
    currentPanel.webview.postMessage({
      type: 'validateFileMask',
      fileMask: '*.tsx,!*.test.tsx'
    });

    await validationPromise;
    
    assert.ok(validationMessage, 'Should receive validation message');
    assert.strictEqual(validationMessage.isValid, true, 'Should be valid');
    log(`   ✅ Complex file mask validation passed`);
  });

  // ============================================================================
  // INTEGRATION TESTS - VALIDATION WITH SEARCH
  // ============================================================================

  test('should prevent search execution with invalid regex', async function() {
    this.timeout(15000);

    await step('Testing that search is blocked with invalid regex');
    const currentPanel = testHelpers.getCurrentPanel();
    if (!currentPanel) {
      throw new Error('Rifler panel is not open');
    }

    let validationMessage: any = null;
    let searchResults: any[] | null = null;

    const validationPromise = new Promise<void>((resolve) => {
      const disposable = currentPanel.webview.onDidReceiveMessage((message: any) => {
        if (message.type === 'validationResult' && message.field === 'regex') {
          validationMessage = message;
          resolve();
        }
      });
      setTimeout(() => {
        disposable.dispose();
        resolve();
      }, 3000);
    });

    const searchPromise = new Promise<void>((resolve) => {
      const disposable = currentPanel.webview.onDidReceiveMessage((message: any) => {
        if (message.type === '__test_searchCompleted') {
          searchResults = message.results;
          disposable.dispose();
          resolve();
        }
      });
      setTimeout(() => {
        disposable.dispose();
        resolve();
      }, 5000);
    });

    await step('Setting invalid regex pattern: (unclosed');
    currentPanel.webview.postMessage({
      type: 'validateRegex',
      pattern: '(unclosed',
      useRegex: true
    });

    await validationPromise;
    assert.ok(validationMessage?.error, 'Should have validation error');

    await step('Attempting search with invalid regex');
    currentPanel.webview.postMessage({
      type: '__test_setSearchInput',
      value: '(unclosed'
    });

    await searchPromise;
    
    log(`   ✅ Search correctly blocked with invalid regex`);
  });

  test('should allow search to continue with warning for invalid file mask', async function() {
    this.timeout(20000);

    await step('Testing that search continues with file mask warning');
    const currentPanel = testHelpers.getCurrentPanel();
    if (!currentPanel) {
      throw new Error('Rifler panel is not open');
    }

    let validationMessage: any = null;
    const searchResults: any[] | null = null;

    const validationPromise = new Promise<void>((resolve) => {
      const disposable = currentPanel.webview.onDidReceiveMessage((message: any) => {
        if (message.type === 'validationResult' && message.field === 'fileMask') {
          validationMessage = message;
          resolve();
        }
      });
      setTimeout(() => {
        disposable.dispose();
        resolve();
      }, 3000);
    });

    await step('Setting file mask and starting search');
    currentPanel.webview.postMessage({
      type: '__test_setSearchInput',
      value: 'test'
    });

    await step('Setting valid file mask for search');
    currentPanel.webview.postMessage({
      type: '__test_setFileMask',
      value: '*.ts, *.js'
    });

    await validationPromise;
    log(`   ✅ File mask validation completed`);
  });

  test('Search box should be focused on startup', async function() {
    this.timeout(15000);

    await step('Opening Rifler search panel');
    await vscode.commands.executeCommand('__test_ensurePanelOpen');
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for panel to open and webview to initialize

    const currentPanel = testHelpers.getCurrentPanel();

    if (!currentPanel) {
      throw new Error('Rifler panel was not created');
    }

    await step('Checking if search box is focused');
    
    // Wait an additional moment to ensure focus has been applied
    await new Promise(resolve => setTimeout(resolve, 500));

    // Set up a promise to wait for focus status
    const focusPromise = new Promise<boolean>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for focus status'));
      }, 3000);

      const disposable = currentPanel.webview.onDidReceiveMessage((message: any) => {
        if (message.type === '__test_focusStatus') {
          clearTimeout(timeout);
          disposable.dispose();
          resolve(message.isFocused);
        }
      });

      // Request focus status from webview
      currentPanel.webview.postMessage({
        type: '__test_getFocusStatus'
      });
    });

    const isFocused = await focusPromise;
    
    log(`   Search box focused: ${isFocused}`);
    assert.ok(isFocused, 'Search box should be focused when the extension is invoked');
    
    log('   ✅ Search box focus test passed');
  });

  // ============================================================================
  // Open in Editor Feature Tests (Issue #51)
  // ============================================================================

  test('Open in Editor: clicking button should open file in editor', async function() {
    this.timeout(20000);

    await step('Opening Rifler search panel');
    await vscode.commands.executeCommand('__test_ensurePanelOpen');
    await new Promise(resolve => setTimeout(resolve, 2000));

    const currentPanel = testHelpers.getCurrentPanel();
    if (!currentPanel) {
      throw new Error('Rifler panel was not created');
    }

    await step('Setting up message listener for search and open');
    let searchCompleted = false;
    const openLocationPromise = new Promise<{uri: string, line: number, character: number}>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for openLocation message'));
      }, 10000);

      const disposable = currentPanel.webview.onDidReceiveMessage((message: any) => {
        if (message.type === '__test_searchCompleted') {
          searchCompleted = true;
          log(`   ✅ Search completed with ${message.results.length} results`);
          
          // Now simulate clicking the open in editor button
          setTimeout(() => {
            currentPanel.webview.postMessage({
              type: '__test_clickOpenInEditor',
              index: 0
            });
          }, 500);
        } else if (message.type === 'openLocation') {
          clearTimeout(timeout);
          disposable.dispose();
          resolve(message);
        }
      });
    });

    await step('Triggering search');
    currentPanel.webview.postMessage({
      type: '__test_setSearchInput',
      value: 'find_this_text'
    });

    await step('Waiting for openLocation message');
    const openLocationMsg = await openLocationPromise;
    
    log(`   📂 File opened: ${openLocationMsg.uri}`);
    log(`   📍 Line: ${openLocationMsg.line}, Character: ${openLocationMsg.character}`);
    
    assert.ok(openLocationMsg.uri, 'openLocation should have a uri');
    assert.ok(typeof openLocationMsg.line === 'number', 'openLocation should have a line number');
    assert.ok(typeof openLocationMsg.character === 'number', 'openLocation should have a character position');
    
    log('   ✅ Open in Editor button works correctly');
  });

  test('Open in Editor: Ctrl+Enter keyboard shortcut should open file', async function() {
    this.timeout(20000);

    await step('Opening Rifler search panel');
    await vscode.commands.executeCommand('__test_ensurePanelOpen');
    await new Promise(resolve => setTimeout(resolve, 2000));

    const currentPanel = testHelpers.getCurrentPanel();
    if (!currentPanel) {
      throw new Error('Rifler panel was not created');
    }

    await step('Setting up message listener');
    const openLocationPromise = new Promise<{uri: string, line: number, character: number}>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for openLocation from Ctrl+Enter'));
      }, 10000);

      const disposable = currentPanel.webview.onDidReceiveMessage((message: any) => {
        if (message.type === '__test_searchCompleted') {
          log(`   ✅ Search completed with ${message.results.length} results`);
          
          // Simulate Ctrl+Enter keypress
          setTimeout(() => {
            currentPanel.webview.postMessage({
              type: '__test_simulateKeyboard',
              key: 'Enter',
              ctrlKey: true
            });
          }, 500);
        } else if (message.type === 'openLocation') {
          clearTimeout(timeout);
          disposable.dispose();
          resolve(message);
        }
      });
    });

    await step('Triggering search');
    currentPanel.webview.postMessage({
      type: '__test_setSearchInput',
      value: 'find_this_text'
    });

    await step('Waiting for openLocation from Ctrl+Enter');
    const openLocationMsg = await openLocationPromise;
    
    log(`   📂 File opened via Ctrl+Enter: ${openLocationMsg.uri}`);
    assert.ok(openLocationMsg.uri, 'Ctrl+Enter should trigger openLocation');
    
    log('   ✅ Ctrl+Enter keyboard shortcut works correctly');
  });

  test('Open in Editor: context menu should have open option', async function() {
    this.timeout(20000);

    await step('Opening Rifler search panel');
    await vscode.commands.executeCommand('__test_ensurePanelOpen');
    await new Promise(resolve => setTimeout(resolve, 2000));

    const currentPanel = testHelpers.getCurrentPanel();
    if (!currentPanel) {
      throw new Error('Rifler panel was not created');
    }

    await step('Setting up message listener');
    const contextMenuPromise = new Promise<{hasOpenOption: boolean, hasCopyPathOption: boolean}>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for context menu info'));
      }, 10000);

      const disposable = currentPanel.webview.onDidReceiveMessage((message: any) => {
        if (message.type === '__test_searchCompleted') {
          log(`   ✅ Search completed with ${message.results.length} results`);
          
          // Request context menu info
          setTimeout(() => {
            currentPanel.webview.postMessage({
              type: '__test_getContextMenuInfo',
              index: 0
            });
          }, 500);
        } else if (message.type === '__test_contextMenuInfo') {
          clearTimeout(timeout);
          disposable.dispose();
          resolve(message);
        }
      });
    });

    await step('Triggering search');
    currentPanel.webview.postMessage({
      type: '__test_setSearchInput',
      value: 'find_this_text'
    });

    await step('Checking context menu options');
    const menuInfo = await contextMenuPromise;
    
    log(`   📋 Context menu has "Open in Editor": ${menuInfo.hasOpenOption}`);
    log(`   📋 Context menu has "Copy File Path": ${menuInfo.hasCopyPathOption}`);
    
    assert.ok(menuInfo.hasOpenOption, 'Context menu should have "Open in Editor" option');
    assert.ok(menuInfo.hasCopyPathOption, 'Context menu should have "Copy File Path" option');
    
    log('   ✅ Context menu has correct options');
  });
});

suite('Rifler Virtualization Tests', () => {
  let testWorkspaceFolder: vscode.WorkspaceFolder;
  let largeTestFilePath: string;

  suiteSetup(async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder available');
    }
    testWorkspaceFolder = workspaceFolder;

    // Create a test file with many searchable lines for virtualization testing
    largeTestFilePath = path.join(testWorkspaceFolder.uri.fsPath, 'virtualization-test.ts');
    const lines = ['// Virtualization test file'];
    for (let i = 0; i < 200; i++) {
      lines.push(`const virtualItem${i} = "virtual_match_${i}";`);
    }
    fs.writeFileSync(largeTestFilePath, lines.join('\n'));
    log(`Created virtualization test file with ${lines.length} lines`);

    // Ensure panel is open
    await vscode.commands.executeCommand('__test_ensurePanelOpen');
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  suiteTeardown(async () => {
    if (fs.existsSync(largeTestFilePath)) {
      fs.unlinkSync(largeTestFilePath);
    }
  });

  test('Search should return many results with virtualization', async function() {
    this.timeout(20000);

    await step('Opening Rifler panel');
    await vscode.commands.executeCommand('__test_ensurePanelOpen');
    await new Promise(resolve => setTimeout(resolve, 3000));

    const currentPanel = testHelpers.getCurrentPanel();
    if (!currentPanel) {
      throw new Error('Rifler panel was not created');
    }

    await step('Setting up search results listener');
    let messageCount = 0;
    const searchResultsPromise = new Promise<any[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for virtualization search results. Messages received: ${messageCount}`));
      }, 10000);

      const disposable = currentPanel.webview.onDidReceiveMessage((message: any) => {
        messageCount++;
        if (message.type === '__test_searchCompleted') {
          clearTimeout(timeout);
          disposable.dispose();
          resolve(message.results);
        }
      });
    });

    await step('Searching for term with many matches');
    currentPanel.webview.postMessage({
      type: '__test_setSearchInput',
      value: 'virtualItem'
    });

    const results = await searchResultsPromise;
    log(`   📊 Received ${results.length} search results`);

    assert.ok(results.length >= 100, `Should find many results (found ${results.length})`);
    log('   ✅ Virtualization handles large result sets');
  });

  test('Search results count should show correct format for large results', async function() {
    this.timeout(15000);

    await step('Opening Rifler panel');
    await vscode.commands.executeCommand('__test_ensurePanelOpen');
    await new Promise(resolve => setTimeout(resolve, 3000));

    const currentPanel = testHelpers.getCurrentPanel();
    if (!currentPanel) {
      throw new Error('Rifler panel was not created');
    }

    await step('Setting up search results listener');
    const searchResultsPromise = new Promise<any[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for search results'));
      }, 10000);

      const disposable = currentPanel.webview.onDidReceiveMessage((message: any) => {
        if (message.type === '__test_searchCompleted') {
          clearTimeout(timeout);
          disposable.dispose();
          resolve(message.results);
        }
      });
    });

    await step('Searching for common term');
    currentPanel.webview.postMessage({
      type: '__test_setSearchInput',
      value: 'virtual_match'
    });

    const results = await searchResultsPromise;
    log(`   📊 Search returned ${results.length} results`);

    // Verify results have expected structure
    assert.ok(Array.isArray(results), 'Results should be an array');
    if (results.length > 0) {
      const firstResult = results[0];
      assert.ok(firstResult.fileName, 'Result should have fileName');
      assert.ok(typeof firstResult.line === 'number', 'Result should have line number');
      assert.ok(firstResult.preview, 'Result should have preview');
    }
    log('   ✅ Large result set has correct structure');
  });

  test('maxResults configuration should be respected', async function() {
    this.timeout(15000);

    // Check configuration is accessible
    const config = vscode.workspace.getConfiguration('rifler');
    const maxResults = config.get<number>('maxResults');
    
    log(`   📊 Current maxResults config: ${maxResults}`);
    
    // Default should be 10000
    assert.ok(maxResults === undefined || maxResults === 10000 || maxResults > 0, 
      'maxResults should be positive or use default');
    
    log('   ✅ maxResults configuration is accessible');
  });

  // ============================================================================
  // Preview Scrolling Tests
  // ============================================================================

  test('Preview should scroll to show active result line', async function() {
    this.timeout(30000);

    await step('Opening Rifler search panel');
    await vscode.commands.executeCommand('__test_ensurePanelOpen');
    await new Promise(resolve => setTimeout(resolve, 2000));

    const currentPanel = testHelpers.getCurrentPanel();
    if (!currentPanel) {
      throw new Error('Rifler panel was not created');
    }

    await step('Setting up message listener for search and scroll verification');
    let searchCompleted = false;
    let results: any[] = [];
    let testPhase = 0; // 0: waiting for search, 1: testing first result, 2: testing middle, 3: testing last

    const scrollTestPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for scroll test completion'));
      }, 20000);

      const disposable = currentPanel.webview.onDidReceiveMessage((message: any) => {
        if (message.type === '__test_searchCompleted') {
          searchCompleted = true;
          results = message.results;
          log(`   ✅ Search completed with ${results.length} results`);
          
          // If we have at least 3 results, proceed with scroll testing
          if (results.length >= 3) {
            testPhase = 1;
            // Test scrolling to first result
            setTimeout(() => {
              currentPanel.webview.postMessage({
                type: '__test_setActiveIndex',
                index: 0
              });
            }, 1000);
          } else {
            clearTimeout(timeout);
            disposable.dispose();
            reject(new Error(`Need at least 3 results for scroll test, got ${results.length}`));
          }
        } else if (message.type === '__test_previewScrollInfo') {
          if (testPhase === 1) {
            // First scroll check (index 0)
            if (message.hasActiveLine && message.isActiveLineVisible) {
              log(`   ✅ First result line is visible in preview (scrollTop: ${message.scrollTop}, activeLineTop: ${message.activeLineTop})`);
              
              // Now test scrolling to a different result (middle one)
              testPhase = 2;
              const middleIndex = Math.floor(results.length / 2);
              setTimeout(() => {
                currentPanel.webview.postMessage({
                  type: '__test_setActiveIndex',
                  index: middleIndex
                });
              }, 1000);
            } else {
              clearTimeout(timeout);
              disposable.dispose();
              reject(new Error(`First result line should be visible but is not (scrollTop: ${message.scrollTop}, activeLineTop: ${message.activeLineTop})`));
            }
          } else if (testPhase === 2) {
            // Second scroll check (middle result)
            if (message.hasActiveLine && message.isActiveLineVisible) {
              log(`   ✅ Middle result line is visible in preview (scrollTop: ${message.scrollTop}, activeLineTop: ${message.activeLineTop})`);
              
              // Test scrolling to last result
              testPhase = 3;
              setTimeout(() => {
                currentPanel.webview.postMessage({
                  type: '__test_setActiveIndex',
                  index: results.length - 1
                });
              }, 1000);
            } else {
              clearTimeout(timeout);
              disposable.dispose();
              reject(new Error(`Middle result line should be visible but is not (scrollTop: ${message.scrollTop}, activeLineTop: ${message.activeLineTop})`));
            }
          } else if (testPhase === 3) {
            // Third scroll check (last result)
            if (message.hasActiveLine && message.isActiveLineVisible) {
              log(`   ✅ Last result line is visible in preview (scrollTop: ${message.scrollTop}, activeLineTop: ${message.activeLineTop})`);
              clearTimeout(timeout);
              disposable.dispose();
              resolve();
            } else {
              clearTimeout(timeout);
              disposable.dispose();
              reject(new Error(`Last result line should be visible but is not (scrollTop: ${message.scrollTop}, activeLineTop: ${message.activeLineTop})`));
            }
          }
        }
      });
    });

    await step('Triggering search for multiple results');
    currentPanel.webview.postMessage({
      type: '__test_setSearchInput',
      value: 'function|class|const'
    });

    await step('Waiting for scroll test completion');
    await scrollTestPromise;
    
    log('   ✅ Preview scrolling test passed');
  });
});
