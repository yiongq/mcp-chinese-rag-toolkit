import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHybridSearch } from '../../../src/rag/hybrid-search.js';
import { openIndex } from '../../../src/rag/sqlite-store.js';
import type { ChunkRow, Embedder, IndexHandle } from '../../../src/rag/types.js';

const DIM = 1024;

function makeEmbedding(seed: number, dim = DIM): Float32Array {
  const arr = new Float32Array(dim);
  for (let i = 0; i < dim; i += 1) {
    arr[i] = Math.sin(seed * 0.13 + i * 0.0007) * 0.5;
  }
  return arr;
}

function makeFixtureRows(): ChunkRow[] {
  // Designed for stub-controlled FTS / vec routing:
  // - id=1 owns the unique keyword '差旅报销规定' (BM25-only recovery test)
  // - id=2 owns '员工培训计划' (used as vec-only recall target via stub)
  // - the remaining chunks share generic HR vocabulary so BM25 cannot single
  //   them out for an arbitrary unrelated query.
  const samples = [
    '差旅报销规定要求保留原始凭证。',
    '员工培训计划面向新入职同事。',
    '请假流程需要走 OA 系统并由直属上级审批。',
    '试用期管理覆盖入职三个月内的所有同事。',
    '法定假日与年假按公司日历执行。',
  ];
  return samples.map((content, i) => ({
    chunk: { content, source: 'unit-fixture.md', page: i + 1, section: '第1章' },
    embedding: makeEmbedding(i + 1),
  }));
}

function makeStubEmbedder(seedFor: (query: string) => number): Embedder {
  const calls: string[] = [];
  const embedder: Embedder = {
    modelId: 'stub-embedder',
    dim: DIM,
    async embed(text: string): Promise<Float32Array> {
      calls.push(text);
      return makeEmbedding(seedFor(text));
    },
    async embedBatch(texts: string[]): Promise<Float32Array[]> {
      return texts.map((t) => makeEmbedding(seedFor(t)));
    },
  };
  Object.defineProperty(embedder, '__calls', { value: calls, enumerable: false });
  return embedder;
}

describe('createHybridSearch (unit, stub embedder + real sqlite)', () => {
  let handle: IndexHandle;

  beforeEach(() => {
    handle = openIndex(':memory:');
    handle.indexChunks(makeFixtureRows());
  });

  afterEach(() => {
    handle.close();
  });

  it('factory itself performs no I/O — no embed / ftsSearch / vecSearch calls before invocation', () => {
    const embedder = makeStubEmbedder(() => 1);
    const embedSpy = vi.spyOn(embedder, 'embed');
    const ftsSpy = vi.spyOn(handle, 'ftsSearch');
    const vecSpy = vi.spyOn(handle, 'vecSearch');

    createHybridSearch({ handle, embedder });

    expect(embedSpy).not.toHaveBeenCalled();
    expect(ftsSpy).not.toHaveBeenCalled();
    expect(vecSpy).not.toHaveBeenCalled();
  });

  it('happy path: returns ≤ topK hits sorted by rrfScore descending with the self-hit on top', async () => {
    // Stub embed returns id=4's exact embedding → vec self-hits id=4 (rank=1, distance≈0)
    const embedder = makeStubEmbedder(() => 4);
    const search = createHybridSearch({ handle, embedder });
    const hits = await search('试用期管理', { topK: 10 });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(10);
    // Descending sort invariant.
    for (let i = 1; i < hits.length; i += 1) {
      const prev = hits[i - 1];
      const curr = hits[i];
      if (!prev || !curr) throw new Error('hits array unexpectedly sparse');
      expect(prev.rrfScore).toBeGreaterThanOrEqual(curr.rrfScore);
    }
    const selfHit = hits.find((h) => h.docId === 4);
    expect(selfHit).toBeDefined();
    expect(selfHit?.vecRank).toBe(1);
    expect(selfHit?.distance).toBeLessThan(0.01);
    expect(selfHit?.chunk.content).toBe('试用期管理覆盖入职三个月内的所有同事。');
  });

  it('BM25-only recovery: keyword chunk surfaces with bm25Rank set + vecRank undefined + score = 1/(60+1)', async () => {
    // perSourceTopK=1 ensures vec only returns the closest chunk to the stub
    // embedding (id=2), so id=1's BM25 hit must survive on its own.
    const embedder = makeStubEmbedder(() => 2);
    const search = createHybridSearch({ handle, embedder });
    const hits = await search('差旅报销规定', { perSourceTopK: 1, topK: 5 });

    const bm25OnlyHit = hits.find((h) => h.docId === 1);
    expect(bm25OnlyHit).toBeDefined();
    expect(bm25OnlyHit?.bm25Rank).toBe(1);
    expect(bm25OnlyHit?.vecRank).toBeUndefined();
    expect(bm25OnlyHit?.distance).toBeUndefined();
    expect(bm25OnlyHit?.bm25Score).toBeDefined();
    expect(Math.abs((bm25OnlyHit?.rrfScore ?? 0) - 1 / 61)).toBeLessThan(1e-12);
  });

  it('vec-only recovery: chunk only the vector index hit surfaces with vecRank set + bm25Rank undefined + score = 1/(60+1)', async () => {
    // Query is jieba-tokenizable but every token is absent from the fixtures
    // (no chunk contains '蓝鲸' / '深空' / '探测'), so BM25 returns 0 hits.
    const embedder = makeStubEmbedder(() => 2);
    const search = createHybridSearch({ handle, embedder });
    const hits = await search('蓝鲸深空探测', { perSourceTopK: 1, topK: 5 });

    expect(hits.length).toBeGreaterThan(0);
    const vecOnlyHit = hits.find((h) => h.docId === 2);
    expect(vecOnlyHit).toBeDefined();
    expect(vecOnlyHit?.vecRank).toBe(1);
    expect(vecOnlyHit?.bm25Rank).toBeUndefined();
    expect(vecOnlyHit?.bm25Score).toBeUndefined();
    expect(vecOnlyHit?.distance).toBeDefined();
    expect(Math.abs((vecOnlyHit?.rrfScore ?? 0) - 1 / 61)).toBeLessThan(1e-12);
  });

  it('honours per-call topK / perSourceTopK by forwarding them to the storage primitives', async () => {
    const embedder = makeStubEmbedder(() => 4);
    const ftsSpy = vi.spyOn(handle, 'ftsSearch');
    const vecSpy = vi.spyOn(handle, 'vecSearch');
    const search = createHybridSearch({ handle, embedder });
    const hits = await search('试用期', { perSourceTopK: 5, topK: 3 });

    expect(hits.length).toBeLessThanOrEqual(3);
    expect(ftsSpy).toHaveBeenCalledWith('试用期', { topK: 5 });
    expect(vecSpy).toHaveBeenCalledTimes(1);
    expect(vecSpy.mock.calls[0]?.[1]).toEqual({ topK: 5 });
  });

  it('applies defaultOpts when per-call opts do not override (and per-call opts win otherwise)', async () => {
    const embedder = makeStubEmbedder(() => 4);
    const ftsSpy = vi.spyOn(handle, 'ftsSearch');
    const search = createHybridSearch({
      handle,
      embedder,
      defaultOpts: { perSourceTopK: 7, topK: 4 },
    });

    await search('试用期');
    expect(ftsSpy).toHaveBeenLastCalledWith('试用期', { topK: 7 });

    await search('试用期', { perSourceTopK: 2 });
    expect(ftsSpy).toHaveBeenLastCalledWith('试用期', { topK: 2 });
  });

  it('rejects empty / whitespace queries and out-of-range opts fail-fast', async () => {
    const embedder = makeStubEmbedder(() => 4);
    const search = createHybridSearch({ handle, embedder });

    await expect(search('')).rejects.toThrow(/hybridSearch: query must be a non-empty string/);
    await expect(search('   ')).rejects.toThrow(/hybridSearch: query must be a non-empty string/);

    await expect(search('q', { topK: 0 })).rejects.toThrow(
      /hybridSearch: topK must be an integer in \[1, 1000\]/,
    );
    await expect(search('q', { topK: -1 })).rejects.toThrow(/hybridSearch: topK/);
    await expect(search('q', { topK: 1.5 })).rejects.toThrow(/hybridSearch: topK/);

    await expect(search('q', { perSourceTopK: 1001 })).rejects.toThrow(
      /hybridSearch: perSourceTopK must be an integer in \[1, 1000\]/,
    );
    await expect(search('q', { rrfK: 0 })).rejects.toThrow(/hybridSearch: rrfK/);
    await expect(search('q', { rrfK: 1001 })).rejects.toThrow(/hybridSearch: rrfK/);
  });

  it('propagates embedder errors without swallowing them', async () => {
    const embedder = makeStubEmbedder(() => 1);
    vi.spyOn(embedder, 'embed').mockRejectedValueOnce(new Error('embed-boom'));
    const search = createHybridSearch({ handle, embedder });

    await expect(search('差旅报销')).rejects.toThrow(/embed-boom/);
  });

  it('propagates handle.ftsSearch errors (Promise.all reject contract)', async () => {
    const embedder = makeStubEmbedder(() => 1);
    vi.spyOn(handle, 'ftsSearch').mockImplementationOnce(() => {
      throw new Error('fts-boom');
    });
    const search = createHybridSearch({ handle, embedder });

    await expect(search('差旅报销')).rejects.toThrow(/fts-boom/);
  });

  it('is a pure function w.r.t. (handle state, query, opts) — two identical calls return deep-equal results', async () => {
    const embedder = makeStubEmbedder(() => 4);
    const search = createHybridSearch({ handle, embedder });

    const first = await search('试用期管理', { topK: 5 });
    const second = await search('试用期管理', { topK: 5 });

    expect(second).toEqual(first);
  });

  it('runs FTS and vec embed in parallel (sanity, not benchmark)', async () => {
    const embedder = makeStubEmbedder(() => 4);
    vi.spyOn(embedder, 'embed').mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return makeEmbedding(4);
    });
    const search = createHybridSearch({ handle, embedder });

    const start = performance.now();
    await search('试用期', { topK: 3 });
    const elapsed = performance.now() - start;

    // FTS path is synchronous (~0ms), vec path is ~50ms; serial wiring would
    // not change the wall-clock here, but the assertion is a smoke test that
    // hybrid does not introduce extra serial work beyond the embed call.
    // Threshold padded for runner jitter (CI macOS / Linux variance).
    expect(elapsed).toBeLessThan(120);
  });
});
