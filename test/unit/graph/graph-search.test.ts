import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { extractGraph } from '../../../src/graph/extract-graph.js';
import { buildGraphSchema } from '../../../src/graph/graph-schema.js';
import { graphRecall } from '../../../src/graph/graph-search.js';
import { writeGraph } from '../../../src/graph/graph-store.js';
import type { ExtractFn, RawExtraction } from '../../../src/graph/types.js';
import { openIndex } from '../../../src/rag/sqlite-store.js';
import type { ChunkRow, IndexHandle } from '../../../src/rag/types.js';

const DIM = 8;

function makeEmbedding(seed: number): Float32Array {
  const arr = new Float32Array(DIM);
  for (let i = 0; i < DIM; i += 1) arr[i] = Math.sin(seed + i) * 0.5;
  return arr;
}

/**
 * Fixture chunks — indexed in order, so docs.id = array index + 1.
 * Contents are chosen for the entity design below (社会保险 vs 保险 overlap).
 */
const FIXTURE_CONTENTS = [
  '社会保险缴纳基数按上年度平均工资核定。', // id=1
  '保险理赔需在事故发生后三十日内申报。', // id=2
  '差旅报销要求保留原始凭证。', // id=3
  '员工体检每年一次。', // id=4
  '办公用品申领流程说明。', // id=5
];

function makeFixtureRows(): ChunkRow[] {
  return FIXTURE_CONTENTS.map((content, i) => ({
    chunk: { content, source: 'graph-fixture.md', page: i + 1, section: '第1章' },
    embedding: makeEmbedding(i + 1),
  }));
}

function stubExtractFn(byChunk: Record<number, RawExtraction>): ExtractFn {
  return ({ chunkId }) => Promise.resolve(byChunk[chunkId] ?? { entities: [], relations: [] });
}

/**
 * Entity design (entity → mentioned-in docs.id):
 * - 社会保险   → 1        (long name, contains 保险)
 * - 保险       → 1, 2     (short name, substring of 社会保险)
 * - 缴纳基数   → 1
 * - 理赔       → 2
 * - 差旅报销   → 3
 * - 凭证       → 3
 * - 体检       → 4
 * (id=5 deliberately entity-free)
 */
async function writeFixtureGraph(handle: IndexHandle): Promise<void> {
  buildGraphSchema(handle.db);
  const graph = await extractGraph({
    chunks: FIXTURE_CONTENTS.map((content, i) => ({ chunkId: i + 1, content })),
    extractFn: stubExtractFn({
      1: {
        entities: [{ name: '社会保险' }, { name: '保险' }, { name: '缴纳基数' }],
        relations: [],
      },
      2: { entities: [{ name: '保险' }, { name: '理赔' }], relations: [] },
      3: { entities: [{ name: '差旅报销' }, { name: '凭证' }], relations: [] },
      4: { entities: [{ name: '体检' }], relations: [] },
    }),
  });
  writeGraph(handle.db, graph);
}

describe('graphRecall — entity-match third recall source', () => {
  let handle: IndexHandle;

  beforeEach(() => {
    handle = openIndex(':memory:', { embeddingDim: DIM });
    handle.indexChunks(makeFixtureRows());
  });

  afterEach(() => {
    handle.close();
  });

  it('returns [] when the graph tables were never created (graph is written asynchronously)', () => {
    // No buildGraphSchema call — a healthy index version without graph opt-in.
    expect(graphRecall(handle.db, '社会保险缴纳基数是多少')).toEqual([]);
  });

  it('containment match: entities that are substrings of the query recall their back-linked chunk', async () => {
    await writeFixtureGraph(handle);
    const hits = graphRecall(handle.db, '差旅报销的凭证要保留多久');

    expect(hits).toHaveLength(1);
    const hit = hits[0];
    expect(hit?.docId).toBe(3);
    expect(hit?.matchCount).toBe(2); // 差旅报销 + 凭证
    expect(hit?.graphRank).toBe(1);
    expect(hit?.chunk).toEqual({
      content: '差旅报销要求保留原始凭证。',
      source: 'graph-fixture.md',
      page: 3,
      section: '第1章',
    });
  });

  it('longest-name-first dedup: 保险 is dropped when 社会保险 also matches, so no double counting', async () => {
    await writeFixtureGraph(handle);
    // Query contains 社会保险 (hence also 保险) and 缴纳基数.
    const hits = graphRecall(handle.db, '社会保险缴纳基数是多少');

    // 保险 dropped entirely: chunk 1 scores 2 (社会保险 + 缴纳基数, NOT 3),
    // and chunk 2 (mentioned only via 保险) does not surface at all.
    expect(hits.map((h) => h.docId)).toEqual([1]);
    expect(hits[0]?.matchCount).toBe(2);
  });

  it('short name still matches on its own when the longer variant is absent from the query', async () => {
    await writeFixtureGraph(handle);
    // 社会保险 ⊄ query → 保险 survives dedup; 理赔 also matches.
    const hits = graphRecall(handle.db, '保险理赔多久申报');

    // chunk 2: 保险 + 理赔 = 2; chunk 1: 保险 = 1. Ranks contiguous from 1.
    expect(hits.map((h) => h.docId)).toEqual([2, 1]);
    expect(hits.map((h) => h.matchCount)).toEqual([2, 1]);
    expect(hits.map((h) => h.graphRank)).toEqual([1, 2]);
  });

  it('breaks score ties by docId ascending (determinism, mirrors rrfFuse)', async () => {
    await writeFixtureGraph(handle);
    // Only 保险 matches → chunks 1 and 2 both score 1.
    const hits = graphRecall(handle.db, '保险政策解读');
    expect(hits.map((h) => h.docId)).toEqual([1, 2]);
    expect(hits.map((h) => h.matchCount)).toEqual([1, 1]);
  });

  it('caps at topK after score ordering', async () => {
    await writeFixtureGraph(handle);
    const hits = graphRecall(handle.db, '保险理赔多久申报', { topK: 1 });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.docId).toBe(2); // top-scoring chunk survives the cut
  });

  it('skips dangling doc_id soft references and keeps ranks contiguous', async () => {
    await writeFixtureGraph(handle);
    // 体检's entity gains a mention pointing at a docs row that does not exist.
    const entity = handle.db
      .prepare<[string], { id: number }>('SELECT id FROM entities WHERE name = ?')
      .get('体检');
    if (!entity) throw new Error('fixture entity 体检 missing');
    handle.db
      .prepare('INSERT INTO entity_mentions (entity_id, doc_id) VALUES (?, ?)')
      .run(entity.id, 999);

    const hits = graphRecall(handle.db, '体检安排在几月');
    expect(hits.map((h) => h.docId)).toEqual([4]);
    expect(hits[0]?.graphRank).toBe(1);
  });

  it('returns [] for a query touching no entity, and for empty / whitespace queries', async () => {
    await writeFixtureGraph(handle);
    expect(graphRecall(handle.db, '完全无关的查询文本')).toEqual([]);
    expect(graphRecall(handle.db, '')).toEqual([]);
    expect(graphRecall(handle.db, '   ')).toEqual([]);
  });

  it('rejects out-of-range topK fail-fast', async () => {
    await writeFixtureGraph(handle);
    for (const bad of [0, -1, 1.5, 1001]) {
      expect(() => graphRecall(handle.db, '保险', { topK: bad })).toThrow(
        /graphRecall: topK must be an integer in \[1, 1000\]/,
      );
    }
  });

  it('is deterministic — two identical calls return deep-equal results', async () => {
    await writeFixtureGraph(handle);
    const first = graphRecall(handle.db, '保险理赔多久申报');
    const second = graphRecall(handle.db, '保险理赔多久申报');
    expect(second).toEqual(first);
  });
});
