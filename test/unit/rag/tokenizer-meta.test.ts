import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openIndex } from '../../../src/rag/sqlite-store.js';
import { JIEBA_VERSION, writeTokenizerMeta } from '../../../src/rag/tokenizer-meta.js';
import type { IndexHandle } from '../../../src/rag/types.js';

describe('JIEBA_VERSION constant', () => {
  it('matches the @node-rs/jieba dep pinned in package.json (2.0.1)', () => {
    expect(JIEBA_VERSION).toBe('@node-rs/jieba@2.0.1');
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
});
