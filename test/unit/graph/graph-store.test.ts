import { describe, expect, it } from 'vitest';

import { extractGraph } from '../../../src/graph/extract-graph.js';
import { buildGraphSchema } from '../../../src/graph/graph-schema.js';
import { writeGraph } from '../../../src/graph/graph-store.js';
import type { ExtractFn, GraphChunk, RawExtraction } from '../../../src/graph/types.js';
import { openIndex } from '../../../src/rag/sqlite-store.js';
import type { IndexHandle } from '../../../src/rag/types.js';

const DIM = 8;

function stubExtractFn(byChunk: Record<number, RawExtraction>): ExtractFn {
  return ({ chunkId }) => Promise.resolve(byChunk[chunkId] ?? { entities: [], relations: [] });
}

function chunk(chunkId: number): GraphChunk {
  return { chunkId, content: `chunk ${chunkId}` };
}

function countRows(handle: IndexHandle, table: string): number {
  return (
    handle.db.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? -1
  );
}

/** A small connected graph: 员工 --works_at--> 北京公司, both mentioned in chunk 10/11. */
async function sampleGraph() {
  return extractGraph({
    chunks: [chunk(10), chunk(11)],
    extractFn: stubExtractFn({
      10: {
        entities: [{ name: '北京公司', type: 'org' }],
        relations: [{ source: '员工', target: '北京公司', type: 'works_at' }],
      },
      11: {
        entities: [{ name: '员工', type: 'person' }],
        relations: [{ source: '员工', target: '北京公司', type: 'works_at' }],
      },
    }),
  });
}

describe('writeGraph — persistence + back-links', () => {
  it('persists entities / relations / mentions and back-links to the source docs.id', async () => {
    const handle = openIndex(':memory:', { embeddingDim: DIM });
    try {
      buildGraphSchema(handle.db);
      const graph = await sampleGraph();
      const stats = writeGraph(handle.db, graph);

      // 员工 + 北京公司 → 2 entities; one directed edge.
      expect(countRows(handle, 'entities')).toBe(2);
      expect(countRows(handle, 'relations')).toBe(1);
      expect(stats.entitiesInserted).toBe(2);
      expect(stats.relationsInserted).toBe(1);
      expect(stats.durationMs).toBeGreaterThanOrEqual(0);

      // Relation FK resolves to the two entity rows.
      const edge = handle.db
        .prepare<[], { s: string; t: string; type: string }>(
          `SELECT es.name AS s, et.name AS t, r.type AS type
             FROM relations r
             JOIN entities es ON es.id = r.source_entity_id
             JOIN entities et ON et.id = r.target_entity_id`,
        )
        .get();
      expect(edge).toMatchObject({ s: '员工', t: '北京公司', type: 'works_at' });

      // 北京公司 back-links to both chunks (mentioned in 10 and 11).
      const beijingDocs = handle.db
        .prepare<[string], { doc_id: number }>(
          `SELECT em.doc_id FROM entity_mentions em
             JOIN entities e ON e.id = em.entity_id
             WHERE e.name = ? ORDER BY em.doc_id`,
        )
        .all('北京公司')
        .map((r) => r.doc_id);
      expect(beijingDocs).toEqual([10, 11]);
    } finally {
      handle.close();
    }
  });
});

describe('writeGraph — idempotency (AC: same batch twice → counts unchanged)', () => {
  it('inserts nothing on a second write of the same graph', async () => {
    const handle = openIndex(':memory:', { embeddingDim: DIM });
    try {
      buildGraphSchema(handle.db);
      const graph = await sampleGraph();

      writeGraph(handle.db, graph);
      const entitiesAfterFirst = countRows(handle, 'entities');
      const relationsAfterFirst = countRows(handle, 'relations');
      const entityMentionsAfterFirst = countRows(handle, 'entity_mentions');
      const relationMentionsAfterFirst = countRows(handle, 'relation_mentions');

      const secondStats = writeGraph(handle.db, graph);

      expect(countRows(handle, 'entities')).toBe(entitiesAfterFirst);
      expect(countRows(handle, 'relations')).toBe(relationsAfterFirst);
      expect(countRows(handle, 'entity_mentions')).toBe(entityMentionsAfterFirst);
      expect(countRows(handle, 'relation_mentions')).toBe(relationMentionsAfterFirst);
      expect(secondStats).toMatchObject({
        entitiesInserted: 0,
        relationsInserted: 0,
        entityMentions: 0,
        relationMentions: 0,
      });
    } finally {
      handle.close();
    }
  });

  it('re-extracting the same corpus and re-writing keeps a single node per entity', async () => {
    const handle = openIndex(':memory:', { embeddingDim: DIM });
    try {
      buildGraphSchema(handle.db);
      writeGraph(handle.db, await sampleGraph());
      writeGraph(handle.db, await sampleGraph());
      expect(countRows(handle, 'entities')).toBe(2);
      expect(countRows(handle, 'relations')).toBe(1);
    } finally {
      handle.close();
    }
  });
});

describe('writeGraph — surface-variant dedup lands one row', () => {
  it('collapses full-width / whitespace variants of a name to a single entity row', async () => {
    const handle = openIndex(':memory:', { embeddingDim: DIM });
    try {
      buildGraphSchema(handle.db);
      const graph = await extractGraph({
        chunks: [chunk(1), chunk(2)],
        extractFn: stubExtractFn({
          1: { entities: [{ name: '北京' }], relations: [] },
          2: { entities: [{ name: '北京　' }], relations: [] }, // trailing full-width space
        }),
      });
      writeGraph(handle.db, graph);
      expect(countRows(handle, 'entities')).toBe(1);
      // and both chunks back-link to that one node
      expect(countRows(handle, 'entity_mentions')).toBe(2);
    } finally {
      handle.close();
    }
  });
});
