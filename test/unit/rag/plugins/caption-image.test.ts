import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openCaptionCache, sha256Hex } from '../../../../src/rag/plugins/caption-cache.js';
import { captionImage } from '../../../../src/rag/plugins/caption-image.js';
import { __setCanvasImporterForTests } from '../../../../src/rag/plugins/png-encoder.js';
import type { CaptionCache, VisionProvider } from '../../../../src/rag/plugins/types.js';
import {
  OptionalDependencyMissingError,
  VisionCaptionFailedError,
} from '../../../../src/rag/plugins/types.js';

// ---------------------------------------------------------------------------
// Stub stack — canvas (via the test-only importer hook, incl. `loadImage`
// for the JPEG decode path), provider (vi.fn). Zero real network / native
// code path: @napi-rs/canvas is an optional peer the toolkit does NOT
// install in CI, so — like every other vision test — this file stubs the
// module instead of skipping when it is absent.
//
// Stub "JPEG" fixture format: [FF D8 SOI] + width uint32 BE + height uint32
// BE + seed byte. `loadImage` rejects anything without the SOI marker, which
// is what lets the decode-failure test exercise the real error path.
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

class StubImage {
  constructor(
    public width: number,
    public height: number,
    public seed: number,
  ) {}
}

interface StubCanvas {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  getContext(kind: '2d'): unknown;
  toBuffer(mime: 'image/png'): Uint8Array;
}

function makeStubCanvas(width: number, height: number): StubCanvas {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const ctx = {
    putImageData(img: StubImageData) {
      pixels.set(img.data);
    },
    drawImage(src: StubCanvas | StubImage, _x: number, _y: number, w: number, h: number) {
      if (src instanceof StubImage) {
        // Deterministic "decode": pixels derived from (seed, target dims)
        // only, so identical jpeg fixture bytes always yield identical
        // canvas pixels — mirroring a real decoder's determinism.
        for (let i = 0; i < w * h * 4; i += 1) pixels[i] = (i * src.seed) & 0xff;
        return;
      }
      // Canvas → canvas (encodePng's resize path): nearest-neighbour so the
      // bytes stay deterministic without a real image-resize impl.
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
    getImageData(_x: number, _y: number, w: number, h: number) {
      return new StubImageData(pixels.slice(0, w * h * 4), w, h);
    },
  };
  return {
    width,
    height,
    pixels,
    getContext: () => ctx,
    toBuffer: (_mime) => {
      // PNG magic + width/height as big-endian uint32 at bytes [8..16] + a
      // pixel sample, so tests can assert the encoded dimensions.
      const header = new Uint8Array(PNG_MAGIC);
      const meta = new Uint8Array(8);
      const dv = new DataView(meta.buffer);
      dv.setUint32(0, width, false);
      dv.setUint32(4, height, false);
      const sample = pixels.slice(0, Math.min(16, pixels.length));
      const out = new Uint8Array(header.length + meta.length + sample.length);
      out.set(header, 0);
      out.set(meta, header.length);
      out.set(sample, header.length + meta.length);
      return out;
    },
  };
}

function stubLoadImage(input: Buffer | Uint8Array): Promise<StubImage> {
  const b = new Uint8Array(input);
  if (b.length < 11 || b[0] !== 0xff || b[1] !== 0xd8) {
    return Promise.reject(new Error('Unsupported image type'));
  }
  const dv = new DataView(b.buffer, b.byteOffset);
  return Promise.resolve(new StubImage(dv.getUint32(2, false), dv.getUint32(6, false), b[10] ?? 1));
}

const stubCanvasModule = {
  createCanvas: (w: number, h: number) => makeStubCanvas(w, h),
  ImageData: StubImageData,
  loadImage: stubLoadImage,
} as unknown as typeof import('@napi-rs/canvas');

/** Build a stub-format jpeg fixture (see the stub-stack comment above). */
function makeJpegBytes(width: number, height: number, seed = 1): Uint8Array {
  const out = new Uint8Array(11);
  out[0] = 0xff;
  out[1] = 0xd8;
  const dv = new DataView(out.buffer);
  dv.setUint32(2, width, false);
  dv.setUint32(6, height, false);
  out[10] = seed & 0xff;
  return out;
}

function makePngBytes(seed = 1): Uint8Array {
  const out = new Uint8Array(24);
  out.set(PNG_MAGIC, 0);
  for (let i = PNG_MAGIC.length; i < out.length; i += 1) out[i] = (i * seed) & 0xff;
  return out;
}

function makeProvider(captionFn?: VisionProvider['caption']): VisionProvider & {
  caption: ReturnType<typeof vi.fn>;
} {
  return {
    providerId: 'anthropic',
    modelId: 'claude-haiku-4-5',
    caption: vi.fn(captionFn ?? (async () => '测试描述文本')),
  };
}

/** Read the (width, height) the stub `toBuffer` embedded at bytes [8..16]. */
function readStubPngDims(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset + 8, 8);
  return { width: view.getUint32(0, false), height: view.getUint32(4, false) };
}

describe('captionImage — png passthrough', () => {
  afterEach(() => {
    __setCanvasImporterForTests(null);
  });

  it('sends the original PNG bytes to the provider untouched (no canvas involved)', async () => {
    // A rejecting importer proves the png path never loads the optional peer.
    __setCanvasImporterForTests(() => Promise.reject(new Error('canvas must not load')));
    const provider = makeProvider();
    const pngBytes = makePngBytes();

    const caption = await captionImage({
      bytes: pngBytes,
      mimeType: 'image/png',
      provider,
      prompt: '描述这张图',
      timeoutMs: 1_000,
    });

    expect(caption).toBe('测试描述文本');
    expect(provider.caption).toHaveBeenCalledTimes(1);
    expect(provider.caption.mock.calls[0]?.[0]?.imagePng).toEqual(pngBytes);
  });

  it('throws VisionCaptionFailedError after a non-retryable provider failure (caller owns skip)', async () => {
    const provider = makeProvider(async () => {
      throw Object.assign(new Error('bad request'), { status: 400 });
    });

    await expect(
      captionImage({
        bytes: makePngBytes(),
        mimeType: 'image/png',
        provider,
        prompt: '描述这张图',
        timeoutMs: 1_000,
      }),
    ).rejects.toBeInstanceOf(VisionCaptionFailedError);
    // 400 is fail-fast — no retry ever spends more quota.
    expect(provider.caption).toHaveBeenCalledTimes(1);
  });
});

describe('captionImage — caption cache', () => {
  let cacheDir: string;
  let cache: CaptionCache;

  beforeEach(() => {
    __setCanvasImporterForTests(() => Promise.resolve(stubCanvasModule));
    cacheDir = mkdtempSync(path.join(tmpdir(), 'caption-image-test-'));
    cache = openCaptionCache({ cacheDir });
  });
  afterEach(() => {
    cache.close();
    rmSync(cacheDir, { recursive: true, force: true });
    __setCanvasImporterForTests(null);
  });

  it('keys the cache on sha256 of the raw PNG bytes — the second call spends nothing', async () => {
    const provider = makeProvider();
    const pngBytes = makePngBytes();
    const prompt = '描述这张图';
    const args = {
      bytes: pngBytes,
      mimeType: 'image/png' as const,
      provider,
      prompt,
      timeoutMs: 1_000,
      cache,
    };

    const first = await captionImage(args);
    const second = await captionImage(args);

    expect(first).toBe('测试描述文本');
    expect(second).toBe(first);
    expect(provider.caption).toHaveBeenCalledTimes(1);
    // The persisted row is addressable by the documented key shape: the
    // untouched PNG bytes hash + prompt hash + provider/model identity.
    const entry = cache.get({
      imageSha256: sha256Hex(pngBytes),
      promptSha256: sha256Hex(prompt),
      providerId: provider.providerId,
      modelId: provider.modelId,
    });
    expect(entry?.captionText).toBe(first);
  });

  it('keeps the cache key stable for jpeg input (deterministic re-encode, provider spent once)', async () => {
    const provider = makeProvider();
    const args = {
      bytes: makeJpegBytes(10, 8, 3),
      mimeType: 'image/jpeg' as const,
      provider,
      prompt: '描述这张图',
      timeoutMs: 1_000,
      cache,
    };

    await captionImage(args);
    await captionImage(args);

    expect(provider.caption).toHaveBeenCalledTimes(1);
  });
});

describe('captionImage — jpeg transcode', () => {
  beforeEach(() => {
    __setCanvasImporterForTests(() => Promise.resolve(stubCanvasModule));
  });
  afterEach(() => {
    __setCanvasImporterForTests(null);
  });

  it('decodes jpeg via canvas and sends re-encoded PNG bytes to the provider', async () => {
    const provider = makeProvider();

    const caption = await captionImage({
      bytes: makeJpegBytes(10, 8, 5),
      mimeType: 'image/jpeg',
      provider,
      prompt: '描述这张图',
      timeoutMs: 1_000,
    });

    expect(caption).toBe('测试描述文本');
    const sent = provider.caption.mock.calls[0]?.[0]?.imagePng as Uint8Array;
    for (let i = 0; i < PNG_MAGIC.length; i += 1) {
      expect(sent[i]).toBe(PNG_MAGIC[i]);
    }
    // Small images keep their native dimensions through the re-encode.
    expect(readStubPngDims(sent)).toEqual({ width: 10, height: 8 });
  });

  it('downscales a dimensions-bomb jpeg before materializing pixels (defensive cap)', async () => {
    const provider = makeProvider();

    // 5000×5000 = 25 MP > the 4096×4096 area cap → defensive shrink to a
    // 2048-long-edge canvas, then encodePng's usual 1568 provider ceiling.
    await captionImage({
      bytes: makeJpegBytes(5_000, 5_000),
      mimeType: 'image/jpeg',
      provider,
      prompt: '描述这张图',
      timeoutMs: 1_000,
    });

    const sent = provider.caption.mock.calls[0]?.[0]?.imagePng as Uint8Array;
    expect(readStubPngDims(sent)).toEqual({ width: 1568, height: 1568 });
  });

  it('throws an actionable decode error for bytes that are not a jpeg (provider never called)', async () => {
    const provider = makeProvider();

    await expect(
      captionImage({
        bytes: new TextEncoder().encode('not really a jpeg'),
        mimeType: 'image/jpeg',
        provider,
        prompt: '描述这张图',
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow(/captionImage: failed to decode image\/jpeg bytes/);
    expect(provider.caption).not.toHaveBeenCalled();
  });

  it('fails fast with OptionalDependencyMissingError when canvas is missing for a jpeg', async () => {
    __setCanvasImporterForTests(() => Promise.reject(new Error('Cannot find module')));

    await expect(
      captionImage({
        bytes: makeJpegBytes(10, 10),
        mimeType: 'image/jpeg',
        provider: makeProvider(),
        prompt: '描述这张图',
        timeoutMs: 1_000,
      }),
    ).rejects.toBeInstanceOf(OptionalDependencyMissingError);
  });
});
