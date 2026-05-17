import { createHash } from 'node:crypto';

import { pipeline } from '@huggingface/transformers';
import type Database from 'better-sqlite3';

import { configureTransformersEnv, resolveCacheDir, verifyModelFiles } from './model-loader.js';
import { BGE_LARGE_ZH_V1_5_MANIFEST } from './model-manifest.js';
import type { Embedder, EmbedderOptions, ModelManifest } from './types.js';

/**
 * Upper bound on `embedBatch({ batchSize })`. Picked to bound the worst-case
 * single ONNX forward memory peak — bge-large-zh-v1.5 fp32 at batchSize ≥ 512
 * starts approaching the per-session limit on 2-vCPU CI runners.
 */
const MAX_BATCH_SIZE = 256;

/**
 * Module-level cache of in-flight + resolved embedders. The cache key folds in
 * every load-affecting option (manifest content hash, cacheDir, options) so two
 * callers with divergent configurations never share a Promise — sharing would
 * silently downgrade the stricter caller's guarantees (e.g. `verifyHashes:
 * true` getting a Promise built without verification).
 *
 * Failed loads are evicted from the cache so the next call gets a clean retry
 * (and so a transient hash-verification failure does not poison the singleton
 * forever).
 */
const embedderCache = new Map<string, Promise<Embedder>>();

type FeatureExtractor = Awaited<ReturnType<typeof pipeline<'feature-extraction'>>>;

interface ExtractorTensor {
  tolist(): number[][];
}

function manifestFingerprint(manifest: ModelManifest): string {
  // Canonical JSON of the manifest so two structurally-different manifests with
  // the same modelId never collide on the cache key.
  const canonical = JSON.stringify({
    modelId: manifest.modelId,
    embeddingDim: manifest.embeddingDim,
    files: manifest.files.map((f) => ({
      relativePath: f.relativePath,
      sha256: f.sha256,
      bytes: f.bytes,
    })),
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/**
 * Resolve a fully-initialised {@link Embedder} for the requested model.
 *
 * Lifecycle:
 *   1. Resolve cache dir + configure transformers.js env (singleton, once
 *      per process).
 *   2. Pre-load opportunistic hash check: any file already on disk MUST
 *      match the manifest; missing files are tolerated so transformers.js
 *      can download them. Size-mismatched files (partial download from a
 *      previous interrupted run) are deleted so the upcoming pipeline call
 *      can refetch — see model-loader.ts `verifyModelFiles` rationale.
 *   3. Construct the feature-extraction pipeline (triggers download +
 *      ONNX session init).
 *   4. Post-load strict hash check: every pinned file MUST now exist and
 *      match. Mismatch → reject + evict the cache entry.
 *
 * Subsequent calls with the same effective options (manifest fingerprint +
 * cacheDir + verifyHashes + allowRemoteModels) resolve synchronously from
 * the in-memory cache.
 */
export async function loadEmbedder(opts: EmbedderOptions = {}): Promise<Embedder> {
  const manifest: ModelManifest = opts.manifest ?? BGE_LARGE_ZH_V1_5_MANIFEST;
  const cacheDir = resolveCacheDir(opts.cacheDir);
  const allowRemoteModels = opts.allowRemoteModels ?? true;
  const verifyHashes = opts.verifyHashes ?? true;

  const cacheKey = [
    manifestFingerprint(manifest),
    cacheDir,
    `verify=${verifyHashes ? 1 : 0}`,
    `remote=${allowRemoteModels ? 1 : 0}`,
  ].join('\x1f');
  const cached = embedderCache.get(cacheKey);
  if (cached) return cached;

  const promise = (async (): Promise<Embedder> => {
    configureTransformersEnv({ cacheDir, allowRemoteModels });

    if (verifyHashes) {
      await verifyModelFiles(cacheDir, manifest, { strict: false });
    }

    const extractor = (await pipeline('feature-extraction', manifest.modelId, {
      dtype: 'fp32',
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
 * `INSERT OR REPLACE` is used so the call is idempotent for the same model.
 * If a previous run wrote a DIFFERENT modelId (i.e. the db was originally
 * indexed with another embedder), this function throws — the vec0 schema is
 * locked to a particular `embedding_dim` at build time, so swapping the
 * underlying model would silently desync `meta` from the stored vectors.
 *
 * The function intentionally does NOT touch `meta.tokenizer_version`
 * (Story 2.4 owner) or `meta.embedding_dim` (Story 2.2 schema invariant
 * guarded at open time).
 */
export function writeEmbedderMeta(db: Database.Database, embedder: Embedder): void {
  const existing = db
    .prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?')
    .get('embedding_model');
  if (existing && existing.value !== '' && existing.value !== embedder.modelId) {
    throw new Error(
      `writeEmbedderMeta: meta.embedding_model is already '${existing.value}' — ` +
        `refusing to overwrite with '${embedder.modelId}'. The db's vec0 schema is locked to the original embedder's dim.`,
    );
  }
  db.prepare<[string, string]>('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
    'embedding_model',
    embedder.modelId,
  );
}

function buildEmbedder(extractor: FeatureExtractor, manifest: ModelManifest): Embedder {
  const dim = manifest.embeddingDim;

  async function runExtraction(input: string | string[]): Promise<number[][]> {
    const tensor = (await extractor(input, { pooling: 'cls', normalize: true })) as ExtractorTensor;
    return tensor.tolist();
  }

  function toFloat32(row: number[]): Float32Array {
    // Allocate a fresh ArrayBuffer per row so downstream consumers (Story 2.2
    // indexChunks) can rely on `byteOffset === 0` and the full byteLength.
    const out = new Float32Array(row.length);
    for (let i = 0; i < row.length; i += 1) {
      const v = row[i] ?? 0;
      if (!Number.isFinite(v)) {
        throw new Error(`embed: extractor returned non-finite value at index ${i} (${v})`);
      }
      out[i] = v;
    }
    return out;
  }

  const embedder: Embedder = {
    modelId: manifest.modelId,
    dim,
    async embed(text: string): Promise<Float32Array> {
      if (typeof text !== 'string') {
        throw new Error('embed: text must be a string');
      }
      if (text.length === 0) {
        throw new Error('embed: text must be non-empty');
      }
      const rows = await runExtraction(text);
      const first = rows[0];
      if (!first) {
        throw new Error('embed: extractor returned no rows');
      }
      return toFloat32(first);
    },
    async embedBatch(texts: string[], batchOpts?: { batchSize?: number }): Promise<Float32Array[]> {
      if (texts.length === 0) return [];
      for (let i = 0; i < texts.length; i += 1) {
        const t = texts[i];
        if (typeof t !== 'string') {
          throw new Error(`embedBatch: texts[${i}] must be a string (got ${typeof t})`);
        }
        if (t.length === 0) {
          throw new Error(`embedBatch: texts[${i}] must be non-empty`);
        }
      }

      const batchSize = batchOpts?.batchSize ?? 32;
      if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
        throw new Error(
          `embedBatch: batchSize must be an integer in [1, ${MAX_BATCH_SIZE}], got ${batchSize}`,
        );
      }

      const out: Float32Array[] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        const slice = texts.slice(i, i + batchSize);
        const rows = await runExtraction(slice);
        for (const row of rows) {
          out.push(toFloat32(row));
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
