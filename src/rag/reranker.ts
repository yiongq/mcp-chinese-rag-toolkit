import { createHash } from 'node:crypto';

import { AutoModelForSequenceClassification, AutoTokenizer } from '@huggingface/transformers';

import { configureTransformersEnv, resolveCacheDir, verifyModelFiles } from './model-loader.js';
import { BGE_RERANKER_V2_M3_MANIFEST } from './model-manifest.js';
import type {
  HybridHit,
  ModelManifest,
  RankedDocument,
  RerankedHit,
  Reranker,
  RerankerDeps,
  RerankerOptions,
  RerankFn,
  RerankOptions,
} from './types.js';

/**
 * Upper bound on `rank({ batchSize })`. Cross-encoder full attention over
 * `[query | SEP | doc]` pairs has ~3× the per-token compute of the embedder's
 * bi-encoder, so the practical batch ceiling is lower than the embedder's
 * `MAX_BATCH_SIZE = 256`. 64 keeps the worst-case forward memory peak inside
 * the 2-vCPU CI runner budget when `maxLength = 512`.
 */
const MAX_BATCH_SIZE = 64;
/** Hard upper bound on `rank({ maxLength })` — bge-reranker-v2-m3 max positional embedding. */
const MAX_LENGTH = 512;
/** Hard lower bound — fewer than 16 tokens of context typically collapses the cross-encoder signal. */
const MIN_LENGTH = 16;
/** Default per-call `rank({ batchSize })`. Picked so a top-30 hybrid candidate list fits one forward. */
const DEFAULT_BATCH_SIZE = 32;
/** Default per-call `rank({ maxLength })`. */
const DEFAULT_MAX_LENGTH = 512;
/** Default `createReranker` top-K —  / Hit Rate@5 contract. */
const DEFAULT_TOP_K = 5;

/**
 * Module-level cache of in-flight + resolved rerankers. Mirrors `embedderCache`
 * (embedder.ts) — the cache key folds in every load-affecting option so two
 * callers with divergent configurations never share a Promise.
 *
 * Failed loads are evicted so the next call gets a clean retry (transient
 * hash-verification or network failure does not poison the singleton).
 */
const rerankerCache = new Map<string, Promise<Reranker>>();

type AutoTokenizerInstance = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
type AutoModelInstance = Awaited<
  ReturnType<typeof AutoModelForSequenceClassification.from_pretrained>
>;

interface SigmoidableTensor {
  sigmoid(): SigmoidableTensor | Promise<SigmoidableTensor>;
  tolist(): number[] | number[][];
}

interface ModelOutput {
  logits: SigmoidableTensor;
}

function manifestFingerprint(manifest: ModelManifest): string {
  // Canonical JSON of the manifest so two structurally-different manifests with
  // the same modelId never collide on the cache key. Identical implementation
  // to embedder.ts:36-49 — intentionally not extracted into a shared helper to
  // keep / 2.5 module boundaries crisp (cache keys are per-loader).
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
 * Resolve a fully-initialised {@link Reranker} for the requested model.
 *
 * Lifecycle mirrors {@link loadEmbedder}:
 *   1. Resolve cache dir + configure transformers.js env.
 *   2. Pre-load opportunistic hash check (missing files tolerated so
 *      transformers.js can download them; size-mismatched partial downloads
 *      are deleted so the upcoming load can refetch).
 *   3. Construct `AutoTokenizer` + `AutoModelForSequenceClassification`
 *      (triggers download + ONNX session init). The `pipeline('text-
 *      classification', ...)` API is intentionally NOT used here — its
 *      handling of `text_pair` input has shifted between transformers.js
 *      4.x minor releases, while the explicit `AutoTokenizer(queries,
 *      { text_pair: docs })` call is stable.
 *   4. Post-load strict hash check.
 *
 * Subsequent calls with the same effective options resolve synchronously
 * from the in-memory cache.
 */
export async function loadReranker(opts: RerankerOptions = {}): Promise<Reranker> {
  const manifest: ModelManifest = opts.manifest ?? BGE_RERANKER_V2_M3_MANIFEST;
  const cacheDir = resolveCacheDir(opts.cacheDir);
  const allowRemoteModels = opts.allowRemoteModels ?? true;
  const verifyHashes = opts.verifyHashes ?? true;

  const cacheKey = [
    manifestFingerprint(manifest),
    cacheDir,
    `verify=${verifyHashes ? 1 : 0}`,
    `remote=${allowRemoteModels ? 1 : 0}`,
  ].join('\x1f');
  const cached = rerankerCache.get(cacheKey);
  if (cached) return cached;

  const promise = (async (): Promise<Reranker> => {
    configureTransformersEnv({ cacheDir, allowRemoteModels });

    if (verifyHashes) {
      await verifyModelFiles(cacheDir, manifest, { strict: false });
    }

    const tokenizer = await AutoTokenizer.from_pretrained(manifest.modelId);
    const model = await AutoModelForSequenceClassification.from_pretrained(manifest.modelId, {
      dtype: 'q8',
    });

    if (verifyHashes) {
      await verifyModelFiles(cacheDir, manifest, { strict: true });
    }

    return buildReranker(tokenizer, model, manifest);
  })().catch((err: unknown) => {
    // Evict failed loads so a fixed environment can retry without restarting
    // the host process — matches embedder.ts:102-107 semantics.
    rerankerCache.delete(cacheKey);
    throw err;
  });

  rerankerCache.set(cacheKey, promise);
  return promise;
}

function buildReranker(
  tokenizer: AutoTokenizerInstance,
  model: AutoModelInstance,
  manifest: ModelManifest,
): Reranker {
  return {
    modelId: manifest.modelId,
    async rank(
      query: string,
      documents: string[],
      rankOpts?: { batchSize?: number; maxLength?: number },
    ): Promise<RankedDocument[]> {
      if (typeof query !== 'string') {
        throw new Error('rank: query must be a string');
      }
      if (query.length === 0) {
        throw new Error('rank: query must be a non-empty string');
      }
      if (!Array.isArray(documents)) {
        throw new Error('rank: documents must be an array');
      }
      if (documents.length === 0) return [];
      for (let i = 0; i < documents.length; i += 1) {
        if (typeof documents[i] !== 'string') {
          throw new Error(`rank: documents[${i}] must be a string`);
        }
      }

      const batchSize = rankOpts?.batchSize ?? DEFAULT_BATCH_SIZE;
      const maxLength = rankOpts?.maxLength ?? DEFAULT_MAX_LENGTH;
      if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
        throw new Error(
          `rank: batchSize must be an integer in [1, ${MAX_BATCH_SIZE}], got ${String(batchSize)}`,
        );
      }
      if (!Number.isInteger(maxLength) || maxLength < MIN_LENGTH || maxLength > MAX_LENGTH) {
        throw new Error(
          `rank: maxLength must be an integer in [${MIN_LENGTH}, ${MAX_LENGTH}], got ${String(maxLength)}`,
        );
      }

      const out: RankedDocument[] = [];
      // Sequential `await` over batches is intentional — the underlying ONNX
      // session is a single shared resource and cannot serve concurrent
      // forwards; `Promise.all([batchA, batchB])` would only serialize them
      // behind an internal lock while doubling the queue overhead.
      //
      for (let i = 0; i < documents.length; i += batchSize) {
        const sliceDocs = documents.slice(i, i + batchSize);
        const queries: string[] = sliceDocs.map(() => query);
        // text_pair tokenization: bge-reranker-v2-m3 expects the cross-encoder
        // form `[CLS] query [SEP] document [SEP]` per pair. AutoTokenizer
        // returns input_ids / attention_mask tensors batched for one forward.
        const tokenizerInputs = (
          tokenizer as unknown as (
            input: string[],
            opts: Record<string, unknown>,
          ) => Promise<Record<string, unknown>>
        )(queries, {
          text_pair: sliceDocs,
          padding: true,
          // `'longest_first'` drops from the longer side of the (query, doc)
          // pair — usually the document — matching FlagEmbedding's reference
          // behaviour and what the public Reranker.rank JSDoc promises.
          truncation: 'longest_first',
          max_length: maxLength,
          return_tensors: 'pt',
        });
        const inputs = await tokenizerInputs;
        const output = (await (
          model as unknown as (input: Record<string, unknown>) => Promise<ModelOutput>
        )(inputs)) as ModelOutput;
        // bge-reranker-v2-m3 logits shape: [N, 1]; sigmoid → [N, 1] probability.
        const sigmoided = await output.logits.sigmoid();
        const rows = sigmoided.tolist();
        for (let j = 0; j < sliceDocs.length; j += 1) {
          const row = rows[j];
          let score: number;
          if (Array.isArray(row)) {
            const first = row[0];
            if (typeof first !== 'number') {
              throw new Error(
                `rank: tokenizer/model returned non-numeric score at batch index ${i + j}`,
              );
            }
            score = first;
          } else if (typeof row === 'number') {
            score = row;
          } else {
            throw new Error(
              `rank: tokenizer/model returned unexpected row shape at batch index ${i + j}`,
            );
          }
          if (!Number.isFinite(score)) {
            throw new Error(
              `rank: tokenizer/model returned non-finite score at batch index ${i + j} (${score})`,
            );
          }
          out.push({ index: i + j, score });
        }
      }
      return out;
    },
  };
}

/**
 * `topK` accepts `Infinity` for "return every reranked candidate", matching
 * `createHybridSearch.assertValidTopK`'s contract.
 */
function assertValidTopK(value: number): void {
  if (value === Number.POSITIVE_INFINITY) return;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `createReranker: topK must be a positive integer (or Infinity), got ${String(value)}`,
    );
  }
}

function assertValidBatchSize(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_BATCH_SIZE) {
    throw new Error(
      `createReranker: batchSize must be an integer in [1, ${MAX_BATCH_SIZE}], got ${String(value)}`,
    );
  }
}

function assertValidMaxLength(value: number): void {
  if (!Number.isInteger(value) || value < MIN_LENGTH || value > MAX_LENGTH) {
    throw new Error(
      `createReranker: maxLength must be an integer in [${MIN_LENGTH}, ${MAX_LENGTH}], got ${String(value)}`,
    );
  }
}

function validateDefaultOpts(opts: RerankOptions): void {
  // Each field has exactly one validator — the prior dual-validation of
  // topK (assertValidTopK + assertBoundedPositiveInteger) silently capped
  // defaultOpts.topK at MAX_OPTION_VALUE while the per-call path had no
  // such ceiling, producing an asymmetric contract for the same field.
  if (opts.topK !== undefined) assertValidTopK(opts.topK);
  if (opts.batchSize !== undefined) assertValidBatchSize(opts.batchSize);
  if (opts.maxLength !== undefined) assertValidMaxLength(opts.maxLength);
}

/**
 * Build a bound reranker that consumes `HybridHit[]`,
 * invokes the cross-encoder over `(query, chunk.content)` pairs, sorts by
 * sigmoid score descending (tie-break: `docId` ascending —
 * symbol-comparison lesson), and caps at `topK`.
 *
 * The factory itself is side-effect-free: it validates `defaultOpts` and
 * freezes a shallow clone. Errors thrown by
 * `reranker.rank` propagate directly to the caller — error normalization
 * is the responsibility of the surrounding tool handler (per
 * `docs/conventions.md §2.4`).
 */
export function createReranker(deps: RerankerDeps): RerankFn {
  const { reranker, defaultOpts } = deps;

  if (!reranker || typeof reranker.rank !== 'function') {
    throw new Error(
      'createReranker: deps.reranker must be a Reranker (got missing or invalid object)',
    );
  }

  let frozenDefaults: RerankOptions | undefined;
  if (defaultOpts !== undefined) {
    validateDefaultOpts(defaultOpts);
    frozenDefaults = Object.freeze({ ...defaultOpts });
  }

  return async function rerank(
    query: string,
    candidates: HybridHit[],
    opts: RerankOptions = {},
  ): Promise<RerankedHit[]> {
    if (candidates.length === 0) return [];

    const topK = opts.topK ?? frozenDefaults?.topK ?? DEFAULT_TOP_K;
    const batchSize = opts.batchSize ?? frozenDefaults?.batchSize ?? DEFAULT_BATCH_SIZE;
    const maxLength = opts.maxLength ?? frozenDefaults?.maxLength ?? DEFAULT_MAX_LENGTH;
    assertValidTopK(topK);
    assertValidBatchSize(batchSize);
    assertValidMaxLength(maxLength);

    const documents = candidates.map((c) => c.chunk.content);
    const ranked = await reranker.rank(query, documents, { batchSize, maxLength });

    const fused: RerankedHit[] = ranked.map((r) => {
      const candidate = candidates[r.index];
      if (!candidate) {
        // Should be impossible — reranker.rank returns one entry per input doc,
        // aligned by index. Defensive throw to keep the type narrowing honest.
        throw new Error(
          `createReranker: reranker returned index ${r.index} out of range for ${candidates.length} candidates`,
        );
      }
      return { ...candidate, rerankScore: r.score };
    });

    fused.sort((a, b) => {
      if (b.rerankScore !== a.rerankScore) return b.rerankScore - a.rerankScore;
      // Tie-break via symbol comparison instead of subtraction — docId can come
      // straight from sqlite-vec / FTS5 ROWID and exceed Number.MAX_SAFE_INTEGER
      // in pathological corpora.
      if (a.docId < b.docId) return -1;
      if (a.docId > b.docId) return 1;
      return 0;
    });

    if (topK === Number.POSITIVE_INFINITY) return fused;
    return fused.slice(0, topK);
  };
}

/**
 * Test-only helper — wipes the module-level reranker cache. Mirrors
 * `__resetEmbedderCacheForTests` (embedder.ts:222).
 *
 * @internal
 */
export function __resetRerankerCacheForTests(): void {
  rerankerCache.clear();
}
