import type { FusedRow, RankedRow, RrfOptions } from './types.js';

/**
 * Maximum allowed value for `RrfOptions.k` and the per-source ranked-list
 * length cap. The upper bound is chosen so a worst-case fusion of two sources
 * with `rank = 1000` still produces stable floating-point scores; values
 * beyond this range are almost always caller bugs (e.g. `Number.MAX_SAFE_INTEGER`
 * accidentally forwarded as `topK`).
 */
const MAX_K = 1000;

function assertValidK(k: number): void {
  if (!Number.isInteger(k) || k < 1 || k > MAX_K) {
    throw new Error(`rrfFuse: k must be an integer in [1, ${MAX_K}], got ${String(k)}`);
  }
}

function assertValidTopK(topK: number): void {
  if (topK === Number.POSITIVE_INFINITY) return;
  if (!Number.isInteger(topK) || topK < 1) {
    throw new Error(`rrfFuse: topK must be a positive integer (or Infinity), got ${String(topK)}`);
  }
}

/**
 * Reciprocal Rank Fusion (Cormack / Clarke / Büttcher 2009, SIGIR).
 *
 * Given any number of ranked input lists, accumulates a per-id score of
 * `Σ 1/(k + rank_i)` across whichever sources contain the id, then sorts
 * descending by score (ties broken by id ascending for determinism).
 *
 * The fused output preserves per-source rank lookups and payload pointers
 * so single-source survival (BDD#2 in Story 2.4) is observable downstream:
 * an id that only one source returned ends up with `null` in the other
 * source's `ranks` / `payloads` slot.
 *
 * Normalization-free by design — that is the whole point of RRF (Cormack
 * 2009 §3.2 "normalization is the source of degradation"); do not preprocess
 * BM25 / vec scores into a shared scale before fusing.
 */
export function rrfFuse<T>(
  sources: ReadonlyArray<ReadonlyArray<RankedRow<T>>>,
  opts: RrfOptions = {},
): FusedRow<T>[] {
  const k = opts.k ?? 60;
  const topK = opts.topK ?? Number.POSITIVE_INFINITY;
  assertValidK(k);
  assertValidTopK(topK);

  const sourceCount = sources.length;
  if (sourceCount === 0) return [];

  const accumulator = new Map<number, FusedRow<T>>();

  for (let i = 0; i < sourceCount; i += 1) {
    const list = sources[i];
    if (!list) continue;
    const seenIds = new Set<number>();
    for (let j = 0; j < list.length; j += 1) {
      const row = list[j];
      if (!row) continue;
      const { id, rank, payload } = row;
      if (!Number.isInteger(rank) || rank < 1) {
        throw new Error(
          `rrfFuse: rank must be a positive integer at source[${i}][${j}], got ${String(rank)}`,
        );
      }
      if (seenIds.has(id)) {
        throw new Error(`rrfFuse: duplicate id ${id} within source[${i}]`);
      }
      seenIds.add(id);

      let fused = accumulator.get(id);
      if (!fused) {
        const ranks: Array<number | null> = new Array(sourceCount).fill(null);
        const payloads: Array<T | null> = new Array(sourceCount).fill(null);
        fused = { id, score: 0, ranks, payloads };
        accumulator.set(id, fused);
      }
      fused.score += 1 / (k + rank);
      fused.ranks[i] = rank;
      fused.payloads[i] = payload;
    }
  }

  const fusedList = Array.from(accumulator.values()).sort(
    (a, b) => b.score - a.score || a.id - b.id,
  );

  if (topK === Number.POSITIVE_INFINITY) return fusedList;
  return fusedList.slice(0, topK);
}
