import pLimit from 'p-limit';
import { extractImages } from 'unpdf';
import type { Chunk, PdfPage } from '../types.js';
import {
  type CaptionCache,
  openCaptionCache,
  resolveDefaultCaptionCacheDir,
  sha256Hex,
} from './caption-cache.js';
import {
  type CaptionEngineOptions,
  captionPngWithCache,
  DEFAULT_VISION_PROMPT,
} from './caption-engine.js';
import { encodePng, ensureCanvasAvailable } from './png-encoder.js';
import type {
  IndexingPlugin,
  IndexingPluginContext,
  VisionCaptionOptions,
  VisionProvider,
} from './types.js';

// Re-export so existing import sites (`from './with-vision-caption.js'`) and the
// public barrel keep resolving DEFAULT_VISION_PROMPT unchanged after it moved
// to the shared caption engine.
export { DEFAULT_VISION_PROMPT } from './caption-engine.js';

const DEFAULT_MAX_CONCURRENCY = 3;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_LONGEST_EDGE = 1568;

/**
 * Internal resolved options bag — all defaults applied, all values
 * validated. Constructed exactly once at factory time so `enrichPdf`
 * does not re-pay validation per page / per image.
 */
interface ResolvedOptions {
  provider: VisionProvider;
  maxConcurrency: number;
  cacheDir: string;
  promptTemplate: string;
  maxRetries: number;
  timeoutMs: number;
  onFailure: 'skip-image' | 'fail-index';
  markSyntheticChunk: boolean;
  maxLongestEdge: number;
}

function resolveOptions(opts: VisionCaptionOptions): ResolvedOptions {
  if (opts === null || typeof opts !== 'object') {
    throw new Error('withVisionCaption: opts must be an object');
  }
  if (!opts.provider || typeof opts.provider.caption !== 'function') {
    throw new Error(
      'withVisionCaption: opts.provider must be a VisionProvider with a caption() method',
    );
  }
  if (typeof opts.provider.providerId !== 'string' || opts.provider.providerId === '') {
    throw new Error('withVisionCaption: opts.provider.providerId must be a non-empty string');
  }
  if (typeof opts.provider.modelId !== 'string' || opts.provider.modelId === '') {
    throw new Error('withVisionCaption: opts.provider.modelId must be a non-empty string');
  }
  const maxConcurrency = opts.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 32) {
    throw new Error(
      `withVisionCaption: maxConcurrency must be an integer in [1, 32], got ${maxConcurrency}`,
    );
  }
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) {
    throw new Error(
      `withVisionCaption: maxRetries must be an integer in [0, 10], got ${maxRetries}`,
    );
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 600_000) {
    throw new Error(
      `withVisionCaption: timeoutMs must be an integer in [100, 600000], got ${timeoutMs}`,
    );
  }
  const maxLongestEdge = opts.maxLongestEdge ?? DEFAULT_MAX_LONGEST_EDGE;
  if (!Number.isInteger(maxLongestEdge) || maxLongestEdge < 64 || maxLongestEdge > 8192) {
    throw new Error(
      `withVisionCaption: maxLongestEdge must be an integer in [64, 8192], got ${maxLongestEdge}`,
    );
  }
  const onFailure = opts.onFailure ?? 'skip-image';
  if (onFailure !== 'skip-image' && onFailure !== 'fail-index') {
    throw new Error(
      `withVisionCaption: onFailure must be 'skip-image' or 'fail-index', got ${String(onFailure)}`,
    );
  }
  // Explicit undefined vs. false: only `false` flips off the marker; an
  // omitted field defaults to `true` (Story 2.7 教训 7).
  const markSyntheticChunk = opts.markSyntheticChunk !== false;
  const promptTemplate = opts.promptTemplate ?? DEFAULT_VISION_PROMPT;
  if (typeof promptTemplate !== 'string' || promptTemplate.length === 0) {
    throw new Error('withVisionCaption: promptTemplate must be a non-empty string');
  }
  const cacheDir = opts.cacheDir ?? resolveDefaultCaptionCacheDir();
  if (typeof cacheDir !== 'string' || cacheDir === '') {
    throw new Error('withVisionCaption: cacheDir must be a non-empty string');
  }

  return {
    provider: opts.provider,
    maxConcurrency,
    cacheDir,
    promptTemplate,
    maxRetries,
    timeoutMs,
    onFailure,
    markSyntheticChunk,
    maxLongestEdge,
  };
}

/**
 * Create an FR20 indexing plugin that captions PDF images using a
 * caller-injected vision LLM provider. Synthetic Chinese caption chunks
 * flow into the same `docs / docs_fts / docs_vec` storage as text chunks
 * (architecture §RAG Indexing Strategy L292-299).
 *
 * Lifecycle:
 *   1. factory: validate options + ensure `@napi-rs/canvas` present
 *      (fail-fast at index start, NOT at first image).
 *   2. enrichPdf: iterate pages → `unpdf.extractImages` → PNG-encode →
 *      cache lookup → `provider.caption` (concurrency-limited, retry on
 *      transient errors, timeout per call) → cache write → synthetic
 *      `Chunk[]`. Cache handle disposed via try/finally regardless of
 *      success path (Story 2.5 教训 1).
 */
export function withVisionCaption(opts: VisionCaptionOptions): IndexingPlugin {
  const resolved = resolveOptions(opts);

  // Eagerly validate canvas availability so a missing peer fails the
  // factory call instead of the first image inside enrichPdf — much
  // easier to debug at boot time (Story 2.6 M1 actionable error).
  // Reset to null on rejection so the caller can `pnpm add @napi-rs/canvas`
  // then reuse the same plugin instance without re-creating it.
  let canvasReady: Promise<unknown> | null = null;

  return {
    name: 'vision-caption',
    async enrichPdf(pages, ctx) {
      const safePdfBytes = validateContext(ctx);
      const safeCtx: IndexingPluginContext = { source: ctx.source, pdfBytes: safePdfBytes };
      if (canvasReady === null) {
        canvasReady = ensureCanvasAvailable();
      }
      try {
        await canvasReady;
      } catch (canvasErr) {
        canvasReady = null;
        throw canvasErr;
      }

      const cache = openCaptionCache({ cacheDir: resolved.cacheDir });
      try {
        return await runEnrichPdf(pages, safeCtx, resolved, cache);
      } finally {
        // Surface dispose errors via warn so they cannot mask the
        // primary throw path (Story 2.7 教训 12 — finally must not eat
        // the in-flight error).
        try {
          cache.close();
        } catch (closeErr) {
          process.stderr.write(
            `[vision-caption] cache.close() failed: ${
              closeErr instanceof Error ? closeErr.message : String(closeErr)
            }\n`,
          );
        }
      }
    },
  };
}

function validateContext(ctx: IndexingPluginContext): Uint8Array {
  if (ctx === null || typeof ctx !== 'object') {
    throw new Error('enrichPdf: ctx must be an object');
  }
  if (typeof ctx.source !== 'string' || ctx.source === '') {
    throw new Error('enrichPdf: ctx.source must be a non-empty string');
  }
  if (!(ctx.pdfBytes instanceof Uint8Array) || ctx.pdfBytes.length === 0) {
    throw new Error('enrichPdf: ctx.pdfBytes must be a non-empty Uint8Array');
  }
  // unpdf.extractImages forwards `bytes.buffer` to PDF.js. If the caller
  // handed us a `Buffer.subarray()` view (byteOffset !== 0) the buffer
  // would point at the wrong region. Slice into a contiguous owning copy
  // when the view is offset; pass-through otherwise to keep the
  // zero-copy fast path for typical readers.
  if (ctx.pdfBytes.byteOffset !== 0 || ctx.pdfBytes.byteLength !== ctx.pdfBytes.buffer.byteLength) {
    return ctx.pdfBytes.slice();
  }
  return ctx.pdfBytes;
}

interface CaptionJobResult {
  caption: string;
  page: number;
  imageIndex: number;
}

interface ExtractedImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  channels: 1 | 3 | 4;
  key?: string;
}

interface QueuedJob {
  image: ExtractedImage;
  pageNumber: number;
  imageIndex: number;
}

async function runEnrichPdf(
  pages: PdfPage[],
  ctx: IndexingPluginContext,
  opts: ResolvedOptions,
  cache: CaptionCache,
): Promise<Chunk[]> {
  if (!Array.isArray(pages)) {
    throw new Error('enrichPdf: pages must be an array');
  }
  const promptSha256 = sha256Hex(opts.promptTemplate);
  const limit = pLimit(opts.maxConcurrency);
  const engineOpts: CaptionEngineOptions = {
    provider: opts.provider,
    promptTemplate: opts.promptTemplate,
    maxRetries: opts.maxRetries,
    timeoutMs: opts.timeoutMs,
    failIndex: opts.onFailure === 'fail-index',
  };

  // Validate all pages upfront, then extract images in parallel (was
  // sequential, defeating the point of pLimit on multi-page PDFs).
  const validatedPages: number[] = [];
  for (const page of pages) {
    if (
      page === null ||
      typeof page !== 'object' ||
      !Number.isInteger(page.pageNumber) ||
      page.pageNumber < 1
    ) {
      throw new Error(
        `enrichPdf: page.pageNumber must be a positive integer, got ${String(page?.pageNumber)}`,
      );
    }
    validatedPages.push(page.pageNumber);
  }
  const extractions = await Promise.all(
    validatedPages.map(async (pageNumber) => {
      // Fresh per-page copy of the bytes: pdf.js (via unpdf) transfers
      // (detaches) the input ArrayBuffer to its worker on each call, so sharing
      // `ctx.pdfBytes` across these concurrent per-page extractImages calls makes
      // every call after the first throw `DataCloneError: Cannot transfer object
      // of unsupported type`. `.slice()` hands each call its own buffer.
      const images = await extractImages(ctx.pdfBytes.slice(), pageNumber);
      if (!Array.isArray(images)) {
        throw new Error(
          `enrichPdf: extractImages(page=${pageNumber}) returned a non-array (${typeof images})`,
        );
      }
      return { pageNumber, images };
    }),
  );

  // Validate every image, then group by dedupe key. Any structural
  // error throws BEFORE we schedule provider calls so we never burn
  // tokens on a half-broken PDF. Dedupe groups exist so a logo embedded
  // on every page issues exactly ONE provider call — three parallel jobs
  // for the same key would all miss the cache (race) and burn 3× tokens.
  const occurrences: Array<{ dedupeKey: string; pageNumber: number; imageIndex: number }> = [];
  const uniqueJobs = new Map<string, QueuedJob>();
  for (const { pageNumber, images } of extractions) {
    for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
      const image = images[imageIndex] as ExtractedImage | undefined;
      if (image === undefined) continue;
      validateExtractedImage(image, pageNumber, imageIndex);
      const dedupeKey =
        typeof image.key === 'string' && image.key !== ''
          ? `k:${image.key}`
          : `p:${pageNumber}:${imageIndex}`;
      if (!uniqueJobs.has(dedupeKey)) {
        uniqueJobs.set(dedupeKey, { image, pageNumber, imageIndex });
      }
      occurrences.push({ dedupeKey, pageNumber, imageIndex });
    }
  }

  const dedupeKeys = [...uniqueJobs.keys()];
  const jobs = dedupeKeys.map((k) => {
    const j = uniqueJobs.get(k) as QueuedJob;
    return limit(() =>
      processImage(j.image, j.pageNumber, j.imageIndex, opts, engineOpts, cache, promptSha256),
    );
  });

  // Promise.allSettled (not Promise.all) so a single rejection does not
  // leave sibling jobs racing the cache.close() in the outer finally
  // block. We surface the first rejection AFTER every job has settled.
  const settled = await Promise.allSettled(jobs);
  const resultByKey = new Map<string, PromiseSettledResult<CaptionJobResult | null>>();
  dedupeKeys.forEach((k, i) => {
    const r = settled[i];
    if (r !== undefined) resultByKey.set(k, r);
  });

  let firstError: unknown;
  const chunks: Chunk[] = [];
  for (const occ of occurrences) {
    const r = resultByKey.get(occ.dedupeKey);
    if (r === undefined) continue;
    if (r.status === 'rejected') {
      if (firstError === undefined) firstError = r.reason;
      continue;
    }
    if (r.value === null) continue;
    const chunk: Chunk = {
      content: r.value.caption,
      source: ctx.source,
      page: occ.pageNumber,
    };
    if (opts.markSyntheticChunk) {
      chunk.section = `[图片描述 #${occ.imageIndex}]`;
    }
    chunks.push(chunk);
  }
  if (firstError !== undefined) throw firstError;
  return chunks;
}

function validateExtractedImage(
  image: ExtractedImage,
  pageNumber: number,
  imageIndex: number,
): void {
  if (!(image.data instanceof Uint8ClampedArray)) {
    throw new Error(
      `enrichPdf: extractImages(page=${pageNumber})[${imageIndex}].data is not a Uint8ClampedArray`,
    );
  }
  if (!Number.isInteger(image.width) || image.width <= 0) {
    throw new Error(
      `enrichPdf: extractImages(page=${pageNumber})[${imageIndex}].width must be a positive integer, got ${image.width}`,
    );
  }
  if (!Number.isInteger(image.height) || image.height <= 0) {
    throw new Error(
      `enrichPdf: extractImages(page=${pageNumber})[${imageIndex}].height must be a positive integer, got ${image.height}`,
    );
  }
  if (image.channels !== 1 && image.channels !== 3 && image.channels !== 4) {
    throw new Error(
      `enrichPdf: extractImages(page=${pageNumber})[${imageIndex}].channels must be 1, 3, or 4, got ${image.channels}`,
    );
  }
  const expectedLen = image.width * image.height * image.channels;
  if (image.data.length !== expectedLen) {
    throw new Error(
      `enrichPdf: extractImages(page=${pageNumber})[${imageIndex}].data.length (${image.data.length}) ` +
        `does not match width*height*channels (${expectedLen})`,
    );
  }
}

async function processImage(
  image: ExtractedImage,
  pageNumber: number,
  imageIndex: number,
  opts: ResolvedOptions,
  engineOpts: CaptionEngineOptions,
  cache: CaptionCache,
  promptSha256: string,
): Promise<CaptionJobResult | null> {
  const pngBytes = await encodePng(
    image.data,
    image.width,
    image.height,
    image.channels,
    opts.maxLongestEdge,
  );
  const caption = await captionPngWithCache(
    pngBytes,
    engineOpts,
    cache,
    promptSha256,
    `page=${pageNumber} image=${imageIndex}`,
  );
  if (caption === null) return null;
  return { caption, page: pageNumber, imageIndex };
}
