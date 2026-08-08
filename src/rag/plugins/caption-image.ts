// Standalone image → caption helper for consumers that ingest raw image
// FILES (`parseDocument`'s `image` shape) rather than images embedded in a
// PDF. Reuses the exact caption runtime the PDF plugins run on —
// `captionPngWithCache` (cache lookup/write, retry + exponential backoff,
// timeout safety net) — so a PNG captioned here and the byte-identical PNG
// extracted from a PDF share one cache entry and one retry policy. JPEG
// input is decoded and deterministically re-encoded to PNG first (via the
// same optional `@napi-rs/canvas` peer, `ensureCanvasAvailable` fail-fast),
// because `sha256(pngBytes)` is the cache key and the `VisionProvider`
// contract speaks PNG only.

import type { CaptionCache } from './caption-cache.js';
import { sha256Hex } from './caption-cache.js';
import type { CaptionEngineOptions } from './caption-engine.js';
import { captionPngWithCache, captionWithRetry } from './caption-engine.js';
import { encodePng, ensureCanvasAvailable } from './png-encoder.js';
import type { VisionProvider } from './types.js';
import { VisionCaptionFailedError } from './types.js';

/**
 * Decoded-pixel area above which a JPEG is downscaled BEFORE its raw pixels
 * are materialized (4096 × 4096 ≈ 16.8 MP ≈ 64 MB of RGBA). Guards against a
 * pathological dimensions-bomb JPEG ballooning the caption input; ordinary
 * photos and screenshots never hit it.
 */
const MAX_DECODED_PIXEL_AREA = 4096 * 4096;

/**
 * Longest-edge target for the defensive downscale above. Deliberately larger
 * than `encodePng`'s 1568 default resize ceiling — this bound is a MEMORY
 * guard on the intermediate pixel buffer, not the provider-size
 * normalization, which `encodePng` still applies afterwards.
 */
const OVERSIZED_JPEG_MAX_EDGE = 2048;

/** Arguments for {@link captionImage}. */
export interface CaptionImageArgs {
  /** Raw image file bytes (e.g. `ParsedDoc.image` from `parseDocument`). */
  bytes: Uint8Array;
  /**
   * Declared image format. PNG bytes go to the provider untouched (their
   * sha256 is the cache key, so a byte-identical file never re-spends); JPEG
   * is decoded and deterministically re-encoded to PNG via `encodePng` first,
   * so an unchanged JPEG file keeps a stable cache key too.
   */
  mimeType: 'image/png' | 'image/jpeg';
  /** Caller-injected vision LLM. REQUIRED — toolkit ships zero vendor SDKs. */
  provider: VisionProvider;
  /**
   * Prompt sent to the provider. Hashed into the cache key, so changing it
   * invalidates cached captions (intentional — different prompts produce
   * different captions). See `DEFAULT_VISION_PROMPT` for the stock template.
   */
  prompt: string;
  /** Per-call timeout (ms) passed to the provider; safety-netted at 1.5× like the plugins. */
  timeoutMs: number;
  /**
   * Optional caption cache (see `openCaptionCache`), shared with the PDF
   * caption plugins. Omitted → every call spends a provider request.
   */
  cache?: CaptionCache;
  /**
   * Retry count on transient errors (timeout / 5xx / 429). Exponential
   * backoff `500ms / 1500ms / ...` @default 2
   */
  maxRetries?: number;
}

/**
 * Caption a single standalone image file through the shared caption runtime.
 *
 * Unlike the PDF plugins (whose default is warn-and-skip), this helper always
 * THROWS on failure so the caller owns the skip-vs-fail decision per image:
 * {@link VisionCaptionFailedError} once retries are exhausted,
 * `OptionalDependencyMissingError` when `@napi-rs/canvas` is missing for a
 * JPEG input, and a plain `Error` with an explicit message when the JPEG
 * bytes do not decode (corrupt / truncated / mislabeled — the ingest layer
 * does not sniff image content, so this decoder is where validity surfaces).
 */
export async function captionImage(args: CaptionImageArgs): Promise<string> {
  const pngBytes =
    args.mimeType === 'image/png' ? args.bytes : await transcodeJpegToPng(args.bytes);
  const engineOpts: CaptionEngineOptions = {
    provider: args.provider,
    promptTemplate: args.prompt,
    maxRetries: args.maxRetries ?? 2,
    timeoutMs: args.timeoutMs,
    // Throw-on-failure is this helper's contract; the caller decides skip
    // semantics (there is no batch here to keep alive).
    failIndex: true,
  };
  const label = `image mime=${args.mimeType}`;
  const caption = args.cache
    ? await captionPngWithCache(pngBytes, engineOpts, args.cache, sha256Hex(args.prompt), label)
    : await captionWithRetry(pngBytes, engineOpts, label);
  // Unreachable: `failIndex: true` makes the engine throw instead of
  // returning null, but TypeScript cannot see through the boolean.
  /* c8 ignore next 3 */
  if (caption === null) {
    throw new VisionCaptionFailedError(`captionImage: caption engine returned null for ${label}`);
  }
  return caption;
}

/**
 * Decode JPEG bytes and re-encode them as PNG through {@link encodePng}, so
 * identical input bytes always yield byte-identical PNG output (the cache-key
 * determinism `encodePng` already guarantees). The oversized-image downscale
 * happens in `drawImage` BEFORE `getImageData` — the full-size bitmap is
 * never materialized as a raw pixel buffer, which is exactly where a
 * dimensions-bomb JPEG would blow up memory. `encodePng` then applies its
 * usual provider-size resize ceiling (1568) on the already-bounded pixels.
 */
async function transcodeJpegToPng(jpegBytes: Uint8Array): Promise<Uint8Array> {
  const { createCanvas, loadImage } = await ensureCanvasAvailable();

  let image: Awaited<ReturnType<typeof loadImage>>;
  try {
    image = await loadImage(Buffer.from(jpegBytes));
  } catch (err) {
    throw new Error(
      `captionImage: failed to decode image/jpeg bytes (${jpegBytes.byteLength} bytes): ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const { width, height } = image;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error(`captionImage: image/jpeg decoded to invalid dimensions ${width}x${height}`);
  }

  let targetWidth = width;
  let targetHeight = height;
  if (width * height > MAX_DECODED_PIXEL_AREA) {
    const scale = OVERSIZED_JPEG_MAX_EDGE / Math.max(width, height);
    targetWidth = Math.max(1, Math.round(width * scale));
    targetHeight = Math.max(1, Math.round(height * scale));
  }

  const canvas = createCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
  const { data } = ctx.getImageData(0, 0, targetWidth, targetHeight);
  return encodePng(data, targetWidth, targetHeight, 4);
}
