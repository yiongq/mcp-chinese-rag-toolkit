import { describe, expect, it } from 'vitest';

import { GraphError } from '../../../src/graph/errors.js';
import { extractGraph } from '../../../src/graph/extract-graph.js';
import { normalizeEntityName, relationNormalizedKey } from '../../../src/graph/normalize.js';
import type { ExtractFn, GraphChunk, RawExtraction } from '../../../src/graph/types.js';

/** Injects a fixed per-chunk extraction result, keyed by chunkId. No LLM. */
function stubExtractFn(byChunk: Record<number, RawExtraction>): ExtractFn {
  return ({ chunkId }) => Promise.resolve(byChunk[chunkId] ?? { entities: [], relations: [] });
}

function chunk(chunkId: number, content = `chunk ${chunkId}`): GraphChunk {
  return { chunkId, content };
}

describe('extractGraph — dedup + back-link', () => {
  it('deduplicates a repeated entity and accumulates every source chunk id', async () => {
    const graph = await extractGraph({
      chunks: [chunk(10), chunk(11), chunk(12)],
      extractFn: stubExtractFn({
        10: { entities: [{ name: '北京公司', type: 'org' }], relations: [] },
        11: { entities: [{ name: '北京公司', type: 'org' }], relations: [] },
        12: { entities: [{ name: '上海分部' }], relations: [] },
      }),
    });

    expect(graph.entities).toHaveLength(2);
    const beijing = graph.entities.find((e) => e.name === '北京公司');
    expect(beijing?.type).toBe('org');
    expect(beijing?.docIds).toEqual([10, 11]);
    expect(graph.failedChunks).toBe(0);
  });

  it('registers relation endpoints as entity nodes so the graph is connected', async () => {
    const graph = await extractGraph({
      chunks: [chunk(1)],
      extractFn: stubExtractFn({
        1: { entities: [], relations: [{ source: '员工', target: '部门', type: 'belongs_to' }] },
      }),
    });

    expect(graph.entities.map((e) => e.name).sort()).toEqual(['员工', '部门']);
    expect(graph.relations).toHaveLength(1);
    expect(graph.relations[0]).toMatchObject({ source: '员工', target: '部门', type: 'belongs_to' });
    expect(graph.relations[0]?.normalizedKey).toBe(relationNormalizedKey('员工', '部门', 'belongs_to'));
  });

  it('preserves relation direction and type as distinct edges', async () => {
    const graph = await extractGraph({
      chunks: [chunk(1)],
      extractFn: stubExtractFn({
        1: {
          entities: [],
          relations: [
            { source: 'A', target: 'B', type: 'manages' },
            { source: 'B', target: 'A', type: 'manages' },
            { source: 'A', target: 'B', type: 'mentors' },
          ],
        },
      }),
    });
    expect(graph.relations).toHaveLength(3);
  });

  it('accumulates a relation seen in multiple chunks onto one edge with both doc ids', async () => {
    const rel: RawExtraction = { entities: [], relations: [{ source: 'A', target: 'B' }] };
    const graph = await extractGraph({
      chunks: [chunk(5), chunk(6)],
      extractFn: stubExtractFn({ 5: rel, 6: rel }),
    });
    expect(graph.relations).toHaveLength(1);
    expect(graph.relations[0]?.docIds).toEqual([5, 6]);
  });
});

describe('extractGraph — normalization (idempotency ground truth)', () => {
  it('collapses full-width / half-width / whitespace variants of a name onto one node', async () => {
    // "北京", " 北京 " (padded), "北京　" (trailing full-width space) → one entity.
    const graph = await extractGraph({
      chunks: [chunk(1), chunk(2), chunk(3)],
      extractFn: stubExtractFn({
        1: { entities: [{ name: '北京' }], relations: [] },
        2: { entities: [{ name: ' 北京 ' }], relations: [] },
        3: { entities: [{ name: '北京　' }], relations: [] },
      }),
    });
    expect(graph.entities).toHaveLength(1);
    expect(graph.entities[0]?.docIds).toEqual([1, 2, 3]);
  });

  it('folds full-width Latin and casing (ＡＢＣ ≡ abc)', () => {
    expect(normalizeEntityName('ＡＢＣ')).toBe('abc');
    expect(normalizeEntityName('  Multi   Word ')).toBe('multi word');
  });

  it('keeps the first non-empty type even when an untyped mention arrives first', async () => {
    const graph = await extractGraph({
      chunks: [chunk(1), chunk(2)],
      extractFn: stubExtractFn({
        1: { entities: [{ name: 'Acme' }], relations: [] },
        2: { entities: [{ name: 'acme', type: 'org' }], relations: [] },
      }),
    });
    expect(graph.entities).toHaveLength(1);
    expect(graph.entities[0]?.type).toBe('org');
    expect(graph.entities[0]?.name).toBe('Acme'); // first-seen surface name
  });

  it('treats a blank / whitespace-only type as absent so a real type still lands', async () => {
    // A blank type first must not block a real type arriving later, nor persist as ''.
    const graph = await extractGraph({
      chunks: [chunk(1), chunk(2)],
      extractFn: stubExtractFn({
        1: { entities: [{ name: 'Acme', type: '   ' }], relations: [] },
        2: { entities: [{ name: 'acme', type: 'org' }], relations: [] },
      }),
    });
    expect(graph.entities).toHaveLength(1);
    expect(graph.entities[0]?.type).toBe('org');
  });

  it('never surfaces an empty-string type — a lone blank type normalizes to absent', async () => {
    const graph = await extractGraph({
      chunks: [chunk(1)],
      extractFn: stubExtractFn({ 1: { entities: [{ name: 'Acme', type: '' }], relations: [] } }),
    });
    expect(graph.entities[0]?.type).toBeUndefined();
  });

  it('strips control characters so a name carrying the key delimiter cannot collide', () => {
    // U+001F is the composite relation-key delimiter; it must not survive into a name.
    expect(normalizeEntityName('a\x1fb')).toBe('ab');
    // Two triples that would collide if \x1f leaked into a name stay distinct.
    expect(relationNormalizedKey('A', 'B\x1fC', undefined)).not.toBe(
      relationNormalizedKey('A\x1f', 'C', 'b'),
    );
  });

  it('skips a blank-named entity as malformed', async () => {
    const graph = await extractGraph({
      chunks: [chunk(1)],
      extractFn: stubExtractFn({ 1: { entities: [{ name: '   ' }, { name: 'Real' }], relations: [] } }),
    });
    expect(graph.entities.map((e) => e.name)).toEqual(['Real']);
  });
});

describe('extractGraph — partial failure containment', () => {
  it('skips a chunk whose extractFn throws and counts it, without aborting the batch', async () => {
    const extractFn: ExtractFn = ({ chunkId }) => {
      if (chunkId === 2) return Promise.reject(new Error('extractor boom'));
      return Promise.resolve({ entities: [{ name: `E${chunkId}` }], relations: [] });
    };
    const graph = await extractGraph({ chunks: [chunk(1), chunk(2), chunk(3)], extractFn });

    expect(graph.failedChunks).toBe(1);
    expect(graph.entities.map((e) => e.name).sort()).toEqual(['E1', 'E3']);
  });

  it('contains a chunk whose extractFn resolves undefined (malformed) without aborting the batch', async () => {
    // A resolved-but-malformed result must be treated like a throw: skip + count,
    // not abort the whole batch (which would discard prior chunks' work).
    const extractFn = (({ chunkId }: { chunkId: number }) =>
      chunkId === 2
        ? Promise.resolve(undefined)
        : Promise.resolve({ entities: [{ name: `E${chunkId}` }], relations: [] })) as unknown as ExtractFn;
    const graph = await extractGraph({ chunks: [chunk(1), chunk(2), chunk(3)], extractFn });

    expect(graph.failedChunks).toBe(1);
    expect(graph.entities.map((e) => e.name).sort()).toEqual(['E1', 'E3']);
  });

  it('fails a malformed chunk atomically — no half-merged entities leak from it', async () => {
    // entities present but `relations` array missing: the chunk must fail whole,
    // leaving none of its entities behind.
    const extractFn = (({ chunkId }: { chunkId: number }) =>
      chunkId === 2
        ? Promise.resolve({ entities: [{ name: 'Leaked' }] }) // no `relations` key
        : Promise.resolve({ entities: [{ name: `E${chunkId}` }], relations: [] })) as unknown as ExtractFn;
    const graph = await extractGraph({ chunks: [chunk(1), chunk(2)], extractFn });

    expect(graph.failedChunks).toBe(1);
    expect(graph.entities.map((e) => e.name)).toEqual(['E1']);
  });
});

describe('extractGraph — empty input', () => {
  it('throws GraphError EMPTY_CHUNKS on an empty chunks array', async () => {
    await expect(
      extractGraph({ chunks: [], extractFn: stubExtractFn({}) }),
    ).rejects.toMatchObject({ code: 'EMPTY_CHUNKS' });
    await expect(
      extractGraph({ chunks: [], extractFn: stubExtractFn({}) }),
    ).rejects.toBeInstanceOf(GraphError);
  });
});
