import { tmpdir } from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { describe, expect, it } from 'vitest';

import { loadEmbedder, writeEmbedderMeta } from '../../../src/rag/embedder.js';
import { buildSchema } from '../../../src/rag/schema.js';

function uniqueTmp(prefix: string): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return path.join(tmpdir(), `${prefix}-${id}`);
}

const SKIP_NETWORK = process.env.SKIP_MODEL_DOWNLOAD === '1';

describe.skipIf(SKIP_NETWORK)('loadEmbedder (real bge-large-zh-v1.5)', () => {
  it('downloads, verifies hashes, produces 1024-dim L2-normalized vectors, and writes meta', {
    timeout: 600_000,
  }, async () => {
    const cacheDir = uniqueTmp('embedder-real');
    const embedder = await loadEmbedder({ cacheDir });
    expect(embedder.modelId).toBe('Xenova/bge-large-zh-v1.5');

    const vec = await embedder.embed('试用期多久');
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(1024);
    expect(embedder.dim).toBe(1024);

    let normSquared = 0;
    for (let i = 0; i < vec.length; i += 1) {
      const x = vec[i] ?? 0;
      normSquared += x * x;
    }
    expect(Math.abs(1 - Math.sqrt(normSquared))).toBeLessThan(1e-3);

    const db = new Database(':memory:');
    sqliteVec.load(db);
    buildSchema(db, { embeddingDim: 1024 });
    try {
      writeEmbedderMeta(db, embedder);
      const row = db
        .prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?')
        .get('embedding_model');
      expect(row?.value).toBe('Xenova/bge-large-zh-v1.5');
    } finally {
      db.close();
    }
  });
});
