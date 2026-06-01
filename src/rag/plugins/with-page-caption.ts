import pLimit from 'p-limit';
import { renderPageAsImage } from 'unpdf';
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
import { ensureCanvasAvailable } from './png-encoder.js';
import type {
  IndexingPlugin,
  IndexingPluginContext,
  PageCaptionOptions,
  VisionProvider,
} from './types.js';

const DEFAULT_MAX_CONCURRENCY = 3;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SCALE = 1.0;
// Boilerplate copyright line repeated on every page is ~65 chars; anything
// under ~90 carries no real text — its content lives in the rendered page.
const DEFAULT_MIN_TEXT_LENGTH = 90;

/**
 * Internal resolved options bag — all defaults applied, all values
 * validated exactly once at factory time so `enrichPdf` does not re-pay
 * validation per page.
 */
interface ResolvedOptions {
  provider: VisionProvider;
  maxConcurrency: number;
  cacheDir: string;
  promptTemplate: string;
  maxRetries: number;
  timeoutMs: number;
  onFailure: 'skip-page' | 'fail-index';
  markSyntheticChunk: boolean;
  scale: number;
  selectPage: (page: PdfPage) => boolean;
}

function resolveOptions(opts: PageCaptionOptions): ResolvedOptions {
  if (opts === null || typeof opts !== 'object') {
    throw new Error('withPageCaption: opts must be an object');
  }
  if (!opts.provider || typeof opts.provider.caption !== 'function') {
    throw new Error(
      'withPageCaption: opts.provider must be a VisionProvider with a caption() method',
    );
  }
  if (typeof opts.provider.providerId !== 'string' || opts.provider.providerId === '') {
    throw new Error('withPageCaption: opts.provider.providerId must be a non-empty string');
  }
  if (typeof opts.provider.modelId !== 'string' || opts.provider.modelId === '') {
    throw new Error('withPageCaption: opts.provider.modelId must be a non-empty string');
  }
  const maxConcurrency = opts.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 32) {
    throw new Error(
      `withPageCaption: maxConcurrency must be an integer in [1, 32], got ${maxConcurrency}`,
    );
  }
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) {
    throw new Error(`withPageCaption: maxRetries must be an integer in [0, 10], got ${maxRetries}`);
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 600_000) {
    throw new Error(
      `withPageCaption: timeoutMs must be an integer in [100, 600000], got ${timeoutMs}`,
    );
  }
  const scale = opts.scale ?? DEFAULT_SCALE;
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0 || scale > 10) {
    throw new Error(`withPageCaption: scale must be a finite number in (0, 10], got ${scale}`);
  }
  const onFailure = opts.onFailure ?? 'skip-page';
  if (onFailure !== 'skip-page' && onFailure !== 'fail-index') {
    throw new Error(
      `withPageCaption: onFailure must be 'skip-page' or 'fail-index', got ${String(onFailure)}`,
    );
  }
  // Explicit undefined vs. false: only `false` flips off the marker; an
  // omitted field defaults to `true`.
  const markSyntheticChunk = opts.markSyntheticChunk !== false;
  const promptTemplate = opts.promptTemplate ?? DEFAULT_VISION_PROMPT;
  if (typeof promptTemplate !== 'string' || promptTemplate.length === 0) {
    throw new Error('withPageCaption: promptTemplate must be a non-empty string');
  }
  const cacheDir = opts.cacheDir ?? resolveDefaultCaptionCacheDir();
  if (typeof cacheDir !== 'string' || cacheDir === '') {
    throw new Error('withPageCaption: cacheDir must be a non-empty string');
  }
  // `selectPage` wins; otherwise build the default text-length predicate.
  let selectPage: (page: PdfPage) => boolean;
  if (opts.selectPage !== undefined) {
    if (typeof opts.selectPage !== 'function') {
      throw new Error('withPageCaption: selectPage must be a function when provided');
    }
    selectPage = opts.selectPage;
  } else {
    const minTextLength = opts.minTextLength ?? DEFAULT_MIN_TEXT_LENGTH;
    if (!Number.isInteger(minTextLength) || minTextLength < 0) {
      throw new Error(
        `withPageCaption: minTextLength must be a non-negative integer, got ${minTextLength}`,
      );
    }
    selectPage = (page) => (page.text ?? '').trim().length < minTextLength;
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
    scale,
    selectPage,
  };
}

/**
 * Create an FR20 indexing plugin that captions WHOLE PDF pages by rendering
 * each selected page to a PNG (`unpdf.renderPageAsImage`) and captioning it
 * with a caller-injected vision LLM. The synthetic Chinese caption chunks
 * flow into the same `docs / docs_fts / docs_vec` storage as text chunks, so
 * the runtime retrieval path is unaffected.
 *
 * Contrast with {@link import('./with-vision-caption.js').withVisionCaption},
 * which captions each EMBEDDED image. For slide-style / scanned / vector
 * PDFs, per-image extraction emits one noisy caption per logo / decoration
 * (and `extractImages` can even throw `DataCloneError` on some PDFs), whereas
 * whole-page rendering captures the page's real meaning — org charts, system
 * screenshots, vector flowcharts — in exactly one caption per page.
 *
 * Lifecycle:
 *   1. factory: validate options.
 *   2. enrichPdf: ensure `@napi-rs/canvas` present (fail-fast at index start,
 *      NOT at first page) → filter pages by `selectPage` →
 *      `renderPageAsImage` (concurrency-limited) → caption (retry on
 *      transient errors, timeout per call, shared caption cache) → synthetic
 *      `Chunk[]`. Cache handle disposed via try/finally regardless of path.
 */
export function withPageCaption(opts: PageCaptionOptions): IndexingPlugin {
  const resolved = resolveOptions(opts);

  // Eagerly validate canvas availability so a missing peer fails the first
  // enrichPdf call instead of the first rendered page — much easier to debug
  // at boot time. Reset to null on rejection so the caller can install the
  // peer then reuse the same plugin instance.
  let canvasReady: Promise<unknown> | null = null;

  return {
    name: 'page-caption',
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
        // Surface dispose errors via warn so they cannot mask the primary
        // throw path (finally must not eat the in-flight error).
        try {
          cache.close();
        } catch (closeErr) {
          process.stderr.write(
            `[page-caption] cache.close() failed: ${
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
  return ctx.pdfBytes;
}

interface CaptionJobResult {
  caption: string;
  page: number;
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

  // Validate every page upfront, then keep only those the predicate selects.
  // Validation runs across ALL pages (not just selected) so a structurally
  // broken page array fails fast before we schedule any render/provider call.
  const selected: number[] = [];
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
    if (opts.selectPage(page)) selected.push(page.pageNumber);
  }

  const jobs = selected.map((pageNumber) =>
    limit(() => processPage(pageNumber, ctx, opts, engineOpts, cache, promptSha256)),
  );

  // Promise.allSettled (not Promise.all) so a single rejection does not leave
  // sibling jobs racing the cache.close() in the outer finally block. Surface
  // the first rejection AFTER every job has settled.
  const settled = await Promise.allSettled(jobs);

  let firstError: unknown;
  const chunks: Chunk[] = [];
  for (const r of settled) {
    if (r.status === 'rejected') {
      if (firstError === undefined) firstError = r.reason;
      continue;
    }
    if (r.value === null) continue;
    const chunk: Chunk = {
      content: r.value.caption,
      source: ctx.source,
      page: r.value.page,
    };
    if (opts.markSyntheticChunk) {
      chunk.section = '[图片描述]';
    }
    chunks.push(chunk);
  }
  if (firstError !== undefined) throw firstError;
  return chunks;
}

async function processPage(
  pageNumber: number,
  ctx: IndexingPluginContext,
  opts: ResolvedOptions,
  engineOpts: CaptionEngineOptions,
  cache: CaptionCache,
  promptSha256: string,
): Promise<CaptionJobResult | null> {
  // Fresh per-page copy of the bytes: pdf.js (via unpdf) transfers (detaches)
  // the input ArrayBuffer to its worker on each call, so sharing
  // `ctx.pdfBytes` across these concurrent renderPageAsImage calls makes every
  // call after the first throw `DataCloneError`. `.slice()` hands each call
  // its own buffer. `canvasImport` routes through the toolkit's own
  // canvas resolver (the same one the eager fail-fast check used).
  const rendered = await renderPageAsImage(ctx.pdfBytes.slice(), pageNumber, {
    canvasImport: () => ensureCanvasAvailable(),
    scale: opts.scale,
  });
  const pngBytes = new Uint8Array(rendered);
  const caption = await captionPngWithCache(
    pngBytes,
    engineOpts,
    cache,
    promptSha256,
    `page=${pageNumber}`,
  );
  if (caption === null) return null;
  return { caption, page: pageNumber };
}
