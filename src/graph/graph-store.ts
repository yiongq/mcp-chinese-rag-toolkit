import type Database from 'better-sqlite3';
import { normalizeEntityName } from './normalize.js';
import type { ExtractedGraph, GraphStats } from './types.js';

/**
 * Persist an {@link ExtractedGraph} into a database whose graph tables were
 * created by `buildGraphSchema`. Idempotent and back-linking:
 *
 * - **Idempotent.** Entities and relations use `INSERT OR IGNORE` against their
 *   `UNIQUE(normalized_key)`, and mention rows use their composite primary key,
 *   so writing the same graph twice inserts nothing the second time and never
 *   throws on a conflict. Combined with in-memory dedup in `extractGraph`, node
 *   and edge counts are stable across re-writes (the machine guarantee behind
 *   idempotent extraction).
 * - **Back-links.** Every entity and relation records a `doc_id` row per source
 *   chunk (`entity_mentions` / `relation_mentions`), so a node / edge can be
 *   traced back to the exact chunk it was mentioned in.
 * - **Atomic.** The whole write runs inside one `db.transaction` for consistency
 *   and speed.
 *
 * The caller owns the `Database` handle (obtained via the index handle's `db`
 * escape hatch after opening the version writable); this primitive adds no new
 * handle method and touches none of the core RAG tables.
 *
 * @returns counts of the rows actually inserted (already-present rows are not
 * counted), plus the transaction's wall-clock duration.
 */
export function writeGraph(db: Database.Database, graph: ExtractedGraph): GraphStats {
  const insertEntity = db.prepare<[string, string | null, string]>(
    'INSERT OR IGNORE INTO entities (name, type, normalized_key) VALUES (?, ?, ?)',
  );
  const selectEntityId = db.prepare<[string], { id: number }>(
    'SELECT id FROM entities WHERE normalized_key = ?',
  );
  const insertEntityMention = db.prepare<[number, number]>(
    'INSERT OR IGNORE INTO entity_mentions (entity_id, doc_id) VALUES (?, ?)',
  );
  const insertRelation = db.prepare<[number, number, string | null, string]>(
    'INSERT OR IGNORE INTO relations (source_entity_id, target_entity_id, type, normalized_key) VALUES (?, ?, ?, ?)',
  );
  const selectRelationId = db.prepare<[string], { id: number }>(
    'SELECT id FROM relations WHERE normalized_key = ?',
  );
  const insertRelationMention = db.prepare<[number, number]>(
    'INSERT OR IGNORE INTO relation_mentions (relation_id, doc_id) VALUES (?, ?)',
  );

  const stats = {
    entitiesInserted: 0,
    relationsInserted: 0,
    entityMentions: 0,
    relationMentions: 0,
  };

  const persist = db.transaction((g: ExtractedGraph): void => {
    // Map each entity's normalized name → its row id, for resolving relation
    // endpoints below. `extractGraph` guarantees every relation endpoint is also
    // present as an entity, so the lookup always succeeds for its output.
    const entityIdByKey = new Map<string, number>();

    for (const entity of g.entities) {
      const res = insertEntity.run(entity.name, entity.type ?? null, entity.normalizedKey);
      if (res.changes > 0) stats.entitiesInserted += 1;
      const row = selectEntityId.get(entity.normalizedKey);
      if (row === undefined) {
        throw new Error(
          `writeGraph: failed to resolve entity id after insert (key=${entity.normalizedKey}).`,
        );
      }
      entityIdByKey.set(entity.normalizedKey, row.id);
      for (const docId of entity.docIds) {
        const mention = insertEntityMention.run(row.id, docId);
        if (mention.changes > 0) stats.entityMentions += 1;
      }
    }

    for (const relation of g.relations) {
      const sourceId = entityIdByKey.get(normalizeEntityName(relation.source));
      const targetId = entityIdByKey.get(normalizeEntityName(relation.target));
      if (sourceId === undefined || targetId === undefined) {
        throw new Error(
          `writeGraph: relation endpoint has no entity node (source=${relation.source}, target=${relation.target}). ` +
            'Build the graph via extractGraph, which registers relation endpoints as entities.',
        );
      }
      const res = insertRelation.run(
        sourceId,
        targetId,
        relation.type ?? null,
        relation.normalizedKey,
      );
      if (res.changes > 0) stats.relationsInserted += 1;
      const row = selectRelationId.get(relation.normalizedKey);
      if (row === undefined) {
        throw new Error(
          `writeGraph: failed to resolve relation id after insert (key=${relation.normalizedKey}).`,
        );
      }
      for (const docId of relation.docIds) {
        const mention = insertRelationMention.run(row.id, docId);
        if (mention.changes > 0) stats.relationMentions += 1;
      }
    }
  });

  const start = Date.now();
  persist(graph);
  return { ...stats, durationMs: Date.now() - start };
}
