import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import { loadEmbedder } from '../../../src/rag/embedder.js';

function uniqueTmp(prefix: string): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return path.join(tmpdir(), `${prefix}-${id}`);
}

const SKIP_NETWORK = process.env.SKIP_MODEL_DOWNLOAD === '1';

describe.skipIf(SKIP_NETWORK)('embedder performance bench', () => {
  it('reports P95 / batch speedup (warn-not-fail; Story 2.5 owns NFR1 gating)', {
    timeout: 600_000,
  }, async () => {
    const cacheDir = uniqueTmp('embedder-perf');
    const embedder = await loadEmbedder({ cacheDir });

    // Warm-up + sample loop for single embed.
    const samples: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      const t0 = performance.now();
      await embedder.embed('试用期多久');
      const t1 = performance.now();
      if (i >= 10) samples.push(t1 - t0); // discard warm-up
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length * 0.5)] ?? 0;
    const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;
    const ceiling = process.env.CI ? 200 : 100;
    if (p95 > ceiling) {
      // eslint-disable-next-line no-console
      console.warn(
        `[embedder-perf] WARN p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms exceeds ${ceiling}ms`,
      );
    }

    // Batched throughput vs sequential.
    const texts = Array.from({ length: 100 }, (_, i) => `试用期多久 #${i}`);
    const tBatchStart = performance.now();
    await embedder.embedBatch(texts, { batchSize: 32 });
    const tBatch = performance.now() - tBatchStart;

    const tSeqStart = performance.now();
    for (const t of texts) {
      await embedder.embed(t);
    }
    const tSeq = performance.now() - tSeqStart;

    const speedup = tSeq / tBatch;
    if (speedup < 2) {
      // eslint-disable-next-line no-console
      console.warn(`[embedder-perf] WARN batch speedup ${speedup.toFixed(2)}× < 2× target`);
    }

    expect(samples.length).toBeGreaterThan(0);
  });
});
