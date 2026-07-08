import { makeSpan, newSpanId, runSpanSafe } from '../observability/span.js';
import { GRAPH_ERROR_CODES, GraphError } from './errors.js';
import { normalizeEntityName, relationNormalizedKey } from './normalize.js';
import type {
  ExtractedEntity,
  ExtractedGraph,
  ExtractedRelation,
  GraphExtractionOptions,
  RawEntity,
  RawRelation,
} from './types.js';

/** In-progress entity accumulator (mutable; finalized into {@link ExtractedEntity}). */
interface MutableEntity {
  name: string;
  type?: string;
  normalizedKey: string;
  docIds: Set<number>;
}

/** In-progress relation accumulator (mutable; finalized into {@link ExtractedRelation}). */
interface MutableRelation {
  source: string;
  target: string;
  type?: string;
  normalizedKey: string;
  docIds: Set<number>;
}

/**
 * A `type` label counts only when it carries a value: `undefined`, empty, or
 * whitespace-only is treated as absent. This keeps the "first non-empty type
 * wins" rule honest — a blank `type` must not block a real one arriving later,
 * nor persist as an empty string where a `NULL` is meant.
 */
function presentType(type: string | undefined): string | undefined {
  if (type === undefined || type.trim() === '') return undefined;
  return type;
}

/**
 * Merge one raw entity into the accumulator under its normalized identity key.
 * A blank name (empty after normalization) is skipped as malformed. The first
 * surface name seen becomes the node's display name; the first **non-empty**
 * `type` observed is kept (so an untyped relation endpoint does not erase a type
 * supplied by an explicit entity, regardless of arrival order).
 */
function mergeEntity(
  map: Map<string, MutableEntity>,
  raw: RawEntity,
  docId: number,
): void {
  const key = normalizeEntityName(raw.name);
  if (key === '') return;
  const type = presentType(raw.type);
  let entity = map.get(key);
  if (entity === undefined) {
    entity = { name: raw.name, normalizedKey: key, docIds: new Set() };
    if (type !== undefined) entity.type = type;
    map.set(key, entity);
  } else if (entity.type === undefined && type !== undefined) {
    entity.type = type;
  }
  entity.docIds.add(docId);
}

/**
 * Merge one raw relation into the accumulator under its normalized identity key.
 * A relation with a blank source or target (empty after normalization) is
 * skipped as malformed.
 */
function mergeRelation(
  map: Map<string, MutableRelation>,
  raw: RawRelation,
  docId: number,
): void {
  if (normalizeEntityName(raw.source) === '' || normalizeEntityName(raw.target) === '') return;
  const key = relationNormalizedKey(raw.source, raw.target, raw.type);
  const type = presentType(raw.type);
  let relation = map.get(key);
  if (relation === undefined) {
    relation = { source: raw.source, target: raw.target, normalizedKey: key, docIds: new Set() };
    if (type !== undefined) relation.type = type;
    map.set(key, relation);
  }
  relation.docIds.add(docId);
}

function finalizeEntity(entity: MutableEntity): ExtractedEntity {
  const out: ExtractedEntity = {
    name: entity.name,
    normalizedKey: entity.normalizedKey,
    docIds: [...entity.docIds],
  };
  if (entity.type !== undefined) out.type = entity.type;
  return out;
}

function finalizeRelation(relation: MutableRelation): ExtractedRelation {
  const out: ExtractedRelation = {
    source: relation.source,
    target: relation.target,
    normalizedKey: relation.normalizedKey,
    docIds: [...relation.docIds],
  };
  if (relation.type !== undefined) out.type = relation.type;
  return out;
}

/**
 * Extract an entity / relation graph from already-indexed chunks using a
 * caller-supplied {@link GraphExtractionOptions.extractFn}. Pure orchestration:
 * the toolkit performs no extraction of its own and depends on no model SDK — it
 * calls `extractFn` per chunk, then normalizes, deduplicates and back-links the
 * results in memory. Persistence is a separate step (`writeGraph`).
 *
 * Behavior:
 * - **Dedup + back-link.** Entities and relations are collapsed onto their
 *   normalized identity key (see `normalize.ts`); each node / edge accumulates
 *   the ids of every chunk that mentioned it. Output arrays are in first-seen
 *   order for stable, assertable results.
 * - **Relation endpoints become nodes.** Each relation's source and target are
 *   registered as entities, so every edge endpoint is guaranteed to exist as a
 *   node and the graph is internally connected (and `writeGraph` can always
 *   resolve an endpoint to an entity row).
 * - **Partial failure is contained.** If `extractFn` throws for one chunk, that
 *   chunk is skipped (not the whole batch) and counted in `failedChunks`.
 * - **Span.** When `onSpan` is supplied, one `ingest.graph` span is emitted with
 *   scalar counts only (chunk / entity / relation / failed counts) — never entity
 *   or relation names, never chunk content. With no `onSpan` the clock is never
 *   read and no span object is allocated.
 *
 * @throws {GraphError} with code `EMPTY_CHUNKS` when `chunks` is empty.
 */
export async function extractGraph(options: GraphExtractionOptions): Promise<ExtractedGraph> {
  const { chunks, extractFn, onSpan } = options;
  if (chunks.length === 0) {
    throw new GraphError(
      GRAPH_ERROR_CODES.EMPTY_CHUNKS,
      'extractGraph called with an empty chunks array — nothing to extract.',
    );
  }

  const startedAtEpochMs = onSpan ? Date.now() : 0;
  const startPerfMs = onSpan ? performance.now() : 0;

  const entityMap = new Map<string, MutableEntity>();
  const relationMap = new Map<string, MutableRelation>();
  let failedChunks = 0;

  for (const chunk of chunks) {
    try {
      const raw = await extractFn({ content: chunk.content, chunkId: chunk.chunkId });
      // Validate the shape before mutating shared state, so a malformed resolved
      // result fails this chunk atomically — no half-merged entities leak from it.
      if (!Array.isArray(raw?.entities) || !Array.isArray(raw?.relations)) {
        throw new TypeError(
          'extractFn resolved a malformed RawExtraction (missing entities/relations array).',
        );
      }
      for (const entity of raw.entities) {
        mergeEntity(entityMap, entity, chunk.chunkId);
      }
      for (const relation of raw.relations) {
        // Register both endpoints as entity nodes (untyped) before the edge, so the
        // graph stays connected even when the extractor lists a relation without
        // separately listing its endpoints as entities.
        mergeEntity(entityMap, { name: relation.source }, chunk.chunkId);
        mergeEntity(entityMap, { name: relation.target }, chunk.chunkId);
        mergeRelation(relationMap, relation, chunk.chunkId);
      }
    } catch {
      // A single chunk's extraction failure must not abort the batch — whether
      // `extractFn` threw or resolved a malformed shape that can't be processed
      // (e.g. a missing `entities`/`relations` array). Skip the chunk and record
      // the count so a caller can surface partial-failure telemetry.
      failedChunks += 1;
    }
  }

  const graph: ExtractedGraph = {
    entities: [...entityMap.values()].map(finalizeEntity),
    relations: [...relationMap.values()].map(finalizeRelation),
    failedChunks,
  };

  if (onSpan) {
    runSpanSafe(
      onSpan,
      makeSpan('ingest.graph', { id: newSpanId() }, startedAtEpochMs, performance.now() - startPerfMs, {
        chunkCount: chunks.length,
        entityCount: graph.entities.length,
        relationCount: graph.relations.length,
        failedChunks,
        ok: failedChunks === 0,
      }),
    );
  }

  return graph;
}
