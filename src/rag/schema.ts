import type Database from 'better-sqlite3';

import type { SchemaOptions } from './types.js';

/** Default vector dimension — matches bge-large-zh-v1.5 (Story 2.3 owner). */
const DEFAULT_EMBEDDING_DIM = 1024;

/** Upper bound chosen to keep `float[N]` DDL sane and protect against arithmetic overflow. */
const MAX_EMBEDDING_DIM = 65535;

/** Generates a default `index_version` value. Not cryptographic — only acts as a cache-key discriminator (Story 2.6). */
function createDefaultIndexVersion(): string {
  return `v1-${Date.now().toString(36)}`;
}

function assertValidEmbeddingDim(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_EMBEDDING_DIM) {
    throw new Error(
      `Invalid embeddingDim: expected integer in [1, ${MAX_EMBEDDING_DIM}], got ${String(value)}`,
    );
  }
}

/**
 * Initializes the four-table RAG storage schema (idempotent):
 *
 * - `docs`       — canonical chunk content + provenance (`source` / `page` / `section`).
 * - `docs_fts`   — FTS5 contentless-with-content reverse index over jieba-pretokenized tokens.
 * - `docs_vec`   — sqlite-vec `vec0` virtual table holding the per-chunk embedding.
 * - `meta`       — single-table KV for `index_version` / `embedding_dim` / `embedding_model` / `tokenizer_version`.
 *
 * **Important**: callers must `sqliteVec.load(db)` before invoking — `docs_vec`'s
 * `CREATE VIRTUAL TABLE ... USING vec0(...)` requires the vec0 module loaded
 * on the connection.
 *
 * Idempotency guarantees:
 * - All DDL uses `IF NOT EXISTS`.
 * - `meta.index_version` is written **only** when absent; re-running `buildSchema`
 *   with a new `indexVersion` does not overwrite an established value (prevents
 *   accidental Story 2.6 cache invalidation).
 * - `meta.embedding_dim`: written on first invocation; on subsequent invocations
 *   a mismatch between the stored value and the caller-supplied opts throws —
 *   the underlying `docs_vec` `float[N]` is DDL-locked at the first build, so
 *   silently overwriting meta would let the value drift away from the actual
 *   on-disk vector schema.
 * - `meta.embedding_model` / `meta.tokenizer_version`: empty-string placeholders
 *   are written when absent. Story 2.3 (embedder) and Story 2.4 (query path)
 *   own the actual values.
 */
export function buildSchema(db: Database.Database, opts: SchemaOptions = {}): void {
  const embeddingDim = opts.embeddingDim ?? DEFAULT_EMBEDDING_DIM;
  assertValidEmbeddingDim(embeddingDim);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS docs (
      id INTEGER PRIMARY KEY,
      content TEXT NOT NULL,
      source TEXT,
      page INTEGER,
      section TEXT,
      indexed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
      text_tokens,
      content='docs',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 1'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS docs_vec USING vec0(
      doc_id integer primary key,
      embedding float[${embeddingDim}]
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const metaSelect = db.prepare<[string], { value: string }>(
    'SELECT value FROM meta WHERE key = ?',
  );
  const metaInsert = db.prepare<[string, string]>('INSERT INTO meta (key, value) VALUES (?, ?)');

  const existingVersion = metaSelect.get('index_version');
  if (!existingVersion) {
    const versionToWrite = opts.indexVersion ?? createDefaultIndexVersion();
    metaInsert.run('index_version', versionToWrite);
  }

  const existingDim = metaSelect.get('embedding_dim');
  if (!existingDim) {
    metaInsert.run('embedding_dim', String(embeddingDim));
  } else if (Number(existingDim.value) !== embeddingDim) {
    // The vec0 virtual table's `float[N]` is locked at first CREATE; overwriting
    // meta.embedding_dim alone would silently desynchronize the value vs the
    // on-disk schema. Reject the inconsistency at the boundary.
    throw new Error(
      `embeddingDim mismatch: existing index was built with ${existingDim.value}, ` +
        `but openIndex was called with ${embeddingDim}. The docs_vec schema is DDL-locked; ` +
        'rebuild the index with the original dimension or delete the .db file.',
    );
  }

  // Story 2.3 / 2.4 / 2.5 owners populate these — write empty-string
  // placeholders so downstream readers can rely on the keys existing.
  if (!metaSelect.get('embedding_model')) metaInsert.run('embedding_model', '');
  if (!metaSelect.get('tokenizer_version')) metaInsert.run('tokenizer_version', '');
  if (!metaSelect.get('reranker_model')) metaInsert.run('reranker_model', '');
}
