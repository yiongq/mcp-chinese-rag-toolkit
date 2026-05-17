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
const RETRY_BACKOFFS_MS = [500, 1500];

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
  let canvasReady: Promise<unknown> | null = null;

  return {
    name: 'vision-caption',
    async enrichPdf(pages, ctx) {
      validateContext(ctx);
      if (canvasReady === null) {
        canvasReady = ensureCanvasAvailable();
      }
      await canvasReady;

      const cache = openCaptionCache({ cacheDir: resolved.cacheDir });
      try {
        return await runEnrichPdf(pages, ctx, resolved, cache);
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

function validateContext(ctx: IndexingPluginContext): void {
  if (ctx === null || typeof ctx !== 'object') {
    throw new Error('enrichPdf: ctx must be an object');
  }
  if (typeof ctx.source !== 'string' || ctx.source === '') {
    throw new Error('enrichPdf: ctx.source must be a non-empty string');
  }
  if (!(ctx.pdfBytes instanceof Uint8Array) || ctx.pdfBytes.length === 0) {
    throw new Error('enrichPdf: ctx.pdfBytes must be a non-empty Uint8Array');
  }
}

interface CaptionJobResult {
  caption: string;
  page: number;
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

  const jobs: Array<Promise<CaptionJobResult | null>> = [];

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
    const pageNumber = page.pageNumber;

    const images = await extractImages(ctx.pdfBytes, pageNumber);
    if (!Array.isArray(images)) {
      throw new Error(
        `enrichPdf: extractImages(page=${pageNumber}) returned a non-array (${typeof images})`,
      );
    }
    for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
      const image = images[imageIndex];
      if (image === undefined) continue;
      validateExtractedImage(image, pageNumber, imageIndex);
      jobs.push(
        limit(() => processImage(image, pageNumber, imageIndex, opts, cache, promptSha256)),
      );
    }
  }

  const results = await Promise.all(jobs);
  const chunks: Chunk[] = [];
  for (const r of results) {
    if (r === null) continue;
    const chunk: Chunk = {
      content: r.caption,
      source: ctx.source,
      page: r.page,
    };
    if (opts.markSyntheticChunk) {
      chunk.section = `[图片描述 #${r.imageIndex}]`;
    }
    chunks.push(chunk);
  }
  return chunks;
}

function validateExtractedImage(
  image: { data: Uint8ClampedArray; width: number; height: number; channels: 1 | 3 | 4 },
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
}

async function processImage(
  image: { data: Uint8ClampedArray; width: number; height: number; channels: 1 | 3 | 4 },
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
  cache.set({
    captionText: caption,
    imageSha256,
    promptSha256,
    providerId: opts.provider.providerId,
    modelId: opts.provider.modelId,
    createdAt: new Date().toISOString(),
  });
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
      const caption = await opts.provider.caption({
        imagePng: pngBytes,
        prompt: opts.promptTemplate,
        timeoutMs: opts.timeoutMs,
      });
      if (typeof caption !== 'string' || caption === '') {
        throw new Error(
          `captionWithRetry: provider returned non-string or empty caption for page=${pageNumber} image=${imageIndex}`,
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
      const backoff =
        RETRY_BACKOFFS_MS[attempt] ?? RETRY_BACKOFFS_MS[RETRY_BACKOFFS_MS.length - 1] ?? 0;
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
 * Classify whether an error should trigger a retry. Retryable:
 *   - `AbortError` (timeout)
 *   - HTTP 5xx
 *   - HTTP 429 (rate limit)
 *
 * Everything else (401 auth fail, 400 bad request, schema mismatch, …)
 * fails fast — re-attempting only wastes quota.
 */
function isRetryable(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const e = err as { name?: unknown; statusCode?: unknown; status?: unknown };
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
