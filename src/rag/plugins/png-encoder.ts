import { OptionalDependencyMissingError } from './types.js';

type CanvasModule = typeof import('@napi-rs/canvas');

/**
 * Lazy-cached `@napi-rs/canvas` module handle. The optional peer is loaded
 * via dynamic `import()` so the toolkit `package.json` can declare it under
 * `optionalPeerDependencies` (caller pays the ~30 MB native binary cost
 * only when they actually opt into the vision plugin).
 */
let canvasModule: CanvasModule | null = null;

/**
 * Importer indirection — defaults to a dynamic `import()` wrapped in
 * `new Function()` to defeat tsdown / esbuild static analysis (otherwise
 * the bundler resolves `@napi-rs/canvas` at build time and the optional
 * peer becomes a hard build-time requirement). Tests override via
 * `__setCanvasImporterForTests` so they can mount a stub without going
 * through vitest's module mocker (which does NOT intercept the
 * `new Function('return import(s)')` path).
 */
let canvasImporter: () => Promise<CanvasModule> = defaultCanvasImporter;

function defaultCanvasImporter(): Promise<CanvasModule> {
  const dynamicImport = new Function('s', 'return import(s)') as (
    s: string,
  ) => Promise<CanvasModule>;
  return dynamicImport('@napi-rs/canvas');
}

/**
 * Test-only hook. Pass a custom importer to inject a stub canvas module;
 * pass `null` to restore the default dynamic-import path. Internal — NOT
 * re-exported from the plugins barrel (so the public toolkit surface stays
 * clean).
 */
export function __setCanvasImporterForTests(fn: (() => Promise<CanvasModule>) | null): void {
  canvasImporter = fn ?? defaultCanvasImporter;
  canvasModule = null;
}

/**
 * Ensure `@napi-rs/canvas` is available. Resolves to the loaded module
 * handle (also memoised on `canvasModule`) or throws
 * {@link OptionalDependencyMissingError} with the precise install command.
 *
 * Called at `withVisionCaption()` factory time so callers see a fail-fast
 * error at index start rather than partway through processing the first
 * image.
 */
export async function ensureCanvasAvailable(): Promise<CanvasModule> {
  if (canvasModule !== null) return canvasModule;
  try {
    canvasModule = await canvasImporter();
    return canvasModule;
  } catch {
    throw new OptionalDependencyMissingError(
      '@napi-rs/canvas',
      'pnpm add @napi-rs/canvas (or: npm install @napi-rs/canvas)',
    );
  }
}

/**
 * Encode a raw RGBA / RGB / Grayscale pixel buffer (as returned by
 * `unpdf.extractImages`) to PNG bytes, optionally downsampling so
 * `max(width, height) <= maxLongestEdge` while preserving aspect ratio.
 *
 * Determinism: identical `(pixels, width, height, channels, maxLongestEdge)`
 * input always produces byte-identical PNG output, which is what makes the
 * caption cache key (`sha256(pngBytes)`) stable across re-indexes.
 *
 * @param pixels Raw pixel buffer from `unpdf.extractImages`.
 * @param width Original width in pixels.
 * @param height Original height in pixels.
 * @param channels 1 (grayscale) | 3 (RGB) | 4 (RGBA).
 * @param maxLongestEdge Resize ceiling (px). @default 1568
 * @returns PNG bytes ready to send to a vision LLM provider.
 */
export async function encodePng(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  channels: 1 | 3 | 4,
  maxLongestEdge = 1568,
): Promise<Uint8Array> {
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error(`encodePng: width must be a positive integer, got ${width}`);
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new Error(`encodePng: height must be a positive integer, got ${height}`);
  }
  if (channels !== 1 && channels !== 3 && channels !== 4) {
    throw new Error(`encodePng: channels must be 1, 3, or 4, got ${channels}`);
  }
  if (!Number.isInteger(maxLongestEdge) || maxLongestEdge <= 0) {
    throw new Error(`encodePng: maxLongestEdge must be a positive integer, got ${maxLongestEdge}`);
  }
  const expectedLen = width * height * channels;
  if (pixels.length !== expectedLen) {
    throw new Error(
      `encodePng: pixels.length (${pixels.length}) does not match width*height*channels (${expectedLen})`,
    );
  }

  const { createCanvas, ImageData } = await ensureCanvasAvailable();

  // Expand to RGBA — canvas ImageData requires 4 channels regardless of source.
  const rgba = channels === 4 ? pixels : expandToRgba(pixels, width, height, channels);

  const srcCanvas = createCanvas(width, height);
  const srcCtx = srcCanvas.getContext('2d');
  srcCtx.putImageData(new ImageData(rgba, width, height), 0, 0);

  const longest = Math.max(width, height);
  if (longest <= maxLongestEdge) {
    return srcCanvas.toBuffer('image/png');
  }
  const scale = maxLongestEdge / longest;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const dstCanvas = createCanvas(targetWidth, targetHeight);
  const dstCtx = dstCanvas.getContext('2d');
  dstCtx.drawImage(srcCanvas, 0, 0, targetWidth, targetHeight);
  return dstCanvas.toBuffer('image/png');
}

function expandToRgba(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  channels: 1 | 3,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  if (channels === 1) {
    for (let i = 0, j = 0; i < pixels.length; i += 1, j += 4) {
      const v = pixels[i] ?? 0;
      out[j] = v;
      out[j + 1] = v;
      out[j + 2] = v;
      out[j + 3] = 255;
    }
    return out;
  }
  // channels === 3 (RGB → RGBA)
  for (let i = 0, j = 0; i < pixels.length; i += 3, j += 4) {
    out[j] = pixels[i] ?? 0;
    out[j + 1] = pixels[i + 1] ?? 0;
    out[j + 2] = pixels[i + 2] ?? 0;
    out[j + 3] = 255;
  }
  return out;
}
