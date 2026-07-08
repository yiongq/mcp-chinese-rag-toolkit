import type Database from 'better-sqlite3';

/**
 * Add the knowledge-graph storage tables to an existing RAG-index database, in
 * place, idempotently.
 *
 * The graph lives in the **same `.db` file** as the vector / FTS / docs tables,
 * so it travels with that index version: rebuilding the corpus into a fresh
 * database version starts with no graph, matching the full-rebuild model. This
 * is an independent, additive DDL — it never touches the four core tables, so it
 * is safe to call on any already-built RAG index to opt that database into graph
 * storage. It is **not** part of the core schema and is never required for the
 * retrieval path: read-only opens of a graph-less database continue to succeed.
 *
 * Tables created (all `IF NOT EXISTS`, so calling twice is a no-op):
 *
 * - `entities`          — deduplicated nodes; `normalized_key` is `UNIQUE`, the
 *                         idempotency anchor (`INSERT OR IGNORE` on re-write).
 * - `entity_mentions`   — entity → source-chunk back-links `(entity_id, doc_id)`,
 *                         composite primary key (idempotent on re-write).
 * - `relations`         — deduplicated directed edges; `normalized_key` `UNIQUE`.
 * - `relation_mentions` — relation → source-chunk back-links, composite PK.
 *
 * `doc_id` is a **soft reference** to `docs.id` (the source chunk). No foreign
 * key is declared: `better-sqlite3` leaves `PRAGMA foreign_keys` off by default,
 * and the graph's lifecycle is deliberately decoupled from `docs` (both are
 * discarded together when the index version is rebuilt), so a plain `INTEGER`
 * column carrying the chunk id is the right shape.
 */
export function buildGraphSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,                 -- canonical display name (from source text)
      type TEXT,                          -- extractor-defined free-form label (nullable)
      normalized_key TEXT NOT NULL UNIQUE -- dedup key → idempotency (see normalize.ts)
    );

    CREATE TABLE IF NOT EXISTS entity_mentions (
      entity_id INTEGER NOT NULL,
      doc_id INTEGER NOT NULL,            -- soft ref to docs.id (source chunk back-link)
      PRIMARY KEY (entity_id, doc_id)
    );

    CREATE TABLE IF NOT EXISTS relations (
      id INTEGER PRIMARY KEY,
      source_entity_id INTEGER NOT NULL,
      target_entity_id INTEGER NOT NULL,
      type TEXT,
      normalized_key TEXT NOT NULL UNIQUE -- dedup key = norm(src) + type + norm(tgt)
    );

    CREATE TABLE IF NOT EXISTS relation_mentions (
      relation_id INTEGER NOT NULL,
      doc_id INTEGER NOT NULL,            -- soft ref to docs.id
      PRIMARY KEY (relation_id, doc_id)
    );
  `);
}
