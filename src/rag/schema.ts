import type Database from 'better-sqlite3';

import type { SchemaOptions } from './types.js';

/** Default vector dimension — matches bge-large-zh-v1.5 (Story 2.3 owner). */
const DEFAULT_EMBEDDING_DIM = 1024;

/** Generates a default `index_version` value. Not cryptographic — only acts as a cache-key discriminator (Story 2.6). */
function createDefaultIndexVersion(): string {
  return `v1-${Date.now().toString(36)}`;
}

/**
 * Initializes the four-table RAG storage schema (idempotent):
 *
 * - `docs`       — canonical chunk content + provenance (`source` / `page` / `section`).
 * - `docs_fts`   — FTS5 contentless-with-content reverse index over jieba-pretokenized tokens.
 * - `docs_vec`   — sqlite-vec `vec0` virtual table holding the per-chunk embedding.
 * - `meta`       — single-table KV for `index_version` / `embedding_dim` / future Story 2.3+ fields.
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
 * - `meta.embedding_dim` is always overwritten (schema invariant tied to `vec0(float[N])`).
 */
export function buildSchema(db: Database.Database, opts: SchemaOptions = {}): void {
  const embeddingDim = opts.embeddingDim ?? DEFAULT_EMBEDDING_DIM;

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

  const existingVersion = db
    .prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?')
    .get('index_version');

  if (!existingVersion) {
    const versionToWrite = opts.indexVersion ?? createDefaultIndexVersion();
    db.prepare<[string, string]>('INSERT INTO meta (key, value) VALUES (?, ?)').run(
      'index_version',
      versionToWrite,
    );
  }

  db.prepare<[string, string]>(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run('embedding_dim', String(embeddingDim));
}
