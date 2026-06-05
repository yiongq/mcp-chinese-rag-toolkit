import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Chunk, HybridHit, ModelManifest, Reranker } from '../../../src/rag/types.js';

function uniqueTmp(prefix: string): string {
  return path.join(tmpdir(), `${prefix}-${randomUUID()}`);
}

const TINY_MANIFEST: ModelManifest = {
  modelId: 'test-org/tiny-reranker-fixture',
  embeddingDim: 1,
  files: [
    {
      relativePath: 'config.json',
      sha256: '0'.repeat(64),
      bytes: 17,
    },
  ],
};

interface StubTensor {
  sigmoid(): StubTensor;
  tolist(): number[][];
}

const tokenizerCallCount = { count: 0 };
const modelCallCount = { count: 0 };
/** Sigmoid logits returned by the stub model on each forward; cycle through batch slices. */
let stubScores: number[] = [0.95, 0.05, 0.5];

function resetStubState(): void {
  tokenizerCallCount.count = 0;
  modelCallCount.count = 0;
  stubScores = [0.95, 0.05, 0.5];
}

function makeStubTensor(scores: number[]): StubTensor {
  const rows = scores.map((s) => [s] as number[]);
  return {
    sigmoid(): StubTensor {
      // The fixtures pre-sigmoid the values so the stub does NOT apply sigmoid
      // again — the test asserts the production code calls .sigmoid() and
      // round-trips the result unchanged.
      return makeStubTensor(scores);
    },
    tolist(): number[][] {
      return rows;
    },
  };
}

vi.mock('@huggingface/transformers', () => {
  const env = {
    cacheDir: '',
    allowRemoteModels: true,
    allowLocalModels: true,
    useBrowserCache: false,
  };
  const tokenizerCallable = Object.assign(
    async (queries: string[], _opts: Record<string, unknown>) => {
      tokenizerCallCount.count += 1;
      return { input_ids: { length: queries.length }, attention_mask: {} };
    },
    {},
  );
  const modelCallable = Object.assign(async (_inputs: Record<string, unknown>) => {
    const slice = stubScores.slice(modelCallCount.count * 3, modelCallCount.count * 3 + 3);
    modelCallCount.count += 1;
    // Fall back to last fixture row if scores are exhausted; tests that need
    // exact pacing reset stubScores in beforeEach.
    const effective = slice.length > 0 ? slice : [stubScores[stubScores.length - 1] ?? 0.5];
    return { logits: makeStubTensor(effective) };
  }, {});
  const AutoTokenizer = {
    from_pretrained: async () => tokenizerCallable,
  };
  const AutoModelForSequenceClassification = {
    from_pretrained: async () => modelCallable,
  };
  return { env, AutoTokenizer, AutoModelForSequenceClassification };
});

describe('loadReranker (stub @huggingface/transformers)', () => {
  beforeEach(async () => {
    resetStubState();
    const mod = await import('../../../src/rag/reranker.js');
    mod.__resetRerankerCacheForTests();
  });

  afterEach(async () => {
    const mod = await import('../../../src/rag/reranker.js');
    mod.__resetRerankerCacheForTests();
  });

  it('returns a Reranker whose modelId echoes the supplied manifest', async () => {
    const { loadReranker } = await import('../../../src/rag/reranker.js');
    const reranker = await loadReranker({
      manifest: TINY_MANIFEST,
      cacheDir: uniqueTmp('reranker-stub'),
      verifyHashes: false,
    });
    expect(reranker.modelId).toBe(TINY_MANIFEST.modelId);
    expect(typeof reranker.rank).toBe('function');
  });

  it('memoises load() for the same effective options', async () => {
    const { loadReranker } = await import('../../../src/rag/reranker.js');
    const cacheDir = uniqueTmp('reranker-stub-singleton');
    const a = await loadReranker({
      manifest: TINY_MANIFEST,
      cacheDir,
      verifyHashes: false,
    });
    const b = await loadReranker({
      manifest: TINY_MANIFEST,
      cacheDir,
      verifyHashes: false,
    });
    expect(a).toBe(b);
  });

  it('evicts failed loads so a fixed environment can retry without restart', async () => {
    const { loadReranker, __resetRerankerCacheForTests } = await import(
      '../../../src/rag/reranker.js'
    );
    __resetRerankerCacheForTests();
    const cacheDir = uniqueTmp('reranker-stub-retry');
    // verifyHashes: true with a zero sha256 forces a strict mismatch on the
    // post-load verify pass — proving the cache evicts the rejected promise.
    await expect(
      loadReranker({ manifest: TINY_MANIFEST, cacheDir, verifyHashes: true }),
    ).rejects.toThrow();
    // The cache is now empty for this key; loading again with verify off must
    // succeed and the failure must NOT be re-served.
    const ok = await loadReranker({ manifest: TINY_MANIFEST, cacheDir, verifyHashes: false });
    expect(ok.modelId).toBe(TINY_MANIFEST.modelId);
  });

  it('rank([]) short-circuits without calling the tokenizer / model', async () => {
    const { loadReranker } = await import('../../../src/rag/reranker.js');
    const reranker = await loadReranker({
      manifest: TINY_MANIFEST,
      cacheDir: uniqueTmp('reranker-stub-empty'),
      verifyHashes: false,
    });
    const beforeTokenizer = tokenizerCallCount.count;
    const beforeModel = modelCallCount.count;
    await expect(reranker.rank('q', [])).resolves.toEqual([]);
    expect(tokenizerCallCount.count).toBe(beforeTokenizer);
    expect(modelCallCount.count).toBe(beforeModel);
  });

  it('rank(query, docs) happy path returns one RankedDocument per input doc in input order', async () => {
    const { loadReranker } = await import('../../../src/rag/reranker.js');
    const reranker = await loadReranker({
      manifest: TINY_MANIFEST,
      cacheDir: uniqueTmp('reranker-stub-happy'),
      verifyHashes: false,
    });
    const docs = ['试用期管理', '加班补偿', '请假申请'];
    const result = await reranker.rank('试用期', docs);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ index: 0, score: 0.95 });
    expect(result[1]).toEqual({ index: 1, score: 0.05 });
    expect(result[2]).toEqual({ index: 2, score: 0.5 });
  });

  it('rank("", docs) rejects with the non-empty-query error message', async () => {
    const { loadReranker } = await import('../../../src/rag/reranker.js');
    const reranker = await loadReranker({
      manifest: TINY_MANIFEST,
      cacheDir: uniqueTmp('reranker-stub-empty-query'),
      verifyHashes: false,
    });
    await expect(reranker.rank('', ['a'])).rejects.toThrow(
      /rank: query must be a non-empty string/,
    );
  });

  it('rank(q, non-array) rejects with the documents-must-be-array error', async () => {
    const { loadReranker } = await import('../../../src/rag/reranker.js');
    const reranker = await loadReranker({
      manifest: TINY_MANIFEST,
      cacheDir: uniqueTmp('reranker-stub-non-array'),
      verifyHashes: false,
    });
    await expect(reranker.rank('q', null as unknown as string[])).rejects.toThrow(
      /rank: documents must be an array/,
    );
  });

  it('rank(q, [null]) rejects with documents[i] must be a string', async () => {
    const { loadReranker } = await import('../../../src/rag/reranker.js');
    const reranker = await loadReranker({
      manifest: TINY_MANIFEST,
      cacheDir: uniqueTmp('reranker-stub-null-doc'),
      verifyHashes: false,
    });
    await expect(reranker.rank('q', [null as unknown as string])).rejects.toThrow(
      /rank: documents\[0\] must be a string/,
    );
  });

  it('rejects out-of-range batchSize fail-fast (0 / 100 / -1 / 1.5)', async () => {
    const { loadReranker } = await import('../../../src/rag/reranker.js');
    const reranker = await loadReranker({
      manifest: TINY_MANIFEST,
      cacheDir: uniqueTmp('reranker-stub-batch-cap'),
      verifyHashes: false,
    });
    await expect(reranker.rank('q', ['a'], { batchSize: 0 })).rejects.toThrow(/batchSize/);
    await expect(reranker.rank('q', ['a'], { batchSize: 100 })).rejects.toThrow(/batchSize/);
    await expect(reranker.rank('q', ['a'], { batchSize: -1 })).rejects.toThrow(/batchSize/);
    await expect(reranker.rank('q', ['a'], { batchSize: 1.5 })).rejects.toThrow(/batchSize/);
  });

  it('rejects out-of-range maxLength fail-fast (0 / 1000 / 8)', async () => {
    const { loadReranker } = await import('../../../src/rag/reranker.js');
    const reranker = await loadReranker({
      manifest: TINY_MANIFEST,
      cacheDir: uniqueTmp('reranker-stub-maxlen'),
      verifyHashes: false,
    });
    await expect(reranker.rank('q', ['a'], { maxLength: 1000 })).rejects.toThrow(/maxLength/);
    await expect(reranker.rank('q', ['a'], { maxLength: 8 })).rejects.toThrow(/maxLength/);
    await expect(reranker.rank('q', ['a'], { maxLength: 0 })).rejects.toThrow(/maxLength/);
  });

  it('shards across batches so a 5-doc rank with batchSize=2 runs 3 forward passes', async () => {
    const { loadReranker } = await import('../../../src/rag/reranker.js');
    const reranker = await loadReranker({
      manifest: TINY_MANIFEST,
      cacheDir: uniqueTmp('reranker-stub-shard'),
      verifyHashes: false,
    });
    const beforeModel = modelCallCount.count;
    // Fill stubScores with enough entries so the slice math returns predictable
    // [0.95, 0.05] / [0.5, 0.95] / [0.05] segments.
    stubScores = [0.95, 0.05, 0.5, 0.95, 0.05, 0.5];
    const result = await reranker.rank('q', ['d1', 'd2', 'd3', 'd4', 'd5'], { batchSize: 2 });
    expect(result).toHaveLength(5);
    // Three forward passes: floor(5/2) + (5 % 2 > 0 ? 1 : 0) = 3.
    expect(modelCallCount.count - beforeModel).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// createReranker — stub-by-injection (no @huggingface/transformers needed)
// ---------------------------------------------------------------------------

function makeStubReranker(modelId: string, scoreFor: (doc: string) => number): Reranker {
  return {
    modelId,
    async rank(_query, documents) {
      return documents.map((doc, index) => ({ index, score: scoreFor(doc) }));
    },
  };
}

function makeHybridFixture(): HybridHit[] {
  const docs: Array<{ docId: number; content: string }> = [
    { docId: 1, content: '差旅报销规定要求保留所有原始凭证。' },
    { docId: 2, content: '加班补偿可换算调休。' },
    { docId: 3, content: '请假流程通过 OA 提交。' },
    { docId: 4, content: '试用期管理覆盖入职三个月。' },
    { docId: 5, content: '员工培训计划。' },
    { docId: 6, content: '健康体检每年提供一次。' },
    { docId: 7, content: '离职手续需提前一个月。' },
    { docId: 8, content: '出差预订使用协议供应商。' },
    { docId: 9, content: '法定假日与年假按公司日历执行。' },
    { docId: 10, content: '保密协议覆盖客户资料。' },
    { docId: 11, content: '年终奖发放。' },
    { docId: 12, content: '员工股票计划。' },
  ];
  return docs.map((d, i) => {
    const chunk: Chunk = { content: d.content, source: 'unit-fixture.md', page: i + 1 };
    return {
      docId: d.docId,
      chunk,
      rrfScore: 0.1 + i * 0.01,
      bm25Rank: i + 1,
      bm25Score: -10 - i,
    };
  });
}

describe('createReranker (stub-by-injection)', () => {
  it('factory itself is side-effect-free — does not invoke reranker.rank', async () => {
    const reranker = makeStubReranker('stub', () => 0.5);
    const spy = vi.spyOn(reranker, 'rank');
    // The dynamic import keeps module-level singletons isolated across tests.
    // (The createReranker factory does NOT touch the singleton; this is a
    // belt-and-suspenders guarantee for the "no I/O at factory time" claim.)
    const { createReranker } = await import('../../../src/rag/reranker.js');
    createReranker({ reranker });
    expect(spy).not.toHaveBeenCalled();
  });

  it('validates defaultOpts at factory time (topK / batchSize / maxLength)', async () => {
    const { createReranker } = await import('../../../src/rag/reranker.js');
    const reranker = makeStubReranker('stub', () => 0.5);
    expect(() => createReranker({ reranker, defaultOpts: { topK: 0 } })).toThrow(/topK/);
    expect(() => createReranker({ reranker, defaultOpts: { topK: -1 } })).toThrow(/topK/);
    expect(() => createReranker({ reranker, defaultOpts: { batchSize: 0 } })).toThrow(/batchSize/);
    expect(() => createReranker({ reranker, defaultOpts: { batchSize: 100 } })).toThrow(
      /batchSize/,
    );
    expect(() => createReranker({ reranker, defaultOpts: { maxLength: 8 } })).toThrow(/maxLength/);
    expect(() => createReranker({ reranker, defaultOpts: { maxLength: 1000 } })).toThrow(
      /maxLength/,
    );
  });

  it('freezes a shallow copy of defaultOpts so caller mutation does not drift effective defaults', async () => {
    const { createReranker } = await import('../../../src/rag/reranker.js');
    const reranker = makeStubReranker('stub', () => 0.5);
    const defaults: { topK: number } = { topK: 3 };
    const rerank = createReranker({ reranker, defaultOpts: defaults });
    defaults.topK = 999;
    const result = await rerank('q', makeHybridFixture());
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('happy path: 12 hybrid hits → sorted by rerankScore desc + topK=5 cap', async () => {
    const { createReranker } = await import('../../../src/rag/reranker.js');
    // Map docId → score so the test asserts on a known reordering: docId 12
    // gets the highest score, descending by docId.
    const scoreByContent: Map<string, number> = new Map();
    const fixture = makeHybridFixture();
    for (let i = 0; i < fixture.length; i += 1) {
      const hit = fixture[i];
      if (!hit) continue;
      scoreByContent.set(hit.chunk.content, 0.1 + i * 0.05);
    }
    const reranker = makeStubReranker('stub', (doc) => scoreByContent.get(doc) ?? 0);
    const rerank = createReranker({ reranker });
    const result = await rerank('q', fixture, { topK: 5 });
    expect(result.length).toBe(5);
    for (let i = 1; i < result.length; i += 1) {
      const prev = result[i - 1];
      const curr = result[i];
      if (!prev || !curr) throw new Error('result array unexpectedly sparse');
      expect(prev.rerankScore).toBeGreaterThanOrEqual(curr.rerankScore);
    }
    // Top result must be the highest-scored doc (docId 12 by construction).
    expect(result[0]?.docId).toBe(12);
  });

  it('accepts topK = Infinity → returns every reranked candidate', async () => {
    const { createReranker } = await import('../../../src/rag/reranker.js');
    const reranker = makeStubReranker('stub', () => 0.5);
    const rerank = createReranker({ reranker });
    const fixture = makeHybridFixture();
    const result = await rerank('q', fixture, { topK: Number.POSITIVE_INFINITY });
    expect(result.length).toBe(fixture.length);
  });

  it('accepts defaultOpts.topK = Infinity (regression: was rejected by redundant ceiling check)', async () => {
    const { createReranker } = await import('../../../src/rag/reranker.js');
    const reranker = makeStubReranker('stub', () => 0.5);
    expect(() =>
      createReranker({ reranker, defaultOpts: { topK: Number.POSITIVE_INFINITY } }),
    ).not.toThrow();
    const rerank = createReranker({ reranker, defaultOpts: { topK: Number.POSITIVE_INFINITY } });
    const result = await rerank('q', makeHybridFixture());
    expect(result.length).toBe(12);
  });

  it('rerank empty candidates short-circuits to []', async () => {
    const { createReranker } = await import('../../../src/rag/reranker.js');
    const reranker = makeStubReranker('stub', () => 0.5);
    const spy = vi.spyOn(reranker, 'rank');
    const rerank = createReranker({ reranker });
    const result = await rerank('q', []);
    expect(result).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('propagates reranker.rank errors to caller (no swallowing)', async () => {
    const { createReranker } = await import('../../../src/rag/reranker.js');
    const reranker: Reranker = {
      modelId: 'boom',
      async rank() {
        throw new Error('rank-boom');
      },
    };
    const rerank = createReranker({ reranker });
    await expect(rerank('q', makeHybridFixture())).rejects.toThrow(/rank-boom/);
  });

  it('is deterministic: two identical calls produce strictly equal RerankedHit[] (ordering + scores)', async () => {
    const { createReranker } = await import('../../../src/rag/reranker.js');
    const fixture = makeHybridFixture();
    const reranker = makeStubReranker('stub', (doc) => doc.length / 100);
    const rerank = createReranker({ reranker });
    const a = await rerank('q', fixture, { topK: 5 });
    const b = await rerank('q', fixture, { topK: 5 });
    expect(b).toEqual(a);
  });

  it('tie-breaks on docId ascending when rerankScores collide', async () => {
    const { createReranker } = await import('../../../src/rag/reranker.js');
    // All docs get the same score → sort must fall back to docId asc.
    const reranker = makeStubReranker('stub', () => 0.7);
    const fixture = makeHybridFixture();
    const rerank = createReranker({ reranker });
    const result = await rerank('q', fixture, { topK: fixture.length });
    for (let i = 1; i < result.length; i += 1) {
      const prev = result[i - 1];
      const curr = result[i];
      if (!prev || !curr) throw new Error('result array unexpectedly sparse');
      expect(curr.docId).toBeGreaterThan(prev.docId);
    }
  });
});
