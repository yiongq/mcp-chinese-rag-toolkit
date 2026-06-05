import { describe, expect, it } from 'vitest';

import { rrfFuse } from '../../../src/rag/rrf.js';
import type { FtsHit, RankedRow } from '../../../src/rag/types.js';

interface Payload {
  label: string;
}

function row(id: number, rank: number, label: string = `p${id}`): RankedRow<Payload> {
  return { id, rank, payload: { label } };
}

describe('rrfFuse', () => {
  it('returns [] for empty sources array', () => {
    expect(rrfFuse([])).toEqual([]);
    expect(rrfFuse([], { k: 60 })).toEqual([]);
  });

  it('returns [] when every source is empty', () => {
    expect(rrfFuse([[]])).toEqual([]);
    expect(rrfFuse([[], [], []], { k: 60 })).toEqual([]);
  });

  it('matches the exact two-source RRF math from the spec', () => {
    const source0: RankedRow<Payload>[] = [row(1, 1, 'a'), row(2, 2, 'b'), row(3, 3, 'c')];
    const source1: RankedRow<Payload>[] = [row(2, 1, 'B'), row(3, 2, 'C'), row(4, 3, 'D')];
    const fused = rrfFuse([source0, source1], { k: 60 });

    expect(fused.map((r) => r.id)).toEqual([2, 3, 1, 4]);

    const score2 = 1 / 62 + 1 / 61;
    const score3 = 1 / 63 + 1 / 62;
    const score1 = 1 / 61;
    const score4 = 1 / 63;

    expect(fused[0]?.score).toBe(score2);
    expect(fused[1]?.score).toBe(score3);
    expect(fused[2]?.score).toBe(score1);
    expect(fused[3]?.score).toBe(score4);
  });

  it('applies topK truncation after fusion', () => {
    const source0: RankedRow<Payload>[] = [row(1, 1), row(2, 2), row(3, 3)];
    const source1: RankedRow<Payload>[] = [row(2, 1), row(3, 2), row(4, 3)];
    const fused = rrfFuse([source0, source1], { k: 60, topK: 2 });
    expect(fused.map((r) => r.id)).toEqual([2, 3]);
  });

  it('preserves single-source survival (BDD#2 mathematical root cause)', () => {
    const source0: RankedRow<Payload>[] = [row(1, 1, 'only-source0')];
    const source1: RankedRow<Payload>[] = [];
    const fused = rrfFuse([source0, source1], { k: 60 });

    expect(fused).toHaveLength(1);
    const only = fused[0];
    expect(only?.id).toBe(1);
    expect(only?.score).toBe(1 / 61);
    expect(only?.ranks).toEqual([1, null]);
    expect(only?.payloads).toEqual([{ label: 'only-source0' }, null]);
  });

  it('supports three-source fusion (e.g. fts + vec + reranker)', () => {
    const source0: RankedRow<Payload>[] = [row(7, 1, 'fts-top')];
    const source1: RankedRow<Payload>[] = [row(7, 3, 'vec-3rd')];
    const source2: RankedRow<Payload>[] = [row(7, 2, 'rerank-2nd')];
    const fused = rrfFuse([source0, source1, source2], { k: 60 });

    expect(fused).toHaveLength(1);
    const r = fused[0];
    expect(r?.id).toBe(7);
    expect(r?.score).toBe(1 / 61 + 1 / 63 + 1 / 62);
    expect(r?.ranks).toEqual([1, 3, 2]);
    expect(r?.payloads).toHaveLength(3);
  });

  it('fills `ranks` / `payloads` with null for sources that did not hit', () => {
    const source0: RankedRow<Payload>[] = [row(1, 1, 'a')];
    const source1: RankedRow<Payload>[] = [row(2, 1, 'B')];
    const source2: RankedRow<Payload>[] = [];
    const fused = rrfFuse([source0, source1, source2], { k: 60 });

    for (const r of fused) {
      expect(r.ranks).toHaveLength(3);
      expect(r.payloads).toHaveLength(3);
    }
    const r1 = fused.find((r) => r.id === 1);
    expect(r1?.ranks).toEqual([1, null, null]);
    expect(r1?.payloads).toEqual([{ label: 'a' }, null, null]);
    const r2 = fused.find((r) => r.id === 2);
    expect(r2?.ranks).toEqual([null, 1, null]);
  });

  it('tiebreaks equal scores by id ascending (deterministic ordering)', () => {
    // Both id=5 and id=9 only appear in source0 at rank=1 → identical scores.
    const source0: RankedRow<Payload>[] = [row(5, 1, 'a'), row(9, 1, 'b')];
    // duplicate id check would fire on a single source — so we put 9 in source0 only.
    const source1: RankedRow<Payload>[] = [];
    const fused = rrfFuse([source0, source1], { k: 60 });
    expect(fused.map((r) => r.id)).toEqual([5, 9]);
  });

  it('handles k=1 (extreme head-bias) and k=1000 (almost flat) without throwing', () => {
    const source0: RankedRow<Payload>[] = [row(1, 1), row(2, 2)];
    const source1: RankedRow<Payload>[] = [row(2, 1), row(1, 2)];

    const headBiased = rrfFuse([source0, source1], { k: 1 });
    expect(headBiased[0]?.score).toBe(1 / 2 + 1 / 3);

    const flat = rrfFuse([source0, source1], { k: 1000 });
    expect(flat).toHaveLength(2);
    // With k=1000 the score difference between 1/1001 + 1/1002 vs 1/1002 + 1/1001
    // is exactly zero for symmetric inputs — both ids fuse to the same score.
    expect(flat[0]?.score).toBe(flat[1]?.score);
  });

  it('uses topK = Infinity by default (returns every fused id)', () => {
    const source0: RankedRow<Payload>[] = Array.from({ length: 50 }, (_, i) => row(i + 1, i + 1));
    const fused = rrfFuse([source0]);
    expect(fused).toHaveLength(50);
  });

  it('rejects invalid k (out of range / fractional)', () => {
    const source0: RankedRow<Payload>[] = [row(1, 1)];
    expect(() => rrfFuse([source0], { k: 0 })).toThrow(/rrfFuse: k must be an integer/);
    expect(() => rrfFuse([source0], { k: -1 })).toThrow(/rrfFuse: k must be an integer/);
    expect(() => rrfFuse([source0], { k: 1.5 })).toThrow(/rrfFuse: k must be an integer/);
    expect(() => rrfFuse([source0], { k: 1001 })).toThrow(/rrfFuse: k must be an integer/);
  });

  it('rejects invalid topK (zero / negative)', () => {
    const source0: RankedRow<Payload>[] = [row(1, 1)];
    expect(() => rrfFuse([source0], { topK: 0 })).toThrow(
      /rrfFuse: topK must be a positive integer/,
    );
    expect(() => rrfFuse([source0], { topK: -1 })).toThrow(
      /rrfFuse: topK must be a positive integer/,
    );
    expect(() => rrfFuse([source0], { topK: 1.5 })).toThrow(
      /rrfFuse: topK must be a positive integer/,
    );
  });

  it('rejects rows whose `id` is not a safe integer (with [i][j] index in message)', () => {
    const badNaN: RankedRow<Payload>[] = [{ id: Number.NaN, rank: 1, payload: { label: 'x' } }];
    expect(() => rrfFuse([badNaN])).toThrow(
      /rrfFuse: id must be a safe integer at source\[0\]\[0\]/,
    );

    const badFloat: RankedRow<Payload>[] = [{ id: 1.5, rank: 1, payload: { label: 'x' } }];
    expect(() => rrfFuse([badFloat])).toThrow(/rrfFuse: id must be a safe integer/);

    const badInf: RankedRow<Payload>[] = [
      { id: Number.POSITIVE_INFINITY, rank: 1, payload: { label: 'x' } },
    ];
    expect(() => rrfFuse([badInf])).toThrow(/rrfFuse: id must be a safe integer/);

    const badUnsafe: RankedRow<Payload>[] = [
      { id: Number.MAX_SAFE_INTEGER + 1, rank: 1, payload: { label: 'x' } },
    ];
    expect(() => rrfFuse([badUnsafe])).toThrow(/rrfFuse: id must be a safe integer/);
  });

  it('coerces caller-supplied undefined payloads to null so single-source survival stays observable', () => {
    const source0: RankedRow<Payload | undefined>[] = [{ id: 1, rank: 1, payload: undefined }];
    const fused = rrfFuse<Payload | undefined>([source0, []]);
    expect(fused).toHaveLength(1);
    // The hit source should still record `null` (not `undefined`) so callers
    // can use a single `=== null` check for "did not hit this source".
    expect(fused[0]?.payloads[0]).toBeNull();
    expect(fused[0]?.payloads[1]).toBeNull();
    expect(fused[0]?.ranks).toEqual([1, null]);
  });

  it('rejects rows whose `rank` is not a positive integer (with [i][j] index in message)', () => {
    const bad0: RankedRow<Payload>[] = [row(1, 0)];
    expect(() => rrfFuse([bad0])).toThrow(
      /rrfFuse: rank must be a positive integer at source\[0\]\[0\]/,
    );

    const bad1: RankedRow<Payload>[] = [row(1, 1), row(2, -1)];
    expect(() => rrfFuse([bad1])).toThrow(
      /rrfFuse: rank must be a positive integer at source\[0\]\[1\]/,
    );

    const bad2: RankedRow<Payload>[] = [row(1, 1.5)];
    expect(() => rrfFuse([[], bad2])).toThrow(
      /rrfFuse: rank must be a positive integer at source\[1\]\[0\]/,
    );
  });

  it('rejects duplicate ids within a single source (prevents double-scoring)', () => {
    const dup: RankedRow<Payload>[] = [row(5, 1), row(5, 2)];
    expect(() => rrfFuse([dup])).toThrow(/rrfFuse: duplicate id 5 within source\[0\]/);
  });

  it('passes through caller-supplied payloads with their original type (compile-time)', () => {
    const ftsRow: RankedRow<FtsHit> = {
      id: 1,
      rank: 1,
      payload: {
        docId: 1,
        chunk: { content: 'x' },
        bm25Rank: 1,
        bm25Score: -1.23,
      },
    };
    const fused = rrfFuse<FtsHit>([[ftsRow], []]);
    const first = fused[0];
    expect(first?.payloads[0]?.bm25Score).toBe(-1.23);
    // Source 1 was empty, so payload[1] must be null — preserves the
    // "ranks/payloads length === sources.length" invariant.
    expect(first?.payloads[1]).toBeNull();
  });
});
