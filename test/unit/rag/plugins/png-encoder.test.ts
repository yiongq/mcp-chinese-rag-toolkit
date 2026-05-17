import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __setCanvasImporterForTests,
  encodePng,
  ensureCanvasAvailable,
} from '../../../../src/rag/plugins/png-encoder.js';
import { OptionalDependencyMissingError } from '../../../../src/rag/plugins/types.js';

// ---------------------------------------------------------------------------
// Minimal in-memory stub of @napi-rs/canvas. Deterministic toBuffer output
// keyed on (width, height, encoded pixel hash) — enough for the tests below
// to assert magic bytes, resize behaviour, and idempotency without booting
// the real native module (which is an optional peer the toolkit does NOT
// install in CI; Story 2.8 spec Optional Peer Dependency Mechanics table).
// ---------------------------------------------------------------------------

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

class StubImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

interface StubCanvas {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  getContext(kind: '2d'): StubContext;
  toBuffer(mime: 'image/png'): Uint8Array;
}

interface StubContext {
  putImageData(img: StubImageData, x: number, y: number): void;
  drawImage(src: StubCanvas, x: number, y: number, w: number, h: number): void;
}

function makeStubCanvas(width: number, height: number): StubCanvas {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const ctx: StubContext = {
    putImageData(img, x, y) {
      // Copy stub image pixels into the canvas-owned buffer so toBuffer can
      // hash them. x/y are always 0 in our caller; ignore for simplicity.
      void x;
      void y;
      pixels.set(img.data);
    },
    drawImage(src, x, y, w, h) {
      void x;
      void y;
      // Nearest-neighbour downsample so resize tests get deterministic
      // bytes without pulling in a real image-resize impl.
      for (let row = 0; row < h; row += 1) {
        for (let col = 0; col < w; col += 1) {
          const srcCol = Math.min(src.width - 1, Math.floor((col / w) * src.width));
          const srcRow = Math.min(src.height - 1, Math.floor((row / h) * src.height));
          const srcIdx = (srcRow * src.width + srcCol) * 4;
          const dstIdx = (row * w + col) * 4;
          pixels[dstIdx] = src.pixels[srcIdx] ?? 0;
          pixels[dstIdx + 1] = src.pixels[srcIdx + 1] ?? 0;
          pixels[dstIdx + 2] = src.pixels[srcIdx + 2] ?? 0;
          pixels[dstIdx + 3] = src.pixels[srcIdx + 3] ?? 0;
        }
      }
    },
  };
  return {
    width,
    height,
    pixels,
    getContext: () => ctx,
    toBuffer: (mime) => {
      void mime;
      // Embed PNG magic + a deterministic digest of (w, h, pixels[0..16]) so
      // bytes are stable across reruns and resize collisions still differ.
      const header = new Uint8Array(PNG_MAGIC);
      const meta = new Uint8Array(8);
      const dv = new DataView(meta.buffer);
      dv.setUint32(0, width, false);
      dv.setUint32(4, height, false);
      const sample = pixels.slice(0, Math.min(64, pixels.length));
      const out = new Uint8Array(header.length + meta.length + sample.length);
      out.set(header, 0);
      out.set(meta, header.length);
      out.set(sample, header.length + meta.length);
      return out;
    },
  };
}

const stubModule = {
  createCanvas: (w: number, h: number) => makeStubCanvas(w, h),
  ImageData: StubImageData,
} as unknown as typeof import('@napi-rs/canvas');

describe('ensureCanvasAvailable', () => {
  beforeEach(() => {
    __setCanvasImporterForTests(() => Promise.resolve(stubModule));
  });
  afterEach(() => {
    __setCanvasImporterForTests(null);
  });

  it('resolves to the loaded canvas module when the importer succeeds', async () => {
    const mod = await ensureCanvasAvailable();
    expect(mod).toBe(stubModule);
  });

  it('throws OptionalDependencyMissingError with actionable install command when import fails', async () => {
    __setCanvasImporterForTests(() => Promise.reject(new Error('Cannot find module')));
    await expect(ensureCanvasAvailable()).rejects.toBeInstanceOf(OptionalDependencyMissingError);
    await expect(ensureCanvasAvailable()).rejects.toThrow(/pnpm add @napi-rs\/canvas/);
  });

  it('caches the module across calls (single import even when invoked twice)', async () => {
    const importer = vi.fn(() => Promise.resolve(stubModule));
    __setCanvasImporterForTests(importer);
    await ensureCanvasAvailable();
    await ensureCanvasAvailable();
    expect(importer).toHaveBeenCalledTimes(1);
  });
});

describe('encodePng', () => {
  beforeEach(() => {
    __setCanvasImporterForTests(() => Promise.resolve(stubModule));
  });
  afterEach(() => {
    __setCanvasImporterForTests(null);
  });

  it('encodes a 100×100 RGBA buffer to PNG bytes starting with the PNG magic', async () => {
    const pixels = new Uint8ClampedArray(100 * 100 * 4);
    pixels.fill(128);
    const png = await encodePng(pixels, 100, 100, 4);
    expect(png.length).toBeGreaterThan(0);
    for (let i = 0; i < PNG_MAGIC.length; i += 1) {
      expect(png[i]).toBe(PNG_MAGIC[i]);
    }
  });

  it('preserves aspect ratio when downsampling above maxLongestEdge', async () => {
    const width = 200;
    const height = 100;
    const pixels = new Uint8ClampedArray(width * height * 4);
    pixels.fill(200);
    const png = await encodePng(pixels, width, height, 4, 50);
    // Stub toBuffer embeds width/height as big-endian uint32 at bytes [8..16].
    const view = new DataView(png.buffer, png.byteOffset + 8, 8);
    expect(view.getUint32(0, false)).toBe(50);
    expect(view.getUint32(4, false)).toBe(25);
  });

  it('produces byte-identical output for identical inputs (cache-key stability)', async () => {
    const pixels = new Uint8ClampedArray(30 * 30 * 4);
    for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 7) & 0xff;
    const a = await encodePng(pixels, 30, 30, 4);
    const b = await encodePng(pixels, 30, 30, 4);
    expect(a).toEqual(b);
  });

  it('expands 3-channel RGB input to RGBA before encoding', async () => {
    const width = 4;
    const height = 4;
    const pixels = new Uint8ClampedArray(width * height * 3);
    pixels.fill(64);
    const png = await encodePng(pixels, width, height, 3);
    expect(png.length).toBeGreaterThan(0);
    for (let i = 0; i < PNG_MAGIC.length; i += 1) {
      expect(png[i]).toBe(PNG_MAGIC[i]);
    }
  });

  it('expands 1-channel grayscale input to RGBA before encoding', async () => {
    const width = 4;
    const height = 4;
    const pixels = new Uint8ClampedArray(width * height);
    pixels.fill(200);
    const png = await encodePng(pixels, width, height, 1);
    expect(png.length).toBeGreaterThan(0);
  });

  it('throws actionable error when width is 0 or negative', async () => {
    const pixels = new Uint8ClampedArray(0);
    await expect(encodePng(pixels, 0, 10, 4)).rejects.toThrow(/width must be a positive integer/);
    await expect(encodePng(pixels, -1, 10, 4)).rejects.toThrow(/width must be a positive integer/);
  });

  it('throws actionable error when height is 0 or negative', async () => {
    const pixels = new Uint8ClampedArray(0);
    await expect(encodePng(pixels, 10, 0, 4)).rejects.toThrow(/height must be a positive integer/);
  });

  it('throws actionable error when channels is invalid', async () => {
    const pixels = new Uint8ClampedArray(10 * 10 * 2);
    await expect(
      // @ts-expect-error invalid channels value for boundary test
      encodePng(pixels, 10, 10, 2),
    ).rejects.toThrow(/channels must be 1, 3, or 4/);
  });

  it('throws when pixel buffer length disagrees with width×height×channels', async () => {
    const pixels = new Uint8ClampedArray(10 * 10 * 4 - 1);
    await expect(encodePng(pixels, 10, 10, 4)).rejects.toThrow(/pixels.length .* does not match/);
  });

  it('throws when maxLongestEdge is not a positive integer', async () => {
    const pixels = new Uint8ClampedArray(4);
    await expect(encodePng(pixels, 1, 1, 4, 0)).rejects.toThrow(
      /maxLongestEdge must be a positive integer/,
    );
  });

  it('skips resize when both dimensions are within maxLongestEdge', async () => {
    const width = 10;
    const height = 20;
    const pixels = new Uint8ClampedArray(width * height * 4);
    pixels.fill(50);
    const png = await encodePng(pixels, width, height, 4, 100);
    const view = new DataView(png.buffer, png.byteOffset + 8, 8);
    expect(view.getUint32(0, false)).toBe(width);
    expect(view.getUint32(4, false)).toBe(height);
  });
});
