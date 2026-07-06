import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PipelineSpan } from '../../../src/observability/span.js';
import { openIndexStore } from '../../../src/rag/index-store.js';
import type { ChunkRow } from '../../../src/rag/types.js';

const DIM = 1024;

function makeEmbedding(seed: number, dim = DIM): Float32Array {
  const arr = new Float32Array(dim);
  for (let i = 0; i < dim; i += 1) {
    arr[i] = Math.sin(seed * 0.13 + i * 0.0007) * 0.5;
  }
  return arr;
}

function makeChunks(n: number): ChunkRow[] {
  return Array.from({ length: n }, (_, i) => ({
    chunk: { content: `条目内容 ${i + 1}`, source: 'fixture.md', page: i + 1, section: '第1章' },
    embedding: makeEmbedding(i + 1),
  }));
}

describe('openIndexStore.buildVersion — ingest.index span', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rag-span-index-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('emits one ingest.index span on a successful build with chunk / inserted counts', () => {
    const spans: PipelineSpan[] = [];
    const store = openIndexStore(dir, { embeddingDim: DIM });
    try {
      const { stats } = store.buildVersion(makeChunks(5), { onSpan: (s) => spans.push(s) });
      expect(spans).toHaveLength(1);
      const span = spans[0];
      expect(span?.name).toBe('ingest.index');
      expect(span?.attributes).toMatchObject({ chunkCount: 5, inserted: stats.inserted, ok: true });
      expect(span?.attributes.inserted).toBe(5);
      expect(typeof span?.durationMs).toBe('number');
      expect(span?.durationMs).toBeGreaterThanOrEqual(0);
      expect(span?.parentId).toBeUndefined();
    } finally {
      store.close();
    }
  });

  it('emits nothing when no consumer is wired', () => {
    const spans: PipelineSpan[] = [];
    const store = openIndexStore(dir, { embeddingDim: DIM });
    try {
      store.buildVersion(makeChunks(3));
      expect(spans).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  it('exposes no CJK content in span attributes (zero PII)', () => {
    const spans: PipelineSpan[] = [];
    const store = openIndexStore(dir, { embeddingDim: DIM });
    try {
      store.buildVersion(makeChunks(3), { onSpan: (s) => spans.push(s) });
      for (const s of spans) {
        expect(JSON.stringify(s.attributes)).not.toMatch(/[一-鿿]/);
        for (const value of Object.values(s.attributes)) {
          expect(['string', 'number', 'boolean']).toContain(typeof value);
        }
      }
    } finally {
      store.close();
    }
  });
});
