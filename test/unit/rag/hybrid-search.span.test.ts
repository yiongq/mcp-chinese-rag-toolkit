import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PipelineSpan } from '../../../src/observability/span.js';
import { createHybridSearch } from '../../../src/rag/hybrid-search.js';
import { openIndex } from '../../../src/rag/sqlite-store.js';
import type { ChunkRow, Embedder, IndexHandle } from '../../../src/rag/types.js';

const DIM = 1024;
const FIXTURE_SOURCE = 'unit-fixture.md';
const FIXTURE_SECTION = '第1章';
const FIXTURE_CONTENTS = [
  '差旅报销规定要求保留原始凭证。',
  '员工培训计划面向新入职同事。',
  '请假流程需要走 OA 系统并由直属上级审批。',
  '试用期管理覆盖入职三个月内的所有同事。',
  '法定假日与年假按公司日历执行。',
];

function makeEmbedding(seed: number, dim = DIM): Float32Array {
  const arr = new Float32Array(dim);
  for (let i = 0; i < dim; i += 1) {
    arr[i] = Math.sin(seed * 0.13 + i * 0.0007) * 0.5;
  }
  return arr;
}

function makeFixtureRows(): ChunkRow[] {
  return FIXTURE_CONTENTS.map((content, i) => ({
    chunk: { content, source: FIXTURE_SOURCE, page: i + 1, section: FIXTURE_SECTION },
    embedding: makeEmbedding(i + 1),
  }));
}

function makeStubEmbedder(seedFor: (query: string) => number): Embedder {
  return {
    modelId: 'stub-embedder',
    dim: DIM,
    async embed(text: string): Promise<Float32Array> {
      return makeEmbedding(seedFor(text));
    },
    async embedBatch(texts: string[]): Promise<Float32Array[]> {
      return texts.map((t) => makeEmbedding(seedFor(t)));
    },
  };
}

function makeThrowingEmbedder(): Embedder {
  return {
    modelId: 'boom-embedder',
    dim: DIM,
    async embed(): Promise<Float32Array> {
      throw new Error('embed boom');
    },
    async embedBatch(): Promise<Float32Array[]> {
      throw new Error('embed boom');
    },
  };
}

describe('createHybridSearch — pipeline spans', () => {
  let handle: IndexHandle;

  beforeEach(() => {
    handle = openIndex(':memory:');
    handle.indexChunks(makeFixtureRows());
  });

  afterEach(() => {
    handle.close();
  });

  it('emits one hybrid parent plus bm25/vector/rrf children, all parented to the hybrid span', async () => {
    const spans: PipelineSpan[] = [];
    const search = createHybridSearch({ handle, embedder: makeStubEmbedder(() => 4) });
    await search('试用期管理', { topK: 10, onSpan: (s) => spans.push(s) });

    const byName = (name: PipelineSpan['name']) => spans.filter((s) => s.name === name);
    expect(spans).toHaveLength(4);
    expect(byName('retrieve.hybrid')).toHaveLength(1);
    expect(byName('retrieve.bm25')).toHaveLength(1);
    expect(byName('retrieve.vector')).toHaveLength(1);
    expect(byName('retrieve.rrf')).toHaveLength(1);

    const hybrid = byName('retrieve.hybrid')[0];
    expect(hybrid).toBeDefined();
    for (const child of ['retrieve.bm25', 'retrieve.vector', 'retrieve.rrf'] as const) {
      expect(byName(child)[0]?.parentId).toBe(hybrid?.id);
    }
    // The hybrid span is the root by default (no enclosing parentSpanId).
    expect(hybrid?.parentId).toBeUndefined();
  });

  it('emits a retrieve.graph child (and graphInputCount on the rrf span) only when graphRecall is wired', async () => {
    const spans: PipelineSpan[] = [];
    const search = createHybridSearch({
      handle,
      embedder: makeStubEmbedder(() => 4),
      graphRecall: () => [],
    });
    await search('试用期管理', { topK: 10, onSpan: (s) => spans.push(s) });

    const byName = (name: PipelineSpan['name']) => spans.filter((s) => s.name === name);
    expect(spans).toHaveLength(5);
    expect(byName('retrieve.graph')).toHaveLength(1);
    const hybrid = byName('retrieve.hybrid')[0];
    expect(byName('retrieve.graph')[0]?.parentId).toBe(hybrid?.id);
    expect(byName('retrieve.graph')[0]?.attributes).toMatchObject({ topK: 30, hitCount: 0 });
    expect(byName('retrieve.rrf')[0]?.attributes).toMatchObject({ graphInputCount: 0 });
  });

  it('gives every span a fresh id and a non-negative numeric durationMs', async () => {
    const spans: PipelineSpan[] = [];
    const search = createHybridSearch({ handle, embedder: makeStubEmbedder(() => 4) });
    await search('试用期', { onSpan: (s) => spans.push(s) });

    for (const s of spans) {
      expect(typeof s.durationMs).toBe('number');
      // Wall-clock upper bounds are known-flaky on shared CI — assert the floor only.
      expect(s.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof s.startedAtEpochMs).toBe('number');
      expect(s.id.length).toBeGreaterThan(0);
    }
    expect(new Set(spans.map((s) => s.id)).size).toBe(spans.length);
  });

  it('carries the expected metadata attributes per stage', async () => {
    const spans: PipelineSpan[] = [];
    const search = createHybridSearch({ handle, embedder: makeStubEmbedder(() => 4) });
    await search('试用期管理', { perSourceTopK: 8, topK: 5, onSpan: (s) => spans.push(s) });

    const attrs = (name: PipelineSpan['name']) =>
      spans.find((s) => s.name === name)?.attributes ?? {};

    expect(attrs('retrieve.bm25')).toMatchObject({ topK: 8 });
    expect(typeof attrs('retrieve.bm25').hitCount).toBe('number');

    expect(attrs('retrieve.vector')).toMatchObject({ topK: 8, embeddingDim: DIM });
    expect(typeof attrs('retrieve.vector').hitCount).toBe('number');

    expect(attrs('retrieve.rrf')).toMatchObject({ rrfK: 60, topK: 5 });
    expect(typeof attrs('retrieve.rrf').bm25InputCount).toBe('number');
    expect(typeof attrs('retrieve.rrf').vecInputCount).toBe('number');
    expect(typeof attrs('retrieve.rrf').fusedCount).toBe('number');

    expect(attrs('retrieve.hybrid')).toMatchObject({ perSourceTopK: 8, topK: 5, ok: true });
    expect(typeof attrs('retrieve.hybrid').resultCount).toBe('number');
  });

  it('threads an outer parentSpanId onto the hybrid root span', async () => {
    const spans: PipelineSpan[] = [];
    const search = createHybridSearch({ handle, embedder: makeStubEmbedder(() => 4) });
    await search('试用期', { parentSpanId: 'outer-trace-1', onSpan: (s) => spans.push(s) });

    const hybrid = spans.find((s) => s.name === 'retrieve.hybrid');
    expect(hybrid?.parentId).toBe('outer-trace-1');
    // Children still parent to the hybrid span, not the outer trace.
    expect(spans.find((s) => s.name === 'retrieve.bm25')?.parentId).toBe(hybrid?.id);
  });

  it('emits nothing and still returns hits when no consumer is wired', async () => {
    const spans: PipelineSpan[] = [];
    const search = createHybridSearch({ handle, embedder: makeStubEmbedder(() => 4) });
    const hits = await search('试用期管理', { topK: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(spans).toHaveLength(0);
  });

  it('exposes zero raw content in span attributes — no query, chunk text, source or section', async () => {
    const spans: PipelineSpan[] = [];
    const query = '差旅报销规定';
    const search = createHybridSearch({ handle, embedder: makeStubEmbedder(() => 2) });
    await search(query, { perSourceTopK: 5, topK: 5, onSpan: (s) => spans.push(s) });

    expect(spans.length).toBeGreaterThan(0);
    for (const s of spans) {
      const json = JSON.stringify(s.attributes);
      expect(json).not.toContain(query);
      expect(json).not.toContain(FIXTURE_SOURCE);
      expect(json).not.toContain(FIXTURE_SECTION);
      for (const content of FIXTURE_CONTENTS) expect(json).not.toContain(content);
      // Retrieval spans hold only numeric / boolean metadata — never any CJK text.
      expect(json).not.toMatch(/[一-鿿]/);
      for (const value of Object.values(s.attributes)) {
        expect(['string', 'number', 'boolean']).toContain(typeof value);
      }
    }
  });

  it('emits a retrieve.hybrid ok:false span and rethrows when a stage fails', async () => {
    const spans: PipelineSpan[] = [];
    const search = createHybridSearch({ handle, embedder: makeThrowingEmbedder() });
    await expect(
      search('试用期管理', { topK: 5, onSpan: (s) => spans.push(s) }),
    ).rejects.toThrow('embed boom');

    const hybrid = spans.find((s) => s.name === 'retrieve.hybrid');
    expect(hybrid?.attributes).toMatchObject({ ok: false, resultCount: 0 });
    // The bm25 child emitted before the failure is still parented to the hybrid
    // span that now (on the error path) actually arrives — no orphaned child.
    const bm25 = spans.find((s) => s.name === 'retrieve.bm25');
    expect(bm25?.parentId).toBe(hybrid?.id);
  });

  it('a throwing consumer never disturbs the search result', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const search = createHybridSearch({ handle, embedder: makeStubEmbedder(() => 4) });
      const hits = await search('试用期管理', {
        topK: 5,
        onSpan: () => {
          throw new Error('sink boom');
        },
      });
      expect(hits.length).toBeGreaterThan(0);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
