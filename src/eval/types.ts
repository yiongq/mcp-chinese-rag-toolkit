// ---------------------------------------------------------------------------
// — Eval Framework + RAG Eval CI Gate types
// ---------------------------------------------------------------------------

// `import type` is erased at compile time (verbatimModuleSyntax), so referencing
// the error core here introduces no runtime import cycle with `errors.ts`.
import type { EvalErrorCore } from './errors.js';

/**
 * Result row returned by an evaluatable `searchFn`. Field naming mirrors
 * `HybridHit` / `RerankedHit` (camelCase wire convention). All metric fields
 * are optional — toolkit eval
 * reports `'n/a'` when missing, never throws (callers may simplify and only
 * supply `rerankScore`).
 */
export interface EvalSearchResult {
  /** Document source identifier (e.g. `'bench-fixture.md'`). REQUIRED. */
  source: string;
  /** 1-indexed page number (mirrors PdfPage / Citation convention). */
  page?: number;
  /** Markdown heading path. */
  section?: string;
  /** Chunk content (informational; not used for Hit Rate scoring). */
  content?: string;
  /** bge-reranker-v2-m3 sigmoid score ∈ [0, 1]; populated by reranker. */
  rerankScore?: number;
  /** sqlite-vec L2 distance; populated by hybrid search vec branch. */
  distance?: number;
  /** FTS5 BM25 rank (1-indexed); populated by hybrid search FTS branch. */
  ftsRank?: number;
}

/**
 * A `searchFn` evaluated by `runEval`. Mirrors `RerankFn` /
 * `HybridSearchFn` provider-injection patterns — toolkit eval does
 * NOT bind to any specific MCP tool; a downstream consumer package or
 * third-party each wire their own.
 */
export type EvalSearchFn = (query: string, opts?: { topK?: number }) => Promise<EvalSearchResult[]>;

/**
 * Expected hit declaration — `source` is REQUIRED, `page` is optional (when
 * present and `strict: true` is passed to runEval, requires exact page match).
 */
export interface EvalExpected {
  source: string;
  page?: number;
}

/**
 * One row of an eval set, declared in YAML. Order of fields in YAML is
 * preserved by `yaml@^2` parse and used by `report.md` deterministic output.
 */
export interface EvalQuery {
  /** Free-form Chinese query, e.g. `'试用期多久'`. */
  query: string;
  /**
   * ≥ 1 expected hit (OR semantics — any match scores hit). Toolkit validates
   * non-empty at load time and throws an actionable error.
   */
  expected: EvalExpected[];
  /**
   * kebab-case category, e.g. `'engine-routing'`,
   * `'hooks'`, `'leave-policy'`. Used by report.md aggregation.
   */
  category?: string;
  /**
   * Author-supplied YAML comment captured as `# reason: ...` (AI Agent
   * Rule #9). Toolkit extracts and surfaces in report.md when CI fails.
   * Inline `reason:` YAML field takes precedence over the comment fallback.
   */
  reason?: string;
  /**
   * Optional gold reference answer for this query. Reference-based answer
   * metrics (e.g. answer correctness / context recall) consume it; retrieval
   * scoring and reference-free metrics ignore it entirely. Adding it is purely
   * additive — existing eval sets and callers that never set it are unaffected.
   */
  referenceAnswer?: string;
}

/** Top-level eval-set.yml document shape. */
export interface EvalSet {
  /**
   * Eval set version string (free-form, e.g. `'v1-hr-mini'`). Used for
   * cross-run report comparison; toolkit does NOT enforce semver.
   */
  version: string;
  /** Optional metadata for report header. */
  description?: string;
  /** ≥ 1 queries; toolkit validates at load time. */
  queries: EvalQuery[];
}

/** Per-query result row, captured in summary.json / per-query.json. */
export interface EvalQueryResult {
  query: string;
  category?: string;
  reason?: string;
  /** First expected hit position in top-K (1-indexed). undefined = miss. */
  hitRank?: number;
  /** Top-K results returned by searchFn — verbatim copy for debugging. */
  topResults: EvalSearchResult[];
  /** Reciprocal Rank ∈ [0, 1] for this query (1/hitRank or 0). */
  reciprocalRank: number;
  /**
   * Error message captured when `searchFn` threw or returned an invalid shape
   * for this query. Present only on failure; the query counts as MISS for Hit
   * Rate / MRR purposes. Keeps the eval running ( — partial artifact still
   * uploaded so CI reviewer can see WHICH query crashed without losing the rest).
   */
  error?: string;
}

/** Aggregate eval-set summary, written to summary.json. */
export interface EvalSummary {
  /** Eval set version (echoed from EvalSet.version). */
  evalSetVersion: string;
  /** When the eval ran (ISO 8601 UTC). */
  timestamp: string;
  /** Total queries evaluated. */
  totalQueries: number;
  /** TopK used for Hit Rate@K computation. */
  topK: number;
  /** hits / totalQueries ∈ [0, 1]. */
  hitRate: number;
  /** Mean Reciprocal Rank ∈ [0, 1]. */
  mrr: number;
  /** Per-query breakdown (also serialized separately as per-query.json). */
  perQuery: EvalQueryResult[];
  /**
   * Aggregate hitRate broken down by category. Present only when at least one
   * query in the eval set declares a `category`; absent (not empty object)
   * otherwise so reviewers do not confuse missing aggregation for zero hits.
   */
  hitRateByCategory?: Record<string, { hitRate: number; total: number; hits: number }>;
}

/** Options for `runEval()`. */
export interface EvalRunnerOptions {
  /**
   * Search function under evaluation. Caller injects (a downstream consumer
   * package or third-party each wire their own).
   */
  searchFn: EvalSearchFn;
  /** Top-K for both Hit Rate@K and MRR@K. @default 5. */
  topK?: number;
  /**
   * When true, `expected.page` (if present) must EXACTLY match a top-K
   * result.page. When false (default), only source match counts.
   */
  strict?: boolean;
}

// ---------------------------------------------------------------------------
// — Reference-free answer-quality scoring (deterministic, model-agnostic)
// ---------------------------------------------------------------------------
//
// The functions in `judges.ts` score answer quality WITHOUT a gold reference,
// using the RAGAS metric family (faithfulness / answer relevance / context
// precision). They are deliberately split from the model-facing extraction
// step: an upstream caller uses a language model to break an answer into atomic
// claims, generate reverse questions, and judge chunk usefulness; it also
// injects an embedding function to vectorize text. The types below are the
// hand-off contract — the already-extracted, structured inputs those scoring
// functions consume. This keeps the scoring layer pure math: no model calls, no
// embedding calls, no I/O, same input → same output.

/**
 * One atomic claim extracted from a generated answer, paired with whether the
 * retrieved context supports it. The boolean is decided upstream (by a language
 * model or a human); {@link faithfulness} only aggregates it.
 */
export interface ClaimVerdict {
  /** The atomic claim text (informational; aids auditing, not used in scoring). */
  claim: string;
  /** `true` when the retrieved context supports this claim. */
  supported: boolean;
}

/**
 * Result of {@link faithfulness}. `score` is the supported fraction; the raw
 * counts are returned alongside so a reviewer can audit how the score was
 * reached.
 */
export interface FaithfulnessResult {
  /** Supported fraction ∈ [0, 1]; `0` when there are no claims (see docs). */
  score: number;
  /** Number of claims marked `supported`. */
  supportedClaims: number;
  /** Total number of claims considered. */
  totalClaims: number;
}

/**
 * Input to {@link answerRelevance}. The original query and the reverse
 * questions (generated upstream from the answer) are supplied as embeddings —
 * vectorization happens in the caller, not here. Embeddings are NOT assumed to
 * be unit-normalized.
 */
export interface AnswerRelevanceInput {
  /** Embedding of the original user query. */
  queryEmbedding: readonly number[];
  /** Embeddings of the reverse questions generated from the answer. */
  generatedQuestionEmbeddings: ReadonlyArray<readonly number[]>;
}

/**
 * Result of {@link answerRelevance}. `score` is the mean cosine similarity; the
 * per-question values are returned so a reviewer can see which reverse question
 * drove the score.
 */
export interface AnswerRelevanceResult {
  /** Mean cosine similarity ∈ [-1, 1]; `0` when there are no reverse questions. */
  score: number;
  /**
   * Cosine similarity of each reverse question against the query, in input
   * order. Length equals `generatedQuestionEmbeddings.length`.
   */
  perQuestionSimilarity: number[];
}

/**
 * Result of {@link contextPrecision}. `score` is the order-sensitive average
 * precision; the useful/total counts are returned for auditing.
 */
export interface ContextPrecisionResult {
  /** Order-sensitive average precision ∈ [0, 1]; `0` when degenerate (see docs). */
  score: number;
  /** Number of retrieved chunks flagged useful. */
  usefulCount: number;
  /** Total number of retrieved chunks considered. */
  total: number;
}

// ---------------------------------------------------------------------------
// — Reference-based answer-quality scoring + ranking gain (deterministic)
// ---------------------------------------------------------------------------
//
// These contracts feed the scoring functions that DO compare an answer against
// a gold reference (answer correctness, context recall) plus a graded-relevance
// ranking metric (nDCG). As with the reference-free family, the language-model
// step that classifies each answer statement, judges whether each reference
// sentence is attributable to the retrieved context, or assigns a graded
// relevance label happens upstream in the caller; the scoring functions consume
// these already-extracted, structured inputs and stay pure math (no model
// calls, no embedding calls, no I/O, same input → same output).

/**
 * Classification of a single answer statement against the gold reference, as
 * decided upstream by a language model or a human:
 *  - `'TP'` (true positive): present in both the answer and the reference.
 *  - `'FP'` (false positive): present in the answer but not the reference.
 *  - `'FN'` (false negative): present in the reference but missing from the answer.
 */
export type CorrectnessLabel = 'TP' | 'FP' | 'FN';

/**
 * One classified statement consumed by {@link answerCorrectness}: the statement
 * text (informational, aids auditing) paired with its TP/FP/FN classification.
 */
export interface AnswerCorrectnessStatement {
  /** The statement text (informational; aids auditing, not used in scoring). */
  statement: string;
  /** Whether this statement is a true / false positive or a false negative. */
  label: CorrectnessLabel;
}

/**
 * Result of {@link answerCorrectness}. `score` is the statement-level F1; the
 * precision/recall and raw TP/FP/FN counts are returned alongside so a reviewer
 * can audit exactly how the score was reached.
 */
export interface AnswerCorrectnessResult {
  /** Statement-level F1 ∈ [0, 1]; `0` when there are no true positives. */
  score: number;
  /** `tp / (tp + fp)` ∈ [0, 1]; `0` when there are no positives. */
  precision: number;
  /** `tp / (tp + fn)` ∈ [0, 1]; `0` when there is nothing to recall. */
  recall: number;
  /** Statements present in both the answer and the reference. */
  truePositives: number;
  /** Statements present in the answer but not the reference. */
  falsePositives: number;
  /** Statements present in the reference but missing from the answer. */
  falseNegatives: number;
}

/**
 * Result of {@link contextRecall}. `score` is the attributed fraction; the
 * attributed/total sentence counts are returned for auditing.
 */
export interface ContextRecallResult {
  /** Attributed fraction ∈ [0, 1]; `0` when there are no sentences. */
  score: number;
  /** Number of reference sentences attributable to the retrieved context. */
  attributedSentences: number;
  /** Total number of reference sentences considered. */
  totalSentences: number;
}

/**
 * Result of {@link ndcg}. `score` is the normalized discounted cumulative gain;
 * the raw `dcg` / `idcg` and the effective cutoff `k` are returned so a reviewer
 * can audit the normalization.
 */
export interface NdcgResult {
  /** Normalized DCG ∈ [0, 1]; `0` when the ideal gain is `0` (empty / all-zero). */
  score: number;
  /** Discounted cumulative gain of the provided ranking, truncated at `k`. */
  dcg: number;
  /** Discounted cumulative gain of the ideal (descending) ranking, truncated at `k`. */
  idcg: number;
  /** Effective rank cutoff used: the requested `k`, or the list length by default. */
  k: number;
}

// ---------------------------------------------------------------------------
// — LLM-facing judge layer (impure boundary: prompt → call → parse → degrade)
// ---------------------------------------------------------------------------
//
// The functions in `llm-judge.ts` are the impure counterpart to the pure
// scoring layer above: they build a prompt, call an injected judge, and parse
// the model's text into the already-structured inputs the scoring functions
// consume (claim verdicts, reverse questions, useful/attribution flags,
// classified statements). Isolating the model's non-determinism and malformed
// output in this thin, mockable layer is what keeps the scoring layer pure.
// The contracts below are that layer's hand-off surface, shared with the
// orchestration step that wires a real judge (or a deterministic mock in CI).

/**
 * A judge function: takes a fully-constructed prompt, returns the model's raw
 * text response. Provider-agnostic, PURE eval semantics — the signature carries
 * no business / envelope fields. The caller wires a real language model (or a
 * deterministic mock in CI) behind this single string-in / string-out shape.
 */
export type JudgeFn = (prompt: string) => Promise<string>;

/** Options for a judge call. */
export interface JudgeCallOptions {
  /**
   * Wall-clock budget in ms before the call degrades to a timeout. Must be a
   * finite, positive number; any other value (`0`, negative, `NaN`, `Infinity`)
   * falls back to the default rather than producing a spurious instant timeout.
   * There is no sentinel to disable the timeout — omit this to use the default.
   * @default DEFAULT_JUDGE_TIMEOUT_MS
   */
  timeoutMs?: number;
}

/**
 * Outcome of a judge call: either a parsed value, or a DEGRADE carrying the lean
 * error core. A malformed judge output or a timeout degrades here — the call
 * never throws for those two conditions (a non-timeout rejection from the judge
 * itself still propagates; that is an infrastructure fault, not a judge-output
 * fault). `value` only ever holds the structured input the scoring layer
 * consumes — never citations or confidence.
 */
export type JudgeOutcome<T> = { ok: true; value: T } | { ok: false; error: EvalErrorCore };

// ---------------------------------------------------------------------------
// — Answer-eval orchestration layer (wires retrieval → generation → judge → score)
// ---------------------------------------------------------------------------
//
// The orchestration entry point runs a whole answer-quality evaluation for a set
// of queries: it retrieves context, generates an answer from that context, drives
// the judge tasks, feeds their structured output to the pure scoring functions,
// and stamps the run with reproducible version metadata. The contracts below are
// its injection surface and result shape. Like the judge signature, the injected
// functions carry PURE eval semantics — no business / transport fields.

/**
 * Generate an answer from a query and its retrieved context. Provider-agnostic,
 * PURE eval semantics — the signature carries no business / transport fields. The
 * caller wires a real language model behind this single shape, or a deterministic
 * mock in CI.
 */
export type GenerateFn = (input: { query: string; context: string }) => Promise<string>;

/**
 * Embed a batch of texts into vectors, one row per input in the same order.
 * Optional in the orchestrator — only answer relevance needs it. Mirrors the
 * toolkit embedder's batch shape; PURE eval semantics, no business fields.
 */
export type EmbedFn = (texts: readonly string[]) => Promise<number[][]>;

/**
 * Reproducible version metadata stamped onto every answer-eval run so scores stay
 * comparable and auditable across time and configurations. Each field has a
 * distinct provenance (see field docs); none may be hardcoded by the toolkit.
 */
export interface AnswerEvalVersionMeta {
  /** Generation model name — caller-injected (NEVER hardcoded in the toolkit). */
  generateModel: string;
  /** Judge model name — caller-injected (NEVER hardcoded in the toolkit). */
  judgeModel: string;
  /** Judge prompt version — the toolkit's own JUDGE_PROMPT_VERSION at run time. */
  judgePromptVersion: string;
  /** Toolkit package version, read from package.json (provenance, auditable). */
  toolkitVersion: string;
  /** Eval-set version — echoed from EvalSet.version. */
  evalSpecVersion: string;
}

/**
 * The five RAGAS metric results for one query. Each is OPTIONAL because a metric
 * is skipped (never faked) when its inputs are unavailable: the reference-based
 * pair when the query has no reference answer, and answer relevance when no embed
 * function is injected or its judge step degrades. A skipped metric is absent here
 * and explained in {@link AnswerEvalQueryResult.skipped}.
 */
export interface AnswerEvalMetrics {
  /** Reference-free: fraction of the answer's claims the context supports. */
  faithfulness?: FaithfulnessResult;
  /** Reference-free: how well the answer addresses the query (needs an embed fn). */
  answerRelevance?: AnswerRelevanceResult;
  /** Reference-free: order-sensitive precision of the retrieved context. */
  contextPrecision?: ContextPrecisionResult;
  /** Reference-based: statement-level F1 against the reference answer. */
  answerCorrectness?: AnswerCorrectnessResult;
  /** Reference-based: fraction of reference sentences the context accounts for. */
  contextRecall?: ContextRecallResult;
}

/**
 * Per-query result row. Mirrors the resilience of the retrieval runner: a fault
 * fatal to THIS query (a throwing search/generate function, a missing chunk, or a
 * judge infrastructure rejection) is recorded in {@link error} and the run keeps
 * going, so a reviewer can see WHICH query failed at WHICH step without losing the
 * rest of the run.
 */
export interface AnswerEvalQueryResult {
  /** The query under evaluation. */
  query: string;
  /** Optional kebab-case category echoed from the eval query. */
  category?: string;
  /** The generated answer under evaluation (verbatim, for auditing). */
  answer?: string;
  /** The computed metrics; a skipped metric is absent (see {@link skipped}). */
  metrics: AnswerEvalMetrics;
  /**
   * Per-metric skip / degrade notes, keyed by metric name → reason. A reference
   * metric with no reference answer reads `NO_REFERENCE_ANSWER`; answer relevance
   * with no embed function reads `NO_EMBED_FN`; a degraded judge call records its
   * stable degrade code. Absent when nothing was skipped.
   */
  skipped?: Record<string, string>;
  /**
   * Fatal-for-this-query error; the query is still recorded. Absent on success.
   * May coexist with populated {@link metrics}: a fault that surfaces partway
   * through a query (e.g. a judge infrastructure rejection on a reference-based
   * metric) is recorded here even though earlier reference-free metrics already
   * scored. Treat any metric that IS present as authoritative regardless of
   * `error` — `error` marks the query as incomplete, not the metrics already
   * computed as invalid.
   */
  error?: string;
}

/**
 * Aggregate result of an answer-eval run, returned by `runAnswerEval`. The five
 * RAGAS metrics are intentionally NOT collapsed into a single number — they
 * measure different things on different scales, so averaging them would be
 * meaningless.
 */
export interface AnswerEvalSummary {
  /** Eval-set version (echoed from EvalSet.version). */
  evalSpecVersion: string;
  /** When the run executed (ISO 8601 UTC). */
  timestamp: string;
  /** Total queries evaluated. */
  totalQueries: number;
  /** Top-K used when retrieving context for each query. */
  topK: number;
  /** Reproducible version metadata stamped once per run. */
  versionMeta: AnswerEvalVersionMeta;
  /** Per-query breakdown. */
  perQuery: AnswerEvalQueryResult[];
}

/** Options for `runAnswerEval`. */
export interface AnswerEvalOptions {
  /** Retrieval function under evaluation. Caller injects (provider-agnostic). */
  searchFn: EvalSearchFn;
  /** Answer generation function. Caller injects (provider-agnostic). */
  generateFn: GenerateFn;
  /** Judge function driving the five judge tasks. Caller injects. */
  judgeFn: JudgeFn;
  /** Optional embed function; when omitted, answer relevance is skipped. */
  embedFn?: EmbedFn;
  /** Top-K context chunks to retrieve per query. @default DEFAULT_EVAL_TOP_K */
  topK?: number;
  /** Generation model name, stamped into version metadata. Required, non-empty. */
  generateModel: string;
  /** Judge model name, stamped into version metadata. Required, non-empty. */
  judgeModel: string;
  /** Wall-clock budget per judge call, forwarded to each judge task. */
  judgeTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// — Multi-config comparison layer (orchestrates retrieval + answer eval per config)
// ---------------------------------------------------------------------------
//
// The comparison entry point runs the SAME eval set through several named
// retrieval configurations and lays the results out as one readable table, so a
// reviewer can see at a glance which retrieval setup scores best on both
// retrieval quality (Hit Rate@K / MRR / nDCG@K) and answer quality (the RAGAS
// metrics). It is an ORCHESTRATOR only — it reuses the retrieval runner, the
// answer-eval orchestrator and the ranking-gain metric without reimplementing any
// formula. Crucially it stays provider-agnostic: it knows nothing about HOW a
// retrieval configuration is built (reranking, lexical vs vector, tokenizer
// choices). The caller pre-wires each configuration as a `searchFn`; the toolkit
// only iterates over them.

/**
 * One named retrieval configuration to compare. The caller pre-wires `searchFn`
 * to a specific retrieval variant; the toolkit does not know how that variant is
 * constructed and never inspects it beyond calling it.
 *
 * Comparing configurations that also GENERATE answers differently (e.g. a
 * different generation model, or a different end-to-end orchestration of
 * retrieval + generation) is a general benchmark need — the optional
 * `generateFn` / `generateModel` pair overrides the run-level defaults for
 * THIS configuration only. Omitting them keeps the shared run-level pair, so
 * existing callers are untouched.
 */
export interface BenchmarkConfig {
  /** Display name for this configuration's row in the comparison table. */
  name: string;
  /** The retrieval variant under evaluation, injected by the caller. */
  searchFn: EvalSearchFn;
  /**
   * Optional per-configuration answer generation override. Falls back to
   * `BenchmarkOptions.generateFn` when omitted.
   */
  generateFn?: GenerateFn;
  /**
   * Optional per-configuration generation model name, stamped into this
   * configuration's answer-eval version metadata. Falls back to
   * `BenchmarkOptions.generateModel` when omitted. Non-empty when provided.
   */
  generateModel?: string;
}

/** Options for `runBenchmark`. */
export interface BenchmarkOptions {
  /** Named retrieval configurations to compare; non-empty, names must be unique. */
  configs: BenchmarkConfig[];
  /**
   * Default answer generation function — used by every configuration that does
   * not provide its own `BenchmarkConfig.generateFn`. Caller-injected.
   */
  generateFn: GenerateFn;
  /** Judge function driving the answer-quality judge tasks. Caller-injected. */
  judgeFn: JudgeFn;
  /** Optional embed function; when omitted, answer relevance is skipped. */
  embedFn?: EmbedFn;
  /** Top-K for retrieval, ranking gain and answer context. @default DEFAULT_EVAL_TOP_K */
  topK?: number;
  /**
   * Default generation model name, stamped into the version metadata of every
   * configuration that does not provide its own `BenchmarkConfig.generateModel`.
   * Required, non-empty.
   */
  generateModel: string;
  /** Judge model name, stamped into version metadata. Required, non-empty. */
  judgeModel: string;
  /** Wall-clock budget per judge call, forwarded to each answer-eval run. */
  judgeTimeoutMs?: number;
  /** Forwarded to retrieval scoring and ranking-gain derivation (page-exact match). */
  strict?: boolean;
  /**
   * Cost tier (AD-10). `'full'` evaluates every query (the nightly full run);
   * `'smoke'` evaluates a reproducible subset (the cheap PR signal). Additive and
   * backward-compatible — omitting it runs `'full'`, exactly as before. @default 'full'
   */
  tier?: 'full' | 'smoke';
  /**
   * Smoke subset size (number of queries kept). Applies ONLY when `tier: 'smoke'`.
   * Selection is a fixed stride over the query order, so the same `sampleSize`
   * always picks the same queries (reproducible, no RNG). Defaults to
   * `DEFAULT_SMOKE_SAMPLE_SIZE` when `tier: 'smoke'` and neither sampling option is set.
   */
  sampleSize?: number;
  /**
   * Smoke stride: keep every Nth query (indices 0, N, 2N, …). Applies ONLY when
   * `tier: 'smoke'`; takes precedence over `sampleSize` when both are set. Also
   * fully reproducible.
   */
  sampleEvery?: number;
  /**
   * Variance samples per judged input — used ONLY to compute the run's cost
   * estimate (the benchmark itself judges each input once; a separate variance
   * harness drives the repeats). Mirrors the `queries × metrics × configs ×
   * variance-samples` cost model (AD-12). @default 1
   */
  varianceSamples?: number;
}

/**
 * One row of the comparison: the FULL retrieval and answer-eval sub-results are
 * retained (auditable, per-query detail preserved) alongside the aggregates the
 * table renders — the mean ranking gain and the mean of each answer metric that
 * actually appeared. A metric that never appeared (e.g. answer relevance with no
 * embed function) is OMITTED from `answerMeans`, never recorded as `0` or
 * `undefined`.
 */
export interface BenchmarkConfigResult {
  /** Echoes {@link BenchmarkConfig.name}. */
  name: string;
  /** Full retrieval sub-result (Hit Rate@K, MRR, per-query top results). */
  retrieval: EvalSummary;
  /** Mean nDCG@K across queries, derived from binary expected-hit gains. */
  ndcg: number;
  /** Full answer-eval sub-result (per-query RAGAS metrics + version metadata). */
  answer: AnswerEvalSummary;
  /** Mean of each answer metric that appeared; absent metrics are omitted. */
  answerMeans: Partial<Record<keyof AnswerEvalMetrics, number>>;
}

/**
 * Aggregate result of a multi-config comparison run, returned by `runBenchmark`.
 * Version metadata is surfaced at the summary level; when configurations use
 * per-config generation overrides, the summary's `generateModel` becomes an
 * explicit per-config aggregate (see {@link BenchmarkSummary.versionMeta}) and
 * each configuration's own `answer.versionMeta` stays the per-config truth. The
 * many metrics are intentionally NOT collapsed into a single "overall" score —
 * they measure different things on different scales.
 */
export interface BenchmarkSummary {
  /**
   * Eval-set version (echoed from EvalSet.version). Intentionally mirrors
   * `versionMeta.evalSpecVersion`: surfaced at the top level for the renderer and
   * direct consumers, while `versionMeta` keeps the field for a self-contained
   * metadata record. Both derive from the same EvalSet, so they never disagree.
   */
  evalSpecVersion: string;
  /** When the run executed (ISO 8601 UTC). */
  timestamp: string;
  /** Top-K used across retrieval, ranking gain and answer context. */
  topK: number;
  /**
   * Reproducible version metadata. The judge / toolkit / eval-spec fields are
   * identical across configurations by construction. `generateModel` is the
   * shared model name when every configuration resolved to the same one;
   * when per-config generation overrides differ, it is an explicit
   * `name=model; name=model` aggregate (never silently the first config's
   * model) — each configuration's true model stays on its own
   * `configs[].answer.versionMeta.generateModel`.
   */
  versionMeta: AnswerEvalVersionMeta;
  /** The cost tier this run used (`'full'` | `'smoke'`). */
  tier: 'full' | 'smoke';
  /**
   * Queries actually evaluated after smoke sampling — equals the eval set size on
   * a `'full'` run, and the (smaller) sampled count on a `'smoke'` run.
   */
  evaluatedQueries: number;
  /**
   * Estimated judge calls for this run: `evaluatedQueries × metricsPerQuery ×
   * configs × varianceSamples` (AD-12). This is the UN-CACHED upper bound — a
   * `withJudgeCache`-wrapped judge serves identical calls from cache, so the real
   * count is ≤ this. Surfaced so a run's cost is predictable before it executes.
   */
  estimatedJudgeCalls: number;
  /** One result row per configuration, in input order. */
  configs: BenchmarkConfigResult[];
}
