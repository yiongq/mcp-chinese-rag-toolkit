#!/usr/bin/env node
/**
 * Story 2.7 CLI — runs the toolkit self-contained RAG eval set against the
 * 12-chunk bench fixture (Story 2.5 reused) and writes summary.json /
 * report.md / per-query.json to eval-results/. Exits non-zero when
 * Hit Rate@5 falls below RAG_EVAL_HIT_RATE_MIN (default 0.9).
 *
 * Usage:
 *   pnpm test:eval                                           # default
 *   RAG_EVAL_HIT_RATE_MIN=0.85 pnpm test:eval                # dev override
 *   pnpm test:eval -- --eval-set eval/eval-set.yml           # explicit path
 *   pnpm test:eval -- --out-dir custom-results               # explicit out dir
 *
 * Exit codes:
 *   0 — Hit Rate@5 ≥ threshold (NFR14 gate passed)
 *   1 — Hit Rate@5 < threshold (NFR14 gate failed; CI must surface as `build failed`)
 *   2 — runtime error (model load failed / eval set parse failed / etc.)
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvalSearchFn, EvalSearchResult } from '../src/eval/index.js';
import {
  DEFAULT_EVAL_TOP_K,
  emitGitHubActionsAnnotation,
  loadEvalSet,
  passesGate,
  resolveHitRateMin,
  runEval,
  writeArtifacts,
} from '../src/eval/index.js';
import type { ChunkRow } from '../src/rag/index.js';
import {
  createHybridSearch,
  createReranker,
  loadEmbedder,
  loadReranker,
  openIndex,
  writeEmbedderMeta,
  writeRerankerMeta,
  writeTokenizerMeta,
} from '../src/rag/index.js';

/**
 * FIXTURE_CHUNKS — mirrors `bin/latency-harness.ts#FIXTURE_CHUNKS` verbatim.
 * Inline copy chosen (rather than `import` from `bin/latency-harness.ts`) so
 * the two CLIs do not develop cross-dependencies; if the chunks drift, the
 * Task 14 manual `test:eval` run + Task 10 fixture test catch it immediately.
 */
const FIXTURE_CHUNKS = [
  {
    content: '差旅报销规定要求保留所有原始凭证并填写电子差旅单。',
    source: 'bench-fixture.md',
    page: 1,
  },
  { content: '实习期评估流程对新人开展导师面谈和绩效评估。', source: 'bench-fixture.md', page: 2 },
  {
    content: '试用期管理覆盖入职三个月内的所有同事,期满启动转正评估。',
    source: 'bench-fixture.md',
    page: 3,
  },
  {
    content: '员工培训计划由人力资源部统筹,每季度更新课程表。',
    source: 'bench-fixture.md',
    page: 4,
  },
  { content: '请假申请需通过 OA 系统提交,由直属上级审批。', source: 'bench-fixture.md', page: 5 },
  { content: '加班补偿可以选择换算成调休或按规定折算工资。', source: 'bench-fixture.md', page: 6 },
  {
    content: '法定节假日按国家公历日历执行,公司同步发布年度排班表。',
    source: 'bench-fixture.md',
    page: 7,
  },
  {
    content: '保密协议覆盖客户资料、内部文档以及未发布的产品信息。',
    source: 'bench-fixture.md',
    page: 8,
  },
  {
    content: '年终奖发放与个人绩效以及公司整体经营情况共同挂钩。',
    source: 'bench-fixture.md',
    page: 9,
  },
  {
    content: '健康体检每年提供一次,可凭票据在体检合作机构完成。',
    source: 'bench-fixture.md',
    page: 10,
  },
  {
    content: '离职手续需要提前一个月以书面形式向直属上级提出申请。',
    source: 'bench-fixture.md',
    page: 11,
  },
  {
    content: '出差预订机票与酒店时优先使用公司协议供应商以享受折扣。',
    source: 'bench-fixture.md',
    page: 12,
  },
] as const;

export interface CliArgs {
  evalSetPath: string;
  outDir: string;
}

/**
 * Parse CLI flags. Exported for unit testing — the test asserts parsing
 * semantics without booting the BGE models. Fail-fast on unknown flags or
 * missing values mirrors `bin/latency-harness.ts#parseArgs`.
 */
export function parseArgs(argv: readonly string[]): CliArgs {
  const out: CliArgs = { evalSetPath: 'eval/eval-set.yml', outDir: 'eval-results' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--eval-set' || arg === '--out-dir') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`run-eval: ${arg} requires a value`);
      }
      if (arg === '--eval-set') out.evalSetPath = value;
      else out.outDir = value;
      i += 1;
      continue;
    }
    throw new Error(`run-eval: unknown argument ${arg}`);
  }
  return out;
}

/**
 * Build the toolkit search function used to evaluate the bench fixture.
 * Mirrors `bin/latency-harness.ts#buildSearchFixtureTool` — loads
 * bge-large-zh + bge-reranker-v2-m3 + indexes 12 chunks into in-memory
 * SQLite, returns an `EvalSearchFn` that runs the full hybrid + rerank
 * pipeline. ALSO exposes the IndexHandle disposer so the caller can release
 * the native SQLite handle deterministically (Story 2.5 教训 1).
 */
async function buildToolkitSearchFn(): Promise<{
  searchFn: EvalSearchFn;
  dispose: () => Promise<void>;
}> {
  const embedder = await loadEmbedder();
  const reranker = await loadReranker();
  const handle = openIndex(':memory:', { embeddingDim: embedder.dim });
  writeEmbedderMeta(handle.db, embedder);
  writeTokenizerMeta(handle.db);
  writeRerankerMeta(handle.db, reranker);

  const contents = FIXTURE_CHUNKS.map((c) => c.content);
  const embeddings = await embedder.embedBatch(contents);
  const rows: ChunkRow[] = FIXTURE_CHUNKS.map((chunk, i) => {
    const embedding = embeddings[i];
    if (!embedding) throw new Error(`run-eval: missing embedding for chunk ${i}`);
    return { chunk, embedding };
  });
  handle.indexChunks(rows);

  const hybridSearch = createHybridSearch({ handle, embedder });
  const rerank = createReranker({ reranker, defaultOpts: { topK: 5 } });

  const searchFn: EvalSearchFn = async (query, opts) => {
    const topK = opts?.topK ?? DEFAULT_EVAL_TOP_K;
    const hybrid = await hybridSearch(query, { topK: Math.max(topK * 2, 10) });
    const reranked = await rerank(query, hybrid, { topK });
    const results: EvalSearchResult[] = reranked.map((r, i) => {
      // The toolkit contract (EvalSearchResult.source) requires a string;
      // silently substituting 'unknown' on a missing source would mask a
      // pipeline bug and make CI debugging impossible. Fail loudly with the
      // chunk index so the operator can find the offending row.
      if (typeof r.chunk.source !== 'string') {
        throw new Error(
          `run-eval: reranked[${i}] for query="${query}" has no string 'source' on chunk; ` +
            'indexing pipeline must populate source — check Story 2.1 chunking output.',
        );
      }
      const out: EvalSearchResult = {
        source: r.chunk.source,
        rerankScore: r.rerankScore,
      };
      if (r.chunk.page !== undefined) out.page = r.chunk.page;
      if (r.chunk.section !== undefined) out.section = r.chunk.section;
      if (r.chunk.content !== undefined) out.content = r.chunk.content;
      if (r.distance !== undefined) out.distance = r.distance;
      // RerankedHit exposes BM25 rank as `bm25Rank`; surface it as `ftsRank`
      // in the EvalSearchResult to match Story 2.7 spec L31 (FR43 wording).
      if (r.bm25Rank !== undefined) out.ftsRank = r.bm25Rank;
      return out;
    });
    return results;
  };
  return {
    searchFn,
    dispose: async () => {
      handle.close();
    },
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkgRoot = path.resolve(here, '..');
  const evalSetAbs = path.isAbsolute(args.evalSetPath)
    ? args.evalSetPath
    : path.resolve(pkgRoot, args.evalSetPath);
  const outDirAbs = path.isAbsolute(args.outDir) ? args.outDir : path.resolve(pkgRoot, args.outDir);
  // chdir so loadEvalSet / writeArtifacts resolve as expected even when
  // invoked from monorepo root via turbo.
  process.chdir(pkgRoot);

  const threshold = resolveHitRateMin();
  process.stdout.write(`run-eval: loading eval set ${evalSetAbs}\n`);
  const evalSet = loadEvalSet(evalSetAbs);
  process.stdout.write(
    `run-eval: ${evalSet.queries.length} queries, version=${evalSet.version}, threshold=${threshold}\n`,
  );

  const { searchFn, dispose } = await buildToolkitSearchFn();
  try {
    process.stdout.write('run-eval: running searchFn over fixture (loads BGE models)…\n');
    // strict: true — every eval-set.yml query declares an explicit `page`, so
    // page-level matching is the assertion the CI gate must enforce. Without
    // strict, ANY chunk from `bench-fixture.md` would score hit on every
    // query (single-file fixture), reducing the gate to a tautology.
    const summary = await runEval(evalSet, {
      searchFn,
      topK: DEFAULT_EVAL_TOP_K,
      strict: true,
    });
    const { reportPath, summaryPath } = writeArtifacts(summary, { outDir: outDirAbs });
    process.stdout.write(`run-eval: wrote ${summaryPath}\n`);
    process.stdout.write(`run-eval: wrote ${reportPath}\n`);
    emitGitHubActionsAnnotation(summary, threshold);

    const pct = (summary.hitRate * 100).toFixed(2);
    const minPct = (threshold * 100).toFixed(2);
    process.stdout.write(
      `\nHit Rate@${summary.topK}: ${pct}%  (threshold ${minPct}%)\n` +
        `MRR@${summary.topK}:      ${summary.mrr.toFixed(4)}\n`,
    );

    return passesGate(summary, threshold) ? 0 : 1;
  } finally {
    // Isolate dispose failure so it cannot mask the primary error from the
    // try block — surface it on stderr but do not throw from finally.
    try {
      await dispose();
    } catch (disposeErr) {
      process.stderr.write(
        `run-eval: dispose() failed: ${disposeErr instanceof Error ? (disposeErr.stack ?? disposeErr.message) : String(disposeErr)}\n`,
      );
    }
  }
}

// Gate auto-execution so unit tests can `import { parseArgs } from
// '../bin/run-eval.ts'` without triggering a 2GB model download. Matches the
// standard Node.js "is this file the entrypoint?" idiom.
const isEntrypoint = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(import.meta.url) === path.resolve(entry);
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      process.stderr.write(
        `run-eval: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      );
      process.exit(2);
    });
}
