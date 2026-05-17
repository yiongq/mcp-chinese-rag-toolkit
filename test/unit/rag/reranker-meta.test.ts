import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeRerankerMeta } from '../../../src/rag/reranker-meta.js';
import { openIndex } from '../../../src/rag/sqlite-store.js';
import type { IndexHandle, Reranker } from '../../../src/rag/types.js';

function makeReranker(modelId: string): Reranker {
  return {
    modelId,
    async rank() {
      return [];
    },
  };
}

describe('writeRerankerMeta', () => {
  let handle: IndexHandle;

  beforeEach(() => {
    handle = openIndex(':memory:');
  });

  afterEach(() => {
    handle.close();
  });

  function readRerankerModel(): string | undefined {
    const row = handle.db
      .prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?')
      .get('reranker_model');
    return row?.value;
  }

  it('writes the reranker modelId into meta.reranker_model on first call', () => {
    // Story 2.2 buildSchema places an '' placeholder via the META_KEYS append
    // landed in this story; confirm the placeholder semantics first.
    expect(readRerankerModel()).toBe('');
    writeRerankerMeta(handle.db, makeReranker('onnx-community/bge-reranker-v2-m3-ONNX'));
    expect(readRerankerModel()).toBe('onnx-community/bge-reranker-v2-m3-ONNX');
  });

  it('is idempotent when called twice with the same reranker', () => {
    const reranker = makeReranker('onnx-community/bge-reranker-v2-m3-ONNX');
    writeRerankerMeta(handle.db, reranker);
    expect(() => writeRerankerMeta(handle.db, reranker)).not.toThrow();
    expect(readRerankerModel()).toBe('onnx-community/bge-reranker-v2-m3-ONNX');
  });

  it('overwrites the empty-string placeholder without firing the mismatch guard', () => {
    expect(readRerankerModel()).toBe('');
    expect(() =>
      writeRerankerMeta(handle.db, makeReranker('cross-encoder/ms-marco-MiniLM-L-12-v2')),
    ).not.toThrow();
    expect(readRerankerModel()).toBe('cross-encoder/ms-marco-MiniLM-L-12-v2');
  });

  it('throws when asked to overwrite a previously-written distinct modelId', () => {
    writeRerankerMeta(handle.db, makeReranker('onnx-community/bge-reranker-v2-m3-ONNX'));
    expect(() =>
      writeRerankerMeta(handle.db, makeReranker('cross-encoder/ms-marco-MiniLM-L-12-v2')),
    ).toThrow(
      /writeRerankerMeta: meta\.reranker_model is already 'onnx-community\/bge-reranker-v2-m3-ONNX'/,
    );
    // Both modelIds must appear so the operator can decide whether to roll
    // back, rebuild the eval baseline, or accept the swap.
    expect(() =>
      writeRerankerMeta(handle.db, makeReranker('cross-encoder/ms-marco-MiniLM-L-12-v2')),
    ).toThrow(/refusing to overwrite with 'cross-encoder\/ms-marco-MiniLM-L-12-v2'/);
    expect(readRerankerModel()).toBe('onnx-community/bge-reranker-v2-m3-ONNX');
  });

  it('rejects empty / whitespace-only modelId fail-fast', () => {
    expect(() => writeRerankerMeta(handle.db, makeReranker(''))).toThrow(
      /writeRerankerMeta: reranker\.modelId must be a non-empty string/,
    );
    expect(() => writeRerankerMeta(handle.db, makeReranker('   '))).toThrow(
      /writeRerankerMeta: reranker\.modelId must be a non-empty string/,
    );
    expect(readRerankerModel()).toBe('');
  });

  it('throws a guidance message when the db lacks the Story 2.2 meta table', () => {
    const rawDb = new Database(':memory:');
    try {
      expect(() =>
        writeRerankerMeta(rawDb, makeReranker('onnx-community/bge-reranker-v2-m3-ONNX')),
      ).toThrow(/writeRerankerMeta: meta table is missing/);
    } finally {
      rawDb.close();
    }
  });
});
