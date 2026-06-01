// Shared caption runtime for the image-caption indexing plugins
// (`withVisionCaption` — per-embedded-image, and `withPageCaption` —
// per-rendered-page). Both plugins differ ONLY in how they turn a PDF into
// PNG bytes (extractImages vs renderPageAsImage). Everything downstream of
// "here are the PNG bytes" — caption cache lookup/write, retry + exponential
// backoff, per-call timeout safety net, transient-vs-fatal classification —
// is identical and lives here so the semantically-critical retry policy has a
// single source of truth (Story 2.8 教训 — keep the hard-won retry math DRY).

import type { CaptionCache } from './caption-cache.js';
import { sha256Hex } from './caption-cache.js';
import { VisionCaptionFailedError, type VisionProvider } from './types.js';

/**
 * Default Chinese prompt template — taken verbatim from ADR-0008 §Caption
 * Prompt 模板. Shared by both caption plugins; callers override via
 * `opts.promptTemplate`, which invalidates the caption cache (intentional,
 * since different prompts produce different captions).
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
 * Caption-runtime knobs shared by both plugins. Constructed once per
 * `enrichPdf` run from each plugin's fully-resolved options bag and threaded
 * down to every per-image / per-page job.
 */
export interface CaptionEngineOptions {
  provider: VisionProvider;
  promptTemplate: string;
  maxRetries: number;
  timeoutMs: number;
  /**
   * `true` → throw {@link VisionCaptionFailedError} once retries are exhausted
   * (caller's `onFailure: 'fail-index'`). `false` → warn to stderr and return
   * `null` so the job is skipped and the rest of the index continues.
   */
  failIndex: boolean;
}

/**
 * Caption a single PNG, going through the caption cache first. Returns the
 * caption text, or `null` when the provider failed and `failIndex` is false
 * (skip). The PNG bytes are the cache key, so identical renders across
 * re-indexes reuse the cached caption and never re-spend on the provider.
 *
 * `label` is a human-readable identifier (e.g. `page=10` or
 * `page=3 image=0`) used only in warn / error messages.
 */
export async function captionPngWithCache(
  pngBytes: Uint8Array,
  opts: CaptionEngineOptions,
  cache: CaptionCache,
  promptSha256: string,
  label: string,
): Promise<string | null> {
  const imageSha256 = sha256Hex(pngBytes);
  const cached = cache.get({
    imageSha256,
    promptSha256,
    providerId: opts.provider.providerId,
    modelId: opts.provider.modelId,
  });
  if (cached) {
    return cached.captionText;
  }
  const caption = await captionWithRetry(pngBytes, opts, label);
  if (caption === null) {
    return null;
  }
  // Wrap cache.set: a failed write (disk full / SQLITE_BUSY / closed handle
  // if the outer finally ran early) must NOT discard a caption we already
  // paid the provider for.
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
      `[caption-engine] WARN: cache.set failed for ${label}; caption returned but not persisted. ` +
        `Reason: ${cacheErr instanceof Error ? cacheErr.message : String(cacheErr)}\n`,
    );
  }
  return caption;
}

/**
 * Call the provider with retry + backoff. Returns the caption string, `null`
 * (skip after exhaustion when `failIndex` is false), or throws
 * {@link VisionCaptionFailedError} (when `failIndex` is true).
 */
export async function captionWithRetry(
  pngBytes: Uint8Array,
  opts: CaptionEngineOptions,
  label: string,
): Promise<string | null> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt += 1) {
    try {
      const caption = await callWithTimeoutSafetyNet(opts, pngBytes);
      // Empty / non-string responses are treated as a transient provider
      // quirk (some vision LLMs occasionally return "" on near-blank
      // images) rather than fatal — re-try the call, fall through to the
      // retry/failIndex machinery if it persists.
      if (typeof caption !== 'string' || caption === '') {
        throw Object.assign(
          new Error(`captionWithRetry: provider returned non-string or empty caption for ${label}`),
          { __visionEmptyResponse: true },
        );
      }
      return caption;
    } catch (err) {
      lastError = err;
      const retryable = isRetryable(err);
      if (!retryable || attempt === opts.maxRetries) {
        if (opts.failIndex) {
          throw new VisionCaptionFailedError(
            `caption: captionWithRetry exhausted after ${attempt + 1} attempt(s) for ${label}`,
            err,
          );
        }
        process.stderr.write(
          `[caption-engine] WARN: ${label} failed after ${attempt + 1} attempt(s); skipping. ` +
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
  if (opts.failIndex) {
    throw new VisionCaptionFailedError('caption: retry loop exited unexpectedly', lastError);
  }
  return null;
}

/**
 * Toolkit-side safety net: even when a provider ignores its `timeoutMs`
 * argument we abort the await `timeoutMs * 1.5` ms after the call started.
 * Without this a misbehaving adapter could stall the entire index. The thrown
 * `AbortError` flows through `isRetryable` so the retry machinery still kicks
 * in.
 */
function callWithTimeoutSafetyNet(opts: CaptionEngineOptions, pngBytes: Uint8Array): Promise<string> {
  const safetyMs = Math.ceil(opts.timeoutMs * TIMEOUT_SAFETY_MULTIPLIER);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const safetyNet = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(
        `caption: provider exceeded timeout safety net (${safetyMs} ms)`,
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
 * (seconds — the HTTP standard) or `retryAfterMs` (milliseconds — what some
 * SDK adapters surface) when the provider supplies it, clamped to
 * MAX_BACKOFF_MS so a hostile server cannot wedge the indexer for minutes.
 * Otherwise falls back to the canonical spec-anchored values 500 / 1500ms for
 * the first two attempts, then grows exponentially (500 * 3^attempt) capped at
 * MAX_BACKOFF_MS.
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

// Transient network-error codes (Node + undici). A provider that hits a
// dropped / refused / blocked connection — common behind a flaky proxy —
// surfaces one of these, usually nested under `.cause` (e.g. the Anthropic SDK
// wraps the undici failure in an `APIConnectionError` whose `.cause.code` is
// `ECONNRESET`). Treat as transient so the retry/backoff machinery covers it
// instead of failing the page fast (the same list axios-retry / is-retry-allowed use).
const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'EHOSTDOWN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_CLOSED',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/**
 * Detect a transient network failure by walking the `.cause` chain (HTTP SDKs
 * wrap the real coded error one or two levels deep) for a known network code,
 * plus the SDK connection-error wrapper class name (which carries no `code`
 * itself — e.g. `APIConnectionError` / `APIConnectionTimeoutError`). Bounded
 * depth guards against a cyclic `.cause`.
 */
function isNetworkError(err: unknown, depth = 0): boolean {
  if (err === null || typeof err !== 'object' || depth > 5) return false;
  const e = err as { code?: unknown; constructor?: { name?: unknown }; cause?: unknown };
  if (typeof e.code === 'string' && NETWORK_ERROR_CODES.has(e.code)) return true;
  const ctorName = e.constructor?.name;
  if (typeof ctorName === 'string' && /Connection(Timeout)?Error$/.test(ctorName)) return true;
  return isNetworkError(e.cause, depth + 1);
}

/**
 * Classify whether an error should trigger a retry. Retryable:
 *   - `AbortError` (timeout — toolkit safety net or provider's own)
 *   - transient network failure (connection reset/refused/timeout, behind
 *     `.cause`, or an SDK `*ConnectionError` wrapper)
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
  if (isNetworkError(err)) return true;
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
