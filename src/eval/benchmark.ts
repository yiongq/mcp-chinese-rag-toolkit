// ---------------------------------------------------------------------------
// — Multi-config comparison (run one eval set through many retrieval configs)
// ---------------------------------------------------------------------------
//
// `runBenchmark` runs the SAME eval set through several caller-supplied retrieval
// configurations and lays the per-config scores out as one readable comparison
// table, so a reviewer can see at a glance which retrieval setup wins — and
// whether a change is a gain or a regression — on both retrieval quality (Hit
// Rate@K / MRR / nDCG@K) and answer quality (the five RAGAS metrics). It is an
// ORCHESTRATOR only: it reuses the retrieval runner, the answer-eval orchestrator
// and the ranking-gain metric, and reimplements none of their formulas.
//
// Provider-agnostic by design: the toolkit knows nothing about HOW a retrieval
// configuration is built (reranking, lexical vs vector, tokenizer choices). Each
// configuration arrives as a pre-wired `searchFn`; this module only iterates over
// them. Named variants ("full stack", "no rerank", …) live in the caller, never
// hardcoded here.
//
// Known trade-off — double retrieval: the retrieval runner and the answer-eval
// orchestrator each call a configuration's `searchFn` once (two retrieval passes
// per configuration). This run ACCEPTS that redundancy to maximize reuse rather
// than refactor either entry point to share a single retrieval pass — both a mock
// and a real retriever are idempotent, and an offline comparison can afford it.
//
// Cost note (documentation only): a run costs roughly
// `queries × metrics × configs` judge calls. Caching, concurrency limiting and
// variance sampling are deliberately out of scope here.

import { runAnswerEval } from './answer-eval.js';
import { DEFAULT_EVAL_TOP_K, expectedMatches, ndcg, runEval } from './eval-runner.js';
import type {
  AnswerEvalMetrics,
  AnswerEvalOptions,
  AnswerEvalQueryResult,
  BenchmarkConfigResult,
  BenchmarkOptions,
  BenchmarkSummary,
  EvalSet,
  EvalSummary,
} from './types.js';

/** The five RAGAS metric keys, in a fixed order so aggregation is deterministic. */
const METRIC_KEYS: ReadonlyArray<keyof AnswerEvalMetrics> = [
  'faithfulness',
  'answerRelevance',
  'contextPrecision',
  'answerCorrectness',
  'contextRecall',
];

/**
 * Run an eval set through every retrieval configuration and aggregate the results
 * into one comparison summary. For each configuration it scores retrieval (Hit
 * Rate@K / MRR via the retrieval runner, plus a derived mean nDCG@K) and answer
 * quality (the five RAGAS metrics via the answer-eval orchestrator), then keeps
 * the full sub-results alongside the per-config aggregates.
 *
 * Resilience is inherited, not re-added: the retrieval runner and the answer-eval
 * orchestrator already record a per-query fault and keep going, so a single bad
 * query never collapses a configuration's run. An errored query counts as a miss
 * in retrieval, is recorded as an error in answer eval, and contributes a zero
 * ranking gain — consistent with how Hit Rate / MRR already treat it.
 *
 * @throws when the options are invalid (an empty or name-colliding `configs`
 *   array, a non-function injection, a blank model name, or a non-positive
 *   `topK`) — a caller bug worth failing loudly on before doing any work.
 */
export async function runBenchmark(
  evalSet: EvalSet,
  opts: BenchmarkOptions,
): Promise<BenchmarkSummary> {
  const topK = opts.topK ?? DEFAULT_EVAL_TOP_K;
  validateBenchmarkOptions(opts, topK);

  const configs: BenchmarkConfigResult[] = [];
  for (const config of opts.configs) {
    // Retrieval pass: Hit Rate@K / MRR + the per-query top results nDCG needs.
    const retrieval = await runEval(evalSet, {
      searchFn: config.searchFn,
      topK,
      strict: opts.strict ?? false,
    });
    const ndcgMean = meanNdcg(evalSet, retrieval, topK, opts.strict);

    // Answer-eval pass: the five RAGAS metrics + reproducible version metadata.
    // Optional fields are attached only when present (exactOptionalPropertyTypes).
    const answerOpts: AnswerEvalOptions = {
      searchFn: config.searchFn,
      generateFn: opts.generateFn,
      judgeFn: opts.judgeFn,
      topK,
      generateModel: opts.generateModel,
      judgeModel: opts.judgeModel,
    };
    if (opts.embedFn !== undefined) answerOpts.embedFn = opts.embedFn;
    if (opts.judgeTimeoutMs !== undefined) answerOpts.judgeTimeoutMs = opts.judgeTimeoutMs;
    const answer = await runAnswerEval(evalSet, answerOpts);

    configs.push({
      name: config.name,
      retrieval,
      ndcg: ndcgMean,
      answer,
      answerMeans: aggregateAnswerMeans(answer.perQuery),
    });
  }

  // Version metadata is identical across configurations (same models, toolkit,
  // judge prompt and eval spec), so it is pinned once from the first config rather
  // than re-assembled here — re-assembling would reintroduce the hardcoding risk
  // the answer-eval orchestrator already eliminated.
  const first = configs[0];
  if (first === undefined) {
    // Unreachable: validateBenchmarkOptions guarantees a non-empty configs array,
    // but noUncheckedIndexedAccess types the read as possibly-undefined.
    throw new Error('runBenchmark: internal invariant violated — no configuration results');
  }

  return {
    evalSpecVersion: evalSet.version,
    timestamp: new Date().toISOString(),
    topK,
    versionMeta: first.answer.versionMeta,
    configs,
  };
}

/** Fail loudly on a caller mistake before doing any work (mirrors `runAnswerEval`). */
function validateBenchmarkOptions(opts: BenchmarkOptions, topK: number): void {
  if (!Array.isArray(opts.configs) || opts.configs.length === 0) {
    throw new Error('runBenchmark: opts.configs must be a non-empty array');
  }
  const seenNames = new Set<string>();
  for (let i = 0; i < opts.configs.length; i += 1) {
    const config = opts.configs[i];
    if (config === null || typeof config !== 'object') {
      throw new Error(`runBenchmark: opts.configs[${i}] must be a { name, searchFn } object`);
    }
    if (typeof config.name !== 'string' || config.name.trim() === '') {
      throw new Error(`runBenchmark: opts.configs[${i}].name must be a non-empty string`);
    }
    if (seenNames.has(config.name)) {
      throw new Error(
        `runBenchmark: duplicate config name "${config.name}" — names must be unique so each table row is unambiguous`,
      );
    }
    seenNames.add(config.name);
    if (typeof config.searchFn !== 'function') {
      throw new Error(`runBenchmark: opts.configs[${i}].searchFn must be a function`);
    }
  }
  if (typeof opts.generateFn !== 'function') {
    throw new Error('runBenchmark: opts.generateFn must be a function');
  }
  if (typeof opts.judgeFn !== 'function') {
    throw new Error('runBenchmark: opts.judgeFn must be a function');
  }
  if (opts.embedFn !== undefined && typeof opts.embedFn !== 'function') {
    throw new Error('runBenchmark: opts.embedFn must be a function when provided');
  }
  // A blank model name would silently poison the audit trail (same reasoning as
  // the answer-eval orchestrator).
  if (typeof opts.generateModel !== 'string' || opts.generateModel.trim() === '') {
    throw new Error('runBenchmark: opts.generateModel must be a non-empty string');
  }
  if (typeof opts.judgeModel !== 'string' || opts.judgeModel.trim() === '') {
    throw new Error('runBenchmark: opts.judgeModel must be a non-empty string');
  }
  if (!Number.isInteger(topK) || topK < 1) {
    throw new Error(`runBenchmark: topK must be a positive integer, got ${String(topK)}`);
  }
}

/**
 * Mean nDCG@K across the eval set, derived from the existing BINARY expected-hit
 * labels: each top-K position scores gain `1` when it matches one of the query's
 * expected hits (via the shared {@link expectedMatches} rule) and `0` otherwise.
 * Even on binary gains nDCG is meaningful — it rewards ranking a hit HIGHER,
 * which Hit Rate@K (position-blind) and MRR (first-hit-only) do not capture.
 *
 * Pure: no I/O, no model or embed calls. An empty eval set scores `0`. A graded
 * (non-binary) gain source is a future, purely-additive extension point and is
 * deliberately not wired here.
 */
export function meanNdcg(
  evalSet: EvalSet,
  retrieval: EvalSummary,
  topK: number,
  strict?: boolean,
): number {
  const { queries } = evalSet;
  const rows = retrieval.perQuery;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < queries.length; i += 1) {
    const query = queries[i];
    const row = rows[i];
    // noUncheckedIndexedAccess: both reads are `T | undefined`. The runner emits
    // one row per query, so a gap should not happen — guard rather than assert.
    if (query === undefined || row === undefined) continue;
    const gains = row.topResults.map((result) => (expectedMatches(query, result, strict) ? 1 : 0));
    sum += ndcg(gains, { k: topK }).score;
    count += 1;
  }
  return count === 0 ? 0 : sum / count;
}

/**
 * Mean of each answer metric across the per-query rows. A metric is included only
 * when it actually appeared on at least one row; a metric that was skipped on
 * every query (e.g. answer relevance with no embed function, or the
 * reference-based pair with no reference answers) is OMITTED from the result
 * rather than recorded as `0` or `undefined`, so a reviewer never mistakes
 * "not measured" for "scored zero".
 *
 * Pure: no I/O, no model or embed calls.
 */
export function aggregateAnswerMeans(
  perQuery: readonly AnswerEvalQueryResult[],
): Partial<Record<keyof AnswerEvalMetrics, number>> {
  const means: Partial<Record<keyof AnswerEvalMetrics, number>> = {};
  for (const key of METRIC_KEYS) {
    let sum = 0;
    let count = 0;
    for (const row of perQuery) {
      const metric = row.metrics[key];
      if (metric !== undefined) {
        sum += metric.score;
        count += 1;
      }
    }
    if (count > 0) means[key] = sum / count;
  }
  return means;
}

/**
 * Render a {@link BenchmarkSummary} as a GitHub-flavoured markdown comparison
 * table — one row per configuration, columns for the retrieval metrics
 * (Hit Rate@K / MRR / nDCG@K) and each of the five RAGAS metrics. Output is
 * DETERMINISTIC: the same summary renders byte-for-byte identically (the only
 * non-deterministic value, the timestamp, is pinned into the summary upstream).
 *
 * An answer metric that was never measured renders as `n/a` (never `0`). There is
 * deliberately no aggregate "overall" column — the metrics measure different
 * things on different scales, so a single blended score would mislead.
 */
export function renderBenchmarkTable(summary: BenchmarkSummary): string {
  const k = summary.topK;
  const lines: string[] = [];
  lines.push('# Benchmark Comparison');
  lines.push('');
  lines.push(
    `| Config | Hit Rate@${k} | MRR | nDCG@${k} | Faithfulness | Answer Relevance | Context Precision | Answer Correctness | Context Recall |`,
  );
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const config of summary.configs) {
    const cells = [
      escapeCell(config.name),
      `${(config.retrieval.hitRate * 100).toFixed(2)}%`,
      config.retrieval.mrr.toFixed(4),
      config.ndcg.toFixed(4),
      meanCell(config.answerMeans.faithfulness),
      meanCell(config.answerMeans.answerRelevance),
      meanCell(config.answerMeans.contextPrecision),
      meanCell(config.answerMeans.answerCorrectness),
      meanCell(config.answerMeans.contextRecall),
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }
  lines.push('');

  // Metadata block so the table carries its own cross-run comparison context.
  const meta = summary.versionMeta;
  lines.push(`- **Eval set version**: \`${summary.evalSpecVersion}\``);
  lines.push(`- **Timestamp (UTC)**: ${summary.timestamp}`);
  lines.push(`- **Top-K**: ${k}`);
  lines.push(`- **Configs compared**: ${summary.configs.length}`);
  lines.push(`- **Generation model**: \`${meta.generateModel}\``);
  lines.push(`- **Judge model**: \`${meta.judgeModel}\``);
  lines.push(`- **Judge prompt version**: \`${meta.judgePromptVersion}\``);
  lines.push(`- **Toolkit version**: \`${meta.toolkitVersion}\``);
  lines.push('');

  return lines.join('\n');
}

/** Render an aggregated metric mean, or `n/a` when the metric was never measured. */
function meanCell(value: number | undefined): string {
  return value === undefined ? 'n/a' : value.toFixed(4);
}

/**
 * Minimal markdown-table-cell escaping for a configuration name — the three
 * characters that would otherwise corrupt a row: `|` (column separator), a
 * backtick (code-span opener) and a newline (row terminator). Inlined here to
 * keep the change local; the report renderer applies the same escaping.
 */
function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/`/g, '\\`').replace(/\n/g, ' ');
}
