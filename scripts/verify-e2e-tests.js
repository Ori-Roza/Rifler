const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const testsRoot = path.join(root, 'out', '__tests__', 'e2e', 'suite');

function findTests(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findTests(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.test.js')) {
      results.push(entryPath);
    }
  }

  return results;
}

if (!fs.existsSync(testsRoot)) {
  console.error(`E2E output folder not found: ${testsRoot}`);
  process.exit(1);
}

const tests = findTests(testsRoot);

if (tests.length === 0) {
  console.error(`No E2E tests found under ${testsRoot}`);
  process.exit(1);
}

console.log(`Found ${tests.length} E2E tests under ${testsRoot}`);
