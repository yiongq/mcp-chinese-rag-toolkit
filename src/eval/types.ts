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
   * Wall-clock budget in ms before the call degrades to a timeout.
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
