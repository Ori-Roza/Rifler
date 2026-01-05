#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
const query = process.argv[3] || 'test';
const runs = Number(process.argv[4] || 5);
const maxMatches = Number(process.env.RG_MAX_MATCHES || 20000);
const extraArgs = (process.env.RG_ARGS || '').split(' ').filter(Boolean);
// Allow overriding the rg binary to compare against native VS Code rg
const rgBin = process.env.RG_BIN || 'rg';

if (!root) {
  console.error('Usage: node ripgrep-benchmark.js <directory> [query="test"] [runs=5]');
  process.exit(1);
}

if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error(`Path does not exist or is not a directory: ${root}`);
  process.exit(1);
}

console.log(`rg binary: ${rgBin}`);
console.log(`root: ${root}`);
console.log(`query: ${query}`);
console.log(`runs: ${runs}`);
console.log(`maxMatches: ${maxMatches}`);
if (extraArgs.length) {
  console.log(`extra rg args: ${extraArgs.join(' ')}`);
}

async function runOnce() {
  return new Promise((resolve, reject) => {
    const args = ['--json', '-m', String(maxMatches), query, root, ...extraArgs];
    const start = process.hrtime.bigint();
    let matches = 0;
    let stderr = '';

    const rg = spawn(rgBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    rg.stdout.on('data', chunk => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.type === 'match' && parsed.data && parsed.data.submatches) {
            matches += parsed.data.submatches.length;
          }
        } catch {
          // Ignore non-JSON lines (should not happen with --json)
        }
      }
    });

    rg.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    rg.on('error', reject);

    rg.on('close', code => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      if (code !== 0 && code !== 1) {
        return reject(new Error(`rg exited with code ${code}: ${stderr.trim()}`));
      }
      resolve({ durationMs, matches, stderr: stderr.trim() });
    });
  });
}

(async () => {
  const durations = [];
  let totalMatches = 0;

  for (let i = 0; i < runs; i++) {
    try {
      const { durationMs, matches } = await runOnce();
      durations.push(durationMs);
      totalMatches = Math.max(totalMatches, matches);
      console.log(`run ${i + 1}: ${durationMs.toFixed(2)} ms, matches: ${matches}`);
    } catch (err) {
      console.error(`run ${i + 1} failed:`, err.message || err);
      process.exit(1);
    }
  }

  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  const min = Math.min(...durations);
  const max = Math.max(...durations);

  console.log('\nSummary');
  console.log('-------');
  console.log(`runs: ${runs}`);
  console.log(`avg: ${avg.toFixed(2)} ms`);
  console.log(`min: ${min.toFixed(2)} ms`);
  console.log(`max: ${max.toFixed(2)} ms`);
  console.log(`max matches in a run: ${totalMatches}`);
})();
