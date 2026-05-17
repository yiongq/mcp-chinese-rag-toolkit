import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openIndex } from '../../../src/rag/sqlite-store.js';
import type { ChunkRow, IndexHandle } from '../../../src/rag/types.js';
import { openIndex as openIndexFromBarrel } from '../../../src/rag/vector-store.js';

const DIM = 1024;

function makeEmbedding(seed: number, dim = DIM): Float32Array {
  const arr = new Float32Array(dim);
  for (let i = 0; i < dim; i += 1) {
    arr[i] = Math.sin(seed * 0.13 + i * 0.0007) * 0.5;
  }
  return arr;
}

function makeFixtureChunks(n: number, dim = DIM): ChunkRow[] {
  const samples = [
    '新员工试用期为三个月,期满后人事部门启动转正评估。',
    '请假申请需在系统提交并由直属上级审批通过。',
    '员工享有法定假日、年假与病假等带薪假期。',
    '试用期管理规定明确了培训目标与考核标准。',
    '差旅报销流程要求保留原始凭证并填写电子表单。',
  ];
  return Array.from({ length: n }, (_, i) => ({
    chunk: {
      content: `${samples[i % samples.length]}（条目 ${i + 1}）`,
      source: 'fixture.md',
      page: (i % 7) + 1,
      section: `第${(i % 3) + 1}章 > ${(i % 5) + 1}.${(i % 4) + 1}`,
    },
    embedding: makeEmbedding(i, dim),
  }));
}

describe('vector-store barrel', () => {
  // Future-proofing the namespace: Phase 2 may split vec backend. Verify
  // the re-export points at the same implementation symbol today.
  it('re-exports the same openIndex implementation as sqlite-store', () => {
    expect(openIndexFromBarrel).toBe(openIndex);
  });
});

describe('openIndex / IndexHandle', () => {
  let handle: IndexHandle;

  beforeEach(() => {
    handle = openIndex(':memory:');
  });

  afterEach(() => {
    handle.close();
  });

  it('indexChunks + ftsSearch + vecSearch end-to-end on an in-memory DB', () => {
    const rows = makeFixtureChunks(10);
    const stats = handle.indexChunks(rows);
    expect(stats.inserted).toBe(10);
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);

    const fts = handle.ftsSearch('试用期');
    expect(fts.length).toBeGreaterThan(0);
    expect(fts[0]?.bm25Rank).toBe(1);

    const firstRow = rows[0];
    if (!firstRow) throw new Error('fixture rows[0] missing');
    const vec = handle.vecSearch(firstRow.embedding);
    expect(vec.length).toBeGreaterThan(0);
    expect(vec[0]?.distance).toBeLessThan(0.01); // self-hit ≈ 0
  });

  it('fails fast on embedding dimension mismatch and rolls back the transaction', () => {
    const rows = makeFixtureChunks(5);
    const target = rows[2];
    if (!target) throw new Error('fixture rows[2] missing');
    target.embedding = new Float32Array(512); // wrong dim mid-batch
    expect(() => handle.indexChunks(rows)).toThrow(/Embedding dimension mismatch/);
    const count = handle.db.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM docs').get()?.c;
    expect(count).toBe(0); // rollback: nothing inserted
  });

  it('appends across two indexChunks calls with auto-incrementing doc ids', () => {
    handle.indexChunks(makeFixtureChunks(5));
    handle.indexChunks(makeFixtureChunks(3));
    const total = handle.db.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM docs').get()?.c;
    expect(total).toBe(8);
    const ids = handle.db
      .prepare<[], { id: number }>('SELECT id FROM docs ORDER BY id')
      .all()
      .map((r) => r.id);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('ftsSearch returns 1-indexed bm25Rank with bm25Score passthrough and respects topK', () => {
    handle.indexChunks(makeFixtureChunks(20));
    const hits = handle.ftsSearch('试用期', { topK: 3 });
    expect(hits.length).toBeLessThanOrEqual(3);
    expect(hits.map((h) => h.bm25Rank)).toEqual(hits.map((_, i) => i + 1));
    // FTS5 rank is negative-floor; closer to 0 = more relevant.
    expect(typeof hits[0]?.bm25Score).toBe('number');
  });

  it('ftsSearch short-circuits on empty query and survives FTS5 operator characters', () => {
    handle.indexChunks(makeFixtureChunks(5));
    expect(handle.ftsSearch('')).toEqual([]);
    expect(() => handle.ftsSearch('请假*流程')).not.toThrow();
    expect(() => handle.ftsSearch('(试用期)')).not.toThrow();
  });

  it('vecSearch returns near-zero distance when querying with a known embedding', () => {
    const rows = makeFixtureChunks(10);
    handle.indexChunks(rows);
    const probe = rows[3];
    if (!probe) throw new Error('fixture rows[3] missing');
    const hits = handle.vecSearch(probe.embedding, { topK: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.distance).toBeLessThan(0.01);
  });

  it('vecSearch with an all-zero query returns up to topK rows and never throws', () => {
    handle.indexChunks(makeFixtureChunks(5));
    const hits = handle.vecSearch(new Float32Array(DIM), { topK: 3 });
    expect(hits.length).toBeLessThanOrEqual(3);
    // Dimension mismatch is fail-fast.
    expect(() => handle.vecSearch(new Float32Array(512))).toThrow(/Embedding dimension mismatch/);
  });

  it('getIndexVersion + readonly mode + on-disk persistence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rag-store-'));
    const filePath = join(dir, 'ix.db');
    try {
      const writer = openIndex(filePath, { indexVersion: 'fixture-v1' });
      expect(writer.getIndexVersion()).toBe('fixture-v1');
      writer.indexChunks(makeFixtureChunks(3));
      writer.close();

      const reader = openIndex(filePath, { readonly: true });
      try {
        // index_version persisted across re-open.
        expect(reader.getIndexVersion()).toBe('fixture-v1');
        // Reads still work.
        expect(reader.ftsSearch('试用期').length).toBeGreaterThanOrEqual(0);
        // Writes rejected.
        expect(() => reader.indexChunks(makeFixtureChunks(1))).toThrow(/readonly/i);
      } finally {
        reader.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
