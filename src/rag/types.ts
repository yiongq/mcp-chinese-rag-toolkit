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
