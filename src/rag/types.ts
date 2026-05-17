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
