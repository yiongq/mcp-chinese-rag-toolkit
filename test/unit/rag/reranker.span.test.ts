import { describe, expect, it } from 'vitest';

import type { PipelineSpan } from '../../../src/observability/span.js';
import { createReranker } from '../../../src/rag/reranker.js';
import type { HybridHit, Reranker } from '../../../src/rag/types.js';

function makeStubReranker(): Reranker {
  return {
    modelId: 'stub-reranker',
    async rank(_query: string, documents: string[]) {
      // Deterministic descending scores by input position.
      return documents.map((_, i) => ({ index: i, score: (documents.length - i) / documents.length }));
    },
  };
}

function makeThrowingReranker(): Reranker {
  return {
    modelId: 'boom-reranker',
    async rank(_query: string, _documents: string[]) {
      throw new Error('rank boom');
    },
  };
}

function makeCandidates(n: number): HybridHit[] {
  return Array.from({ length: n }, (_, i) => ({
    docId: i + 1,
    chunk: { content: `候选文本 ${i + 1}`, source: 'rerank-fixture.md', page: i + 1, section: '第2章' },
    rrfScore: 1 / (60 + i + 1),
  }));
}

describe('createReranker — pipeline spans', () => {
  it('emits one retrieve.rerank span with candidate / returned counts', async () => {
    const spans: PipelineSpan[] = [];
    const rerank = createReranker({ reranker: makeStubReranker() });
    const out = await rerank('查询词', makeCandidates(4), { topK: 2, onSpan: (s) => spans.push(s) });

    expect(out).toHaveLength(2);
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span?.name).toBe('retrieve.rerank');
    expect(span?.attributes).toMatchObject({
      candidateCount: 4,
      topK: 2,
      returnedCount: 2,
      ok: true,
    });
    expect(span?.durationMs).toBeGreaterThanOrEqual(0);
    expect(span?.parentId).toBeUndefined();
  });

  it('emits a zero-candidate span on the empty early-return path', async () => {
    const spans: PipelineSpan[] = [];
    const rerank = createReranker({ reranker: makeStubReranker() });
    const out = await rerank('查询词', [], { onSpan: (s) => spans.push(s) });

    expect(out).toEqual([]);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.attributes).toMatchObject({ candidateCount: 0, returnedCount: 0, ok: true });
  });

  it('threads parentSpanId, and stays silent when no consumer is wired', async () => {
    const spans: PipelineSpan[] = [];
    const rerank = createReranker({ reranker: makeStubReranker() });
    await rerank('查询词', makeCandidates(3), { parentSpanId: 'trace-x', onSpan: (s) => spans.push(s) });
    expect(spans[0]?.parentId).toBe('trace-x');

    const out = await rerank('查询词', makeCandidates(3), {});
    expect(out).toHaveLength(3);
    // The un-instrumented call added no spans to the collector above.
    expect(spans).toHaveLength(1);
  });

  it('emits a retrieve.rerank ok:false span and rethrows when ranking fails', async () => {
    const spans: PipelineSpan[] = [];
    const rerank = createReranker({ reranker: makeThrowingReranker() });
    await expect(
      rerank('查询词', makeCandidates(3), { topK: 2, onSpan: (s) => spans.push(s) }),
    ).rejects.toThrow('rank boom');

    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe('retrieve.rerank');
    expect(spans[0]?.attributes).toMatchObject({
      candidateCount: 3,
      topK: 2,
      returnedCount: 0,
      ok: false,
    });
  });

  it('renders an unbounded (Infinity) topK export-safe in the span', async () => {
    const spans: PipelineSpan[] = [];
    const rerank = createReranker({ reranker: makeStubReranker() });
    await rerank('查询词', makeCandidates(3), {
      topK: Number.POSITIVE_INFINITY,
      onSpan: (s) => spans.push(s),
    });
    // Infinity would JSON-serialize to null; makeSpan renders it as a string.
    expect(spans[0]?.attributes.topK).toBe('Infinity');
    expect(JSON.parse(JSON.stringify(spans[0]?.attributes)).topK).toBe('Infinity');
  });

  it('exposes no CJK content in span attributes (zero PII)', async () => {
    const spans: PipelineSpan[] = [];
    const rerank = createReranker({ reranker: makeStubReranker() });
    await rerank('机密查询词', makeCandidates(3), { onSpan: (s) => spans.push(s) });

    for (const s of spans) {
      expect(JSON.stringify(s.attributes)).not.toMatch(/[一-鿿]/);
      for (const value of Object.values(s.attributes)) {
        expect(['string', 'number', 'boolean']).toContain(typeof value);
      }
    }
  });
});
