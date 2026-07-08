import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildGraphSchema } from '../../../src/graph/graph-schema.js';
import { openIndex } from '../../../src/rag/sqlite-store.js';
import type { IndexHandle } from '../../../src/rag/types.js';

const DIM = 8;
const GRAPH_TABLES = ['entities', 'entity_mentions', 'relations', 'relation_mentions'];
const CORE_TABLES = ['docs', 'docs_fts', 'docs_vec', 'meta'];

function makeEmbedding(seed: number, dim = DIM): Float32Array {
  const arr = new Float32Array(dim);
  for (let i = 0; i < dim; i += 1) arr[i] = Math.sin(seed * 0.13 + i * 0.31) * 0.5;
  return arr;
}

function tableNames(handle: IndexHandle): Set<string> {
  return new Set(
    handle.db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name),
  );
}

describe('buildGraphSchema', () => {
  it('adds the four graph tables in place on an already-built RAG index', () => {
    const handle = openIndex(':memory:', { embeddingDim: DIM });
    try {
      buildGraphSchema(handle.db);
      const tables = tableNames(handle);
      for (const t of GRAPH_TABLES) expect(tables.has(t)).toBe(true);
    } finally {
      handle.close();
    }
  });

  it('is idempotent — a second call does not throw and leaves a single table set', () => {
    const handle = openIndex(':memory:', { embeddingDim: DIM });
    try {
      buildGraphSchema(handle.db);
      expect(() => buildGraphSchema(handle.db)).not.toThrow();
      const tables = tableNames(handle);
      for (const t of GRAPH_TABLES) expect(tables.has(t)).toBe(true);
    } finally {
      handle.close();
    }
  });

  it('does not touch the four core tables or their data', () => {
    const handle = openIndex(':memory:', { embeddingDim: DIM });
    try {
      handle.indexChunks([
        { chunk: { content: '员工手册第一章', source: 'hr.md', page: 1 }, embedding: makeEmbedding(1) },
        { chunk: { content: '请假审批流程', source: 'hr.md', page: 2 }, embedding: makeEmbedding(2) },
      ]);
      const before = handle.db.prepare('SELECT id, content, source, page FROM docs ORDER BY id').all();

      buildGraphSchema(handle.db);

      const after = handle.db.prepare('SELECT id, content, source, page FROM docs ORDER BY id').all();
      expect(after).toEqual(before);
      const tables = tableNames(handle);
      for (const t of CORE_TABLES) expect(tables.has(t)).toBe(true);
    } finally {
      handle.close();
    }
  });
});

describe('buildGraphSchema — read-only coexistence (REQUIRED_TABLES unchanged)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'graph-schema-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('a graph-less index still opens read-only (graph tables are not required)', () => {
    const path = join(dir, 'graphless.db');
    const w = openIndex(path, { embeddingDim: DIM });
    w.indexChunks([{ chunk: { content: '核心数据' }, embedding: makeEmbedding(3) }]);
    w.close();

    // No graph tables were ever added — a read-only open must still succeed.
    const r = openIndex(path, { readonly: true });
    try {
      expect(() => r.getIndexVersion()).not.toThrow();
    } finally {
      r.close();
    }
  });

  it('an index carrying graph tables still opens read-only and keeps them', () => {
    const path = join(dir, 'withgraph.db');
    const w = openIndex(path, { embeddingDim: DIM });
    w.indexChunks([{ chunk: { content: '核心数据' }, embedding: makeEmbedding(4) }]);
    buildGraphSchema(w.db);
    w.close();

    const r = openIndex(path, { readonly: true });
    try {
      const tables = tableNames(r);
      for (const t of GRAPH_TABLES) expect(tables.has(t)).toBe(true);
      for (const t of CORE_TABLES) expect(tables.has(t)).toBe(true);
    } finally {
      r.close();
    }
  });
});
