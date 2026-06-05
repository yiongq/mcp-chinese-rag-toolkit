import type { Chunk, PdfPage } from '../types.js';

// ---------------------------------------------------------------------------
// — Indexing Plugin abstraction + Vision
// Caption Plugin types (ADR-0008)
// ---------------------------------------------------------------------------

/**
 * Context passed to {@link IndexingPlugin.enrichPdf}. Lets the plugin call
 * `unpdf.extractImages(pdfBytes, pageN)` etc. without re-reading the source
 * file (which the caller already loaded for `parsePdf`).
 */
export interface IndexingPluginContext {
  /** Source identifier propagated to every produced {@link Chunk.source}. */
  source: string;
  /** Raw PDF bytes (already loaded by caller — DO NOT re-read from disk). */
  pdfBytes: Uint8Array;
}

/**
 *  indexing-time plugin. Hooks fire DURING `pnpm run index`, AFTER
 * `parsePdf()` produces {@link PdfPage}[] and BEFORE the caller passes the
 * combined chunk array to the embedder / FTS tokenizer.
 *
 * The plugin returns ADDITIONAL synthetic chunks which the caller
 * concatenates with the text chunks produced by `chunkPdfPages()`. Runtime
 * retrieval path is UNAFFECTED — synthetic chunks live in the same
 * `docs / docs_fts / docs_vec` tables as text chunks and flow through the
 * unchanged hybrid + rerank pipeline.
 *
 * Why a minimal single-hook interface (and not a multi-hook lifecycle):
 *   - The first plugin only needs pre-chunking enrichment.
 *   - YAGNI — additional hooks (`enrichChunks` / `postRerank`) land when a
 *     second plugin actually requires them; over-abstracting now would lock
 *     the contract before we know the real shape.
 */
export interface IndexingPlugin {
  /**
   * Plugin identity (kebab-case, e.g. `'vision-caption'`). Used for
   * structured logging + future cache directory namespacing.
   */
  readonly name: string;
  /**
   * Generate synthetic chunks from a parsed PDF. Optional — additional
   * lifecycle hooks may grow alongside the interface; absence of `enrichPdf`
   * means the plugin opts out of pre-chunking enrichment for this run.
   */
  enrichPdf?(pages: PdfPage[], ctx: IndexingPluginContext): Promise<Chunk[]>;
}

/**
 * Caller-injected vision LLM provider. Toolkit deliberately does NOT bind
 * to `@anthropic-ai/sdk` / `openai` / 豆包 SDK / qwen SDK —
 * `templates/anthropic-vision-provider.ts` is a reference adapter the
 * caller copies + fills in their own API key.
 *
 * Mirrors {@link import('../types.js').LlmProvider} (contextual
 * retrieval) + `EvalSearchFn` (eval framework) provider-injection
 * patterns. Toolkit `dependencies` stays free of vendor SDKs ( npm
 * package size guard + 教训 9).
 */
export interface VisionProvider {
  /**
   * Provider identity (kebab-case, e.g. `'doubao-vision'`, `'anthropic'`,
   * `'qwen-vl'`, `'openai'`). Written into the caption cache key so
   * provider switches invalidate cached captions.
   */
  readonly providerId: string;
  /**
   * Model identity (e.g. `'doubao-vision-pro-32k'`, `'claude-haiku-4-5'`).
   * Written into cache key — model bumps invalidate cache.
   */
  readonly modelId: string;
  /**
   * Caption a single PNG-encoded image. MUST return a non-empty string
   * (200-300 chars Chinese is the target; toolkit does not enforce length
   * since providers occasionally return shorter output on simple images).
   *
   * MUST honor `timeoutMs` via internal `AbortController` / provider SDK
   * timeout. Throw an `Error` with `name === 'AbortError'` on timeout so
   * the retry policy in {@link import('./with-vision-caption.js').withVisionCaption}
   * can classify it correctly.
   */
  caption(args: { imagePng: Uint8Array; prompt: string; timeoutMs: number }): Promise<string>;
}

/**
 * Options for `withVisionCaption`. All fields except `provider` are
 * optional; defaults align with ADR-0008 §Provider 选型矩阵
 * `concurrency=3` scenario.
 */
export interface VisionCaptionOptions {
  /** Caller-injected vision LLM. REQUIRED — toolkit ships zero vendor SDKs. */
  provider: VisionProvider;
  /** Concurrency cap across `provider.caption()` calls. @default 3 */
  maxConcurrency?: number;
  /**
   * Caption SQLite cache directory.
   * @default `<userCacheDir>/mcp-chinese-rag-toolkit/caption-cache` (resolved via
   * the same env-paths logic uses for model cache, but under a
   * disjoint subpath so model cache and caption cache never collide).
   */
  cacheDir?: string;
  /**
   * Override the default prompt template. The plugin hashes the FINAL
   * rendered prompt for the cache key, so changing this string invalidates
   * cached captions (intentional — different prompts produce different
   * captions). @default see `DEFAULT_VISION_PROMPT`.
   */
  promptTemplate?: string;
  /**
   * Per-image retry count on transient errors (timeout / 5xx / 429).
   * Exponential backoff `500ms / 1500ms / ...` @default 2
   */
  maxRetries?: number;
  /** Per-image timeout in milliseconds passed to provider. @default 30000 */
  timeoutMs?: number;
  /**
   * Per-image failure mode after retries exhausted.
   *  - `'skip-image'` (default): warn + skip the image; index continues.
   *  - `'fail-index'`: throw {@link VisionCaptionFailedError}; caller decides
   *    recovery.
   *
   * Never silently swallows errors regardless of mode (教训 2
   * fail-fast + actionable error). @default 'skip-image'
   */
  onFailure?: 'skip-image' | 'fail-index';
  /**
   * When true, generated chunk `.section` is `'[图片描述 #<idx>]'`; when
   * false, `.section` is `undefined` (caption blends transparently into
   * the text stream). @default true
   */
  markSyntheticChunk?: boolean;
  /**
   * Resize ceiling — images with `max(width, height) > maxLongestEdge` are
   * downsampled keeping aspect ratio. 1568 is the common-denominator safe
   * upper bound across 4 providers (Anthropic max 1568, OpenAI max 2048,
   * 豆包 max 2048, 千问 max 1792 — pick the lowest for cross-provider
   * portability). @default 1568
   */
  maxLongestEdge?: number;
}

/**
 * Options for `withPageCaption`. Like {@link VisionCaptionOptions} but the
 * unit of work is a WHOLE rendered page (via `unpdf.renderPageAsImage`),
 * not each embedded image (`unpdf.extractImages`). Use this for slide-style /
 * scanned / vector-flowchart PDFs where the meaningful content is the page as
 * a whole and per-image extraction would emit one noisy caption per logo /
 * decoration. Shares the same {@link VisionProvider}, caption cache, default
 * prompt, retry + backoff, timeout safety net and concurrency cap as
 * `withVisionCaption`.
 */
export interface PageCaptionOptions {
  /** Caller-injected vision LLM. REQUIRED — toolkit ships zero vendor SDKs. */
  provider: VisionProvider;
  /** Concurrency cap across `provider.caption()` calls. @default 3 */
  maxConcurrency?: number;
  /**
   * Caption SQLite cache directory. Shared with `withVisionCaption` — the
   * rendered-page PNG bytes are the cache key, so the two plugins never
   * collide. @default `<userCacheDir>/mcp-chinese-rag-toolkit/caption-cache`.
   */
  cacheDir?: string;
  /**
   * Override the default prompt template. The plugin hashes the FINAL
   * rendered prompt for the cache key, so changing this string invalidates
   * cached captions. @default see `DEFAULT_VISION_PROMPT`.
   */
  promptTemplate?: string;
  /**
   * Per-page retry count on transient errors (timeout / 5xx / 429).
   * Exponential backoff `500ms / 1500ms / ...` @default 2
   */
  maxRetries?: number;
  /** Per-page timeout in milliseconds passed to provider. @default 30000 */
  timeoutMs?: number;
  /**
   * Per-page failure mode after retries exhausted.
   *  - `'skip-page'` (default): warn + skip the page; index continues.
   *  - `'fail-index'`: throw {@link VisionCaptionFailedError}; caller decides
   *    recovery.
   *
   * Never silently swallows errors regardless of mode. @default 'skip-page'
   */
  onFailure?: 'skip-page' | 'fail-index';
  /**
   * When true, generated chunk `.section` is `'[图片描述]'`; when false,
   * `.section` is `undefined` (caption blends transparently into the text
   * stream). @default true
   */
  markSyntheticChunk?: boolean;
  /**
   * Render scale forwarded to `unpdf.renderPageAsImage`. 1.0 reproduces the
   * page at its native PDF point size; bump (e.g. 2.0) for sharper OCR on
   * dense slides at the cost of larger PNGs / more provider tokens.
   * @default 1.0
   */
  scale?: number;
  /**
   * Predicate selecting which pages to render + caption. Receives each
   * {@link PdfPage} and returns `true` to caption it. Overrides
   * `minTextLength` when provided. @default selects pages whose trimmed text
   * length is `< minTextLength` (i.e. image-only / title-only pages whose
   * meaning lives in the rendered page, not the extracted text).
   */
  selectPage?: (page: PdfPage) => boolean;
  /**
   * Threshold for the DEFAULT page-selection predicate: a page is captioned
   * when `page.text.trim().length < minTextLength`. Ignored when `selectPage`
   * is supplied. The boilerplate copyright line repeated on every page (~65
   * chars) means anything under ~90 carries no real text. @default 90
   */
  minTextLength?: number;
}

/**
 * Result row returned by `CaptionCache.get` / accepted by `.set`. Internal
 * cache record shape — exported for test-time introspection.
 */
export interface CaptionCacheEntry {
  captionText: string;
  /** sha256(imagePngBytes) — primary lookup key. */
  imageSha256: string;
  /** sha256(promptTemplate) — invalidates on prompt change. */
  promptSha256: string;
  providerId: string;
  modelId: string;
  /** ISO 8601 UTC timestamp. */
  createdAt: string;
}

/**
 * Thrown when `VisionCaptionOptions.onFailure === 'fail-index'` AND all
 * retries are exhausted. `cause` preserves the underlying provider error
 * for diagnostics.
 */
export class VisionCaptionFailedError extends Error {
  override readonly name = 'VisionCaptionFailedError';
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
  }
}

/**
 * Thrown when `@napi-rs/canvas` (optional peer) is not installed. The
 * `install` arg becomes part of an actionable error message (e.g.
 * `pnpm add @napi-rs/canvas`).
 */
export class OptionalDependencyMissingError extends Error {
  override readonly name = 'OptionalDependencyMissingError';
  constructor(
    public readonly packageName: string,
    install: string,
  ) {
    super(
      `${packageName} is required by withVisionCaption() but not installed. ` +
        `Install with: ${install}`,
    );
  }
}
