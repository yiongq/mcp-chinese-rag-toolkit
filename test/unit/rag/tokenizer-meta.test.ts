import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openIndex } from '../../../src/rag/sqlite-store.js';
import { JIEBA_VERSION, writeTokenizerMeta } from '../../../src/rag/tokenizer-meta.js';
import type { IndexHandle } from '../../../src/rag/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '../../..');

describe('JIEBA_VERSION constant', () => {
  it('matches the @node-rs/jieba dep pinned in package.json (cross-check, not tautology)', () => {
    const pkg = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const range = pkg.dependencies['@node-rs/jieba'];
    if (!range) throw new Error('package.json missing @node-rs/jieba dependency');
    const pinned = range.replace(/^[\^~]/, '');
    expect(JIEBA_VERSION).toBe(`@node-rs/jieba@${pinned}`);
  });
});

describe('writeTokenizerMeta', () => {
  let handle: IndexHandle;

  beforeEach(() => {
    handle = openIndex(':memory:');
  });

  afterEach(() => {
    handle.close();
  });

  function readTokenizerVersion(): string | undefined {
    const row = handle.db
      .prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?')
      .get('tokenizer_version');
    return row?.value;
  }

  it('writes JIEBA_VERSION into meta.tokenizer_version on first call', () => {
    expect(readTokenizerVersion()).toBe(''); // Story 2.2 placeholder
    writeTokenizerMeta(handle.db);
    expect(readTokenizerVersion()).toBe(JIEBA_VERSION);
  });

  it('overwrites the empty-string placeholder without throwing (placeholder = "not yet written")', () => {
    // Placeholder is written by buildSchema as ''; the mismatch guard must
    // not treat it as a stale legacy value.
    expect(readTokenizerVersion()).toBe('');
    expect(() => writeTokenizerMeta(handle.db, '@node-rs/jieba@2.0.1')).not.toThrow();
    expect(readTokenizerVersion()).toBe('@node-rs/jieba@2.0.1');
  });

  it('is idempotent when called twice with the same version', () => {
    writeTokenizerMeta(handle.db);
    expect(() => writeTokenizerMeta(handle.db)).not.toThrow();
    expect(readTokenizerVersion()).toBe(JIEBA_VERSION);
  });

  it('throws when asked to overwrite a previously-written distinct version', () => {
    writeTokenizerMeta(handle.db, '@node-rs/jieba@2.0.1');
    expect(() => writeTokenizerMeta(handle.db, '@node-rs/jieba@1.10.4')).toThrow(
      /writeTokenizerMeta: meta\.tokenizer_version is already '@node-rs\/jieba@2\.0\.1'/,
    );
    // The mismatch error message must surface both versions so the operator
    // can decide whether to rebuild the index or roll back the dep upgrade.
    expect(() => writeTokenizerMeta(handle.db, '@node-rs/jieba@1.10.4')).toThrow(
      /refusing to overwrite with '@node-rs\/jieba@1\.10\.4'/,
    );
    expect(readTokenizerVersion()).toBe('@node-rs/jieba@2.0.1');
  });

  it('rejects empty / whitespace-only version arguments fail-fast', () => {
    expect(() => writeTokenizerMeta(handle.db, '')).toThrow(
      /writeTokenizerMeta: version must be a non-empty string/,
    );
    expect(() => writeTokenizerMeta(handle.db, '   ')).toThrow(
      /writeTokenizerMeta: version must be a non-empty string/,
    );
    // No write should have happened.
    expect(readTokenizerVersion()).toBe('');
  });

  it('throws a guidance message when the db lacks the Story 2.2 meta table', () => {
    const rawDb = new Database(':memory:');
    try {
      expect(() => writeTokenizerMeta(rawDb)).toThrow(/writeTokenizerMeta: meta table is missing/);
    } finally {
      rawDb.close();
    }
  });
});
