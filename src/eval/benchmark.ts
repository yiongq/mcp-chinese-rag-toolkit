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
// Cost model (AD-10 / AD-12): a run costs roughly `evaluatedQueries ×
// metricsPerQuery × configs × varianceSamples` judge calls. Two levers keep that
// affordable and predictable: a COST TIER (`'full'` nightly vs `'smoke'` PR subset,
// reproducibly sampled) shrinks the `evaluatedQueries` factor, and an injected
// `withJudgeCache`-wrapped judge dedupes identical calls (the same answer judged
// under multiple configs is paid once). The estimate below is the UN-CACHED upper
// bound, surfaced on every summary so a run's cost is known before it executes.

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
 * Judge calls a single query can drive — one per RAGAS metric. Used as the
 * `metricsPerQuery` factor of the cost estimate; it is the UPPER bound (a query
 * with no reference answer / no embed function drives fewer), which is the right
 * basis for a worst-case cost prediction.
 */
const JUDGE_CALLS_PER_QUERY = METRIC_KEYS.length;

/** Default smoke-tier subset size when `tier: 'smoke'` is set with no explicit sampling option. */
export const DEFAULT_SMOKE_SAMPLE_SIZE = 5;

/**
 * The un-cached judge-call cost estimate: `evaluatedQueries × metricsPerQuery ×
 * configs × varianceSamples` (AD-12). PURE. `varianceSamples` defaults to 1 (the
 * benchmark judges each input once); a caller modelling a variance sweep passes
 * the repeat count to see the full sweep cost.
 */
export function estimateJudgeCalls(args: {
  evaluatedQueries: number;
  configs: number;
  varianceSamples?: number | undefined;
  metricsPerQuery?: number | undefined;
}): number {
  const variance = args.varianceSamples ?? 1;
  const metrics = args.metricsPerQuery ?? JUDGE_CALLS_PER_QUERY;
  return args.evaluatedQueries * metrics * args.configs * variance;
}

/**
 * Reproducibly sample a query list for the smoke tier — NO RNG, so the same
 * options always select the same queries (a PR signal must be replayable). When
 * `sampleEvery` is set, keep every Nth query (indices 0, N, 2N, …); otherwise keep
 * `sampleSize` queries on a fixed stride across the full order. Returns the list
 * unchanged when the requested subset covers it. PURE.
 */
export function sampleQueries<T>(
  queries: readonly T[],
  opts: { sampleSize?: number | undefined; sampleEvery?: number | undefined },
): T[] {
  // This is a top-level PUBLIC export, so it validates its own precondition rather
  // than trusting the caller-side `validateBenchmarkOptions` (which only runs inside
  // runBenchmark). A non-positive / non-integer `sampleEvery` would otherwise make the
  // `i += sampleEvery` stride below loop forever (0 never advances; a negative step
  // runs backward and stays `< total`). Mirrors the validator's positive-integer rule.
  if (opts.sampleEvery !== undefined && (!Number.isInteger(opts.sampleEvery) || opts.sampleEvery < 1)) {
    throw new Error(
      `sampleQueries: sampleEvery must be a positive integer, got ${String(opts.sampleEvery)}`,
    );
  }
  const total = queries.length;
  if (opts.sampleEvery !== undefined) {
    const out: T[] = [];
    for (let i = 0; i < total; i += opts.sampleEvery) {
      const q = queries[i];
      if (q !== undefined) out.push(q);
    }
    return out;
  }
  const size = opts.sampleSize ?? DEFAULT_SMOKE_SAMPLE_SIZE;
  if (size >= total || size <= 0) return [...queries];
  const stride = total / size;
  const out: T[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < size; i += 1) {
    const idx = Math.min(total - 1, Math.floor(i * stride));
    if (seen.has(idx)) continue;
    seen.add(idx);
    const q = queries[idx];
    if (q !== undefined) out.push(q);
  }
  return out;
}

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

  // Cost tier: 'smoke' evaluates a reproducible subset; 'full' (default) keeps the
  // whole set. The sampling happens ONCE at the entry — the per-config loop below is
  // untouched, so every resilience / metric property is identical to a full run.
  const tier: 'full' | 'smoke' = opts.tier ?? 'full';
  const evaluatedSet: EvalSet =
    tier === 'smoke'
      ? {
          ...evalSet,
          queries: sampleQueries(evalSet.queries, {
            sampleSize: opts.sampleSize,
            sampleEvery: opts.sampleEvery,
          }),
        }
      : evalSet;

  const configs: BenchmarkConfigResult[] = [];
  for (const config of opts.configs) {
    // Retrieval pass: Hit Rate@K / MRR + the per-query top results nDCG needs.
    const retrieval = await runEval(evaluatedSet, {
      searchFn: config.searchFn,
      topK,
      strict: opts.strict ?? false,
    });
    const ndcgMean = meanNdcg(evaluatedSet, retrieval, topK, opts.strict);

    // Answer-eval pass: the five RAGAS metrics + reproducible version metadata.
    // Per-config generation override: a configuration that generates answers
    // differently (different model, different orchestration) brings its own
    // generateFn/generateModel pair; everything else falls back to the shared
    // run-level pair. The per-config `answer.versionMeta` is stamped from the
    // RESOLVED pair, so each row's metadata is honest on its own.
    // Optional fields are attached only when present (exactOptionalPropertyTypes).
    const answerOpts: AnswerEvalOptions = {
      searchFn: config.searchFn,
      generateFn: config.generateFn ?? opts.generateFn,
      judgeFn: opts.judgeFn,
      topK,
      generateModel: config.generateModel ?? opts.generateModel,
      judgeModel: opts.judgeModel,
    };
    if (opts.embedFn !== undefined) answerOpts.embedFn = opts.embedFn;
    if (opts.judgeTimeoutMs !== undefined) answerOpts.judgeTimeoutMs = opts.judgeTimeoutMs;
    const answer = await runAnswerEval(evaluatedSet, answerOpts);

    configs.push({
      name: config.name,
      retrieval,
      ndcg: ndcgMean,
      answer,
      answerMeans: aggregateAnswerMeans(answer.perQuery),
    });
  }

  // Summary-level version metadata. The judge / toolkit / eval-spec fields are
  // identical across configurations by construction (single judgeFn / judge
  // model / toolkit / eval set per run), so they are pinned from the first
  // config rather than re-assembled — re-assembling would reintroduce the
  // hardcoding risk the answer-eval orchestrator already eliminated. The
  // generation model may now differ per configuration: when it does, the
  // summary field becomes an explicit `name=model; name=model` aggregate
  // (never silently the first config's model — that would misattribute every
  // other configuration's answers in the audit trail).
  const first = configs[0];
  if (first === undefined) {
    // Unreachable: validateBenchmarkOptions guarantees a non-empty configs array,
    // but noUncheckedIndexedAccess types the read as possibly-undefined.
    throw new Error('runBenchmark: internal invariant violated — no configuration results');
  }
  const generateModels = configs.map((c) => c.answer.versionMeta.generateModel);
  const versionMeta =
    new Set(generateModels).size <= 1
      ? first.answer.versionMeta
      : {
          ...first.answer.versionMeta,
          generateModel: configs
            .map((c) => `${c.name}=${c.answer.versionMeta.generateModel}`)
            .join('; '),
        };

  const evaluatedQueries = evaluatedSet.queries.length;
  return {
    evalSpecVersion: evalSet.version,
    timestamp: new Date().toISOString(),
    topK,
    versionMeta,
    tier,
    evaluatedQueries,
    estimatedJudgeCalls: estimateJudgeCalls({
      evaluatedQueries,
      configs: opts.configs.length,
      varianceSamples: opts.varianceSamples,
    }),
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
    // Per-config generation overrides get the same posture as their run-level
    // counterparts below: a function when provided, a non-empty model name.
    if (config.generateFn !== undefined && typeof config.generateFn !== 'function') {
      throw new Error(`runBenchmark: opts.configs[${i}].generateFn must be a function when provided`);
    }
    if (
      config.generateModel !== undefined &&
      (typeof config.generateModel !== 'string' || config.generateModel.trim() === '')
    ) {
      throw new Error(
        `runBenchmark: opts.configs[${i}].generateModel must be a non-empty string when provided`,
      );
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
  if (opts.tier !== undefined && opts.tier !== 'full' && opts.tier !== 'smoke') {
    throw new Error(`runBenchmark: opts.tier must be 'full' or 'smoke', got ${String(opts.tier)}`);
  }
  // Smoke-sampling and variance-sample counts feed query selection / the cost
  // estimate, so a non-positive-integer would silently corrupt either — fail loudly.
  for (const [k, v] of [
    ['sampleSize', opts.sampleSize],
    ['sampleEvery', opts.sampleEvery],
    ['varianceSamples', opts.varianceSamples],
  ] as const) {
    if (v !== undefined && (!Number.isInteger(v) || v < 1)) {
      throw new Error(`runBenchmark: opts.${k} must be a positive integer, got ${String(v)}`);
    }
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
  // Caller-provided strings are rendered inside inline-code spans, so they get
  // the same escaping discipline as the table cells (a stray backtick would
  // otherwise close the span early).
  const meta = summary.versionMeta;
  lines.push(`- **Eval set version**: \`${escapeInlineCode(summary.evalSpecVersion)}\``);
  lines.push(`- **Timestamp (UTC)**: ${summary.timestamp}`);
  lines.push(`- **Top-K**: ${k}`);
  lines.push(`- **Configs compared**: ${summary.configs.length}`);
  lines.push(`- **Cost tier**: ${summary.tier}`);
  lines.push(`- **Queries evaluated**: ${summary.evaluatedQueries}`);
  lines.push(
    `- **Estimated judge calls** (un-cached upper bound): ${summary.estimatedJudgeCalls}`,
  );
  // Generation model: a single line when every configuration resolved to the
  // same model; one line PER configuration when they differ — the reader must
  // see which row's answers came from which generation path, never a single
  // model name silently standing in for all of them.
  const generationModels = summary.configs.map((c) => c.answer.versionMeta.generateModel);
  if (new Set(generationModels).size <= 1) {
    lines.push(`- **Generation model**: \`${escapeInlineCode(meta.generateModel)}\``);
  } else {
    lines.push('- **Generation model**: per configuration —');
    for (const config of summary.configs) {
      lines.push(
        `  - \`${escapeInlineCode(config.name)}\`: \`${escapeInlineCode(config.answer.versionMeta.generateModel)}\``,
      );
    }
  }
  lines.push(`- **Judge model**: \`${escapeInlineCode(meta.judgeModel)}\``);
  lines.push(`- **Judge prompt version**: \`${escapeInlineCode(meta.judgePromptVersion)}\``);
  lines.push(`- **Toolkit version**: \`${escapeInlineCode(meta.toolkitVersion)}\``);
  lines.push('');

  return lines.join('\n');
}

/** Render an aggregated metric mean, or `n/a` when the metric was never measured. */
function meanCell(value: number | undefined): string {
  return value === undefined ? 'n/a' : value.toFixed(4);
}

/**
 * Escape a value rendered inside an inline-code span (`` `...` ``): a backtick
 * would close the span early and a line break would split the bullet across
 * lines, so both are neutralized. Keeps the metadata block's escaping policy
 * consistent with {@link escapeCell}.
 */
function escapeInlineCode(s: string): string {
  return s.replace(/`/g, '\\`').replace(/[\r\n]+/g, ' ');
}

/**
 * Minimal markdown-table-cell escaping for a configuration name. `|` (the column
 * separator) and any line break (`\r` / `\n`, the row terminators) corrupt the
 * row STRUCTURE; a backtick is escaped too so a name never opens an unintended
 * inline-code span. The backslash is escaped FIRST so a later `|`→`\|` rewrite
 * cannot be re-merged into a corrupting `\\|` sequence (which GFM reads as a
 * literal backslash followed by an UNescaped column separator). Inlined here to
 * keep the change local; the report renderer applies the same idea.
 */
function escapeCell(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/`/g, '\\`')
    .replace(/[\r\n]+/g, ' ');
}
