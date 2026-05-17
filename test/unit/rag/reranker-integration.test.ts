import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadEmbedder, writeEmbedderMeta } from '../../../src/rag/embedder.js';
import { createHybridSearch } from '../../../src/rag/hybrid-search.js';
import { createReranker, loadReranker } from '../../../src/rag/reranker.js';
import { writeRerankerMeta } from '../../../src/rag/reranker-meta.js';
import { openIndex } from '../../../src/rag/sqlite-store.js';
import { writeTokenizerMeta } from '../../../src/rag/tokenizer-meta.js';
import type {
  ChunkRow,
  Embedder,
  HybridSearchFn,
  IndexHandle,
  Reranker,
  RerankFn,
} from '../../../src/rag/types.js';

const SKIP_NETWORK = process.env.SKIP_MODEL_DOWNLOAD === '1';

function uniqueTmp(prefix: string): string {
  return path.join(tmpdir(), `${prefix}-${randomUUID()}`);
}

// 12 HR-flavoured chunks mirroring `hybrid-search.integration.test.ts`. The
// fixture is intentionally NOT extracted into a shared helper (YAGNI — only
// two integration suites use it; Story 2.6 / 2.7 will revisit if a third
// emerges) per Story 2.5 Task 11.3.
const FIXTURE_CHUNKS: ChunkRow['chunk'][] = [
  {
    content: '差旅报销规定要求保留所有原始凭证并填写电子差旅单。',
    source: 'reranker-integration.md',
    page: 1,
  },
  {
    content: '实习期评估流程对新人开展导师面谈和绩效评估。',
    source: 'reranker-integration.md',
    page: 2,
  },
  {
    content: '试用期管理覆盖入职三个月内的所有同事,期满启动转正评估。',
    source: 'reranker-integration.md',
    page: 3,
  },
  {
    content: '员工培训计划由人力资源部统筹,每季度更新课程表。',
    source: 'reranker-integration.md',
    page: 4,
  },
  {
    content: '请假申请需通过 OA 系统提交,由直属上级审批。',
    source: 'reranker-integration.md',
    page: 5,
  },
  {
    content: '加班补偿可以选择换算成调休或按规定折算工资。',
    source: 'reranker-integration.md',
    page: 6,
  },
  {
    content: '法定节假日按国家公历日历执行,公司同步发布年度排班表。',
    source: 'reranker-integration.md',
    page: 7,
  },
  {
    content: '保密协议覆盖客户资料、内部文档以及未发布的产品信息。',
    source: 'reranker-integration.md',
    page: 8,
  },
  {
    content: '年终奖发放与个人绩效以及公司整体经营情况共同挂钩。',
    source: 'reranker-integration.md',
    page: 9,
  },
  {
    content: '健康体检每年提供一次,可凭票据在体检合作机构完成。',
    source: 'reranker-integration.md',
    page: 10,
  },
  {
    content: '离职手续需要提前一个月以书面形式向直属上级提出申请。',
    source: 'reranker-integration.md',
    page: 11,
  },
  {
    content: '出差预订机票与酒店时优先使用公司协议供应商以享受折扣。',
    source: 'reranker-integration.md',
    page: 12,
  },
];

const tmpCacheDirs: string[] = [];

describe.skipIf(SKIP_NETWORK)(
  'createReranker integration (real bge-large-zh + bge-reranker-v2-m3 + real sqlite)',
  () => {
    // Share embedder + reranker + index across the cases to avoid paying
    // ~30s embedder cold-start + ~30s reranker cold-start per case (~2GB
    // total weights). Skipped entirely when SKIP_MODEL_DOWNLOAD=1.
    let embedder: Embedder;
    let reranker: Reranker;
    let handle: IndexHandle;
    let hybridSearch: HybridSearchFn;
    let rerank: RerankFn;

    beforeAll(async () => {
      const cacheDir = uniqueTmp('reranker-integration');
      tmpCacheDirs.push(cacheDir);

      embedder = await loadEmbedder({ cacheDir });
      reranker = await loadReranker({ cacheDir });
      handle = openIndex(':memory:', { embeddingDim: embedder.dim });
      writeEmbedderMeta(handle.db, embedder);
      writeTokenizerMeta(handle.db);
      writeRerankerMeta(handle.db, reranker);

      const contents = FIXTURE_CHUNKS.map((c) => c.content);
      const embeddings = await embedder.embedBatch(contents);
      const rows: ChunkRow[] = FIXTURE_CHUNKS.map((chunk, i) => {
        const embedding = embeddings[i];
        if (!embedding) throw new Error(`integration fixture: missing embedding for chunk ${i}`);
        return { chunk, embedding };
      });
      handle.indexChunks(rows);
      hybridSearch = createHybridSearch({ handle, embedder });
      rerank = createReranker({ reranker, defaultOpts: { topK: 5 } });
    }, 300_000);

    afterAll(() => {
      handle?.close();
      for (const d of tmpCacheDirs) {
        rmSync(d, { recursive: true, force: true });
      }
    });

    it('Hit Rate sanity: query "试用期" → rerank top-5 contains the 试用期管理 chunk with rerankScore > 0.5', async () => {
      const hybrid = await hybridSearch('试用期');
      const reranked = await rerank('试用期', hybrid);
      expect(reranked.length).toBeGreaterThan(0);
      expect(reranked.length).toBeLessThanOrEqual(5);
      const target = reranked.find((h) => h.chunk.content.includes('试用期管理'));
      expect(target).toBeDefined();
      expect(target?.rerankScore).toBeGreaterThan(0.5);
    });

    it('score ordering: query "差旅报销规定" → exact-match chunk ranks #1 with rerankScore > 0.9', async () => {
      const hybrid = await hybridSearch('差旅报销规定');
      const reranked = await rerank('差旅报销规定', hybrid);
      expect(reranked.length).toBeGreaterThan(0);
      expect(reranked[0]?.chunk.content).toContain('差旅报销规定');
      expect(reranked[0]?.rerankScore).toBeGreaterThan(0.9);
    });

    it('low-confidence detection: query "蓝鲸深空探测" → every reranked rerankScore < 0.5 (FR25 / NFR17 threshold)', async () => {
      const hybrid = await hybridSearch('蓝鲸深空探测');
      // hybrid may return zero hits (no token overlap); rerank short-circuits if so.
      const reranked = await rerank('蓝鲸深空探测', hybrid);
      for (const h of reranked) {
        expect(h.rerankScore).toBeLessThan(0.5);
      }
    });

    it('element-wise consistency: two identical rerank calls produce structurally equal RerankedHit[] (fp32 ONNX deterministic)', async () => {
      const hybrid = await hybridSearch('试用期');
      const a = await rerank('试用期', hybrid);
      const b = await rerank('试用期', hybrid);
      expect(b.length).toBe(a.length);
      for (let i = 0; i < a.length; i += 1) {
        expect(b[i]?.docId).toBe(a[i]?.docId);
        // fp32 ONNX is deterministic to within ~1e-6 across forwards.
        expect(Math.abs((b[i]?.rerankScore ?? 0) - (a[i]?.rerankScore ?? 0))).toBeLessThan(1e-6);
      }
    });
  },
);
