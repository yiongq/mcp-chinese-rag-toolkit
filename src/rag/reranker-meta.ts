import type Database from 'better-sqlite3';

import type { Reranker } from './types.js';

/**
 * Persist the active reranker's model id into the Story 2.2 `meta` table.
 *
 * Mirrors `writeEmbedderMeta` (Story 2.3) for `meta.embedding_model` and
 * `writeTokenizerMeta` (Story 2.4) for `meta.tokenizer_version`:
 * `INSERT OR REPLACE` for idempotent same-model writes, but throws if a
 * DIFFERENT non-empty modelId already exists. Forcing operators to
 * acknowledge a reranker swap protects downstream eval reproducibility
 * (Story 2.7 Hit Rate@5 baseline is reranker-dependent).
 *
 * `meta.reranker_model` is provenance / debug only — NOT part of the
 * Story 2.6 cache key (cache key is `(toolName, indexVersion, args)`;
 * reranker change does not invalidate the FTS / vec stores).
 *
 * The select-then-insert pair runs inside a `BEGIN IMMEDIATE` transaction so
 * the mismatch guard is atomic — two processes racing the same `.db` cannot
 * both observe an empty placeholder and write divergent versions (Story 2.4
 * M4 lesson applied symmetrically).
 *
 * The empty-string placeholder written by Story 2.2 `buildSchema` is
 * treated as "not yet written" and is overwritten without complaint.
 *
 * @throws if `reranker.modelId` is missing, non-string, empty, or whitespace-only.
 * @throws if the db does not contain the Story 2.2 `meta` table (caller
 *   must initialise via `openIndex` / `buildSchema` first).
 * @throws if a different non-empty modelId is already stored for this index.
 */
export function writeRerankerMeta(db: Database.Database, reranker: Reranker): void {
  if (!reranker || typeof reranker.modelId !== 'string' || reranker.modelId.trim().length === 0) {
    throw new Error('writeRerankerMeta: reranker.modelId must be a non-empty string');
  }
  const nextModelId = reranker.modelId;

  let select: Database.Statement<[string], { value: string }>;
  let insert: Database.Statement<[string, string]>;
  try {
    select = db.prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?');
    insert = db.prepare<[string, string]>('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  } catch (err) {
    throw new Error(
      'writeRerankerMeta: meta table is missing — initialise the db via openIndex() / buildSchema() before writeRerankerMeta().',
      { cause: err },
    );
  }

  const txn = db.transaction((modelId: string) => {
    const existing = select.get('reranker_model');
    if (existing && existing.value !== '' && existing.value !== modelId) {
      throw new Error(
        `writeRerankerMeta: meta.reranker_model is already '${existing.value}' — ` +
          `refusing to overwrite with '${modelId}'. Reranker score cache + downstream ` +
          'eval comparisons assume a stable reranker; rebuild via a fresh index or delete ' +
          'the .db file before proceeding with a different reranker.',
      );
    }
    insert.run('reranker_model', modelId);
  });
  // BEGIN IMMEDIATE acquires the SQLite write lock before the SELECT, so
  // concurrent writers serialize on the guard rather than racing it.
  txn.immediate(nextModelId);
}
