import type Database from 'better-sqlite3';

/**
 * A single page extracted from a PDF document.
 *
 * `pageNumber` is 1-indexed to match PDF industry convention and the toolkit
 * `Citation.page` contract (see `errors.ts`). The conversion from unpdf's
 * 0-indexed internal arrays happens at the `parsePdf()` boundary.
 */
export interface PdfPage {
  pageNumber: number;
  text: string;
}

/**
 * Result of parsing a PDF via `parsePdf()`.
 *
 * `totalPages` mirrors unpdf's metadata; `pages.length === totalPages` is an
 * enforced post-condition (see pdf-parser tests).
 */
export interface ParsePdfResult {
  totalPages: number;
  pages: PdfPage[];
}

/**
 * Options controlling the Markdown hierarchical splitter behaviour.
 *
 * `chunkSize` / `chunkOverlap` units are CHARACTERS, not tokens (consistent
 * with `@langchain/textsplitters` `RecursiveCharacterTextSplitter`). For
 * Chinese text 1 character ≈ 0.6 tokens under bge-large-zh-v1.5.
 */
export interface ChunkOptions {
  /** @default 1000 — range [100, 4000]; out-of-range throws */
  chunkSize?: number;
  /** @default 200 — range [0, chunkSize); out-of-range throws */
  chunkOverlap?: number;
  /** Propagated unchanged to every produced chunk. */
  source?: string;
  /** Propagated unchanged to every produced chunk. */
  page?: number;
}

/**
 * Output unit of the chunking pipeline.
 *
 * Field semantics intentionally align with `Citation` (errors.ts):
 * `content` matches `Citation.content`; `source` / `page` / `section` are
 * identical in meaning and casing. Downstream snake_case conversion (e.g.
 * SQLite `docs.text`) happens at the indexing layer, not here.
 */
export interface Chunk {
  content: string;
  source?: string;
  page?: number;
  /** Markdown heading path, levels joined by ` > ` (H1–H4 tracked). */
  section?: string;
}

// ---------------------------------------------------------------------------
// Story 2.2 — SQLite + sqlite-vec + jieba storage layer types
// ---------------------------------------------------------------------------

/**
 * Options for {@link buildSchema}. Writes are idempotent: when called against
 * an existing index, `embedding_dim` is overwritten (schema invariant) but
 * `index_version` is preserved (Story 2.6 cache-key stability).
 */
export interface SchemaOptions {
  /** Vector dimension for `docs_vec` virtual table. @default 1024 (bge-large-zh-v1.5) */
  embeddingDim?: number;
  /**
   * Index version string written into `meta.index_version` when the row does
   * not yet exist. Used by Story 2.6 cache key. @default `'v1-' + Date.now().toString(36)`
   */
  indexVersion?: string;
}

/**
 * Options for {@link openIndex}. When `readonly` is true the underlying
 * connection opens in read-only mode and `buildSchema` is skipped — useful
 * for query-only consumers (e.g. mcp-hr search path) that ship a prebuilt
 * `.db` inside the npm tarball.
 */
export interface OpenIndexOptions {
  /** Open the `.db` read-only. `sqlite-vec` still loads. @default false */
  readonly?: boolean;
  /** Forwarded to {@link buildSchema}; ignored when `readonly` is true. @default 1024 */
  embeddingDim?: number;
  /** Forwarded to {@link buildSchema}. */
  indexVersion?: string;
}

/**
 * Single row consumed by {@link IndexHandle.indexChunks}. `embedding.length`
 * must equal the handle's `embeddingDim` (validated, fail-fast).
 */
export interface ChunkRow {
  chunk: Chunk;
  embedding: Float32Array;
}

/** Result of a single {@link IndexHandle.indexChunks} batch. */
export interface IndexStats {
  inserted: number;
  durationMs: number;
}

/** Shared options for the search primitives. */
export interface SearchOptions {
  /** @default 30 — sized for Story 2.4 hybrid RRF (top-30 each side). */
  topK?: number;
}

/**
 * Result from {@link IndexHandle.ftsSearch}.
 *
 * `bm25Rank` is a 1-indexed position in the returned ordering (consumed by
 * Story 2.4 RRF `1/(k + rank)`); `bm25Score` is the FTS5-native `rank`
 * column (negative-floor; closer to 0 = more relevant) and is passed
 * through verbatim for debugging / threshold filtering.
 */
export interface FtsHit {
  docId: number;
  chunk: Chunk;
  bm25Rank: number;
  bm25Score: number;
}

/**
 * Result from {@link IndexHandle.vecSearch}. `distance` is the sqlite-vec
 * default L2 distance (Story 2.3 may opt into cosine via L2-normalized
 * embeddings; see Story 2.2 Dev Notes §sqlite-vec distance 语义).
 */
export interface VecHit {
  docId: number;
  chunk: Chunk;
  distance: number;
}

/**
 * Storage handle returned by {@link openIndex}. Wraps a `better-sqlite3`
 * connection + `sqlite-vec` extension load + jieba pre-tokenization, and
 * exposes the five storage primitives consumed by Stories 2.3 / 2.4 / 2.6.
 *
 * The `db` getter is an escape hatch for advanced use (per-chunk metadata
 * reads in Story 2.4, etc.); prefer the typed primitives whenever possible.
 */
export interface IndexHandle {
  /** Insert a batch of chunks. Wrapped in a single transaction (50–100× speedup vs autocommit). */
  indexChunks(rows: ChunkRow[]): IndexStats;
  /** BM25 search over `docs_fts` using jieba-pretokenized query. */
  ftsSearch(query: string, opts?: SearchOptions): FtsHit[];
  /** KNN search over `docs_vec` (sqlite-vec L2 by default). */
  vecSearch(queryEmbedding: Float32Array, opts?: SearchOptions): VecHit[];
  /** Returns `meta.index_version` (Story 2.6 cache key). */
  getIndexVersion(): string;
  /** Underlying `better-sqlite3` Database. Escape hatch — use the typed primitives first. */
  readonly db: Database.Database;
  /** Closes the underlying connection. Idempotent. */
  close(): void;
}

// ---------------------------------------------------------------------------
// Story 2.3 — bge-large-zh-v1.5 embedder + model hash verification types
// ---------------------------------------------------------------------------

/**
 * A single entry inside a {@link ModelManifest}. The (path, sha256, bytes)
 * triple is the unit of supply-chain pinning consumed by `verifyModelFiles`.
 *
 * `relativePath` MUST be a POSIX-style path relative to the per-model cache
 * directory (`<cacheDir>/<modelId>/...`). It is rejected at verify time if it
 * is absolute, contains `..` segments, or holds NUL / control characters.
 */
export interface ManifestEntry {
  /** Path relative to the per-model cache directory (e.g. `'onnx/model.onnx'`). */
  relativePath: string;
  /** Lowercase hex SHA-256 of the file contents. */
  sha256: string;
  /** Total file size in bytes — pre-flight check before streaming the full hash. */
  bytes: number;
  /**
   * When `true`, a *missing* file does not fail strict verification: transformers.js
   * loads the model fine without it (e.g. `special_tokens_map.json` is redundant once
   * `tokenizer.json` is present, so transformers.js v4.x never downloads it). The
   * sha256 / byte-length pin is still enforced *if* the file is present in the cache —
   * `optional` relaxes presence, never integrity. @default false
   */
  optional?: boolean;
}

/**
 * Hardcoded supply-chain pin for a HuggingFace Hub model used by
 * {@link loadEmbedder}. The list is intentionally narrow — only files the
 * toolkit actually loads are pinned; extra files in the cache (README, full
 * PyTorch weights, alternative dtypes) are neither verified nor considered a
 * tamper signal.
 *
 * Tracking is always against the upstream `main` branch (the sha256 entries
 * are the supply-chain boundary, so a per-revision pin is redundant).
 * `embeddingDim` is the contract value for the model's vector dimension —
 * `loadEmbedder` exposes it as `Embedder.dim` so the FR20 factory pattern
 * works for non-1024-dim manifests too.
 */
export interface ModelManifest {
  /** HF Hub repo id consumed by `pipeline('feature-extraction', modelId)`. */
  modelId: string;
  /** Vector dimension produced by the model (e.g. 1024 for bge-large-zh-v1.5, 768 for bge-base-zh, 512 for bge-small-zh). */
  embeddingDim: number;
  /** Frozen list of files to verify. */
  files: readonly ManifestEntry[];
}

/**
 * Options for {@link loadEmbedder}.
 *
 * All fields are optional. `verifyHashes` should never be set to `false` in
 * production code paths — it exists for test fixtures that mock the pipeline
 * with synthetic models whose hashes are not under our control.
 *
 * Note: `dtype` is currently fixed at `'fp32'` because the default manifest
 * only pins the fp32 ONNX file. Supporting `'q8'` / `'fp16'` would require
 * pinning the corresponding alternative ONNX files in the manifest — see
 * `BGE_LARGE_ZH_V1_5_MANIFEST` Dev Notes / Story 2.3 review H2 for context.
 */
export interface EmbedderOptions {
  /**
   * Override the default bge-large-zh-v1.5 manifest — keep the value in sync
   * with a `ModelManifest` whose `modelId` matches the model you intend to
   * load. @default BGE_LARGE_ZH_V1_5_MANIFEST
   */
  manifest?: ModelManifest;
  /** Absolute path override; defaults to `<userCacheDir>/mcp-chinese-rag-toolkit/models`. */
  cacheDir?: string;
  /** Whether transformers.js may fetch missing files from HF Hub. Set false for fully offline / air-gapped runs. @default true */
  allowRemoteModels?: boolean;
  /** Hash-verification toggle — never set false in production. @default true */
  verifyHashes?: boolean;
}

/**
 * Result returned by {@link loadEmbedder}.
 *
 * `embed` / `embedBatch` produce L2-normalized vectors (`Σ x_i² ≈ 1`)
 * suitable for direct insertion into a sqlite-vec `docs_vec` table opened
 * with {@link openIndex}. `dim` MUST equal `meta.embedding_dim`; mismatches
 * are caught by Story 2.2 `schema.ts` at index-open time.
 */
export interface Embedder {
  /** Compute a single L2-normalized embedding. `result.length === dim`. */
  embed(text: string): Promise<Float32Array>;
  /**
   * Batched variant; semantically equivalent to N sequential `embed` calls
   * but uses a single tokenization + ONNX forward when `batchSize > 1`.
   * `batchSize` is clamped to `[1, 256]`; values outside the range throw.
   */
  embedBatch(texts: string[], opts?: { batchSize?: number }): Promise<Float32Array[]>;
  /** Vector dimension. Sourced from `manifest.embeddingDim` at load time (1024 for bge-large-zh-v1.5). */
  readonly dim: number;
  /** Echo of the manifest's `modelId` — written to `meta.embedding_model` by {@link writeEmbedderMeta}. */
  readonly modelId: string;
}

// ---------------------------------------------------------------------------
// Story 2.4 — Hybrid Search + Reciprocal Rank Fusion (RRF) types
// ---------------------------------------------------------------------------

/**
 * Rank-bearing input row consumed by `rrfFuse`. Generic so callers can fuse
 * `FtsHit[]` (using `bm25Rank`) and `VecHit[]` (using `arrayIndex + 1`)
 * without coercing them into a shared intermediate object shape.
 */
export interface RankedRow<T> {
  /** Stable identifier — typically `docId` from {@link FtsHit} / {@link VecHit}. */
  id: number;
  /** Caller-supplied payload (passed through unchanged into the fused result). */
  payload: T;
  /** 1-indexed rank within this list (so `1/(k + 1)` for the top element). */
  rank: number;
}

/**
 * Output row from `rrfFuse`. `ranks[i]` / `payloads[i]` mirror the order of
 * the input `sources` array; entries are `null` when the corresponding
 * source did not return this id — BDD#2 single-source survival relies on
 * this contract.
 */
export interface FusedRow<T> {
  id: number;
  /** Accumulated RRF score `Σ 1/(k + rank_i)` over every source that contained `id`. */
  score: number;
  /** Per-source rank lookup. `null` for sources that did not hit `id`. */
  ranks: Array<number | null>;
  /** Per-source payload lookup. `null` for sources that did not hit `id`. */
  payloads: Array<T | null>;
}

/** Options for `rrfFuse`. */
export interface RrfOptions {
  /** RRF constant — defaults to 60 (Cormack 2009 / Elasticsearch / Weaviate convention). Range [1, 1000]. */
  k?: number;
  /** Final fused top-K cap. @default Infinity (return everything fused) */
  topK?: number;
}

/** Options for the bound query function returned by `createHybridSearch`. */
export interface HybridSearchOptions {
  /** Per-source candidate cap before RRF fusion (top-N from FTS, top-N from vec). @default 30 */
  perSourceTopK?: number;
  /** Final fused top-K returned to the caller. @default 10 */
  topK?: number;
  /** RRF constant. @default 60 (Cormack 2009 convention) */
  rrfK?: number;
}

/**
 * A single fused hit returned by the bound hybrid-search function.
 *
 * Field semantics intentionally mirror the upstream Story 2.2 types:
 * `bm25Score` is the FTS5 native `rank` column (negative-floor, closer to
 * 0 = more relevant); `distance` is the sqlite-vec L2 distance (lower =
 * closer). Optional fields are `undefined` when the corresponding source
 * did not contribute to this hit (single-source survival).
 */
export interface HybridHit {
  /** `docs.id` — stable per-index identifier. */
  docId: number;
  /** Chunk content + provenance (source / page / section). */
  chunk: Chunk;
  /** `Σ 1/(rrfK + rank_i)` across whichever sources hit this docId. */
  rrfScore: number;
  /** 1-indexed BM25 position within `ftsSearch` top-N — undefined when only vec hit. */
  bm25Rank?: number;
  /** Mirrors {@link FtsHit.bm25Score} — undefined when only vec hit. */
  bm25Score?: number;
  /** 1-indexed vector position within `vecSearch` top-N — undefined when only BM25 hit. */
  vecRank?: number;
  /** Mirrors {@link VecHit.distance} — undefined when only BM25 hit. */
  distance?: number;
}

/** Dependencies bound by `createHybridSearch`. */
export interface HybridSearchDeps {
  handle: IndexHandle;
  embedder: Embedder;
  /** Optional default options applied when the per-call `opts` does not override. */
  defaultOpts?: HybridSearchOptions;
}

/** Bound query function returned by `createHybridSearch`. */
export type HybridSearchFn = (query: string, opts?: HybridSearchOptions) => Promise<HybridHit[]>;

// ---------------------------------------------------------------------------
// Story 2.5 — BGE-Reranker (cross-encoder) + stdio P95 latency harness types
// ---------------------------------------------------------------------------

/**
 * Options for {@link loadReranker}.
 *
 * Mirrors {@link EmbedderOptions} field-for-field so callers wiring both
 * pipelines together (Epic 4 mcp-hr / mcp-modeling) get a uniform surface.
 * `dtype` is currently fixed at `'q8'` (model_quantized.onnx) by the default
 * manifest — see `BGE_RERANKER_V2_M3_MANIFEST` JSDoc for the rationale.
 */
export interface RerankerOptions {
  /**
   * Override the default bge-reranker-v2-m3 manifest. Pass a `ModelManifest`
   * whose `modelId` is recognised by `@huggingface/transformers`
   * `AutoModelForSequenceClassification.from_pretrained(modelId)`.
   * @default BGE_RERANKER_V2_M3_MANIFEST
   */
  manifest?: ModelManifest;
  /** Absolute path override; defaults to `<userCacheDir>/mcp-chinese-rag-toolkit/models` (shared with embedder). */
  cacheDir?: string;
  /** Whether transformers.js may fetch missing files from HF Hub. Set false for fully offline / air-gapped runs. @default true */
  allowRemoteModels?: boolean;
  /** Hash-verification toggle — never set false in production. @default true */
  verifyHashes?: boolean;
}

/**
 * Single rank result returned by {@link Reranker.rank}.
 *
 * `score` is `sigmoid(logit)` — bge-reranker-v2-m3 is a single-class
 * sequence-classification model that emits one logit per `(query, doc)`
 * pair; `sigmoid` converts that into a `[0, 1]` relevance probability.
 * The FR25 / NFR17 `confidence: 'low'` threshold defaults to `< 0.5`
 * and is enforced at the tool handler layer (Epic 4 mcp-hr), not here.
 */
export interface RankedDocument {
  /** Position in the input `documents` array (0-indexed). */
  index: number;
  /** `sigmoid(logit)` ∈ `[0, 1]` — relevance probability. */
  score: number;
}

/**
 * Result returned by {@link loadReranker}.
 *
 * `rank(query, documents, opts?)` is the canonical surface: it tokenizes
 * each `(query, document)` pair, runs a batched forward pass through the
 * cross-encoder, applies sigmoid to the single output logit per pair, and
 * returns `RankedDocument[]` aligned to the input `documents` array order
 * (so callers can re-attach their own metadata). Sort / top-K filtering is
 * the caller's job — see {@link createReranker} for the bound HybridHit
 * variant that does both.
 *
 * Unlike {@link Embedder} (a bi-encoder that produces a per-document dense
 * vector and lets the caller compute similarity offline), a cross-encoder
 * sees the `(query, doc)` pair jointly through full self-attention; this
 * is why reranking is significantly slower than embedding but also much
 * more accurate at separating near-duplicate candidates.
 */
export interface Reranker {
  /**
   * Score `documents` against `query`. Returns one entry per input document,
   * in the SAME order (so caller can `documents[i] ←→ scores[i]`).
   *
   * `opts.batchSize` clamped to `[1, 64]`; cross-encoder is heavier than
   * the bi-encoder embedder (full attention over `[query | SEP | doc]`),
   * so the practical batch ceiling is lower than the embedder's 256.
   *
   * `opts.maxLength` defaults to 512 tokens (bge-reranker-v2-m3 max
   * positional embedding); pairs longer than this are truncated with
   * `truncation: 'longest_first'` (drops from the longer side, usually
   * the document) — matches FlagEmbedding's reference behaviour.
   */
  rank(
    query: string,
    documents: string[],
    opts?: { batchSize?: number; maxLength?: number },
  ): Promise<RankedDocument[]>;
  /** Echo of the manifest's `modelId` — written to `meta.reranker_model` by {@link writeRerankerMeta}. */
  readonly modelId: string;
}

/** Options for the bound rerank function returned by `createReranker`. */
export interface RerankOptions {
  /** Final reranked top-K cap. Accepts `Infinity` for "return every reranked hit". @default 5 */
  topK?: number;
  /** Forwarded to `reranker.rank()`. @default 32 */
  batchSize?: number;
  /** Forwarded to `reranker.rank()`. @default 512 */
  maxLength?: number;
}

/**
 * Reranked hit — extends `HybridHit` with `rerankScore` and re-orders
 * candidates by sigmoid relevance score. `rerankScore` is in `[0, 1]`;
 * FR25 / NFR17 `confidence: 'low'` threshold defaults to `< 0.5` and
 * is enforced at the tool handler layer (Epic 4 mcp-hr), not here.
 */
export interface RerankedHit extends HybridHit {
  /** `sigmoid(cross-encoder logit)` ∈ `[0, 1]`. */
  rerankScore: number;
}

/** Dependencies bound by `createReranker`. */
export interface RerankerDeps {
  reranker: Reranker;
  /** Optional default options applied when the per-call `opts` does not override. */
  defaultOpts?: RerankOptions;
}

/** Bound rerank function returned by `createReranker`. */
export type RerankFn = (
  query: string,
  candidates: HybridHit[],
  opts?: RerankOptions,
) => Promise<RerankedHit[]>;

/** Options for `runStdioLatencyHarness`. */
export interface LatencyHarnessOptions {
  /** Number of throwaway warm-up calls before measurement starts. @default 5 */
  warmupRuns?: number;
  /** Number of measured tool calls. @default 100 */
  measureRuns?: number;
  /**
   * Fixture: query strings cycled through during measurement.
   * @default ['试用期', '加班', '请假', '差旅报销', '保密协议']
   */
  queries?: string[];
  /**
   * Tool name to invoke. Default tool is a hybrid + rerank pipeline over an
   * in-memory 12-chunk HR fixture (mirrors the integration test fixture).
   */
  toolName?: string;
}

/**
 * Snapshot returned by `runStdioLatencyHarness` — schema also written to
 * `bench/baseline.json` by `bin/latency-harness.ts`.
 */
export interface LatencySnapshot {
  /** ISO-8601 timestamp when the harness completed. */
  timestamp: string;
  /** Tool name that was measured. */
  toolName: string;
  /** Number of warmup runs that completed successfully. */
  warmupRuns: number;
  /** Number of measured runs. */
  measureRuns: number;
  /**
   * Cold start latency — total elapsed time of the warmup loop (ms). When
   * `warmupRuns === 0` this is approximately `0` (loop never ran) and the
   * first measured sample carries the cold-start cost; treat the field as
   * informational only in that case.
   */
  coldStartMs: number;
  /** Warm-only P50 latency (ms). */
  p50Ms: number;
  /** Warm-only P95 latency (ms). NFR1: must stay < 200. */
  p95Ms: number;
  /** Warm-only P99 latency (ms). */
  p99Ms: number;
  /** Mean warm latency (ms). */
  meanMs: number;
  /** Min warm latency (ms). */
  minMs: number;
  /** Max warm latency (ms). */
  maxMs: number;
  /**
   * Toolkit + reranker provenance — frozen into the snapshot so
   * baseline.json regressions are debuggable years later without
   * re-running git archaeology.
   */
  environment: {
    /** Node version (e.g. 'v22.10.0'). */
    node: string;
    /** Platform (`darwin` / `linux` / `win32`). */
    platform: string;
    /** Arch (`arm64` / `x64`). */
    arch: string;
    /** Toolkit `package.json` version. */
    toolkitVersion: string;
    /** Reranker manifest modelId. */
    rerankerModelId: string;
    /** Embedder manifest modelId. */
    embedderModelId: string;
    /** `JIEBA_VERSION` constant. */
    jiebaVersion: string;
  };
}

/** Result returned by `runStdioLatencyHarness` — includes raw samples for debug. */
export interface HarnessResult {
  snapshot: LatencySnapshot;
  /** Raw per-call latency array (warm runs only) — for histograms / debug. */
  samples: number[];
}

// ---------------------------------------------------------------------------
// Story 2.6 — L0 Tool-Result LRU Cache + Contextual Retrieval types
// ---------------------------------------------------------------------------

/**
 * Options for `withLruCache`. `indexVersion` is REQUIRED — it is the
 * primary cache-invalidation signal (changes when the underlying SQLite
 * index is rebuilt; see Story 2.2 §schema invariants and
 * `IndexHandle.getIndexVersion()`).
 *
 * Omitting `cache` on the parent factory (`createMcpServer`) is equivalent
 * to `enabled: false`; setting `enabled: false` explicitly is the supported
 * way to *force* cache off when an `indexVersion` is otherwise available
 * (unit tests / experiments / Phase 2 hot-reload diagnostics).
 */
export interface CacheOptions {
  /** Maximum entries per server. @default 500 (architecture §缓存策略 L628) */
  max?: number;
  /** TTL in ms. @default 60 * 60 * 1000 (1h, FR16) */
  ttlMs?: number;
  /** REQUIRED — typically `IndexHandle.getIndexVersion()` at startup time. */
  indexVersion: string;
  /** Set false in unit tests / experiments. @default true */
  enabled?: boolean;
}

/** Status injected at `structuredContent._meta.cache` on every cached
 *  tool result — `'hit'` when served from cache, `'miss'` when freshly
 *  computed. The field is ALWAYS present after passing through
 *  `withLruCache`, so callers (eval / OTel / Inspector) can rely on a
 *  binary contract instead of a tri-state truthy / missing check. */
export type CacheStatus = 'hit' | 'miss';

/** Dependencies bound by `withLruCache` (kept for the alternative
 *  ergonomic factory shape — not consumed by `createMcpServer` directly;
 *  see Story 2.6 AC3 §design rationale). */
export interface WithLruCacheDeps {
  toolName: string;
  options: CacheOptions;
}

/** Options for `generateChunkContext` (Story 2.6 Contextual Retrieval,
 *  FR15). Provider injection only — toolkit does NOT bind to a specific
 *  LLM SDK; see Story 2.6 AC5 §design rationale. */
export interface ContextualRetrievalOptions {
  /** Source document the chunk was sliced from. Sent ONCE per indexing
   *  batch with `cache_control: ephemeral`; subsequent chunks reuse the
   *  cached prefix → ≤ 50% token cost vs uncached (FR15). */
  fullDocument: string;
  /** Target prefix length range (characters). @default { min: 50, max: 100 } */
  prefixLength?: { min: number; max: number };
  /** Cache key passed to provider for cache_control identity (e.g. doc
   *  sha256). Default `'default'`. */
  cacheKey?: string;
}

/** Provider abstraction injected into `generateChunkContext`. Mirrors
 *  Anthropic / OpenAI / 豆包 chat completion shape so callers can plug in
 *  any provider that supports prompt caching (Anthropic Phase 1 target;
 *  others Phase 2 via provider adapter). The toolkit deliberately does
 *  NOT depend on `@anthropic-ai/sdk` — caller-side wiring keeps bundle
 *  size minimal and avoids locking consumers into a single vendor. */
export interface LlmProvider {
  /** Generate prefix text given a (system, user) message pair where the
   *  system block carries `cache_control: { type: 'ephemeral' }` for the
   *  full document. `cacheKey` is the stable identity used by callers to
   *  group requests under the same cache_control entry (typically the
   *  source document's sha256). */
  generateChunkPrefix(args: {
    fullDocument: string;
    chunkContent: string;
    cacheKey: string;
    prefixLength: { min: number; max: number };
  }): Promise<string>;
}
