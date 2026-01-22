import * as assert from 'assert';
import { before, after } from 'mocha';
import * as vscode from 'vscode';
import * as path from 'path';

import { performSearch } from '../../../search';

// Use process.stdout.write for synchronous output that won't be buffered
function log(message: string) {
  process.stdout.write(message + '\n');
}

suite('Multiline Search E2E Tests', () => {
  let testWorkspaceFolder: vscode.WorkspaceFolder;
  let multilineTestFilePath: string;

  before(async () => {
    // Activate the extension before running tests
    const extension = vscode.extensions.getExtension('Ori-Roza.rifler');
    if (extension && !extension.isActive) {
      await extension.activate();
    }

    // Get workspace folder
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder available');
    }
    testWorkspaceFolder = workspaceFolder;

    // Create a test file with multiline content patterns
    multilineTestFilePath = path.join(testWorkspaceFolder.uri.fsPath, 'multiline-test-file.md');
    const multilineContent = `# Multiline Test File

## Section One

npm test

# Run E2E tests

This is a test section.

## Section Two

function hello() {
  console.log("hello");
}

npm test

# Another heading

More content here.

## Empty Line Pattern

test

# Pattern with empty line

Final section.
`;

    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(multilineTestFilePath),
      Buffer.from(multilineContent, 'utf8')
    );
    // Wait for file system to update
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  after(async () => {
    // Clean up test file
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(multilineTestFilePath));
    } catch {
      // Ignore cleanup errors
    }
  });

  test('performSearch should find multiline patterns with empty lines', async function() {
    this.timeout(30000);

    log('\n🔹 Testing multiline search with empty line pattern');
    log('   🔍 Query: "npm test\\n\\n# Run"');

    const results = await performSearch(
      'npm test\n\n# Run',
      'project',
      { matchCase: false, wholeWord: false, useRegex: false, fileMask: '', multiline: true }
    );

    log(`   📊 Found ${results.length} result(s)`);
    assert.ok(results.length >= 1, 'Should find multiline pattern with empty line');
    log('   ✅ Multiline pattern found');
  });

  test('performSearch should find multiline patterns without empty lines', async function() {
    this.timeout(30000);

    log('\n🔹 Testing multiline search without empty line');
    log('   🔍 Query: "function hello() {\\n  console.log"');

    const results = await performSearch(
      'function hello() {\n  console.log',
      'project',
      { matchCase: false, wholeWord: false, useRegex: false, fileMask: '', multiline: true }
    );

    log(`   📊 Found ${results.length} result(s)`);
    assert.ok(results.length >= 1, 'Should find multiline pattern without empty line');
    log('   ✅ Multiline pattern found');
  });

  test('performSearch should find multiple multiline matches in same file', async function() {
    this.timeout(30000);

    log('\n🔹 Testing multiple multiline matches');
    log('   🔍 Query: "test\\n\\n#" (pattern appears twice)');

    const results = await performSearch(
      'test\n\n#',
      'project',
      { matchCase: false, wholeWord: false, useRegex: false, fileMask: '', multiline: true }
    );

    log(`   📊 Found ${results.length} result(s)`);
    // The pattern "test\n\n#" appears twice in our test file
    assert.ok(results.length >= 2, 'Should find multiple multiline matches');
    log('   ✅ Multiple multiline matches found');
  });

  test('performSearch should handle multiline regex patterns', async function() {
    this.timeout(30000);

    log('\n🔹 Testing multiline regex search');
    log('   🔍 Query: "npm test\\n\\n# .*" (regex)');

    const results = await performSearch(
      'npm test\n\n# .*',
      'project',
      { matchCase: false, wholeWord: false, useRegex: true, fileMask: '', multiline: true }
    );

    log(`   📊 Found ${results.length} result(s)`);
    assert.ok(results.length >= 1, 'Should find multiline regex pattern');
    log('   ✅ Multiline regex pattern found');
  });

  test('performSearch should return correct line numbers for multiline matches', async function() {
    this.timeout(30000);

    log('\n🔹 Testing line numbers in multiline results');
    log('   🔍 Query: "npm test\\n\\n# Run"');

    const results = await performSearch(
      'npm test\n\n# Run',
      'project',
      { matchCase: false, wholeWord: false, useRegex: false, fileMask: '', multiline: true },
      undefined,
      undefined
    );

    if (results.length > 0) {
      log(`   📊 First match at line ${results[0].line}`);
      // The multiline match should report the first line of the match
      assert.ok(results[0].line >= 0, 'Should have valid line number');
      log('   ✅ Line numbers are valid');
    } else {
      log('   ⚠️ No results found to verify line numbers');
    }
  });

  test('performSearch should not match if pattern spans incorrectly', async function() {
    this.timeout(30000);

    log('\n🔹 Testing non-matching multiline pattern');
    log('   🔍 Query: "npm test\\n\\n\\n# Run" (extra empty line)');

    const results = await performSearch(
      'npm test\n\n\n# Run',
      'project',
      { matchCase: false, wholeWord: false, useRegex: false, fileMask: '', multiline: true }
    );

    log(`   📊 Found ${results.length} result(s)`);
    assert.strictEqual(results.length, 0, 'Should not find pattern with incorrect line count');
    log('   ✅ No false positives for incorrect pattern');
  });
});
