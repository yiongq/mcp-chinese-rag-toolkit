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
 * Shared upper bound for all three positive-integer options. Mirrors
 * `rrfFuse`'s `MAX_K` and keeps `perSourceTopK` below sqlite-vec's practical
 * RAM ceiling on 1024-dim fp32 vectors.
 */
const MAX_OPTION_VALUE = 1000;

function assertPositiveIntegerOption(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_OPTION_VALUE) {
    throw new Error(
      `hybridSearch: ${field} must be an integer in [1, ${MAX_OPTION_VALUE}], got ${String(value)}`,
    );
  }
}

/**
 * Build a bound hybrid-search function from a Story 2.2 `IndexHandle` and a
 * Story 2.3 `Embedder`. The returned function runs `ftsSearch` (BM25 +
 * jieba) and `embed(query) → vecSearch` (sqlite-vec) in parallel and fuses
 * the two ranked lists via Reciprocal Rank Fusion (`score = Σ 1/(k + rank)`,
 * default `k = 60`, Cormack 2009).
 *
 * The factory itself is side-effect-free: it captures `handle` / `embedder` /
 * `defaultOpts` in a closure but performs no I/O until the bound function is
 * invoked. Errors thrown by `embedder.embed`, `handle.ftsSearch`, or
 * `handle.vecSearch` propagate directly to the caller — error normalization
 * is the responsibility of the surrounding tool handler (per
 * `docs/conventions.md §2.4`).
 */
export function createHybridSearch(deps: HybridSearchDeps): HybridSearchFn {
  const { handle, embedder, defaultOpts } = deps;

  return async function hybridSearch(
    query: string,
    opts: HybridSearchOptions = {},
  ): Promise<HybridHit[]> {
    if (typeof query !== 'string' || query.trim().length === 0) {
      throw new Error('hybridSearch: query must be a non-empty string');
    }

    const perSourceTopK =
      opts.perSourceTopK ?? defaultOpts?.perSourceTopK ?? DEFAULT_PER_SOURCE_TOP_K;
    const topK = opts.topK ?? defaultOpts?.topK ?? DEFAULT_TOP_K;
    const rrfK = opts.rrfK ?? defaultOpts?.rrfK ?? DEFAULT_RRF_K;
    assertPositiveIntegerOption(perSourceTopK, 'perSourceTopK');
    assertPositiveIntegerOption(topK, 'topK');
    assertPositiveIntegerOption(rrfK, 'rrfK');

    const [ftsHits, vecHits] = await Promise.all([
      Promise.resolve(handle.ftsSearch(query, { topK: perSourceTopK })),
      embedder.embed(query).then((emb) => handle.vecSearch(emb, { topK: perSourceTopK })),
    ]);

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
        // Defensive: `rrfFuse` only emits rows where at least one source hit,
        // so payloads must have at least one non-null entry. This branch is
        // unreachable; the cast keeps the type narrowing honest.
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
