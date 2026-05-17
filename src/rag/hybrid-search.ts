import { rrfFuse } from './rrf.js';
import type {
  FtsHit,
  HybridHit,
  HybridSearchDeps,
  HybridSearchFn,
  HybridSearchOptions,
  RankedRow,
  VecHit,
} from './types.js';

/**
 * Per-source candidate cap default — sized to feed Story 2.5 reranker with
 * 60 unique candidates (worst-case 30+30, when the two sources are disjoint).
 */
const DEFAULT_PER_SOURCE_TOP_K = 30;
/** Final fused top-K default — matches the `search_hr_docs` envelope contract. */
const DEFAULT_TOP_K = 10;
/** RRF constant default — Cormack 2009 / Elasticsearch / Weaviate convention. */
const DEFAULT_RRF_K = 60;
/**
 * Shared upper bound for the bounded options (`perSourceTopK` / `rrfK`).
 * Mirrors `rrfFuse`'s `MAX_K` and comfortably fits sqlite-vec's per-query
 * memory budget on 1024-dim fp32 vectors (~4 MB at k = 1000).
 */
const MAX_OPTION_VALUE = 1000;

function assertBoundedPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_OPTION_VALUE) {
    throw new Error(
      `hybridSearch: ${field} must be an integer in [1, ${MAX_OPTION_VALUE}], got ${String(value)}`,
    );
  }
}

/**
 * `topK` accepts `Infinity` for "return every fused hit", matching `rrfFuse`'s
 * contract; the bounded options (`perSourceTopK` / `rrfK`) stay capped.
 */
function assertValidTopK(value: number): void {
  if (value === Number.POSITIVE_INFINITY) return;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `hybridSearch: topK must be a positive integer (or Infinity), got ${String(value)}`,
    );
  }
}

function validateDefaultOpts(opts: HybridSearchOptions): void {
  if (opts.perSourceTopK !== undefined) {
    assertBoundedPositiveInteger(opts.perSourceTopK, 'perSourceTopK');
  }
  if (opts.topK !== undefined) assertValidTopK(opts.topK);
  if (opts.rrfK !== undefined) assertBoundedPositiveInteger(opts.rrfK, 'rrfK');
}

function readHandleEmbeddingDim(handle: HybridSearchDeps['handle']): number | undefined {
  // The `meta` table is owned by Story 2.2 `buildSchema`; if a caller bypasses
  // `openIndex` we surface a friendlier message at factory time rather than
  // letting `vecSearch` throw on the first query.
  try {
    const row = handle.db
      .prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?')
      .get('embedding_dim');
    if (!row) return undefined;
    const parsed = Number(row.value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build a bound hybrid-search function from a Story 2.2 `IndexHandle` and a
 * Story 2.3 `Embedder`. The returned function runs `ftsSearch` (BM25 +
 * jieba) and `embed(query) → vecSearch` (sqlite-vec) in parallel and fuses
 * the two ranked lists via Reciprocal Rank Fusion (`score = Σ 1/(k + rank)`,
 * default `k = 60`, Cormack 2009).
 *
 * The factory itself is side-effect-free w.r.t. db writes: it captures
 * `handle` / `embedder` / `defaultOpts` in a closure, runs a single read on
 * `meta.embedding_dim` to fail fast on `(handle, embedder)` dim mismatches,
 * validates `defaultOpts`, and freezes a shallow clone so later caller-side
 * mutation cannot drift the effective defaults. Errors thrown by
 * `embedder.embed`, `handle.ftsSearch`, or `handle.vecSearch` propagate
 * directly to the caller — error normalization is the responsibility of the
 * surrounding tool handler (per `docs/conventions.md §2.4`).
 */
export function createHybridSearch(deps: HybridSearchDeps): HybridSearchFn {
  const { handle, embedder, defaultOpts } = deps;

  const handleDim = readHandleEmbeddingDim(handle);
  if (handleDim !== undefined && handleDim !== embedder.dim) {
    throw new Error(
      `createHybridSearch: embedder.dim (${embedder.dim}) does not match handle's meta.embedding_dim (${handleDim}). ` +
        'The index was built for a different vector size; rebuild the .db with a matching embedder or pass a matching embedder.',
    );
  }

  let frozenDefaults: HybridSearchOptions | undefined;
  if (defaultOpts !== undefined) {
    validateDefaultOpts(defaultOpts);
    frozenDefaults = Object.freeze({ ...defaultOpts });
  }

  return async function hybridSearch(
    query: string,
    opts: HybridSearchOptions = {},
  ): Promise<HybridHit[]> {
    if (typeof query !== 'string' || query.trim().length === 0) {
      throw new Error('hybridSearch: query must be a non-empty string');
    }

    const perSourceTopK =
      opts.perSourceTopK ?? frozenDefaults?.perSourceTopK ?? DEFAULT_PER_SOURCE_TOP_K;
    const topK = opts.topK ?? frozenDefaults?.topK ?? DEFAULT_TOP_K;
    const rrfK = opts.rrfK ?? frozenDefaults?.rrfK ?? DEFAULT_RRF_K;
    assertBoundedPositiveInteger(perSourceTopK, 'perSourceTopK');
    assertValidTopK(topK);
    assertBoundedPositiveInteger(rrfK, 'rrfK');

    // Order matters: start `embed()` first so the async ONNX work yields the
    // event loop before the synchronous better-sqlite3 `ftsSearch` runs.
    // Inlining both expressions into the `Promise.all([...])` literal would
    // evaluate them left-to-right at call site, making FTS block embed —
    // see Story 2.4 code-review M1 / AC11 sanity test.
    const vecPromise = embedder
      .embed(query)
      .then((emb) => handle.vecSearch(emb, { topK: perSourceTopK }));
    const ftsHits = handle.ftsSearch(query, { topK: perSourceTopK });
    const vecHits = await vecPromise;

    const ftsRanked: RankedRow<FtsHit>[] = ftsHits.map((hit) => ({
      id: hit.docId,
      payload: hit,
      rank: hit.bm25Rank,
    }));
    const vecRanked: RankedRow<VecHit>[] = vecHits.map((hit, index) => ({
      id: hit.docId,
      payload: hit,
      rank: index + 1,
    }));

    const fused = rrfFuse<FtsHit | VecHit>([ftsRanked, vecRanked], { k: rrfK, topK });

    return fused.map((row) => {
      const ftsPayload = row.payloads[0] as FtsHit | null;
      const vecPayload = row.payloads[1] as VecHit | null;
      // Both sources project from `docs.id`; whichever populated this row
      // carries the canonical chunk metadata.
      const chunk = ftsPayload?.chunk ?? vecPayload?.chunk;
      if (!chunk) {
        // `rrfFuse` only emits rows where at least one source hit, so payloads
        // are guaranteed to have at least one non-null entry. The throw keeps
        // TypeScript narrowing honest and surfaces any future regression.
        throw new Error(`hybridSearch: fused row for docId ${row.id} has no chunk payload`);
      }
      const hit: HybridHit = {
        docId: row.id,
        chunk,
        rrfScore: row.score,
      };
      const bm25Rank = row.ranks[0];
      if (bm25Rank !== null && bm25Rank !== undefined) hit.bm25Rank = bm25Rank;
      if (ftsPayload) hit.bm25Score = ftsPayload.bm25Score;
      const vecRank = row.ranks[1];
      if (vecRank !== null && vecRank !== undefined) hit.vecRank = vecRank;
      if (vecPayload) hit.distance = vecPayload.distance;
      return hit;
    });
  };
}
