#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Simple benchmark script to measure search performance
// This simulates the core search logic from extension.ts

const excludeDirs = new Set([
  'node_modules', '.git', 'dist', 'out', '__pycache__', '.venv', 'venv',
  '.idea', '.vscode', 'coverage', '.nyc_output', 'build', '.next',
  '.nuxt', '.cache', 'tmp', 'temp', '.pytest_cache', '.tox'
]);

const binaryExts = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz',
  '.exe', '.dll', '.so', '.dylib', '.woff', '.woff2', '.ttf', '.eot',
  '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.svg',
  '.lock', '.bin', '.dat', '.db', '.sqlite', '.sqlite3'
]);

function searchInDirectory(dirPath, regex, results, maxResults) {
  if (results.length >= maxResults) return;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= maxResults) break;

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (!excludeDirs.has(entry.name) && !entry.name.startsWith('.')) {
          searchInDirectory(fullPath, regex, results, maxResults);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!binaryExts.has(ext)) {
          searchInFile(fullPath, regex, results, maxResults);
        }
      }
    }
  } catch {
    // Skip directories we can't read
  }
}

function searchInFile(filePath, regex, results, maxResults) {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size > 1024 * 1024) return; // Skip files > 1MB

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let lineIndex = 0; lineIndex < lines.length && results.length < maxResults; lineIndex++) {
      const line = lines[lineIndex];
      regex.lastIndex = 0;
      
      if (regex.test(line)) {
        results.push({
          file: filePath,
          line: lineIndex,
          content: line.trim()
        });
      }
    }
  } catch {
    // Skip files that can't be read
  }
}

// Benchmark scenarios
const scenarios = [
  { name: 'Simple text search', pattern: /function/gi, description: 'Search for "function" keyword' },
  { name: 'Regex search', pattern: /import\s+.*from/gi, description: 'Search for import statements' },
  { name: 'Short word', pattern: /\bif\b/gi, description: 'Search for "if" keyword' },
  { name: 'Complex regex', pattern: /(?:const|let|var)\s+\w+\s*=/gi, description: 'Search for variable declarations' }
];

console.log('🔍 Rifler Search Benchmark\n');
console.log('Running benchmarks on current directory...\n');

const results = [];

for (const scenario of scenarios) {
  const searchResults = [];
  const startTime = Date.now();
  
  searchInDirectory(process.cwd(), scenario.pattern, searchResults, 5000);
  
  const duration = Date.now() - startTime;
  
  results.push({
    name: scenario.name,
    description: scenario.description,
    matches: searchResults.length,
    duration: duration
  });
  
  console.log(`✓ ${scenario.name}`);
  console.log(`  ${scenario.description}`);
  console.log(`  Found: ${searchResults.length} matches`);
  console.log(`  Time: ${duration}ms`);
  console.log();
}

// Calculate stats
const avgTime = Math.round(results.reduce((sum, r) => sum + r.duration, 0) / results.length);
const minTime = Math.min(...results.map(r => r.duration));
const maxTime = Math.max(...results.map(r => r.duration));
const totalMatches = results.reduce((sum, r) => sum + r.matches, 0);

console.log('📊 Summary');
console.log(`  Average time: ${avgTime}ms`);
console.log(`  Fastest: ${minTime}ms`);
console.log(`  Slowest: ${maxTime}ms`);
console.log(`  Total matches: ${totalMatches}`);

// Output for README
console.log('\n📝 README Format:\n');
console.log('## Performance');
console.log('');
console.log('Benchmark results on a typical codebase:');
console.log('');
console.log('| Scenario | Matches | Time |');
console.log('|----------|---------|------|');
results.forEach(r => {
  console.log(`| ${r.description} | ${r.matches} | ${r.duration}ms |`);
});
console.log('');
console.log(`Average search time: **${avgTime}ms** | Max results: **5000**`);
