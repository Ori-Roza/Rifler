#!/usr/bin/env node

/**
 * E2E Test Coverage Analysis
 * Since E2E tests run in a separate VS Code process, traditional code coverage
 * doesn't work. This script analyzes which extension features are tested by E2E tests.
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 E2E Test Coverage Analysis');
console.log('=' .repeat(50));

// Read E2E test files
const testDir = path.join(__dirname, '..', 'src', '__tests__', 'e2e', 'suite');
const testFiles = fs.readdirSync(testDir).filter(f => f.endsWith('.ts'));

let totalTests = 0;
let featuresTested = new Set();

testFiles.forEach(file => {
  const content = fs.readFileSync(path.join(testDir, file), 'utf8');
  const testMatches = content.match(/test\(['"](.+?)['"]/g) || [];
  totalTests += testMatches.length;

// Extract features being tested
if (content.includes('rifler.open')) featuresTested.add('Open Search Panel');
if (content.includes('rifler.openReplace')) featuresTested.add('Open Replace Panel');
if (content.includes('performSearch') || content.includes('search')) featuresTested.add('Search Functionality');
if (content.includes('replaceOne') || content.includes('replaceAll') || content.includes('replace')) featuresTested.add('Replace Functionality');
if (content.includes('vscode.workspace.getConfiguration') || content.includes('getConfiguration')) featuresTested.add('Configuration Access');
if (content.includes('webview') || content.includes('Webview')) featuresTested.add('Webview Integration');
if (content.includes('workspace') || content.includes('Workspace')) featuresTested.add('Workspace Operations');
if (content.includes('vscode.commands.executeCommand')) featuresTested.add('Command Execution');
if (content.includes('vscode.extensions.getExtension')) featuresTested.add('Extension Loading');
});

console.log(`📊 Total E2E Tests: ${totalTests}`);
console.log(`🎯 Features Tested: ${featuresTested.size}`);
console.log('\n✅ Tested Features:');
Array.from(featuresTested).sort().forEach(feature => {
  console.log(`   • ${feature}`);
});

// Read main extension file to see what could be tested
const extensionFile = path.join(__dirname, '..', 'src', 'extension.ts');
const extensionContent = fs.readFileSync(extensionFile, 'utf8');

const extensionFeatures = [];
if (extensionContent.includes('registerCommand')) extensionFeatures.push('Command Registration');
if (extensionContent.includes('createWebviewPanel')) extensionFeatures.push('Webview Creation');
if (extensionContent.includes('onDidChangeConfiguration')) extensionFeatures.push('Configuration Watching');
if (extensionContent.includes('activate')) extensionFeatures.push('Extension Activation');
if (extensionContent.includes('deactivate')) extensionFeatures.push('Extension Deactivation');

console.log('\n🔧 Extension Features (available for testing):');
extensionFeatures.forEach(feature => {
  const tested = featuresTested.has(feature.replace(' Registration', '').replace(' Creation', ' Integration').replace(' Watching', ' Access'));
  console.log(`   ${tested ? '✅' : '❌'} ${feature}`);
});

console.log('\n📈 E2E Coverage Summary:');
const coveragePercent = Math.min(100, Math.round((featuresTested.size / Math.max(extensionFeatures.length, featuresTested.size)) * 100));
console.log(`   Feature Coverage: ${coveragePercent}% (${featuresTested.size} features tested)`);
console.log(`   Test Count: ${totalTests} individual test cases`);

console.log('\n💡 Note: E2E tests provide integration coverage, complementing unit test code coverage.');
console.log('   Use "npm run test:coverage" for unit test code coverage.');
console.log('   Use "npm run test:e2e:visible" to watch E2E tests in action.');