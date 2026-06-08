// ---------------------------------------------------------------------------
// — Eval Framework + RAG Eval CI Gate types
// ---------------------------------------------------------------------------

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
 * NOT bind to any specific MCP tool; a downstream consumer package / a downstream consumer package / third-party each
 * wire their own.
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
   * Search function under evaluation. Caller injects (a downstream consumer package / a downstream consumer package /
   * third-party each wire their own).
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
