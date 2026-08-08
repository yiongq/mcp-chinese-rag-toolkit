import type Database from 'better-sqlite3';
import type { Chunk } from '../rag/types.js';
import { normalizeEntityName } from './normalize.js';
import type { GraphHit, GraphRecallOptions } from './types.js';

/** Default hit cap — mirrors the hybrid per-source candidate cap (top-30 per side). */
const DEFAULT_TOP_K = 30;
/** Upper `topK` bound — mirrors `rrfFuse`'s `MAX_K` / the hybrid option ceiling. */
const MAX_TOP_K = 1000;

interface EntityRow {
  id: number;
  normalized_key: string;
}

interface MentionRow {
  doc_id: number;
}

interface DocRow {
  id: number;
  content: string;
  source: string | null;
  page: number | null;
  section: string | null;
}

/** Same null→absent projection as the storage layer's `rowToChunk`. */
function rowToChunk(row: DocRow): Chunk {
  const chunk: Chunk = { content: row.content };
  if (row.source !== null) chunk.source = row.source;
  if (row.page !== null) chunk.page = row.page;
  if (row.section !== null) chunk.section = row.section;
  return chunk;
}

function assertValidTopK(topK: number): void {
  if (!Number.isInteger(topK) || topK < 1 || topK > MAX_TOP_K) {
    throw new Error(`graphRecall: topK must be an integer in [1, ${MAX_TOP_K}], got ${String(topK)}`);
  }
}

/**
 * Entity-match graph recall — the third retrieval source next to BM25 and
 * vector search.
 *
 * Matching is **reverse containment**: the query is normalized with the same
 * deterministic `normalizeEntityName` used at extraction time, every stored
 * entity is loaded (the table holds thousands of rows at most — a full scan is
 * <1 ms in better-sqlite3, same access pattern as the subgraph reader), and an
 * entity matches when its `normalized_key` is a substring of the normalized
 * query. Matched entities are deduplicated longest-name-first: a shorter
 * matched name that is contained in a longer matched name is dropped (the long
 * name is more specific — "保险" must not double-count chunks already scored
 * via "社会保险").
 *
 * Surviving entities expand to chunks through `entity_mentions` (composite-PK
 * index scan); a chunk's score is the number of distinct matched entities that
 * mention it. Chunks are ordered score-descending (ties broken by `docId`
 * ascending for determinism), capped at `topK`, and projected through `docs`
 * into the same hit shape as the other sources. `doc_id` is a soft reference —
 * rows whose chunk no longer exists are skipped, and ranks stay contiguous
 * from 1 (the `rrfFuse` input contract).
 *
 * The graph tables are written asynchronously after ingest, so an index
 * version may not have them (or may have them empty) — both degrade to `[]`,
 * never an error. Same for a query that touches no entity.
 *
 * One-hop neighbour expansion (folding docIds of relation-adjacent entities in
 * at a discounted weight) and relation-type weighting are deliberately NOT
 * implemented in this version — measure the plain entity-match A/B first;
 * revisit as phase 2 once the benchmark shows the third source earning its
 * keep.
 */
export function graphRecall(
  db: Database.Database,
  query: string,
  opts: GraphRecallOptions = {},
): GraphHit[] {
  const topK = opts.topK ?? DEFAULT_TOP_K;
  assertValidTopK(topK);

  // Probe for the graph tables — written asynchronously after ingest, so a
  // perfectly healthy index version may not have them (same probe as the
  // downstream subgraph reader). Absence degrades to an empty source.
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'entities'")
    .get();
  if (table === undefined) return [];

  const normalizedQuery = normalizeEntityName(query ?? '');
  if (normalizedQuery.length === 0) return [];

  // Full-table load + JS containment — entities number in the thousands at
  // most (<1 ms); no FTS shadow table needed for a table this small.
  const entityRows = db
    .prepare('SELECT id, normalized_key FROM entities')
    .all() as EntityRow[];
  const matched = entityRows.filter(
    (row) => row.normalized_key.length > 0 && normalizedQuery.includes(row.normalized_key),
  );
  if (matched.length === 0) return [];

  // Longest-name-first dedup: sort by key length descending (id ascending for
  // determinism), keep an entity only when no already-kept longer name
  // contains it. `normalized_key` is UNIQUE, so equal-length keys never
  // contain each other.
  matched.sort((a, b) => b.normalized_key.length - a.normalized_key.length || a.id - b.id);
  const kept: EntityRow[] = [];
  for (const candidate of matched) {
    if (!kept.some((k) => k.normalized_key.includes(candidate.normalized_key))) {
      kept.push(candidate);
    }
  }

  // Expand entities → chunks via the composite-PK index. `(entity_id, doc_id)`
  // is the primary key, so each (kept entity, chunk) pair appears once and a
  // plain count per doc_id equals "distinct matched entities on this chunk".
  const placeholders = kept.map(() => '?').join(', ');
  const mentions = db
    .prepare(`SELECT doc_id FROM entity_mentions WHERE entity_id IN (${placeholders})`)
    .all(...kept.map((k) => k.id)) as MentionRow[];
  if (mentions.length === 0) return [];

  const scoreByDocId = new Map<number, number>();
  for (const mention of mentions) {
    scoreByDocId.set(mention.doc_id, (scoreByDocId.get(mention.doc_id) ?? 0) + 1);
  }

  // Score descending; docId ascending tiebreak (mirrors `rrfFuse` determinism).
  const ranked = Array.from(scoreByDocId.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0]);

  // Project through `docs` in one query, then assign contiguous 1-based ranks,
  // skipping dangling soft references so rank gaps can never reach `rrfFuse`.
  const docPlaceholders = ranked.map(() => '?').join(', ');
  const docRows = db
    .prepare(
      `SELECT id, content, source, page, section FROM docs WHERE id IN (${docPlaceholders})`,
    )
    .all(...ranked.map(([docId]) => docId)) as DocRow[];
  const docById = new Map(docRows.map((row) => [row.id, row]));

  const hits: GraphHit[] = [];
  for (const [docId, matchCount] of ranked) {
    if (hits.length >= topK) break;
    const doc = docById.get(docId);
    if (doc === undefined) continue; // dangling soft ref — chunk row is gone
    hits.push({ docId, chunk: rowToChunk(doc), matchCount, graphRank: hits.length + 1 });
  }
  return hits;
}
