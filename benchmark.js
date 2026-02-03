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

/**
 * Simple concurrency limiter
 */
class Limiter {
  constructor(max) {
    this.max = max;
    this.active = 0;
    this.queue = [];
  }

  async run(fn) {
    if (this.active >= this.max) {
      await new Promise(resolve => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      if (this.queue.length > 0) {
        this.queue.shift()();
      }
    }
  }
}

async function searchInDirectory(dirPath, regex, results, maxResults, limiter) {
  if (results.length >= maxResults) return;

  try {
    // Use limiter for directory reading
    const entries = await limiter.run(() => fs.promises.readdir(dirPath, { withFileTypes: true }));
    const tasks = [];

    for (const entry of entries) {
      if (results.length >= maxResults) break;

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (!excludeDirs.has(entry.name) && !entry.name.startsWith('.')) {
          // Recursively search subdirectories in parallel
          tasks.push(searchInDirectory(fullPath, regex, results, maxResults, limiter));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!binaryExts.has(ext)) {
          // Search files in parallel, controlled by limiter
          tasks.push(limiter.run(() => searchInFile(fullPath, regex, results, maxResults)));
        }
      }
    }
    
    await Promise.all(tasks);
  } catch (e) {
    // Skip directories we can't read
  }
}

async function searchInFile(filePath, regex, results, maxResults) {
  try {
    // Open file first to avoid race condition between stat and read
    const fileHandle = await fs.promises.open(filePath, 'r');
    try {
      const stats = await fileHandle.stat();
      if (stats.size > 1024 * 1024) return; // Skip files > 1MB

      const content = await fileHandle.readFile('utf-8');
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
    } finally {
      await fileHandle.close();
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

async function runBenchmark() {
  const targetDir = process.argv[2] || process.cwd();
  console.log('🔍 Rifler Search Benchmark');
  console.log(`📂 Target: ${targetDir}`);
  console.log('🚀 Mode: Parallel Execution (Async I/O)\n');

  const results = [];
  const limiter = new Limiter(100); // Concurrency limit

  for (const scenario of scenarios) {
    const searchResults = [];
    const startTime = Date.now();
    
    await searchInDirectory(targetDir, scenario.pattern, searchResults, 5000, limiter);
    
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
}

runBenchmark().catch(console.error);
