import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { loadEmbedder, writeEmbedderMeta } from '../../../src/rag/embedder.js';
import { createHybridSearch } from '../../../src/rag/hybrid-search.js';
import { openIndex } from '../../../src/rag/sqlite-store.js';
import { writeTokenizerMeta } from '../../../src/rag/tokenizer-meta.js';
import type { ChunkRow } from '../../../src/rag/types.js';

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
  afterAll(() => {
    for (const d of tmpCacheDirs) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('BDD#1 + BDD#2 — happy path + single-source survival (case A BM25 / case B vec)', {
    timeout: 180_000,
  }, async () => {
    const cacheDir = uniqueTmp('hybrid-integration');
    tmpCacheDirs.push(cacheDir);

    const embedder = await loadEmbedder({ cacheDir });
    const handle = openIndex(':memory:', { embeddingDim: embedder.dim });
    try {
      writeEmbedderMeta(handle.db, embedder);
      writeTokenizerMeta(handle.db);

      const contents = FIXTURE_CHUNKS.map((c) => c.content);
      const embeddings = await embedder.embedBatch(contents);
      const rows: ChunkRow[] = FIXTURE_CHUNKS.map((chunk, i) => {
        const embedding = embeddings[i];
        if (!embedding) throw new Error(`integration fixture: missing embedding for chunk ${i}`);
        return { chunk, embedding };
      });
      handle.indexChunks(rows);

      const search = createHybridSearch({ handle, embedder });

      // BDD#1 — default-shape call returns ≤ topK fused hits with rrfScore set.
      const generic = await search('试用期管理', { topK: 10 });
      expect(generic.length).toBeGreaterThan(0);
      expect(generic.length).toBeLessThanOrEqual(10);
      for (const h of generic) {
        expect(typeof h.rrfScore).toBe('number');
        expect(Number.isFinite(h.rrfScore)).toBe(true);
        expect(h.chunk.source).toBe('integration-fixture.md');
      }

      // BDD#2 case A — '差旅报销规定' is the unique exact-match chunk; BM25
      // should rank it first regardless of where the vector index puts it.
      const caseA = await search('差旅报销规定', { topK: 10 });
      const aHit = caseA.find((h) => h.chunk.content.includes('差旅报销规定'));
      expect(aHit).toBeDefined();
      expect(aHit?.bm25Rank).toBe(1);

      // BDD#2 case B — '试用期评估' has no token-level overlap with '实习期评估流程'
      // after jieba splits both queries / chunks. The vector index should still
      // recall the semantically close chunk; we only require `vecRank` to be
      // defined (BM25 may also pull it via the shared '评估' token — see
      // Story 2.4 Dev Notes §测试容忍).
      const caseB = await search('试用期评估', { topK: 10 });
      const bHit = caseB.find((h) => h.chunk.content.includes('实习期评估流程'));
      expect(bHit).toBeDefined();
      expect(bHit?.vecRank).toBeDefined();
      expect(typeof bHit?.vecRank).toBe('number');
    } finally {
      handle.close();
    }
  });
});
