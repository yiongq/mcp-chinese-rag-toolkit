import { pipeline } from '@huggingface/transformers';
import type Database from 'better-sqlite3';

import { configureTransformersEnv, resolveCacheDir, verifyModelFiles } from './model-loader.js';
import { BGE_LARGE_ZH_V1_5_MANIFEST } from './model-manifest.js';
import type { Embedder, EmbedderOptions, ModelManifest } from './types.js';

/**
 * Module-level cache of in-flight + resolved embedders, keyed by
 * `${modelId}|${cacheDir}|${dtype}`. Concurrent first-time calls share the
 * same promise so transformers.js downloads each model file exactly once.
 *
 * Failed loads are evicted from the cache so the next call gets a clean
 * retry (and so a transient hash-verification failure does not poison the
 * singleton forever).
 */
const embedderCache = new Map<string, Promise<Embedder>>();

type FeatureExtractor = Awaited<ReturnType<typeof pipeline<'feature-extraction'>>>;

interface ExtractorTensor {
  tolist(): number[][];
}

/**
 * Resolve a fully-initialised {@link Embedder} for the requested model.
 *
 * Lifecycle:
 *   1. Resolve cache dir + configure transformers.js env (singleton, once
 *      per process).
 *   2. Pre-load opportunistic hash check: any file already on disk MUST
 *      match the manifest; missing files are tolerated so transformers.js
 *      can download them.
 *   3. Construct the feature-extraction pipeline (triggers download +
 *      ONNX session init).
 *   4. Post-load strict hash check: every pinned file MUST now exist and
 *      match. Mismatch → reject + evict the cache entry.
 *
 * Subsequent calls with the same `(modelId, cacheDir, dtype)` tuple resolve
 * synchronously from the in-memory cache.
 */
export async function loadEmbedder(opts: EmbedderOptions = {}): Promise<Embedder> {
  const manifest: ModelManifest = opts.manifest ?? BGE_LARGE_ZH_V1_5_MANIFEST;
  const cacheDir = resolveCacheDir(opts.cacheDir);
  const dtype = opts.dtype ?? 'fp32';
  const allowRemoteModels = opts.allowRemoteModels ?? true;
  const verifyHashes = opts.verifyHashes ?? true;

  const cacheKey = `${manifest.modelId}|${cacheDir}|${dtype}`;
  const cached = embedderCache.get(cacheKey);
  if (cached) return cached;

  const promise = (async (): Promise<Embedder> => {
    configureTransformersEnv({ cacheDir, allowRemoteModels });

    if (verifyHashes) {
      await verifyModelFiles(cacheDir, manifest, { strict: false });
    }

    const extractor = (await pipeline('feature-extraction', manifest.modelId, {
      dtype,
    })) as FeatureExtractor;

    if (verifyHashes) {
      await verifyModelFiles(cacheDir, manifest, { strict: true });
    }

    return buildEmbedder(extractor, manifest);
  })().catch((err: unknown) => {
    // Evict failed loads so a fixed environment can retry without restarting
    // the host process.
    embedderCache.delete(cacheKey);
    throw err;
  });

  embedderCache.set(cacheKey, promise);
  return promise;
}

/**
 * Persist the active embedder's model id into the Story 2.2 `meta` table.
 *
 * Idempotent thanks to `INSERT OR REPLACE`. The function intentionally does
 * NOT touch `meta.tokenizer_version` (Story 2.4 owner) or
 * `meta.embedding_dim` (Story 2.2 schema invariant guarded at open time).
 */
export function writeEmbedderMeta(db: Database.Database, embedder: Embedder): void {
  db.prepare<[string, string]>('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
    'embedding_model',
    embedder.modelId,
  );
}

function buildEmbedder(extractor: FeatureExtractor, manifest: ModelManifest): Embedder {
  let cachedDim: number | undefined;

  async function runExtraction(input: string | string[]): Promise<number[][]> {
    const tensor = (await extractor(input, { pooling: 'cls', normalize: true })) as ExtractorTensor;
    return tensor.tolist();
  }

  function toFloat32(row: number[]): Float32Array {
    // Allocate a fresh ArrayBuffer per row so downstream consumers (Story 2.2
    // indexChunks) can rely on `byteOffset === 0` and the full byteLength.
    return new Float32Array(row);
  }

  const embedder: Embedder = {
    modelId: manifest.modelId,
    get dim(): number {
      if (cachedDim !== undefined) return cachedDim;
      // bge-large-zh-v1.5 is fixed at 1024; the value is materialised on the
      // first embed call to avoid an extra forward at construction time.
      return 1024;
    },
    async embed(text: string): Promise<Float32Array> {
      if (text.length === 0) {
        throw new Error('embed: text must be non-empty');
      }
      const rows = await runExtraction(text);
      const first = rows[0];
      if (!first) {
        throw new Error('embed: extractor returned no rows');
      }
      const out = toFloat32(first);
      cachedDim = out.length;
      return out;
    },
    async embedBatch(texts: string[], batchOpts?: { batchSize?: number }): Promise<Float32Array[]> {
      if (texts.length === 0) return [];
      for (const t of texts) {
        if (t.length === 0) {
          throw new Error('embedBatch: every text must be non-empty');
        }
      }

      const batchSize = batchOpts?.batchSize ?? 32;
      if (!Number.isInteger(batchSize) || batchSize < 1) {
        throw new Error(`embedBatch: batchSize must be a positive integer, got ${batchSize}`);
      }

      const out: Float32Array[] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        const slice = texts.slice(i, i + batchSize);
        const rows = await runExtraction(slice);
        for (const row of rows) {
          const vec = toFloat32(row);
          out.push(vec);
          cachedDim = vec.length;
        }
      }
      return out;
    },
  };
  return embedder;
}

/**
 * Test-only helper — wipes the module-level embedder cache. Exported with a
 * deliberately discoverable name so test suites that mock the pipeline can
 * isolate themselves without spelunking module internals. Not part of the
 * public API.
 *
 * @internal
 */
export function __resetEmbedderCacheForTests(): void {
  embedderCache.clear();
}
