import type Database from 'better-sqlite3';

/**
 * Canonical tokenizer-identity string written into `meta.tokenizer_version`.
 * Hardcoded against `@node-rs/jieba@2.0.1` (the version pinned by
 * `packages/mcp-chinese-rag-toolkit/package.json#dependencies`).
 *
 * Bump this literal whenever the jieba runtime dep is upgraded AND
 * Story 2.7 eval confirms no Hit Rate@5 regression. Reading from
 * `node:fs` at runtime would couple the toolkit to its on-disk layout
 * (npm tarball / bundle / pnpm hoisting all reshape `node_modules`);
 * the literal IS the contract. `tokenizer-meta.test.ts` cross-checks
 * this against `package.json#dependencies['@node-rs/jieba']` so a dep
 * bump without a constant bump fails CI.
 */
export const JIEBA_VERSION = '@node-rs/jieba@2.0.1' as const;

/**
 * Persist the active tokenizer identity into the Story 2.2 `meta` table.
 *
 * The select-then-insert pair runs inside a `BEGIN IMMEDIATE` transaction so
 * the mismatch guard is atomic — two processes racing the same `.db` cannot
 * both observe an empty placeholder and write divergent versions.
 *
 * `INSERT OR REPLACE` is used so the call is idempotent for the same
 * tokenizer; if a previous run wrote a DIFFERENT non-empty value (e.g. the
 * db was indexed with an older jieba release whose dictionary changed),
 * this function throws — the `docs_fts` reverse index was tokenized with
 * the original release, so silently overwriting would let
 * `meta.tokenizer_version` desync from the on-disk index.
 *
 * The empty-string placeholder written by Story 2.2 `buildSchema` is
 * treated as "not yet written" and is overwritten without complaint.
 *
 * Mirrors `writeEmbedderMeta` (Story 2.3) for `meta.embedding_model`.
 *
 * @throws if `version` is empty or whitespace-only.
 * @throws if the db does not contain the Story 2.2 `meta` table (caller
 *   must initialise via `openIndex` / `buildSchema` first).
 * @throws if a different non-empty version is already stored for this index.
 */
export function writeTokenizerMeta(db: Database.Database, version: string = JIEBA_VERSION): void {
  if (typeof version !== 'string' || version.trim().length === 0) {
    throw new Error('writeTokenizerMeta: version must be a non-empty string');
  }

  let select: Database.Statement<[string], { value: string }>;
  let insert: Database.Statement<[string, string]>;
  try {
    select = db.prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?');
    insert = db.prepare<[string, string]>('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  } catch (err) {
    throw new Error(
      'writeTokenizerMeta: meta table is missing — initialise the db via openIndex() / buildSchema() before writeTokenizerMeta().',
      { cause: err },
    );
  }

  const txn = db.transaction((nextVersion: string) => {
    const existing = select.get('tokenizer_version');
    if (existing && existing.value !== '' && existing.value !== nextVersion) {
      throw new Error(
        `writeTokenizerMeta: meta.tokenizer_version is already '${existing.value}' — ` +
          `refusing to overwrite with '${nextVersion}'. The docs_fts reverse index was tokenized ` +
          'with the original release; rebuild the index with the original jieba version or delete the .db file.',
      );
    }
    insert.run('tokenizer_version', nextVersion);
  });
  // BEGIN IMMEDIATE acquires the SQLite write lock before the SELECT, so
  // concurrent writers serialize on the guard rather than racing it.
  txn.immediate(version);
}
