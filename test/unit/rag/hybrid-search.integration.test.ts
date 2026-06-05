import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadEmbedder, writeEmbedderMeta } from '../../../src/rag/embedder.js';
import { createHybridSearch } from '../../../src/rag/hybrid-search.js';
import { openIndex } from '../../../src/rag/sqlite-store.js';
import { writeTokenizerMeta } from '../../../src/rag/tokenizer-meta.js';
import type { ChunkRow, Embedder, HybridSearchFn, IndexHandle } from '../../../src/rag/types.js';

const SKIP_NETWORK = process.env.SKIP_MODEL_DOWNLOAD === '1';

function uniqueTmp(prefix: string): string {
  return path.join(tmpdir(), `${prefix}-${randomUUID()}`);
}

// 12 HR-flavoured chunks chosen for the two BDD#2 recovery scenarios:
// - '差旅报销规定' is the unique exact-match keyword for BDD#2 case A.
// - '实习期评估流程' uses '实习期' instead of '试用期', so the BM25 path
//   under-recalls relative to the semantically similar query '试用期评估'
//   — case B verifies the vector index pulls it back.
const FIXTURE_CHUNKS: ChunkRow['chunk'][] = [
  {
    content: '差旅报销规定要求保留所有原始凭证并填写电子差旅单。',
    source: 'integration-fixture.md',
    page: 1,
  },
  {
    content: '实习期评估流程对新人开展导师面谈和绩效评估。',
    source: 'integration-fixture.md',
    page: 2,
  },
  {
    content: '试用期管理覆盖入职三个月内的所有同事,期满启动转正评估。',
    source: 'integration-fixture.md',
    page: 3,
  },
  {
    content: '员工培训计划由人力资源部统筹,每季度更新课程表。',
    source: 'integration-fixture.md',
    page: 4,
  },
  {
    content: '请假申请需通过 OA 系统提交,由直属上级审批。',
    source: 'integration-fixture.md',
    page: 5,
  },
  {
    content: '加班补偿可以选择换算成调休或按规定折算工资。',
    source: 'integration-fixture.md',
    page: 6,
  },
  {
    content: '法定节假日按国家公历日历执行,公司同步发布年度排班表。',
    source: 'integration-fixture.md',
    page: 7,
  },
  {
    content: '保密协议覆盖客户资料、内部文档以及未发布的产品信息。',
    source: 'integration-fixture.md',
    page: 8,
  },
  {
    content: '年终奖发放与个人绩效以及公司整体经营情况共同挂钩。',
    source: 'integration-fixture.md',
    page: 9,
  },
  {
    content: '健康体检每年提供一次,可凭票据在体检合作机构完成。',
    source: 'integration-fixture.md',
    page: 10,
  },
  {
    content: '离职手续需要提前一个月以书面形式向直属上级提出申请。',
    source: 'integration-fixture.md',
    page: 11,
  },
  {
    content: '出差预订机票与酒店时优先使用公司协议供应商以享受折扣。',
    source: 'integration-fixture.md',
    page: 12,
  },
];

const tmpCacheDirs: string[] = [];

describe.skipIf(SKIP_NETWORK)('createHybridSearch (real bge-large-zh-v1.5 + real sqlite)', () => {
  // Share embedder + indexed handle across the three BDD cases to avoid
  // paying the ~30s ONNX cold-start cost per case (Task 8.1 cost-sharing
  // requirement, now split into three it() blocks to satisfy AC7 literal
  // "≥ 3 cases").
  let embedder: Embedder;
  let handle: IndexHandle;
  let search: HybridSearchFn;
  let firstChunkEmbedding: Float32Array | undefined;

  beforeAll(async () => {
    const cacheDir = uniqueTmp('hybrid-integration');
    tmpCacheDirs.push(cacheDir);

    embedder = await loadEmbedder({ cacheDir });
    handle = openIndex(':memory:', { embeddingDim: embedder.dim });
    writeEmbedderMeta(handle.db, embedder);
    writeTokenizerMeta(handle.db);

    const contents = FIXTURE_CHUNKS.map((c) => c.content);
    const embeddings = await embedder.embedBatch(contents);
    firstChunkEmbedding = embeddings[0];
    const rows: ChunkRow[] = FIXTURE_CHUNKS.map((chunk, i) => {
      const embedding = embeddings[i];
      if (!embedding) throw new Error(`integration fixture: missing embedding for chunk ${i}`);
      return { chunk, embedding };
    });
    handle.indexChunks(rows);
    search = createHybridSearch({ handle, embedder });
  }, 180_000);

  afterAll(() => {
    handle?.close();
    for (const d of tmpCacheDirs) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('BDD#1 — default-shape call returns ≤ topK fused hits with rrfScore + chunk metadata populated', async () => {
    const generic = await search('试用期管理', { topK: 10 });
    expect(generic.length).toBeGreaterThan(0);
    expect(generic.length).toBeLessThanOrEqual(10);
    for (const h of generic) {
      expect(typeof h.rrfScore).toBe('number');
      expect(Number.isFinite(h.rrfScore)).toBe(true);
      expect(h.chunk.source).toBe('integration-fixture.md');
      // AC4 BDD#1 explicit: at least 1 non-empty metadata field per hit.
      expect(h.chunk.content.length).toBeGreaterThan(0);
      expect(typeof h.chunk.page).toBe('number');
    }
  });

  it('BDD#2 case A — exact-keyword chunk surfaces with bm25Rank = 1 and rrfScore math matches', async () => {
    const caseA = await search('差旅报销规定', { topK: 10 });
    const aHit = caseA.find((h) => h.chunk.content.includes('差旅报销规定'));
    expect(aHit).toBeDefined();
    expect(aHit?.bm25Rank).toBe(1);
    // AC4 mathematical assertion — RRF accumulates `1/(k + rank)` per source
    // that hit. With BM25 rank=1 the BM25 contribution is exactly `1/61`;
    // when vec also pulls this chunk (12-chunk fixture sits inside the
    // default perSourceTopK=30), the total is `1/61 + 1/(60+vecRank)`.
    // Validate the closed-form maths against the observed score.
    const expectedFromBm25 = 1 / 61;
    const expectedFromVec = aHit?.vecRank !== undefined ? 1 / (60 + aHit.vecRank) : 0;
    const expected = expectedFromBm25 + expectedFromVec;
    expect(Math.abs((aHit?.rrfScore ?? 0) - expected)).toBeLessThan(1e-12);
  });

  it('BDD#2 case B — semantically-similar chunk surfaces via vec even without exact keyword overlap', async () => {
    // '试用期评估' has no full-token overlap with '实习期评估流程' after jieba
    // splits both queries / chunks ('试用期' vs '实习期'). The vector index
    // should still recall the semantically close chunk. Per Dev Notes
    // §测试容忍, BM25 may also pull it via the shared '评估' token, so we
    // only require `vecRank` to be defined (the vec-only assertion is the
    // unit test's job — see hybrid-search.test.ts).
    const caseB = await search('试用期评估', { topK: 10 });
    const bHit = caseB.find((h) => h.chunk.content.includes('实习期评估流程'));
    expect(bHit).toBeDefined();
    expect(bHit?.vecRank).toBeDefined();
    expect(typeof bHit?.vecRank).toBe('number');
    // AC4 mathematical assertion — observed score must equal the closed-form
    // sum of `1/(60 + bm25Rank)` (when defined) + `1/(60 + vecRank)`.
    const bmContribution = bHit?.bm25Rank !== undefined ? 1 / (60 + bHit.bm25Rank) : 0;
    const vecRank = bHit?.vecRank ?? Number.NaN;
    const vecContribution = 1 / (60 + vecRank);
    expect(Math.abs((bHit?.rrfScore ?? 0) - (bmContribution + vecContribution))).toBeLessThan(
      1e-12,
    );
  });

  it('embedBatch and embed produce element-wise consistent vectors for the same input', async () => {
    // Closes the previously-deferred batch/single-path
    // D1/D3 check: assert the batch and single
    // code paths produce element-wise equivalent outputs for the same text
    // (modulo floating-point noise — bge-large-zh-v1.5 fp32 ONNX is
    // deterministic to within ~1e-3 across batch sizes).
    if (!firstChunkEmbedding) throw new Error('beforeAll did not populate firstChunkEmbedding');
    const single = await embedder.embed(FIXTURE_CHUNKS[0]?.content ?? '');
    expect(single.length).toBe(firstChunkEmbedding.length);
    let maxDelta = 0;
    for (let i = 0; i < single.length; i += 1) {
      const a = single[i] ?? 0;
      const b = firstChunkEmbedding[i] ?? 0;
      const d = Math.abs(a - b);
      if (d > maxDelta) maxDelta = d;
    }
    expect(maxDelta).toBeLessThan(1e-3);
  });
});
