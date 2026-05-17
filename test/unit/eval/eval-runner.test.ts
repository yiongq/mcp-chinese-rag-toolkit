import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_EVAL_TOP_K,
  loadEvalSet,
  runEval,
  scoreQuery,
} from '../../../src/eval/eval-runner.js';
import type {
  EvalQuery,
  EvalSearchFn,
  EvalSearchResult,
  EvalSet,
} from '../../../src/eval/types.js';

function makeQuery(over: Partial<EvalQuery> = {}): EvalQuery {
  return {
    query: '试用期多久',
    expected: [{ source: 'bench-fixture.md', page: 3 }],
    ...over,
  };
}

function makeResult(over: Partial<EvalSearchResult> = {}): EvalSearchResult {
  return { source: 'bench-fixture.md', page: 3, ...over };
}

describe('loadEvalSet', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'eval-runner-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeYaml(name: string, body: string): string {
    const p = path.join(tmpDir, name);
    writeFileSync(p, body, 'utf8');
    return p;
  }

  it('throws actionable error when file does not exist', () => {
    expect(() => loadEvalSet(path.join(tmpDir, 'missing.yml'))).toThrow(
      /loadEvalSet: failed to read .*missing\.yml/,
    );
  });

  it('throws on empty file', () => {
    const p = writeYaml('empty.yml', '   \n');
    expect(() => loadEvalSet(p)).toThrow(/is empty/);
  });

  it('throws when top-level is not a mapping', () => {
    const p = writeYaml('arr.yml', '- one\n- two\n');
    expect(() => loadEvalSet(p)).toThrow(/top-level must be a mapping/);
  });

  it('throws when version is missing', () => {
    const p = writeYaml(
      'no-version.yml',
      'queries:\n  - query: a\n    expected: [{ source: x }]\n',
    );
    expect(() => loadEvalSet(p)).toThrow(/missing required string field 'version'/);
  });

  it('throws when queries is missing or empty', () => {
    const empty = writeYaml('empty-queries.yml', 'version: v1\nqueries: []\n');
    expect(() => loadEvalSet(empty)).toThrow(/queries.*non-empty array/);
  });

  it('throws when expected is empty', () => {
    const p = writeYaml(
      'empty-expected.yml',
      'version: v1\nqueries:\n  - query: a\n    expected: []\n',
    );
    expect(() => loadEvalSet(p)).toThrow(/must declare ≥ 1 expected sources/);
  });

  it('throws when expected.source is missing', () => {
    const p = writeYaml(
      'no-source.yml',
      'version: v1\nqueries:\n  - query: a\n    expected:\n      - page: 1\n',
    );
    expect(() => loadEvalSet(p)).toThrow(/expected\[0\]\.source must be a non-empty string/);
  });

  it('throws when expected.page is not a positive integer', () => {
    const p = writeYaml(
      'bad-page.yml',
      'version: v1\nqueries:\n  - query: a\n    expected:\n      - source: x\n        page: 0\n',
    );
    expect(() => loadEvalSet(p)).toThrow(/page must be a positive integer/);
  });

  it('fails fast on duplicate map keys (uniqueKeys: true)', () => {
    // Two `expected:` blocks under the same query would silently last-wins by
    // default; for a CI gate that decides merge eligibility we must surface
    // the typo immediately. Review fix M4.
    const body =
      'version: v1\nqueries:\n  - query: a\n    expected:\n      - source: x\n    expected:\n      - source: y\n';
    const p = writeYaml('dup-keys.yml', body);
    expect(() => loadEvalSet(p)).toThrow(/YAML parse errors/);
  });

  it('treats empty / whitespace-only inline `reason:` as absent and falls back to comment', () => {
    // Review fix M5 — an inline `reason: ""` should not silently override the
    // comment-based reason and defeat AI Agent Rule #9.
    const body = `version: v1\nqueries:\n  # reason: comment-version\n  - query: a\n    reason: ''\n    expected:\n      - source: bench-fixture.md\n        page: 1\n`;
    const p = writeYaml('empty-inline-reason.yml', body);
    const set = loadEvalSet(p);
    expect(set.queries[0]?.reason).toBe('comment-version');
  });

  it('recovers item[0] reason from sequence-level commentBefore when item-level comment is unrelated', () => {
    // Review fix M6 — if the user puts an unrelated comment immediately before
    // the first item, the seq-level `# reason:` between `queries:` and the
    // first list entry must still be picked up rather than silently dropped.
    const body = `version: v1\nqueries:\n  # reason: seq-level\n  # not a reason note\n  - query: a\n    expected:\n      - source: x\n`;
    const p = writeYaml('seq-reason.yml', body);
    const set = loadEvalSet(p);
    expect(set.queries[0]?.reason).toBe('seq-level');
  });

  it('extracts `# reason:` comments from queries', () => {
    const body = `version: v1\nqueries:\n  # reason: BM25 sanity\n  - query: 差旅\n    expected:\n      - source: bench-fixture.md\n        page: 1\n  # not-reason: ignored\n  # reason: 同义改写\n  - query: 实习\n    expected:\n      - source: bench-fixture.md\n        page: 2\n`;
    const p = writeYaml('reasons.yml', body);
    const set = loadEvalSet(p);
    expect(set.queries[0]?.reason).toBe('BM25 sanity');
    expect(set.queries[1]?.reason).toBe('同义改写');
  });

  it('prefers inline `reason:` field over comment fallback', () => {
    const body = `version: v1\nqueries:\n  # reason: comment-version\n  - query: 试用期多久\n    reason: inline-version\n    expected:\n      - source: bench-fixture.md\n        page: 3\n`;
    const p = writeYaml('inline-reason.yml', body);
    const set = loadEvalSet(p);
    expect(set.queries[0]?.reason).toBe('inline-version');
  });

  it('parses description + category + version through to EvalSet', () => {
    const body = `version: v1-mini\ndescription: smoke\nqueries:\n  - query: q1\n    category: leave-policy\n    expected:\n      - source: x\n`;
    const p = writeYaml('full.yml', body);
    const set = loadEvalSet(p);
    expect(set.version).toBe('v1-mini');
    expect(set.description).toBe('smoke');
    expect(set.queries[0]?.category).toBe('leave-policy');
  });
});

describe('scoreQuery', () => {
  it('returns rank 1 + RR 1 when first result matches', () => {
    const out = scoreQuery(makeQuery(), [makeResult({ page: 3 })]);
    expect(out).toEqual({ hitRank: 1, reciprocalRank: 1 });
  });

  it('returns rank 3 + RR 1/3 when third result matches', () => {
    const out = scoreQuery(makeQuery(), [
      makeResult({ source: 'other.md', page: 1 }),
      makeResult({ source: 'other.md', page: 2 }),
      makeResult({ source: 'bench-fixture.md', page: 9 }),
    ]);
    expect(out.hitRank).toBe(3);
    expect(out.reciprocalRank).toBeCloseTo(1 / 3, 10);
  });

  it('returns RR 0 when no result matches', () => {
    const out = scoreQuery(makeQuery(), [makeResult({ source: 'other.md', page: 99 })]);
    expect(out).toEqual({ reciprocalRank: 0 });
    expect(out.hitRank).toBeUndefined();
  });

  it('strict mode rejects matching source with mismatched page', () => {
    const q = makeQuery({ expected: [{ source: 'bench-fixture.md', page: 3 }] });
    const out = scoreQuery(q, [makeResult({ page: 4 })], { strict: true });
    expect(out.reciprocalRank).toBe(0);
  });

  it('strict mode accepts matching source + matching page', () => {
    const q = makeQuery({ expected: [{ source: 'bench-fixture.md', page: 3 }] });
    const out = scoreQuery(q, [makeResult({ page: 3 })], { strict: true });
    expect(out.hitRank).toBe(1);
  });

  it('expected entries are OR-semantics (any match scores)', () => {
    const q = makeQuery({
      expected: [
        { source: 'a.md', page: 1 },
        { source: 'b.md', page: 2 },
      ],
    });
    const out = scoreQuery(q, [makeResult({ source: 'b.md', page: 2 })]);
    expect(out.hitRank).toBe(1);
  });

  it('handles empty topResults gracefully', () => {
    const out = scoreQuery(makeQuery(), []);
    expect(out).toEqual({ reciprocalRank: 0 });
  });
});

describe('runEval', () => {
  const baseSet: EvalSet = {
    version: 'v1-test',
    queries: [
      { query: 'q1', expected: [{ source: 'a.md', page: 1 }] },
      { query: 'q2', expected: [{ source: 'b.md', page: 2 }] },
      { query: 'q3', expected: [{ source: 'c.md', page: 3 }] },
      { query: 'q4', expected: [{ source: 'd.md', page: 4 }] },
    ],
  };

  it('throws when topK is not a positive integer', async () => {
    await expect(
      runEval(baseSet, { searchFn: (async () => []) as EvalSearchFn, topK: 0 }),
    ).rejects.toThrow(/topK must be a positive integer/);
    await expect(
      runEval(baseSet, { searchFn: (async () => []) as EvalSearchFn, topK: 1.5 }),
    ).rejects.toThrow(/topK must be a positive integer/);
  });

  it('throws when searchFn is not a function', async () => {
    await expect(
      runEval(baseSet, { searchFn: undefined as unknown as EvalSearchFn }),
    ).rejects.toThrow(/searchFn must be a function/);
  });

  it('produces hitRate=1 and mrr=1 with a perfect searchFn', async () => {
    const perfect: EvalSearchFn = async (q) => {
      const map: Record<string, EvalSearchResult> = {
        q1: { source: 'a.md', page: 1 },
        q2: { source: 'b.md', page: 2 },
        q3: { source: 'c.md', page: 3 },
        q4: { source: 'd.md', page: 4 },
      };
      const hit = map[q];
      return hit ? [hit] : [];
    };
    const summary = await runEval(baseSet, { searchFn: perfect });
    expect(summary.hitRate).toBe(1);
    expect(summary.mrr).toBe(1);
    expect(summary.topK).toBe(DEFAULT_EVAL_TOP_K);
    expect(summary.totalQueries).toBe(4);
    expect(summary.perQuery).toHaveLength(4);
    expect(summary.perQuery.every((r) => r.hitRank === 1)).toBe(true);
    expect(summary.evalSetVersion).toBe('v1-test');
    expect(summary.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(summary.hitRateByCategory).toBeUndefined();
  });

  it('produces hitRate=0 and mrr=0 with an all-miss searchFn', async () => {
    const miss: EvalSearchFn = async () => [{ source: 'nope.md', page: 99 }];
    const summary = await runEval(baseSet, { searchFn: miss });
    expect(summary.hitRate).toBe(0);
    expect(summary.mrr).toBe(0);
    expect(summary.perQuery.every((r) => r.hitRank === undefined)).toBe(true);
  });

  it('computes partial hit rate + MRR correctly', async () => {
    // q1 hits at rank 1 → RR=1, q2 hits at rank 2 → RR=0.5, q3/q4 miss → RR=0
    const partial: EvalSearchFn = async (q) => {
      if (q === 'q1') return [{ source: 'a.md', page: 1 }];
      if (q === 'q2') {
        return [
          { source: 'nope.md', page: 0 },
          { source: 'b.md', page: 2 },
        ];
      }
      return [{ source: 'nope.md', page: 0 }];
    };
    const summary = await runEval(baseSet, { searchFn: partial });
    expect(summary.hitRate).toBe(0.5);
    // MRR = (1 + 0.5 + 0 + 0) / 4 = 0.375
    expect(summary.mrr).toBeCloseTo(0.375, 10);
  });

  it('honours custom topK and forwards it to searchFn', async () => {
    const seen: number[] = [];
    const sf: EvalSearchFn = async (_q, opts) => {
      seen.push(opts?.topK ?? -1);
      return [{ source: 'a.md', page: 1 }];
    };
    const summary = await runEval(baseSet, { searchFn: sf, topK: 10 });
    expect(seen.every((v) => v === 10)).toBe(true);
    expect(summary.topK).toBe(10);
  });

  it('builds hitRateByCategory only when at least one query carries a category', async () => {
    const withCat: EvalSet = {
      version: 'v1-cats',
      queries: [
        { query: 'q1', category: 'leave-policy', expected: [{ source: 'a.md' }] },
        { query: 'q2', category: 'leave-policy', expected: [{ source: 'b.md' }] },
        { query: 'q3', category: 'training', expected: [{ source: 'c.md' }] },
      ],
    };
    // q1 hits, q2 misses, q3 hits
    const sf: EvalSearchFn = async (q) => {
      if (q === 'q1') return [{ source: 'a.md' }];
      if (q === 'q3') return [{ source: 'c.md' }];
      return [{ source: 'nope.md' }];
    };
    const summary = await runEval(withCat, { searchFn: sf });
    expect(summary.hitRateByCategory).toBeDefined();
    expect(summary.hitRateByCategory?.['leave-policy']).toEqual({
      hits: 1,
      total: 2,
      hitRate: 0.5,
    });
    expect(summary.hitRateByCategory?.training).toEqual({ hits: 1, total: 1, hitRate: 1 });
  });

  it('preserves topResults verbatim for debugging', async () => {
    const detailed: EvalSearchResult[] = [
      { source: 'a.md', page: 1, rerankScore: 0.92, distance: 0.31, ftsRank: 1 },
      { source: 'b.md', page: 2, rerankScore: 0.41 },
    ];
    const sf: EvalSearchFn = async () => detailed;
    const summary = await runEval(
      { version: 'v', queries: [{ query: 'x', expected: [{ source: 'a.md' }] }] },
      { searchFn: sf },
    );
    expect(summary.perQuery[0]?.topResults).toEqual(detailed);
  });

  it('forwards strict mode to scoreQuery', async () => {
    const sf: EvalSearchFn = async () => [{ source: 'a.md', page: 99 }];
    const set: EvalSet = {
      version: 'v',
      queries: [{ query: 'q', expected: [{ source: 'a.md', page: 1 }] }],
    };
    const strict = await runEval(set, { searchFn: sf, strict: true });
    expect(strict.hitRate).toBe(0);
    const loose = await runEval(set, { searchFn: sf, strict: false });
    expect(loose.hitRate).toBe(1);
  });

  it('returns zeros (no NaN) when the eval set has 0 queries — defensive guard', async () => {
    const empty: EvalSet = { version: 'v', queries: [] };
    const sf: EvalSearchFn = async () => [];
    const summary = await runEval(empty, { searchFn: sf });
    expect(summary.hitRate).toBe(0);
    expect(summary.mrr).toBe(0);
    expect(summary.totalQueries).toBe(0);
  });

  it('captures category + reason fields on each EvalQueryResult row', async () => {
    const set: EvalSet = {
      version: 'v',
      queries: [
        {
          query: 'q',
          category: 'leave-policy',
          reason: 'because',
          expected: [{ source: 'a.md' }],
        },
      ],
    };
    const sf: EvalSearchFn = async () => [{ source: 'a.md' }];
    const summary = await runEval(set, { searchFn: sf });
    expect(summary.perQuery[0]?.category).toBe('leave-policy');
    expect(summary.perQuery[0]?.reason).toBe('because');
  });

  it('truncates searchFn results to topK before scoring (Hit Rate@K contract)', async () => {
    // Review fix H1 — a provider returning > topK rows must NOT inflate Hit Rate.
    // Here the EXPECTED source lands at rank 10 but topK=5, so it should MISS.
    const set: EvalSet = {
      version: 'v',
      queries: [{ query: 'q', expected: [{ source: 'target.md' }] }],
    };
    const sf: EvalSearchFn = async () => [
      ...Array.from({ length: 9 }, (_, i) => ({ source: `noise-${i}.md` })),
      { source: 'target.md' }, // rank 10
    ];
    const summary = await runEval(set, { searchFn: sf, topK: 5 });
    expect(summary.hitRate).toBe(0);
    expect(summary.perQuery[0]?.topResults).toHaveLength(5);
    expect(summary.perQuery[0]?.hitRank).toBeUndefined();
  });

  it('records searchFn throw on the per-query row and continues with remaining queries', async () => {
    // Review fix M8 — one failing query must not abort the whole eval.
    const set: EvalSet = {
      version: 'v',
      queries: [
        { query: 'q1', expected: [{ source: 'a.md' }] },
        { query: 'q2-bad', expected: [{ source: 'b.md' }] },
        { query: 'q3', expected: [{ source: 'c.md' }] },
      ],
    };
    const sf: EvalSearchFn = async (q) => {
      if (q === 'q2-bad') throw new Error('boom');
      return [{ source: q === 'q1' ? 'a.md' : 'c.md' }];
    };
    const summary = await runEval(set, { searchFn: sf });
    expect(summary.perQuery).toHaveLength(3);
    expect(summary.perQuery[0]?.hitRank).toBe(1);
    expect(summary.perQuery[1]?.error).toBe('boom');
    expect(summary.perQuery[1]?.hitRank).toBeUndefined();
    expect(summary.perQuery[2]?.hitRank).toBe(1);
    expect(summary.hitRate).toBeCloseTo(2 / 3, 10);
  });

  it('records an error when searchFn returns a non-array (M9 shape validation)', async () => {
    const set: EvalSet = {
      version: 'v',
      queries: [{ query: 'q', expected: [{ source: 'a.md' }] }],
    };
    const sf = (async () => null) as unknown as EvalSearchFn;
    const summary = await runEval(set, { searchFn: sf });
    expect(summary.perQuery[0]?.error).toMatch(/returned non-array/);
    expect(summary.hitRate).toBe(0);
  });

  it('records an error when a searchFn row is missing the required `source` field', async () => {
    const set: EvalSet = {
      version: 'v',
      queries: [{ query: 'q', expected: [{ source: 'a.md' }] }],
    };
    const sf = (async () => [{ page: 1 }]) as unknown as EvalSearchFn;
    const summary = await runEval(set, { searchFn: sf });
    expect(summary.perQuery[0]?.error).toMatch(/result\[0\] without a string 'source'/);
    expect(summary.hitRate).toBe(0);
  });
});
