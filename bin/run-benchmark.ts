#!/usr/bin/env node
/**
 * CLI — retrieval-only multi-config benchmark over the self-contained RAG
 * eval set + 12-chunk bench fixture. Runs SIX retrieval configurations
 * (bm25-only / vector-only / hybrid+rrf / hybrid+rrf+graph / hybrid+rrf+rerank
 * / hybrid+rrf+graph+rerank) through the same `runEval` scorer, measures
 * per-query wall-clock latency across repeats for a P95, and writes one
 * `benchmark.json` artifact (consumed by the web eval page as a committed
 * snapshot) plus a stdout markdown table. The `+graph` pair A/Bs the
 * entity-match third recall source against its two-source baseline.
 *
 * Deliberately NOT `runBenchmark` (src/eval/benchmark.ts): that orchestrator
 * requires the answer-eval pass (`generateFn` + judge), whose faithfulness
 * judge has not passed the calibration gate — this CLI keeps the comparison
 * table to deterministic retrieval metrics + latency only.
 *
 * Usage:
 *   pnpm bench:retrieval                                # default (3 repeats)
 *   pnpm bench:retrieval -- --repeats 5                 # more latency samples
 *   pnpm bench:retrieval -- --eval-set eval/eval-set.yml --out-dir eval-results
 *
 * Exit codes: 0 — completed; 2 — runtime error (model load / parse failure).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvalSearchFn, EvalSearchResult, EvalSet, EvalSummary } from '../src/eval/index.js';
import { DEFAULT_EVAL_TOP_K, loadEvalSet, runEval } from '../src/eval/index.js';
import type { RawExtraction } from '../src/graph/index.js';
import { buildGraphSchema, extractGraph, graphRecall, writeGraph } from '../src/graph/index.js';
import type { ChunkRow } from '../src/rag/index.js';
import {
  createHybridSearch,
  createReranker,
  loadEmbedder,
  loadReranker,
  openIndex,
  percentile,
  writeEmbedderMeta,
  writeRerankerMeta,
  writeTokenizerMeta,
} from '../src/rag/index.js';

/**
 * FIXTURE_CHUNKS — pages 1–12 mirror `bin/run-eval.ts#FIXTURE_CHUNKS` verbatim
 * (which in turn mirrors `bin/latency-harness.ts`). Inline copy per the
 * standing ruling: bin CLIs do not develop cross-dependencies; drift is caught
 * by the Task 10 fixture test.
 *
 * Pages 13–18 are BENCHMARK-ONLY aggregation soil (absent from the CI fixture,
 * so the Hit Rate@5 ≥ 90% gate is untouched): page 13 is an anchor that binds
 * two canonical entities (张伟 / 差旅报销系统) to their alias surface forms
 * (工号 A1024 / TRS), and pages 14–18 each state one fact about those entities
 * while referring to them ONLY by alias. The facts are deliberately lexically
 * and semantically cold against the aggregation queries — BM25 shares no token
 * with them and the embedding has no surface bridge — so the only retrieval
 * path that reaches them is the graph third source via `entity_mentions`.
 */
const FIXTURE_CHUNKS = [
  {
    content: '差旅报销规定要求保留所有原始凭证并填写电子差旅单。',
    source: 'bench-fixture.md',
    page: 1,
  },
  { content: '实习期评估流程对新人开展导师面谈和绩效评估。', source: 'bench-fixture.md', page: 2 },
  {
    content: '试用期管理覆盖入职三个月内的所有同事，期满启动转正评估。',
    source: 'bench-fixture.md',
    page: 3,
  },
  {
    content: '员工培训计划由人力资源部统筹，每季度更新课程表。',
    source: 'bench-fixture.md',
    page: 4,
  },
  { content: '请假申请需通过 OA 系统提交，由直属上级审批。', source: 'bench-fixture.md', page: 5 },
  { content: '加班补偿可以选择换算成调休或按规定折算工资。', source: 'bench-fixture.md', page: 6 },
  {
    content: '法定节假日按国家公历日历执行，公司同步发布年度排班表。',
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
    content: '健康体检每年提供一次，可凭票据在体检合作机构完成。',
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
  // ── benchmark-only aggregation tier (pages 13–18) — see docstring above ──
  // Wording rule for this tier: no high-frequency function words (的/把/还/…)
  // that existing benchmark queries tokenize to — stray stopword overlap makes
  // BM25 OR-match these pages for unrelated queries, crowding vector-only
  // evidence out of the hybrid candidate pool (observed: p1 fell out of the
  // rerank pool for the 垫付 hard query until 的/把 were removed here).
  {
    content: '行政部张伟（工号 A1024）负责差旅报销系统（内部代号 TRS）日常运维和账号发放。',
    source: 'bench-fixture.md',
    page: 13,
  },
  {
    content: 'TRS 将于十月停机升级三天，期间提交入口关闭，紧急事项转线下受理。',
    source: 'bench-fixture.md',
    page: 14,
  },
  {
    content: '新版 TRS 界面将常用入口移到首页顶部，旧版入口保留至年底。',
    source: 'bench-fixture.md',
    page: 15,
  },
  {
    content: '档案室钥匙由工号 A1024 统一保管，外借需在前台登记。',
    source: 'bench-fixture.md',
    page: 16,
  },
  {
    content: 'A1024 兼任消防疏散演练楼层联络员，覆盖三层东侧区域。',
    source: 'bench-fixture.md',
    page: 17,
  },
  {
    content: 'TRS 年度安全审计由工号 A1024 牵头，计划十一月完成。',
    source: 'bench-fixture.md',
    page: 18,
  },
] as const;

/**
 * FIXTURE_GRAPH_BY_PAGE — hand-written deterministic entity / relation
 * extraction over FIXTURE_CHUNKS, keyed by fixture page number. Stands in for
 * the LLM-backed `ExtractFn` (graph writes are async in production and the CI
 * fixture ships no graph), so the `+graph` configs are benchmarkable without
 * any model call and the numbers are reproducible run-to-run. Entity names are
 * chosen so a subset of benchmark-set queries contain them verbatim
 * (graphRecall's containment match): 差旅报销/凭证 (p1), 试用期 (p3), 请假
 * (p5), 法定节假日 (p7), 保密协议 (p8), 年终奖 (p9), 体检 (p10), 离职 (p11),
 * 出差/机票 (p12) all fire on easy-tier queries. Hard-tier paraphrases mostly
 * stay entity-free — that asymmetry is the honest shape of entity recall.
 *
 * Pages 13–18 (aggregation tier): mentions LINK ALIAS SURFACE FORMS to their
 * canonical entity — p14/15/18 mention 差旅报销系统 as "TRS", p16/17/18
 * mention 张伟 as "工号 A1024" — standing in for a document-level entity
 * linking pass (the anchor p13 establishes both aliases, so a linker that sees
 * the whole document can resolve them). This out-of-text link is exactly the
 * capability BM25/vector lack and precisely what the aggregation tier
 * measures; if a production extractor only copies surface strings, the graph
 * source degenerates into a BM25 subset and the aggregation gain disappears.
 */
const FIXTURE_GRAPH_BY_PAGE: Record<number, RawExtraction> = {
  1: {
    entities: [
      { name: '差旅报销', type: 'policy' },
      { name: '凭证', type: 'document' },
      { name: '电子差旅单', type: 'document' },
    ],
    relations: [{ source: '差旅报销', target: '凭证', type: '要求保留' }],
  },
  2: {
    entities: [
      { name: '实习期评估', type: 'process' },
      { name: '导师面谈', type: 'process' },
    ],
    relations: [{ source: '实习期评估', target: '导师面谈', type: '包含' }],
  },
  3: {
    entities: [
      { name: '试用期', type: 'policy' },
      { name: '转正评估', type: 'process' },
    ],
    relations: [{ source: '试用期', target: '转正评估', type: '期满启动' }],
  },
  4: {
    entities: [
      { name: '员工培训', type: 'program' },
      { name: '人力资源部', type: 'org' },
    ],
    relations: [{ source: '人力资源部', target: '员工培训', type: '统筹' }],
  },
  5: {
    entities: [
      { name: '请假', type: 'process' },
      { name: 'OA 系统', type: 'system' },
      { name: '直属上级', type: 'role' },
    ],
    relations: [{ source: '请假', target: '直属上级', type: '审批人' }],
  },
  6: {
    entities: [
      { name: '加班', type: 'policy' },
      { name: '调休', type: 'benefit' },
    ],
    relations: [{ source: '加班', target: '调休', type: '可折算为' }],
  },
  7: {
    entities: [
      { name: '法定节假日', type: 'policy' },
      { name: '排班表', type: 'document' },
    ],
    relations: [],
  },
  8: {
    entities: [
      { name: '保密协议', type: 'policy' },
      { name: '客户资料', type: 'asset' },
    ],
    relations: [{ source: '保密协议', target: '客户资料', type: '覆盖' }],
  },
  9: {
    entities: [
      { name: '年终奖', type: 'benefit' },
      { name: '绩效', type: 'metric' },
    ],
    relations: [{ source: '年终奖', target: '绩效', type: '挂钩' }],
  },
  10: {
    entities: [
      { name: '体检', type: 'benefit' },
      { name: '体检合作机构', type: 'org' },
    ],
    relations: [],
  },
  11: {
    entities: [
      { name: '离职', type: 'process' },
      { name: '直属上级', type: 'role' },
    ],
    relations: [{ source: '离职', target: '直属上级', type: '提交至' }],
  },
  12: {
    entities: [
      { name: '出差', type: 'activity' },
      { name: '机票', type: 'item' },
      { name: '协议供应商', type: 'vendor' },
    ],
    relations: [{ source: '出差', target: '协议供应商', type: '优先使用' }],
  },
  // ── aggregation tier: alias mentions resolved to canonical entities ──
  13: {
    entities: [
      { name: '张伟', type: 'person' },
      { name: '差旅报销系统', type: 'system' },
      { name: '行政部', type: 'org' },
    ],
    relations: [
      { source: '张伟', target: '差旅报销系统', type: '运维' },
      { source: '张伟', target: '行政部', type: '属于' },
    ],
  },
  // "TRS" → 差旅报销系统 (alias established by the p13 anchor)
  14: {
    entities: [{ name: '差旅报销系统', type: 'system' }],
    relations: [],
  },
  15: {
    entities: [{ name: '差旅报销系统', type: 'system' }],
    relations: [],
  },
  // "工号 A1024" → 张伟 (alias established by the p13 anchor)
  16: {
    entities: [{ name: '张伟', type: 'person' }],
    relations: [],
  },
  17: {
    entities: [{ name: '张伟', type: 'person' }],
    relations: [],
  },
  18: {
    entities: [
      { name: '差旅报销系统', type: 'system' },
      { name: '张伟', type: 'person' },
    ],
    relations: [{ source: '张伟', target: '差旅报销系统', type: '牵头审计' }],
  },
};

export interface CliArgs {
  evalSetPath: string;
  outDir: string;
  repeats: number;
}

/**
 * Parse CLI flags. Exported for unit testing — mirrors
 * `bin/run-eval.ts#parseArgs` fail-fast semantics.
 */
export function parseArgs(argv: readonly string[]): CliArgs {
  const out: CliArgs = { evalSetPath: 'eval/benchmark-set.yml', outDir: 'eval-results', repeats: 3 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--eval-set' || arg === '--out-dir' || arg === '--repeats') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`run-benchmark: ${arg} requires a value`);
      }
      if (arg === '--eval-set') out.evalSetPath = value;
      else if (arg === '--out-dir') out.outDir = value;
      else {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
          throw new Error('run-benchmark: --repeats must be an integer in [1, 20]');
        }
        out.repeats = parsed;
      }
      i += 1;
      continue;
    }
    throw new Error(`run-benchmark: unknown argument ${arg}`);
  }
  return out;
}

/** One benchmark configuration: a name + its EvalSearchFn. */
interface BenchConfig {
  name: string;
  searchFn: EvalSearchFn;
}

/**
 * Guard shared by every config's result mapping — the eval contract requires a
 * string `source`; failing loudly with the chunk index mirrors run-eval.ts.
 */
function requireSource(source: unknown, cfg: string, query: string, i: number): string {
  if (typeof source !== 'string') {
    throw new Error(
      `run-benchmark: [${cfg}] result[${i}] for query="${query}" has no string 'source' on chunk`,
    );
  }
  return source;
}

/**
 * Build the six retrieval configurations over ONE shared index / embedder /
 * reranker stack (identical corpus + models + graph per config — only the
 * retrieval strategy differs, so the comparison isolates strategy).
 */
async function buildConfigs(): Promise<{ configs: BenchConfig[]; dispose: () => void }> {
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
    if (!embedding) throw new Error(`run-benchmark: missing embedding for chunk ${i}`);
    return { chunk, embedding };
  });
  handle.indexChunks(rows);

  // Graph over the same docs rows — deterministic hand-written extraction
  // (see FIXTURE_GRAPH_BY_PAGE), resolved to real docs.id values so the
  // entity back-links live in the same id space as the other two sources.
  buildGraphSchema(handle.db);
  const docRows = handle.db.prepare('SELECT id, page FROM docs').all() as Array<{
    id: number;
    page: number;
  }>;
  const pageByDocId = new Map(docRows.map((r) => [r.id, r.page]));
  const extracted = await extractGraph({
    chunks: docRows.map((r) => ({ chunkId: r.id, content: `bench fixture p${r.page}` })),
    extractFn: async ({ chunkId }) =>
      FIXTURE_GRAPH_BY_PAGE[pageByDocId.get(chunkId) ?? -1] ?? { entities: [], relations: [] },
  });
  writeGraph(handle.db, extracted);

  const hybridSearch = createHybridSearch({ handle, embedder });
  const hybridGraphSearch = createHybridSearch({
    handle,
    embedder,
    graphRecall: (query, topK) => graphRecall(handle.db, query, { topK }),
  });
  const rerank = createReranker({ reranker, defaultOpts: { topK: DEFAULT_EVAL_TOP_K } });

  const bm25Only: EvalSearchFn = async (query, opts) => {
    const topK = opts?.topK ?? DEFAULT_EVAL_TOP_K;
    return handle.ftsSearch(query, { topK }).map((hit, i): EvalSearchResult => {
      const out: EvalSearchResult = {
        source: requireSource(hit.chunk.source, 'bm25-only', query, i),
        ftsRank: hit.bm25Rank,
      };
      if (hit.chunk.page !== undefined) out.page = hit.chunk.page;
      if (hit.chunk.section !== undefined) out.section = hit.chunk.section;
      if (hit.chunk.content !== undefined) out.content = hit.chunk.content;
      return out;
    });
  };

  const vectorOnly: EvalSearchFn = async (query, opts) => {
    const topK = opts?.topK ?? DEFAULT_EVAL_TOP_K;
    const queryEmbedding = await embedder.embed(query);
    return handle.vecSearch(queryEmbedding, { topK }).map((hit, i): EvalSearchResult => {
      const out: EvalSearchResult = {
        source: requireSource(hit.chunk.source, 'vector-only', query, i),
        distance: hit.distance,
      };
      if (hit.chunk.page !== undefined) out.page = hit.chunk.page;
      if (hit.chunk.section !== undefined) out.section = hit.chunk.section;
      if (hit.chunk.content !== undefined) out.content = hit.chunk.content;
      return out;
    });
  };

  const hybridRrf: EvalSearchFn = async (query, opts) => {
    const topK = opts?.topK ?? DEFAULT_EVAL_TOP_K;
    return (await hybridSearch(query, { topK })).map((hit, i): EvalSearchResult => {
      const out: EvalSearchResult = {
        source: requireSource(hit.chunk.source, 'hybrid+rrf', query, i),
      };
      if (hit.chunk.page !== undefined) out.page = hit.chunk.page;
      if (hit.chunk.section !== undefined) out.section = hit.chunk.section;
      if (hit.chunk.content !== undefined) out.content = hit.chunk.content;
      if (hit.distance !== undefined) out.distance = hit.distance;
      if (hit.bm25Rank !== undefined) out.ftsRank = hit.bm25Rank;
      return out;
    });
  };

  const hybridRrfGraph: EvalSearchFn = async (query, opts) => {
    const topK = opts?.topK ?? DEFAULT_EVAL_TOP_K;
    return (await hybridGraphSearch(query, { topK })).map((hit, i): EvalSearchResult => {
      const out: EvalSearchResult = {
        source: requireSource(hit.chunk.source, 'hybrid+rrf+graph', query, i),
      };
      if (hit.chunk.page !== undefined) out.page = hit.chunk.page;
      if (hit.chunk.section !== undefined) out.section = hit.chunk.section;
      if (hit.chunk.content !== undefined) out.content = hit.chunk.content;
      if (hit.distance !== undefined) out.distance = hit.distance;
      if (hit.bm25Rank !== undefined) out.ftsRank = hit.bm25Rank;
      return out;
    });
  };

  const hybridRrfRerank: EvalSearchFn = async (query, opts) => {
    const topK = opts?.topK ?? DEFAULT_EVAL_TOP_K;
    const hybrid = await hybridSearch(query, { topK: Math.max(topK * 2, 10) });
    return (await rerank(query, hybrid, { topK })).map((r, i): EvalSearchResult => {
      const out: EvalSearchResult = {
        source: requireSource(r.chunk.source, 'hybrid+rrf+rerank', query, i),
        rerankScore: r.rerankScore,
      };
      if (r.chunk.page !== undefined) out.page = r.chunk.page;
      if (r.chunk.section !== undefined) out.section = r.chunk.section;
      if (r.chunk.content !== undefined) out.content = r.chunk.content;
      if (r.distance !== undefined) out.distance = r.distance;
      if (r.bm25Rank !== undefined) out.ftsRank = r.bm25Rank;
      return out;
    });
  };

  const hybridRrfGraphRerank: EvalSearchFn = async (query, opts) => {
    const topK = opts?.topK ?? DEFAULT_EVAL_TOP_K;
    const hybrid = await hybridGraphSearch(query, { topK: Math.max(topK * 2, 10) });
    return (await rerank(query, hybrid, { topK })).map((r, i): EvalSearchResult => {
      const out: EvalSearchResult = {
        source: requireSource(r.chunk.source, 'hybrid+rrf+graph+rerank', query, i),
        rerankScore: r.rerankScore,
      };
      if (r.chunk.page !== undefined) out.page = r.chunk.page;
      if (r.chunk.section !== undefined) out.section = r.chunk.section;
      if (r.chunk.content !== undefined) out.content = r.chunk.content;
      if (r.distance !== undefined) out.distance = r.distance;
      if (r.bm25Rank !== undefined) out.ftsRank = r.bm25Rank;
      return out;
    });
  };

  return {
    configs: [
      { name: 'bm25-only', searchFn: bm25Only },
      { name: 'vector-only', searchFn: vectorOnly },
      { name: 'hybrid+rrf', searchFn: hybridRrf },
      { name: 'hybrid+rrf+graph', searchFn: hybridRrfGraph },
      { name: 'hybrid+rrf+rerank', searchFn: hybridRrfRerank },
      { name: 'hybrid+rrf+graph+rerank', searchFn: hybridRrfGraphRerank },
    ],
    dispose: () => {
      handle.close();
    },
  };
}

/**
 * Category name of the aggregation tier in eval/benchmark-set.yml. Queries in
 * this category declare MULTIPLE expected pages (scattered evidence); the
 * subset gets its own stdout table + artifact block because the any-hit
 * Hit Rate@5 of the full set dilutes exactly the signal the tier exists for.
 */
const AGGREGATION_CATEGORY = 'aggregation';

/**
 * Aggregation-subset metrics for one config. `coverage5` is the mean, over the
 * subset's queries, of |expected pages present in top-5| / |expected pages| —
 * the "did we fetch ALL the scattered evidence" complement to the any-hit
 * hitRate5 (runEval's hitRank counts a query as hit when ANY expected page
 * appears in top-K; see `expectedMatches`).
 */
export interface AggregationStats {
  queries: number;
  hitRate5: number;
  mrr: number;
  coverage5: number;
}

/** One config's benchmark row in the JSON artifact. */
export interface BenchmarkRow {
  config: string;
  hitRate5: number;
  mrr: number;
  p50Ms: number;
  p95Ms: number;
  latencySamples: number;
  /** Present only when the eval set declares `category: aggregation` queries. */
  aggregation?: AggregationStats;
}

/**
 * Compute {@link AggregationStats} for one config's summary, or `undefined`
 * when the eval set has no `category: aggregation` queries. Relies on the
 * runEval contract that `summary.perQuery[i]` corresponds to
 * `evalSet.queries[i]` (runEval iterates queries in order, one row each).
 */
export function aggregationStats(
  evalSet: EvalSet,
  summary: EvalSummary,
): AggregationStats | undefined {
  const rows: Array<{ hit: boolean; reciprocalRank: number; coverage: number }> = [];
  for (let i = 0; i < evalSet.queries.length; i += 1) {
    const query = evalSet.queries[i];
    const result = summary.perQuery[i];
    if (!query || !result || query.category !== AGGREGATION_CATEGORY) continue;
    const pagesInTop = new Set(
      result.topResults
        .filter((r) => r.source !== undefined && r.page !== undefined)
        .map((r) => `${r.source}#${r.page}`),
    );
    const found = query.expected.filter(
      (e) => e.page !== undefined && pagesInTop.has(`${e.source}#${e.page}`),
    ).length;
    rows.push({
      hit: result.hitRank !== undefined,
      reciprocalRank: result.reciprocalRank,
      coverage: query.expected.length === 0 ? 0 : found / query.expected.length,
    });
  }
  if (rows.length === 0) return undefined;
  const n = rows.length;
  return {
    queries: n,
    hitRate5: rows.filter((r) => r.hit).length / n,
    mrr: Number((rows.reduce((s, r) => s + r.reciprocalRank, 0) / n).toFixed(4)),
    coverage5: Number((rows.reduce((s, r) => s + r.coverage, 0) / n).toFixed(4)),
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
  process.chdir(pkgRoot);

  process.stdout.write(`run-benchmark: loading eval set ${evalSetAbs}\n`);
  const evalSet = loadEvalSet(evalSetAbs);
  process.stdout.write(
    `run-benchmark: ${evalSet.queries.length} queries, version=${evalSet.version}, ` +
      `topK=${DEFAULT_EVAL_TOP_K}, repeats=${args.repeats}\n`,
  );

  process.stdout.write('run-benchmark: loading BGE models + indexing fixture…\n');
  const { configs, dispose } = await buildConfigs();
  try {
    const rowsOut: BenchmarkRow[] = [];
    for (const config of configs) {
      // Latency wrapper: record wall-clock per searchFn call across ALL repeat
      // passes (retrieval metrics are deterministic — repeats only widen the
      // latency sample). One untimed warmup pass avoids first-call ONNX warmup
      // skew biasing the tail.
      const latencies: number[] = [];
      const timed: EvalSearchFn = async (query, opts) => {
        const t0 = performance.now();
        const results = await config.searchFn(query, opts);
        latencies.push(performance.now() - t0);
        return results;
      };

      for (const q of evalSet.queries) await config.searchFn(q.query, { topK: DEFAULT_EVAL_TOP_K });

      // strict: true — every eval-set query declares an explicit `page` (same
      // ruling as run-eval.ts: without strict the single-file fixture makes
      // every query a tautological hit).
      let summary = await runEval(evalSet, { searchFn: timed, topK: DEFAULT_EVAL_TOP_K, strict: true });
      for (let r = 1; r < args.repeats; r += 1) {
        summary = await runEval(evalSet, { searchFn: timed, topK: DEFAULT_EVAL_TOP_K, strict: true });
      }

      const row: BenchmarkRow = {
        config: config.name,
        hitRate5: summary.hitRate,
        mrr: Number(summary.mrr.toFixed(4)),
        p50Ms: Number(percentile(latencies, 0.5).toFixed(1)),
        p95Ms: Number(percentile(latencies, 0.95).toFixed(1)),
        latencySamples: latencies.length,
      };
      const agg = aggregationStats(evalSet, summary);
      if (agg) row.aggregation = agg;
      rowsOut.push(row);
      process.stdout.write(
        `run-benchmark: ${config.name.padEnd(18)} hit@5=${row.hitRate5.toFixed(2)} ` +
          `mrr=${row.mrr.toFixed(4)} p50=${row.p50Ms}ms p95=${row.p95Ms}ms (n=${row.latencySamples})\n`,
      );
      // MISS 明细（hard-tier 调优的主要反馈回路）— hitRank undefined = miss。
      for (const q of summary.perQuery) {
        if (q.hitRank === undefined) {
          process.stdout.write(`run-benchmark:   MISS [${q.category ?? '-'}] ${q.query}\n`);
        }
      }
    }

    const artifact = {
      schema: 'ai-edge/retrieval-benchmark@1',
      evalSet: evalSet.version,
      questions: evalSet.queries.length,
      topK: DEFAULT_EVAL_TOP_K,
      repeats: args.repeats,
      ranAt: new Date().toISOString(),
      command: 'pnpm bench:retrieval',
      note: '检索指标确定性计算（strict 页级命中，任一 expected 页进 top-K 即计 hit）；聚合题子集另附 coverage@5（expected 页被捞回的比例，度量「捞得全」）。P95 为本机 wall-clock（含 embedding/rerank 推理），跨机器不可比。回答层指标不在本表——faithfulness judge 未过校准门前不参与配置对比。',
      configs: rowsOut,
    };
    fs.mkdirSync(outDirAbs, { recursive: true });
    const outPath = path.join(outDirAbs, 'benchmark.json');
    fs.writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
    process.stdout.write(`run-benchmark: wrote ${outPath}\n\n`);

    // stdout markdown table for humans / CI logs.
    process.stdout.write(`| 配置 | Hit Rate@${DEFAULT_EVAL_TOP_K} | MRR | P50 | P95 |\n|---|---|---|---|---|\n`);
    for (const row of rowsOut) {
      process.stdout.write(
        `| ${row.config} | ${row.hitRate5.toFixed(2)} | ${row.mrr.toFixed(4)} | ${row.p50Ms}ms | ${row.p95Ms}ms |\n`,
      );
    }

    // Aggregation-subset table — only when the eval set declares the tier.
    // coverage@5 is the "捞得全" metric the any-hit hitRate cannot express.
    if (rowsOut.some((r) => r.aggregation !== undefined)) {
      process.stdout.write(
        `\n聚合题子集（category: ${AGGREGATION_CATEGORY}）\n` +
          `| 配置 | Hit Rate@${DEFAULT_EVAL_TOP_K} | MRR | Coverage@${DEFAULT_EVAL_TOP_K} |\n|---|---|---|---|\n`,
      );
      for (const row of rowsOut) {
        const agg = row.aggregation;
        if (!agg) continue;
        process.stdout.write(
          `| ${row.config} | ${agg.hitRate5.toFixed(2)} | ${agg.mrr.toFixed(4)} | ${agg.coverage5.toFixed(2)} |\n`,
        );
      }
    }
    return 0;
  } finally {
    try {
      dispose();
    } catch (disposeErr) {
      process.stderr.write(
        `run-benchmark: dispose() failed: ${disposeErr instanceof Error ? (disposeErr.stack ?? disposeErr.message) : String(disposeErr)}\n`,
      );
    }
  }
}

// Gate auto-execution so unit tests can import parseArgs without triggering a
// model download — same idiom as bin/run-eval.ts.
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
        `run-benchmark: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      );
      process.exit(2);
    });
}
