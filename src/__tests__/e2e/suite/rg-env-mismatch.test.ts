import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { performSearch } from '../../../search';

suite('Ripgrep Environment Mismatch', () => {
  const originalRgPath = process.env.RIFLER_RG_PATH;
  let badRgPath: string | undefined;

  setup(async () => {
    // Create a file that is executable but not a valid binary/script (no shebang).
    // Executing it typically yields ENOEXEC, simulating a wrong-format bundled rg.
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rifler-bad-rg-'));
    badRgPath = path.join(dir, 'rg');
    await fs.promises.writeFile(badRgPath, 'this is not a valid executable\n', { encoding: 'utf8' });
    await fs.promises.chmod(badRgPath, 0o755);

    process.env.RIFLER_RG_PATH = badRgPath;

    // Ensure extension is active so any shared state is initialized.
    const extension = vscode.extensions.getExtension('Ori-Roza.rifler');
    if (extension && !extension.isActive) {
      await extension.activate();
    }
  });

  teardown(async () => {
    if (originalRgPath === undefined) {
      delete process.env.RIFLER_RG_PATH;
    } else {
      process.env.RIFLER_RG_PATH = originalRgPath;
    }

    if (badRgPath) {
      try {
        await fs.promises.rm(path.dirname(badRgPath), { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  test('falls back to VS Code native rg when override is ENOEXEC', async () => {
    const options = {
      matchCase: false,
      wholeWord: false,
      useRegex: false,
      fileMask: ''
    };

    const results = await performSearch('updated', 'project', options, undefined, undefined, 200);

    // The fixture workspace contains this token in test.js, so search should succeed.
    assert.ok(results.length > 0, 'Expected results via fallback from bad rg override');
  });
});
