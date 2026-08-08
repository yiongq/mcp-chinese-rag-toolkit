// ---------------------------------------------------------------------------
// Knowledge-graph primitives — public types.
// ---------------------------------------------------------------------------
//
// These types describe a stateless, injection-driven pipeline that turns
// already-indexed chunks into an entity / relation graph whose nodes and edges
// each back-link to the source chunk they were mentioned in. The toolkit never
// performs the extraction itself: the caller supplies an `ExtractFn` (typically
// backed by any LLM provider), keeping the toolkit free of any model SDK.

import type { OnSpan } from '../observability/span.js';
import type { Chunk } from '../rag/types.js';

/**
 * One input chunk fed to {@link extractGraph}. `chunkId` is the stable id of the
 * source chunk inside its `.db` (the auto-increment primary key assigned when the
 * chunk was indexed), so every extracted node / edge can back-link to it.
 */
export interface GraphChunk {
  /** Stable source-chunk id — the same id carried by search hits for this chunk. */
  chunkId: number;
  /** Chunk text handed to the extraction function. */
  content: string;
}

/** A raw entity as returned by a caller-supplied {@link ExtractFn}. */
export interface RawEntity {
  /** Surface name exactly as the extractor produced it. */
  name: string;
  /** Optional extractor-defined free-form type label (e.g. `person`, `org`). */
  type?: string;
}

/** A raw relation as returned by a caller-supplied {@link ExtractFn}. */
export interface RawRelation {
  /** Surface name of the source endpoint. */
  source: string;
  /** Surface name of the target endpoint. */
  target: string;
  /** Optional extractor-defined free-form relation label (e.g. `works_at`). */
  type?: string;
}

/** The per-chunk result an {@link ExtractFn} returns. */
export interface RawExtraction {
  entities: RawEntity[];
  relations: RawRelation[];
}

/**
 * Caller-supplied extraction function — the sole injection point for turning a
 * chunk's text into raw entities / relations. The toolkit ships no default
 * implementation and depends on no model SDK; a downstream consumer wires this
 * to any LLM provider (or a rule-based extractor, or a test stub).
 */
export type ExtractFn = (input: {
  content: string;
  chunkId: number;
}) => Promise<RawExtraction>;

/**
 * A deduplicated entity node in the extracted graph. `normalizedKey` is the
 * deterministic identity key (see the normalization strategy in
 * `normalize.ts`); `docIds` lists every source chunk that mentioned it.
 */
export interface ExtractedEntity {
  /** First-seen surface name (used as the display name). */
  name: string;
  /** First non-empty extractor type observed for this entity, if any. */
  type?: string;
  /** Deterministic dedup identity key = normalized name. */
  normalizedKey: string;
  /** Source-chunk ids that mentioned this entity (deduplicated, first-seen order). */
  docIds: number[];
}

/**
 * A deduplicated relation edge in the extracted graph. Its endpoints are
 * referenced by surface name; every endpoint is guaranteed to also appear as an
 * {@link ExtractedEntity} node (extraction registers relation endpoints as
 * entities), so the graph is always internally connected.
 */
export interface ExtractedRelation {
  source: string;
  target: string;
  type?: string;
  /** Deterministic dedup identity key = norm(source) + type + norm(target). */
  normalizedKey: string;
  docIds: number[];
}

/**
 * The full result of {@link extractGraph}: deduplicated entities and relations,
 * plus a count of chunks whose extraction threw (and were skipped) so a caller
 * can surface partial-failure telemetry without the whole batch aborting.
 */
export interface ExtractedGraph {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
  /** Number of chunks whose `extractFn` call threw and were skipped. */
  failedChunks: number;
}

/** Options for {@link extractGraph}. */
export interface GraphExtractionOptions {
  chunks: GraphChunk[];
  extractFn: ExtractFn;
  /**
   * Optional span sink. When supplied, one `ingest.graph` span is emitted with
   * scalar counts only (never entity / relation names or chunk content).
   */
  onSpan?: OnSpan;
}

/** Options for {@link graphRecall}. */
export interface GraphRecallOptions {
  /**
   * Maximum hits returned. Range [1, 1000] — mirrors the hybrid per-source
   * candidate cap. @default 30
   */
  topK?: number;
}

/**
 * Result from {@link graphRecall} — one chunk reached through the entity graph.
 *
 * Projection contract intentionally mirrors {@link FtsHit} / {@link VecHit}:
 * `docId` is drawn from the same `docs.id` space (the `rrfFuse` caller
 * contract), `chunk` carries the canonical content + provenance, and
 * `graphRank` is the 1-indexed position within this source's ordering
 * (consumed by RRF `1/(k + rank)`).
 */
export interface GraphHit {
  /** `docs.id` of the back-linked source chunk. */
  docId: number;
  /** Chunk content + provenance, projected from the `docs` row. */
  chunk: Chunk;
  /** Number of distinct matched query entities that mention this chunk. */
  matchCount: number;
  /** 1-indexed position in the returned ordering (score-descending). */
  graphRank: number;
}

/** Row counts returned by {@link writeGraph} for one persistence pass. */
export interface GraphStats {
  /** New entity rows inserted (already-present rows are ignored). */
  entitiesInserted: number;
  /** New relation rows inserted. */
  relationsInserted: number;
  /** New entity→chunk back-link rows inserted. */
  entityMentions: number;
  /** New relation→chunk back-link rows inserted. */
  relationMentions: number;
  /** Wall-clock duration of the persistence transaction, in milliseconds. */
  durationMs: number;
}
