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

  it('fails fast on embedding dimension mismatch and rolls back all three tables', () => {
    const rows = makeFixtureChunks(5);
    const target = rows[2];
    if (!target) throw new Error('fixture rows[2] missing');
    target.embedding = new Float32Array(512); // wrong dim mid-batch
    expect(() => handle.indexChunks(rows)).toThrow(/Embedding dimension mismatch/);
    // All three tables must rollback in lockstep — otherwise downstream JOINs
    // on docs.id ↔ docs_fts.rowid ↔ docs_vec.doc_id would see dangling rows.
    // (FTS5 contentless-with-content does not support a plain `COUNT(*)`; we
    // count via the internal shadow `docs_fts_docsize` which tracks per-row
    // metadata for every indexed entry.)
    const docs = handle.db.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM docs').get()?.c;
    const fts = handle.db
      .prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM docs_fts_docsize')
      .get()?.c;
    const vec = handle.db.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM docs_vec').get()?.c;
    expect(docs).toBe(0);
    expect(fts).toBe(0);
    expect(vec).toBe(0);
  });

  it('rejects non-finite embeddings (NaN / Infinity) before they corrupt vec0', () => {
    const baseRow = makeFixtureChunks(1)[0];
    if (!baseRow) throw new Error('fixture missing');
    const withNaN: ChunkRow = { ...baseRow, embedding: new Float32Array(DIM) };
    withNaN.embedding[0] = Number.NaN;
    expect(() => handle.indexChunks([withNaN])).toThrow(/non-finite/);
    const withInf: ChunkRow = { ...baseRow, embedding: new Float32Array(DIM) };
    withInf.embedding[10] = Number.POSITIVE_INFINITY;
    expect(() => handle.indexChunks([withInf])).toThrow(/non-finite/);
    // vecSearch must apply the same guard for query-side embeddings.
    const badQuery = new Float32Array(DIM);
    badQuery[0] = Number.NaN;
    expect(() => handle.vecSearch(badQuery)).toThrow(/non-finite/);
  });

  it('rejects Float32Array subviews to dodge sqlite-vec 0.1.x buffer-offset bugs', () => {
    const buffer = new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * (DIM + 4));
    const view = new Float32Array(buffer, Float32Array.BYTES_PER_ELEMENT, DIM);
    const baseRow = makeFixtureChunks(1)[0];
    if (!baseRow) throw new Error('fixture missing');
    expect(() => handle.indexChunks([{ ...baseRow, embedding: view }])).toThrow(
      /own its underlying buffer/,
    );
    expect(() => handle.vecSearch(view)).toThrow(/own its underlying buffer/);
  });

  it('rejects empty chunk content (FTS5 row would be permanently unreachable)', () => {
    const row = makeFixtureChunks(1)[0];
    if (!row) throw new Error('fixture missing');
    row.chunk.content = '';
    expect(() => handle.indexChunks([row])).toThrow(/empty chunk\.content/);
  });

  it('rejects sparse arrays instead of silently reporting an inflated insert count', () => {
    const rows = makeFixtureChunks(3) as (ChunkRow | undefined)[];
    rows[1] = undefined;
    expect(() => handle.indexChunks(rows as ChunkRow[])).toThrow(/sparse arrays/);
  });

  it('short-circuits an empty batch without opening a transaction', () => {
    const stats = handle.indexChunks([]);
    expect(stats).toEqual({ inserted: 0, durationMs: 0 });
  });

  it('validates topK as a positive integer for both search primitives', () => {
    handle.indexChunks(makeFixtureChunks(3));
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => handle.ftsSearch('试用期', { topK: bad })).toThrow(/Invalid topK/);
      expect(() => handle.vecSearch(makeEmbedding(0), { topK: bad })).toThrow(/Invalid topK/);
    }
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
      const seedRows = makeFixtureChunks(3);
      writer.indexChunks(seedRows);
      writer.close();

      const reader = openIndex(filePath, { readonly: true });
      try {
        // index_version persisted across re-open.
        expect(reader.getIndexVersion()).toBe('fixture-v1');
        // Reads still work.
        expect(reader.ftsSearch('试用期').length).toBeGreaterThanOrEqual(0);
        // vecSearch must also work under readonly — sqlite-vec extension load
        // is exercised on the readonly connection.
        const probe = seedRows[0];
        if (!probe) throw new Error('seedRows[0] missing');
        const vec = reader.vecSearch(probe.embedding, { topK: 2 });
        expect(vec.length).toBeGreaterThan(0);
        // Writes rejected.
        expect(() => reader.indexChunks(makeFixtureChunks(1))).toThrow(/readonly/i);
      } finally {
        reader.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('readonly open of an empty file fails fast with a schema-incomplete message', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rag-store-empty-'));
    const filePath = join(dir, 'empty.db');
    try {
      // Touch an empty file so SQLite has something to open in readonly mode.
      const seed = openIndex(filePath); // creates schema, then we wipe meta to simulate incompleteness
      seed.db.exec('DROP TABLE meta; DROP TABLE docs;');
      seed.close();
      expect(() => openIndex(filePath, { readonly: true })).toThrow(/schema incomplete/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects reopening an existing index with a different embeddingDim', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rag-store-dim-'));
    const filePath = join(dir, 'dim.db');
    try {
      const first = openIndex(filePath, { embeddingDim: 1024 });
      first.close();
      expect(() => openIndex(filePath, { embeddingDim: 768 })).toThrow(/embeddingDim mismatch/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
