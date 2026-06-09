import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import { readToolkitVersion } from '../../../src/eval/toolkit-version.js';

// Read the real version independently (not hardcoded) so this test keeps passing
// across releases: the find-up probe must agree with the package's own
// package.json. createRequire resolves the path relative to this test file.
const require = createRequire(import.meta.url);
const pkg = require('../../../package.json') as { version: string };

describe('readToolkitVersion', () => {
  it('reads the version from this package package.json by walking up', () => {
    expect(readToolkitVersion()).toBe(pkg.version);
  });

  it('returns a semver-shaped string', () => {
    expect(readToolkitVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('memoizes — repeated calls return the same value', () => {
    expect(readToolkitVersion()).toBe(readToolkitVersion());
  });
});
