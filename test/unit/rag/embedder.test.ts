import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSchema } from '../../../src/rag/schema.js';
import type { ModelManifest } from '../../../src/rag/types.js';

function uniqueTmp(prefix: string): string {
  return path.join(tmpdir(), `${prefix}-${randomUUID()}`);
}

const TINY_MANIFEST: ModelManifest = {
  modelId: 'test-org/tiny-fixture-model',
  embeddingDim: 4,
  files: [
    {
      relativePath: 'config.json',
      sha256: '0'.repeat(64),
      bytes: 17,
    },
  ],
};

const SKIP_NETWORK = process.env.SKIP_MODEL_DOWNLOAD === '1';

interface StubTensor {
  tolist: () => number[][];
}

function makeStubExtractor(dim = 4): (input: string | string[]) => Promise<StubTensor> {
  const stub = async (input: string | string[]): Promise<StubTensor> => {
    const rows = Array.isArray(input) ? input.length : 1;
    const data: number[][] = [];
    for (let i = 0; i < rows; i += 1) {
      const arr = new Array<number>(dim).fill(0);
      arr[0] = 1; // canonical L2-normalized one-hot
      data.push(arr);
    }
    return { tolist: () => data };
  };
  return stub;
}

vi.mock('@huggingface/transformers', () => {
  const env = {
    cacheDir: '',
    allowRemoteModels: true,
    allowLocalModels: true,
    useBrowserCache: false,
  };
  return {
    env,
    pipeline: async () => makeStubExtractor(4),
  };
});

describe('loadEmbedder (stub pipeline)', () => {
  beforeEach(async () => {
    const mod = await import('../../../src/rag/embedder.js');
    mod.__resetEmbedderCacheForTests();
  });

  afterEach(async () => {
    const mod = await import('../../../src/rag/embedder.js');
    mod.__resetEmbedderCacheForTests();
  });

  it('returns an embedder whose modelId echoes the supplied manifest', async () => {
    const { loadEmbedder } = await import('../../../src/rag/embedder.js');
    const cacheDir = uniqueTmp('embedder-stub');
    const embedder = await loadEmbedder({
      manifest: TINY_MANIFEST,
      cacheDir,
      verifyHashes: false,
    });
    expect(embedder.modelId).toBe(TINY_MANIFEST.modelId);
    // dim is sourced from manifest.embeddingDim at load time, NOT lazily on first embed.
    expect(embedder.dim).toBe(TINY_MANIFEST.embeddingDim);
    const vec = await embedder.embed('hello');
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(TINY_MANIFEST.embeddingDim);
  });

  it('memoises load() for the same effective options', async () => {
    const { loadEmbedder } = await import('../../../src/rag/embedder.js');
    const cacheDir = uniqueTmp('embedder-stub-singleton');
    const a = await loadEmbedder({
      manifest: TINY_MANIFEST,
      cacheDir,
      verifyHashes: false,
    });
    const b = await loadEmbedder({
      manifest: TINY_MANIFEST,
      cacheDir,
      verifyHashes: false,
    });
    expect(a).toBe(b);
  });

  it('does NOT share the cache when verifyHashes differs (H9)', async () => {
    const { loadEmbedder } = await import('../../../src/rag/embedder.js');
    const cacheDir = uniqueTmp('embedder-stub-keysplit');
    const noVerify = await loadEmbedder({
      manifest: TINY_MANIFEST,
      cacheDir,
      verifyHashes: false,
    });
    // Re-loading with verifyHashes: true would try a real verify against the
    // tiny fixture (whose sha256 is all zeros) and fail — proving the cache
    // key correctly distinguished the two configurations.
    await expect(
      loadEmbedder({
        manifest: TINY_MANIFEST,
        cacheDir,
        verifyHashes: true,
      }),
    ).rejects.toThrow();
    // The first embedder should still be reachable from the cache.
    const noVerifyAgain = await loadEmbedder({
      manifest: TINY_MANIFEST,
      cacheDir,
      verifyHashes: false,
    });
    expect(noVerifyAgain).toBe(noVerify);
  });

  it('embed("") throws, embedBatch([]) returns []', async () => {
    const { loadEmbedder } = await import('../../../src/rag/embedder.js');
    const cacheDir = uniqueTmp('embedder-stub-edge');
    const embedder = await loadEmbedder({
      manifest: TINY_MANIFEST,
      cacheDir,
      verifyHashes: false,
    });
    await expect(embedder.embed('')).rejects.toThrow(/non-empty/);
    await expect(embedder.embedBatch([])).resolves.toEqual([]);
  });

  it('embedBatch rejects null / non-string elements (M2)', async () => {
    const { loadEmbedder } = await import('../../../src/rag/embedder.js');
    const cacheDir = uniqueTmp('embedder-stub-typecheck');
    const embedder = await loadEmbedder({
      manifest: TINY_MANIFEST,
      cacheDir,
      verifyHashes: false,
    });
    await expect(embedder.embedBatch(['ok', null as unknown as string, 'also-ok'])).rejects.toThrow(
      /must be a string/,
    );
  });

  it('embedBatch rejects out-of-range batchSize (M3)', async () => {
    const { loadEmbedder } = await import('../../../src/rag/embedder.js');
    const cacheDir = uniqueTmp('embedder-stub-batchcap');
    const embedder = await loadEmbedder({
      manifest: TINY_MANIFEST,
      cacheDir,
      verifyHashes: false,
    });
    await expect(embedder.embedBatch(['a'], { batchSize: 0 })).rejects.toThrow(/batchSize/);
    await expect(embedder.embedBatch(['a'], { batchSize: 1_000_000 })).rejects.toThrow(/batchSize/);
  });

  it('embedBatch shards by batchSize and concatenates results', async () => {
    const { loadEmbedder } = await import('../../../src/rag/embedder.js');
    const cacheDir = uniqueTmp('embedder-stub-batch');
    const embedder = await loadEmbedder({
      manifest: TINY_MANIFEST,
      cacheDir,
      verifyHashes: false,
    });
    const out = await embedder.embedBatch(['a', 'b', 'c', 'd', 'e'], { batchSize: 2 });
    expect(out).toHaveLength(5);
    for (const v of out) {
      expect(v).toBeInstanceOf(Float32Array);
      expect(v.length).toBe(4);
    }
  });
});

describe('writeEmbedderMeta', () => {
  it('persists modelId into the meta table and is idempotent', async () => {
    const { loadEmbedder, writeEmbedderMeta } = await import('../../../src/rag/embedder.js');
    const cacheDir = uniqueTmp('embedder-stub-meta');
    const embedder = await loadEmbedder({
      manifest: TINY_MANIFEST,
      cacheDir,
      verifyHashes: false,
    });

    const db = new Database(':memory:');
    sqliteVec.load(db);
    buildSchema(db, { embeddingDim: 4 });
    try {
      writeEmbedderMeta(db, embedder);
      writeEmbedderMeta(db, embedder);
      const row = db
        .prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?')
        .get('embedding_model');
      expect(row?.value).toBe(TINY_MANIFEST.modelId);
    } finally {
      db.close();
    }
  });

  it('refuses to overwrite when a different modelId is already recorded (M7)', async () => {
    const { loadEmbedder, writeEmbedderMeta, __resetEmbedderCacheForTests } = await import(
      '../../../src/rag/embedder.js'
    );
    const cacheDir = uniqueTmp('embedder-stub-meta-mismatch');
    const embedderA = await loadEmbedder({
      manifest: TINY_MANIFEST,
      cacheDir,
      verifyHashes: false,
    });

    const db = new Database(':memory:');
    sqliteVec.load(db);
    buildSchema(db, { embeddingDim: 4 });
    try {
      writeEmbedderMeta(db, embedderA);

      // Build a second embedder with a different modelId, then attempt to
      // write — the guard must reject because the db's vec0 schema is locked
      // to the first model's dim.
      __resetEmbedderCacheForTests();
      const embedderB = await loadEmbedder({
        manifest: { ...TINY_MANIFEST, modelId: 'test-org/different-model' },
        cacheDir: uniqueTmp('embedder-stub-meta-mismatch-b'),
        verifyHashes: false,
      });
      expect(() => writeEmbedderMeta(db, embedderB)).toThrow(/refusing to overwrite/);
    } finally {
      db.close();
    }
  });
});

// Real bge-large-zh-v1.5 download + assertions live in embedder-integration.test.ts
// (separate file because vi.mock for @huggingface/transformers is hoisted at the
//  module level and cannot be opted out per-describe).
void SKIP_NETWORK;
