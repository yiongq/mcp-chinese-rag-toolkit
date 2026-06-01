import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setCanvasImporterForTests } from '../../../../src/rag/plugins/png-encoder.js';
import type { VisionProvider } from '../../../../src/rag/plugins/types.js';
import { VisionCaptionFailedError } from '../../../../src/rag/plugins/types.js';
import {
  DEFAULT_VISION_PROMPT,
  withVisionCaption,
} from '../../../../src/rag/plugins/with-vision-caption.js';
import type { PdfPage } from '../../../../src/rag/types.js';

// ---------------------------------------------------------------------------
// Mock stack — extractImages (via vi.mock), canvas (via the test-only
// importer hook), provider (vi.fn). Zero real network / native code path.
// ---------------------------------------------------------------------------

const extractImagesMock = vi.fn();
vi.mock('unpdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('unpdf')>();
  return {
    ...actual,
    extractImages: (...args: Parameters<typeof actual.extractImages>) => extractImagesMock(...args),
  };
});

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

function makeStubCanvas(width: number, height: number) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  return {
    width,
    height,
    pixels,
    getContext: () => ({
      putImageData(img: StubImageData) {
        pixels.set(img.data);
      },
      drawImage(_src: unknown, _x: number, _y: number, _w: number, _h: number) {
        // No-op resize for stub.
      },
    }),
    toBuffer: (_mime: 'image/png') => {
      const header = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
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

const stubCanvasModule = {
  createCanvas: (w: number, h: number) => makeStubCanvas(w, h),
  ImageData: StubImageData,
} as unknown as typeof import('@napi-rs/canvas');

function makePages(count = 1): PdfPage[] {
  return Array.from({ length: count }, (_, i) => ({
    pageNumber: i + 1,
    text: `page ${i + 1} text`,
  }));
}

function makePdfBytes(size = 16): Uint8Array {
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) b[i] = i & 0xff;
  return b;
}

function makeImage(seed = 1) {
  const w = 10;
  const h = 10;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 1) data[i] = (i * seed) & 0xff;
  return { data, width: w, height: h, channels: 4 as const, key: `img-${seed}` };
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

describe('withVisionCaption — factory validation', () => {
  beforeEach(() => {
    __setCanvasImporterForTests(() => Promise.resolve(stubCanvasModule));
    extractImagesMock.mockReset();
  });
  afterEach(() => {
    __setCanvasImporterForTests(null);
  });

  it('exposes DEFAULT_VISION_PROMPT containing Chinese 200-300 length guidance', () => {
    expect(DEFAULT_VISION_PROMPT).toContain('200-300');
    expect(DEFAULT_VISION_PROMPT).toContain('OCR');
  });

  it('throws when opts.provider is missing', () => {
    expect(() =>
      withVisionCaption({} as unknown as Parameters<typeof withVisionCaption>[0]),
    ).toThrow(/provider must be a VisionProvider/);
  });

  it('throws when opts.provider.caption is not a function', () => {
    expect(() =>
      withVisionCaption({
        provider: {
          providerId: 'x',
          modelId: 'y',
          caption: 'not-a-function' as unknown as VisionProvider['caption'],
        },
      }),
    ).toThrow(/provider must be a VisionProvider/);
  });

  it('throws when opts.provider.providerId is empty', () => {
    expect(() =>
      withVisionCaption({
        provider: {
          providerId: '',
          modelId: 'y',
          caption: async () => 'x',
        },
      }),
    ).toThrow(/providerId must be a non-empty string/);
  });

  it('returns a plugin with name="vision-caption" and an enrichPdf hook', () => {
    const plugin = withVisionCaption({ provider: makeProvider() });
    expect(plugin.name).toBe('vision-caption');
    expect(typeof plugin.enrichPdf).toBe('function');
  });

  it('rejects out-of-range maxConcurrency / maxRetries / timeoutMs / maxLongestEdge', () => {
    const provider = makeProvider();
    expect(() => withVisionCaption({ provider, maxConcurrency: 0 })).toThrow(/maxConcurrency/);
    expect(() => withVisionCaption({ provider, maxRetries: -1 })).toThrow(/maxRetries/);
    expect(() => withVisionCaption({ provider, timeoutMs: 50 })).toThrow(/timeoutMs/);
    expect(() => withVisionCaption({ provider, maxLongestEdge: 32 })).toThrow(/maxLongestEdge/);
  });

  it('rejects invalid onFailure value', () => {
    expect(() =>
      withVisionCaption({
        provider: makeProvider(),
        onFailure: 'invalid' as unknown as 'skip-image',
      }),
    ).toThrow(/onFailure/);
  });
});

describe('withVisionCaption — enrichPdf core path', () => {
  let cacheDir: string;
  beforeEach(() => {
    __setCanvasImporterForTests(() => Promise.resolve(stubCanvasModule));
    extractImagesMock.mockReset();
    cacheDir = mkdtempSync(path.join(tmpdir(), 'vision-caption-cache-'));
  });
  afterEach(() => {
    __setCanvasImporterForTests(null);
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('produces a single caption chunk for one page with one image', async () => {
    extractImagesMock.mockResolvedValueOnce([makeImage(1)]);
    const provider = makeProvider();
    const plugin = withVisionCaption({ provider, cacheDir });
    const chunks = await plugin.enrichPdf?.(makePages(1), {
      source: 'hr.pdf',
      pdfBytes: makePdfBytes(),
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({
      content: '测试描述文本',
      source: 'hr.pdf',
      page: 1,
      section: '[图片描述 #0]',
    });
    expect(provider.caption).toHaveBeenCalledTimes(1);
    expect(provider.caption).toHaveBeenCalledWith({
      imagePng: expect.any(Uint8Array),
      prompt: DEFAULT_VISION_PROMPT,
      timeoutMs: 30_000,
    });
  });

  it('writes a cache row that satisfies the second enrichPdf call without provider invocation', async () => {
    extractImagesMock.mockResolvedValue([makeImage(7)]);
    const provider1 = makeProvider();
    const plugin1 = withVisionCaption({ provider: provider1, cacheDir });
    await plugin1.enrichPdf?.(makePages(1), { source: 'hr.pdf', pdfBytes: makePdfBytes() });
    expect(provider1.caption).toHaveBeenCalledTimes(1);

    const provider2 = makeProvider(async () => 'SHOULD NOT BE CALLED');
    const plugin2 = withVisionCaption({ provider: provider2, cacheDir });
    const chunks = await plugin2.enrichPdf?.(makePages(1), {
      source: 'hr.pdf',
      pdfBytes: makePdfBytes(),
    });
    expect(provider2.caption).not.toHaveBeenCalled();
    expect(chunks[0]?.content).toBe('测试描述文本');
  });

  it('retries on 5xx and 429 then succeeds; aggregates spy callCount across attempts', async () => {
    extractImagesMock.mockResolvedValueOnce([makeImage(2)]);
    let callIdx = 0;
    const provider = makeProvider(async () => {
      callIdx += 1;
      if (callIdx === 1) throw Object.assign(new Error('server'), { statusCode: 503 });
      if (callIdx === 2) throw Object.assign(new Error('rate-limited'), { statusCode: 429 });
      return '重试成功';
    });
    const plugin = withVisionCaption({
      provider,
      cacheDir,
      maxRetries: 2,
      timeoutMs: 200,
    });
    const chunks = await plugin.enrichPdf?.(makePages(1), {
      source: 'hr.pdf',
      pdfBytes: makePdfBytes(),
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe('重试成功');
    expect(provider.caption).toHaveBeenCalledTimes(3);
  }, 10_000);

  it('fails fast (no retry) on non-retryable 401; onFailure=skip-image returns zero chunks', async () => {
    extractImagesMock.mockResolvedValueOnce([makeImage(3)]);
    const provider = makeProvider(async () => {
      throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
    });
    const plugin = withVisionCaption({ provider, cacheDir });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const chunks = await plugin.enrichPdf?.(makePages(1), {
        source: 'hr.pdf',
        pdfBytes: makePdfBytes(),
      });
      expect(chunks).toHaveLength(0);
      expect(provider.caption).toHaveBeenCalledTimes(1);
    } finally {
      stderr.mockRestore();
    }
  });

  it('onFailure=fail-index throws VisionCaptionFailedError when retries exhausted', async () => {
    extractImagesMock.mockResolvedValueOnce([makeImage(4)]);
    const provider = makeProvider(async () => {
      throw Object.assign(new Error('boom'), { statusCode: 500 });
    });
    const plugin = withVisionCaption({
      provider,
      cacheDir,
      maxRetries: 0,
      onFailure: 'fail-index',
    });
    await expect(
      plugin.enrichPdf?.(makePages(1), { source: 'hr.pdf', pdfBytes: makePdfBytes() }),
    ).rejects.toBeInstanceOf(VisionCaptionFailedError);
  });

  it('respects maxConcurrency — peak in-flight provider calls never exceeds the cap', async () => {
    const total = 9;
    extractImagesMock.mockResolvedValueOnce(
      Array.from({ length: total }, (_, i) => makeImage(i + 1)),
    );
    let inFlight = 0;
    let peak = 0;
    const provider = makeProvider(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      // Yield to the event loop a few times so concurrent jobs start.
      await Promise.resolve();
      await Promise.resolve();
      inFlight -= 1;
      return 'caption';
    });
    const plugin = withVisionCaption({ provider, cacheDir, maxConcurrency: 3 });
    const chunks = await plugin.enrichPdf?.(makePages(1), {
      source: 'hr.pdf',
      pdfBytes: makePdfBytes(),
    });
    expect(chunks).toHaveLength(total);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(0);
  });

  it('handles multiple pages with per-page image indexes (imageIndex resets per page)', async () => {
    extractImagesMock
      .mockResolvedValueOnce([makeImage(10), makeImage(11)])
      .mockResolvedValueOnce([makeImage(20), makeImage(21)])
      .mockResolvedValueOnce([makeImage(30), makeImage(31)]);
    const provider = makeProvider();
    const plugin = withVisionCaption({ provider, cacheDir });
    const chunks = await plugin.enrichPdf?.(makePages(3), {
      source: 'multi.pdf',
      pdfBytes: makePdfBytes(),
    });
    expect(chunks).toHaveLength(6);
    const sections = chunks.map((c) => c.section ?? '').sort();
    // Two #0 markers (one per page 1, 2, 3 — three pages each producing #0
    // and #1) — but since order depends on async resolution we just count.
    expect(sections.filter((s) => s === '[图片描述 #0]')).toHaveLength(3);
    expect(sections.filter((s) => s === '[图片描述 #1]')).toHaveLength(3);
  });

  it('markSyntheticChunk=false drops the section marker', async () => {
    extractImagesMock.mockResolvedValueOnce([makeImage(5)]);
    const provider = makeProvider();
    const plugin = withVisionCaption({
      provider,
      cacheDir,
      markSyntheticChunk: false,
    });
    const chunks = await plugin.enrichPdf?.(makePages(1), {
      source: 'hr.pdf',
      pdfBytes: makePdfBytes(),
    });
    expect(chunks[0]?.section).toBeUndefined();
  });

  it('rejects ctx.source missing/empty with actionable error', async () => {
    extractImagesMock.mockResolvedValue([]);
    const plugin = withVisionCaption({ provider: makeProvider(), cacheDir });
    await expect(
      plugin.enrichPdf?.(makePages(1), {
        source: '',
        pdfBytes: makePdfBytes(),
      }),
    ).rejects.toThrow(/ctx.source/);
  });

  it('rejects ctx.pdfBytes when not a Uint8Array', async () => {
    extractImagesMock.mockResolvedValue([]);
    const plugin = withVisionCaption({ provider: makeProvider(), cacheDir });
    await expect(
      plugin.enrichPdf?.(makePages(1), {
        source: 'x.pdf',
        pdfBytes: 'not-bytes' as unknown as Uint8Array,
      }),
    ).rejects.toThrow(/pdfBytes/);
  });

  it('rejects when extractImages returns a non-array', async () => {
    extractImagesMock.mockResolvedValueOnce('oops' as unknown);
    const plugin = withVisionCaption({ provider: makeProvider(), cacheDir });
    await expect(
      plugin.enrichPdf?.(makePages(1), { source: 'x.pdf', pdfBytes: makePdfBytes() }),
    ).rejects.toThrow(/extractImages.*non-array/);
  });

  it('rejects when an extracted image has invalid dimensions', async () => {
    extractImagesMock.mockResolvedValueOnce([
      { data: new Uint8ClampedArray(4), width: 0, height: 1, channels: 4 as const, key: 'k' },
    ]);
    const plugin = withVisionCaption({ provider: makeProvider(), cacheDir });
    await expect(
      plugin.enrichPdf?.(makePages(1), { source: 'x.pdf', pdfBytes: makePdfBytes() }),
    ).rejects.toThrow(/width must be a positive integer/);
  });

  it('treats AbortError (timeout) as retryable', async () => {
    extractImagesMock.mockResolvedValueOnce([makeImage(8)]);
    let calls = 0;
    const provider = makeProvider(async () => {
      calls += 1;
      if (calls < 2) {
        const err = new Error('timeout');
        (err as Error & { name: string }).name = 'AbortError';
        throw err;
      }
      return '超时后成功';
    });
    const plugin = withVisionCaption({ provider, cacheDir, maxRetries: 2 });
    const chunks = await plugin.enrichPdf?.(makePages(1), {
      source: 'hr.pdf',
      pdfBytes: makePdfBytes(),
    });
    expect(chunks).toHaveLength(1);
    expect(provider.caption).toHaveBeenCalledTimes(2);
  }, 10_000);

  it('treats a transient network error (code under .cause) as retryable', async () => {
    extractImagesMock.mockResolvedValueOnce([makeImage(81)]);
    let calls = 0;
    const provider = makeProvider(async () => {
      calls += 1;
      if (calls < 2) {
        throw Object.assign(new Error('Connection error.'), {
          cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
        });
      }
      return '网络重试成功';
    });
    const plugin = withVisionCaption({ provider, cacheDir, maxRetries: 2, timeoutMs: 200 });
    const chunks = await plugin.enrichPdf?.(makePages(1), {
      source: 'hr.pdf',
      pdfBytes: makePdfBytes(),
    });
    expect(chunks).toHaveLength(1);
    expect(provider.caption).toHaveBeenCalledTimes(2);
  }, 10_000);

  it('returns empty result when a page has zero images', async () => {
    extractImagesMock.mockResolvedValueOnce([]);
    const provider = makeProvider();
    const plugin = withVisionCaption({ provider, cacheDir });
    const chunks = await plugin.enrichPdf?.(makePages(1), {
      source: 'x.pdf',
      pdfBytes: makePdfBytes(),
    });
    expect(chunks).toHaveLength(0);
    expect(provider.caption).not.toHaveBeenCalled();
  });

  it('rejects extracted image whose data.length mismatches width*height*channels', async () => {
    // 10x10x4 should be 400 bytes; supply 100 → validation catches it
    // BEFORE any provider call.
    extractImagesMock.mockResolvedValueOnce([
      { data: new Uint8ClampedArray(100), width: 10, height: 10, channels: 4 as const, key: 'k' },
    ]);
    const provider = makeProvider();
    const plugin = withVisionCaption({ provider, cacheDir });
    await expect(
      plugin.enrichPdf?.(makePages(1), { source: 'x.pdf', pdfBytes: makePdfBytes() }),
    ).rejects.toThrow(/data\.length .* does not match width\*height\*channels/);
    expect(provider.caption).not.toHaveBeenCalled();
  });

  it('dedupes images by `image.key` so a logo on every page hits the cache once', async () => {
    const shared = { ...makeImage(99), key: 'shared-logo' };
    extractImagesMock
      .mockResolvedValueOnce([shared])
      .mockResolvedValueOnce([shared])
      .mockResolvedValueOnce([shared]);
    const provider = makeProvider();
    const plugin = withVisionCaption({ provider, cacheDir });
    const chunks = await plugin.enrichPdf?.(makePages(3), {
      source: 'header-logo.pdf',
      pdfBytes: makePdfBytes(),
    });
    expect(chunks).toHaveLength(3);
    // First occurrence calls the provider, subsequent pages hit the
    // cache row that was just written → exactly 1 provider invocation
    // even though there are 3 caption chunks (one per page).
    expect(provider.caption).toHaveBeenCalledTimes(1);
  });

  it('honors HTTP Retry-After header when classifying 429 backoff', async () => {
    extractImagesMock.mockResolvedValueOnce([makeImage(123)]);
    let calls = 0;
    const provider = makeProvider(async () => {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error('rate-limited'), {
          statusCode: 429,
          // Use retryAfterMs (millisecond form) so the test does not
          // burn real time — readRetryAfterMs accepts both the seconds
          // form (Retry-After header) and the millisecond form.
          retryAfterMs: 10,
        });
      }
      return '重试 after honored';
    });
    const plugin = withVisionCaption({
      provider,
      cacheDir,
      maxRetries: 1,
      timeoutMs: 200,
    });
    const start = Date.now();
    const chunks = await plugin.enrichPdf?.(makePages(1), {
      source: 'rate-limit.pdf',
      pdfBytes: makePdfBytes(),
    });
    const elapsed = Date.now() - start;
    expect(chunks).toHaveLength(1);
    expect(provider.caption).toHaveBeenCalledTimes(2);
    // Without Retry-After we'd wait RETRY_BACKOFFS_MS[0] = 500ms; with
    // it we wait ~10ms. Anything under 200ms is unambiguously the
    // hinted path.
    expect(elapsed).toBeLessThan(200);
  });

  it('retries empty caption from provider (treats as transient quirk)', async () => {
    extractImagesMock.mockResolvedValueOnce([makeImage(77)]);
    let calls = 0;
    const provider = makeProvider(async () => {
      calls += 1;
      return calls === 1 ? '' : '终于有内容了';
    });
    const plugin = withVisionCaption({ provider, cacheDir, maxRetries: 1 });
    const chunks = await plugin.enrichPdf?.(makePages(1), {
      source: 'blank.pdf',
      pdfBytes: makePdfBytes(),
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe('终于有内容了');
    expect(provider.caption).toHaveBeenCalledTimes(2);
  }, 10_000);

  it('safety-net aborts when provider hangs past timeoutMs * 1.5', async () => {
    extractImagesMock.mockResolvedValueOnce([makeImage(88)]);
    const provider = makeProvider(
      () =>
        new Promise<string>(() => {
          // Never resolves — simulates a misbehaving SDK that ignores
          // its timeoutMs argument. Without the safety net the plugin
          // would hang indefinitely.
        }),
    );
    const plugin = withVisionCaption({
      provider,
      cacheDir,
      maxRetries: 0,
      timeoutMs: 100,
      onFailure: 'fail-index',
    });
    await expect(
      plugin.enrichPdf?.(makePages(1), { source: 'hang.pdf', pdfBytes: makePdfBytes() }),
    ).rejects.toBeInstanceOf(VisionCaptionFailedError);
  }, 10_000);

  it('slices ctx.pdfBytes when it is a non-zero-offset buffer view', async () => {
    extractImagesMock.mockResolvedValueOnce([makeImage(5)]);
    const provider = makeProvider();
    const plugin = withVisionCaption({ provider, cacheDir });
    // Underlying buffer is larger than the view; view starts at +4.
    const parent = new Uint8Array(64);
    for (let i = 0; i < parent.length; i += 1) parent[i] = i & 0xff;
    const view = parent.subarray(4, 20);
    await plugin.enrichPdf?.(makePages(1), { source: 'view.pdf', pdfBytes: view });
    // The first arg to extractImages must be a fresh, contiguous Uint8Array
    // (byteOffset = 0) — not the offset view that would mis-point PDF.js.
    const passedBytes = extractImagesMock.mock.calls[0]?.[0] as Uint8Array;
    expect(passedBytes).toBeInstanceOf(Uint8Array);
    expect(passedBytes.byteOffset).toBe(0);
    expect(passedBytes.byteLength).toBe(16);
  });
});

describe('withVisionCaption — canvas peer recovery', () => {
  let cacheDir: string;
  beforeEach(() => {
    extractImagesMock.mockReset();
    cacheDir = mkdtempSync(path.join(tmpdir(), 'vision-caption-cache-'));
  });
  afterEach(() => {
    __setCanvasImporterForTests(null);
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('retries the canvas importer on the next enrichPdf call after a failed import', async () => {
    extractImagesMock.mockResolvedValue([makeImage(1)]);
    let attempt = 0;
    __setCanvasImporterForTests(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error('simulated missing peer');
      }
      return stubCanvasModule;
    });
    const provider = makeProvider();
    const plugin = withVisionCaption({ provider, cacheDir });
    await expect(
      plugin.enrichPdf?.(makePages(1), { source: 'x.pdf', pdfBytes: makePdfBytes() }),
    ).rejects.toThrow(/@napi-rs\/canvas/);
    // Second call must re-attempt the importer (would hang forever on
    // the cached rejected promise otherwise).
    const chunks = await plugin.enrichPdf?.(makePages(1), {
      source: 'x.pdf',
      pdfBytes: makePdfBytes(),
    });
    expect(chunks).toHaveLength(1);
    expect(attempt).toBe(2);
  });
});
