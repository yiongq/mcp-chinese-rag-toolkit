import { describe, expect, it } from 'vitest';

import { openIndex } from '../../../src/rag/sqlite-store.js';
import type { ChunkRow } from '../../../src/rag/types.js';

const DIM = 1024;
const N = 1000;

/**
 * Story 2.2 — partial NFR3 sanity (SQLite write segment only).
 *
 * NFR3 ("index 1k chunks < 30 s") covers chunking + embedding + FTS + vec
 * end-to-end. This test exercises **only** the SQLite write path: 1k chunks
 * with synthetic 1024-dim embeddings, single transaction. The Story 2.5
 * latency-harness owns the full end-to-end gate; if this micro-bench regresses
 * sharply we want to know early.
 */
describe('indexChunks performance (SQLite write segment)', () => {
  // Marked with a generous timeout to absorb cold native-module load on CI.
  it('writes 1k chunks × 1024-dim embeddings in under 5 s (local) / 15 s (CI)', {
    timeout: 30_000,
  }, () => {
    const handle = openIndex(':memory:');
    try {
      const rows: ChunkRow[] = Array.from({ length: N }, (_, i) => ({
        chunk: {
          content: `内容条目 ${i} ${'员工试用期管理规定与请假流程。'.repeat(3)}`,
          source: 'perf-fixture.md',
          page: (i % 50) + 1,
          section: '第1章 > 1.1',
        },
        embedding: new Float32Array(DIM).fill(0.1),
      }));

      const stats = handle.indexChunks(rows);
      expect(stats.inserted).toBe(N);

      const ceiling = process.env.CI ? 15000 : 5000;
      expect(stats.durationMs).toBeLessThan(ceiling);
    } finally {
      handle.close();
    }
  });
});
