import pLimit from 'p-limit';
import { extractImages } from 'unpdf';
import type { Chunk, PdfPage } from '../types.js';
import {
  type CaptionCache,
  openCaptionCache,
  resolveDefaultCaptionCacheDir,
  sha256Hex,
} from './caption-cache.js';
import { encodePng, ensureCanvasAvailable } from './png-encoder.js';
import {
  type IndexingPlugin,
  type IndexingPluginContext,
  VisionCaptionFailedError,
  type VisionCaptionOptions,
  type VisionProvider,
} from './types.js';

/**
 * Default Chinese prompt template — taken verbatim from ADR-0008 §Caption
 * Prompt 模板. Callers can override via `opts.promptTemplate`; doing so
 * invalidates the caption cache (intentional, since different prompts
 * produce different captions).
 */
export const DEFAULT_VISION_PROMPT =
  '你是一个文档内容描述助手。请用中文 200-300 字描述这张图的核心信息。\n\n' +
  '重点关注（按重要性排序）：\n' +
  '1. 文字标注与数字（OCR-style 完整保留，不简化）\n' +
  '2. 表格内容（按行列结构描述）\n' +
  '3. 流程节点与连线方向\n' +
  '4. 图表类型与数据趋势\n' +
  '5. 关键 UI 元素位置与标签\n\n' +
  '格式要求：\n' +
  '- 不要写"这张图展示了..."类客套开头\n' +
  '- 数字、专有名词、英文术语必须保留原文\n' +
  '- 不要推测图外含义，只描述可见内容\n' +
  '- 中文逗号/句号';

const DEFAULT_MAX_CONCURRENCY = 3;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_LONGEST_EDGE = 1568;
// Spec L66 anchors the first two values (500ms / 1500ms); subsequent
// attempts grow as 500 * 3^attempt clamped at MAX_BACKOFF_MS so a caller
// who sets `maxRetries > 2` actually sees exponential growth instead of
// the array tail flat-lining at 1500ms.
const RETRY_BACKOFFS_MS = [500, 1500];
const MAX_BACKOFF_MS = 30_000;
// Safety-net multiplier applied to provider's own timeoutMs. If a buggy
// provider ignores its timeoutMs argument we still abort the await this
// long after the call started (see captionWithRetry Promise.race).
const TIMEOUT_SAFETY_MULTIPLIER = 1.5;

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
      const images = await extractImages(ctx.pdfBytes, pageNumber);
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
      processImage(j.image, j.pageNumber, j.imageIndex, opts, cache, promptSha256),
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
  const imageSha256 = sha256Hex(pngBytes);
  const cached = cache.get({
    imageSha256,
    promptSha256,
    providerId: opts.provider.providerId,
    modelId: opts.provider.modelId,
  });
  if (cached) {
    return { caption: cached.captionText, page: pageNumber, imageIndex };
  }
  const caption = await captionWithRetry(pngBytes, opts, pageNumber, imageIndex);
  if (caption === null) {
    return null;
  }
  // Wrap cache.set: a failed write (disk full / SQLITE_BUSY / closed
  // handle if outer ran finally early) must NOT discard a caption we
  // already paid the provider for.
  try {
    cache.set({
      captionText: caption,
      imageSha256,
      promptSha256,
      providerId: opts.provider.providerId,
      modelId: opts.provider.modelId,
      createdAt: new Date().toISOString(),
    });
  } catch (cacheErr) {
    process.stderr.write(
      `[vision-caption] WARN: cache.set failed for page=${pageNumber} image=${imageIndex}; ` +
        `caption returned but not persisted. Reason: ${
          cacheErr instanceof Error ? cacheErr.message : String(cacheErr)
        }\n`,
    );
  }
  return { caption, page: pageNumber, imageIndex };
}

async function captionWithRetry(
  pngBytes: Uint8Array,
  opts: ResolvedOptions,
  pageNumber: number,
  imageIndex: number,
): Promise<string | null> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt += 1) {
    try {
      const caption = await callWithTimeoutSafetyNet(opts, pngBytes);
      // Empty / non-string responses are treated as a transient provider
      // quirk (some vision LLMs occasionally return "" on near-blank
      // images) rather than fatal — re-try the call, fall through to the
      // retry/onFailure machinery if it persists.
      if (typeof caption !== 'string' || caption === '') {
        throw Object.assign(
          new Error(
            `captionWithRetry: provider returned non-string or empty caption for page=${pageNumber} image=${imageIndex}`,
          ),
          { __visionEmptyResponse: true },
        );
      }
      return caption;
    } catch (err) {
      lastError = err;
      const retryable = isRetryable(err);
      if (!retryable || attempt === opts.maxRetries) {
        if (opts.onFailure === 'fail-index') {
          throw new VisionCaptionFailedError(
            `vision-caption: captionWithRetry exhausted after ${attempt + 1} attempt(s) for page=${pageNumber} image=${imageIndex}`,
            err,
          );
        }
        process.stderr.write(
          `[vision-caption] WARN: page=${pageNumber} image=${imageIndex} failed after ${attempt + 1} attempt(s); skipping. ` +
            `Last error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        return null;
      }
      const backoff = computeBackoffMs(attempt, err);
      if (backoff > 0) await sleep(backoff);
    }
  }
  // Unreachable, but TypeScript needs a terminal statement.
  /* c8 ignore next 3 */
  if (opts.onFailure === 'fail-index') {
    throw new VisionCaptionFailedError('vision-caption: retry loop exited unexpectedly', lastError);
  }
  return null;
}

/**
 * Toolkit-side safety net: even when a provider ignores its `timeoutMs`
 * argument we abort the await `timeoutMs * 1.5` ms after the call
 * started. Without this a misbehaving adapter could stall the entire
 * index. The thrown `AbortError` flows through `isRetryable` so the
 * retry machinery still kicks in.
 */
function callWithTimeoutSafetyNet(opts: ResolvedOptions, pngBytes: Uint8Array): Promise<string> {
  const safetyMs = Math.ceil(opts.timeoutMs * TIMEOUT_SAFETY_MULTIPLIER);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const safetyNet = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(
        `vision-caption: provider exceeded timeout safety net (${safetyMs} ms)`,
      );
      (err as Error & { name: string }).name = 'AbortError';
      reject(err);
    }, safetyMs);
    // Avoid keeping the event loop alive purely for this timer.
    timer?.unref?.();
  });
  const call = opts.provider.caption({
    imagePng: pngBytes,
    prompt: opts.promptTemplate,
    timeoutMs: opts.timeoutMs,
  });
  return Promise.race([call, safetyNet]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  }) as Promise<string>;
}

/**
 * Compute the wait before retry `attempt + 1`. Honors `Retry-After`
 * (seconds — the HTTP standard) or `retryAfterMs` (milliseconds — what
 * some SDK adapters surface) when the provider supplies it, clamped to
 * MAX_BACKOFF_MS so a hostile server cannot wedge the indexer for
 * minutes. Otherwise falls back to the canonical spec-anchored values
 * 500 / 1500ms for the first two attempts, then grows exponentially
 * (500 * 3^attempt) capped at MAX_BACKOFF_MS.
 */
function computeBackoffMs(attempt: number, err: unknown): number {
  const hint = readRetryAfterMs(err);
  if (hint !== null) return Math.min(MAX_BACKOFF_MS, hint);
  const explicit = RETRY_BACKOFFS_MS[attempt];
  if (typeof explicit === 'number') return explicit;
  const expo = Math.round(500 * 3 ** attempt);
  return Math.min(MAX_BACKOFF_MS, expo);
}

function readRetryAfterMs(err: unknown): number | null {
  if (err === null || typeof err !== 'object') return null;
  const e = err as {
    retryAfterMs?: unknown;
    retryAfter?: unknown;
    headers?: Record<string, unknown> | { get?: (k: string) => unknown };
  };
  if (typeof e.retryAfterMs === 'number' && Number.isFinite(e.retryAfterMs) && e.retryAfterMs > 0) {
    return Math.ceil(e.retryAfterMs);
  }
  if (typeof e.retryAfter === 'number' && Number.isFinite(e.retryAfter) && e.retryAfter > 0) {
    return Math.ceil(e.retryAfter * 1000);
  }
  const headers = e.headers;
  let raw: unknown;
  if (headers !== undefined && headers !== null) {
    if (typeof (headers as { get?: unknown }).get === 'function') {
      raw = (headers as { get: (k: string) => unknown }).get('retry-after');
    } else if (typeof headers === 'object') {
      const h = headers as Record<string, unknown>;
      raw = h['retry-after'] ?? h['Retry-After'];
    }
  }
  if (typeof raw === 'string') {
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n) && n > 0) return Math.ceil(n * 1000);
  } else if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.ceil(raw * 1000);
  }
  return null;
}

/**
 * Classify whether an error should trigger a retry. Retryable:
 *   - `AbortError` (timeout — toolkit safety net or provider's own)
 *   - HTTP 5xx
 *   - HTTP 429 (rate limit)
 *   - empty / non-string provider response (provider quirk, not a bug)
 *
 * Everything else (401 auth fail, 400 bad request, schema mismatch, …)
 * fails fast — re-attempting only wastes quota.
 */
function isRetryable(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const e = err as {
    name?: unknown;
    statusCode?: unknown;
    status?: unknown;
    __visionEmptyResponse?: unknown;
  };
  if (e.__visionEmptyResponse === true) return true;
  if (e.name === 'AbortError') return true;
  const status =
    typeof e.statusCode === 'number'
      ? e.statusCode
      : typeof e.status === 'number'
        ? e.status
        : undefined;
  if (status === undefined) return false;
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
