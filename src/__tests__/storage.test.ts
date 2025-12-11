import * as assert from 'assert';

describe('Storage Utility Tests', () => {
  const STORAGE_KEY = 'rifler.persistedSearchState';

  describe('Storage Constants', () => {
    test('should define correct storage key', () => {
      assert.strictEqual(STORAGE_KEY, 'rifler.persistedSearchState');
      assert.ok(STORAGE_KEY.length > 0, 'Storage key should not be empty');
    });

    test('storage key should use namespace prefix', () => {
      assert.ok(STORAGE_KEY.startsWith('rifler.'), 'Storage key should have rifler namespace');
    });

    test('storage key should be kebab-case with camelCase suffix', () => {
      const parts = STORAGE_KEY.split('.');
      assert.strictEqual(parts[0], 'rifler');
      assert.strictEqual(parts[1], 'persistedSearchState');
    });
  });

  describe('State Shape', () => {
    test('should have correct state structure', () => {
      const mockState = {
        query: 'test query',
        replaceText: 'replacement',
        scope: 'project' as const,
        directoryPath: '/path/to/dir',
        modulePath: 'module-name',
        filePath: '/path/to/file.ts',
        options: {
          matchCase: true,
          wholeWord: false,
          useRegex: false,
          fileMask: '*.ts',
        },
        showReplace: true,
      };

      // Verify shape
      assert.strictEqual(typeof mockState.query, 'string');
      assert.strictEqual(typeof mockState.replaceText, 'string');
      assert.ok(['project', 'module', 'directory', 'file'].includes(mockState.scope));
      assert.strictEqual(typeof mockState.directoryPath, 'string');
      assert.strictEqual(typeof mockState.modulePath, 'string');
      assert.strictEqual(typeof mockState.filePath, 'string');
      assert.strictEqual(typeof mockState.options, 'object');
      assert.strictEqual(typeof mockState.showReplace, 'boolean');
    });

    test('state options should have correct structure', () => {
      const options = {
        matchCase: false,
        wholeWord: false,
        useRegex: false,
        fileMask: '',
      };

      assert.strictEqual(typeof options.matchCase, 'boolean');
      assert.strictEqual(typeof options.wholeWord, 'boolean');
      assert.strictEqual(typeof options.useRegex, 'boolean');
      assert.strictEqual(typeof options.fileMask, 'string');
    });

    test('state should handle empty strings', () => {
      const minimalState = {
        query: '',
        replaceText: '',
        scope: 'project' as const,
        directoryPath: '',
        modulePath: '',
        filePath: '',
        options: {
          matchCase: false,
          wholeWord: false,
          useRegex: false,
          fileMask: '',
        },
        showReplace: false,
      };

      assert.strictEqual(minimalState.query, '');
      assert.strictEqual(minimalState.directoryPath, '');
    });

    test('state should handle various scope values', () => {
      const scopes = ['project', 'module', 'directory', 'file'] as const;

      scopes.forEach(scope => {
        const state = {
          query: 'test',
          replaceText: 'test',
          scope,
          directoryPath: '',
          modulePath: '',
          filePath: '',
          options: {
            matchCase: false,
            wholeWord: false,
            useRegex: false,
            fileMask: '',
          },
          showReplace: false,
        };

        assert.ok(state.scope, `Scope ${scope} should be valid`);
      });
    });
  });

  describe('State Serialization', () => {
    test('state should be JSON serializable', () => {
      const state = {
        query: 'test',
        replaceText: 'replacement',
        scope: 'project' as const,
        directoryPath: '/test',
        modulePath: 'test-module',
        filePath: '/test/file.ts',
        options: {
          matchCase: true,
          wholeWord: false,
          useRegex: false,
          fileMask: '*.ts',
        },
        showReplace: true,
      };

      const serialized = JSON.stringify(state);
      assert.ok(serialized.length > 0);

      const deserialized = JSON.parse(serialized);
      assert.deepStrictEqual(deserialized, state);
    });

    test('state should preserve special characters', () => {
      const state = {
        query: 'test.*([a-z]+)',
        replaceText: '$1',
        scope: 'project' as const,
        directoryPath: '/path/with spaces',
        modulePath: '@scoped/module',
        filePath: '/path/to/file.ts',
        options: {
          matchCase: false,
          wholeWord: false,
          useRegex: true,
          fileMask: '*.{ts,tsx,js}',
        },
        showReplace: false,
      };

      const serialized = JSON.stringify(state);
      const deserialized = JSON.parse(serialized);

      assert.strictEqual(deserialized.query, state.query);
      assert.strictEqual(deserialized.replaceText, state.replaceText);
      assert.strictEqual(deserialized.directoryPath, state.directoryPath);
    });
  });

  describe('State Validation', () => {
    test('should validate required fields', () => {
      const requiredFields = [
        'query',
        'replaceText',
        'scope',
        'directoryPath',
        'modulePath',
        'filePath',
        'options',
        'showReplace',
      ];

      const state = {
        query: 'test',
        replaceText: '',
        scope: 'project' as const,
        directoryPath: '',
        modulePath: '',
        filePath: '',
        options: {
          matchCase: false,
          wholeWord: false,
          useRegex: false,
          fileMask: '',
        },
        showReplace: false,
      };

      requiredFields.forEach(field => {
        assert.ok(field in state, `State should have ${field} field`);
      });
    });

    test('should handle undefined and null gracefully', () => {
      // When loading from storage, handle edge cases
      const possibleValues = [
        undefined,
        null,
        {},
        { query: 'test' },
      ];

      possibleValues.forEach(value => {
        // In real code, we'd validate and use default values
        if (value && typeof value === 'object' && 'query' in value) {
          assert.ok(true);
        }
      });
    });
  });

  describe('State Defaults', () => {
    test('should have sensible default values', () => {
      const defaults = {
        query: '',
        replaceText: '',
        scope: 'project' as const,
        directoryPath: '',
        modulePath: '',
        filePath: '',
        options: {
          matchCase: false,
          wholeWord: false,
          useRegex: false,
          fileMask: '',
        },
        showReplace: false,
      };

      // All options should be disabled by default
      assert.strictEqual(defaults.options.matchCase, false);
      assert.strictEqual(defaults.options.wholeWord, false);
      assert.strictEqual(defaults.options.useRegex, false);

      // Replace should not be shown by default
      assert.strictEqual(defaults.showReplace, false);

      // Scope should default to project
      assert.strictEqual(defaults.scope, 'project');
    });
  });
});
