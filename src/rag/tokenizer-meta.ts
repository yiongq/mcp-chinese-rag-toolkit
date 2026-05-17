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
 * the literal IS the contract.
 */
export const JIEBA_VERSION = '@node-rs/jieba@2.0.1' as const;

/**
 * Persist the active tokenizer identity into the Story 2.2 `meta` table.
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
 */
export function writeTokenizerMeta(db: Database.Database, version: string = JIEBA_VERSION): void {
  const existing = db
    .prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?')
    .get('tokenizer_version');
  if (existing && existing.value !== '' && existing.value !== version) {
    throw new Error(
      `writeTokenizerMeta: meta.tokenizer_version is already '${existing.value}' — ` +
        `refusing to overwrite with '${version}'. The docs_fts reverse index was tokenized ` +
        'with the original release; rebuild the index with the original jieba version or delete the .db file.',
    );
  }
  db.prepare<[string, string]>('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
    'tokenizer_version',
    version,
  );
}
