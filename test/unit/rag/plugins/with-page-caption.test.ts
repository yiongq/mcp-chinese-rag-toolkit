import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setCanvasImporterForTests } from '../../../../src/rag/plugins/png-encoder.js';
import type { VisionProvider } from '../../../../src/rag/plugins/types.js';
import { VisionCaptionFailedError } from '../../../../src/rag/plugins/types.js';
import { withPageCaption } from '../../../../src/rag/plugins/with-page-caption.js';
import { DEFAULT_VISION_PROMPT } from '../../../../src/rag/plugins/caption-engine.js';
import type { PdfPage } from '../../../../src/rag/types.js';

// ---------------------------------------------------------------------------
// Mock stack — renderPageAsImage (via vi.mock), canvas (via the test-only
// importer hook), provider (vi.fn). Zero real native / network path.
// `withPageCaption` renders WHOLE pages, so we only mock renderPageAsImage;
// extractImages (the per-image plugin's input) is irrelevant here.
// ---------------------------------------------------------------------------

const renderPageAsImageMock = vi.fn();
vi.mock('unpdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('unpdf')>();
  return {
    ...actual,
    renderPageAsImage: (...args: Parameters<typeof actual.renderPageAsImage>) =>
      renderPageAsImageMock(...args),
  };
});

// A truthy stub for `@napi-rs/canvas`. renderPageAsImage is fully mocked, so
// canvas is never actually exercised; the stub only needs to satisfy the
// eager `ensureCanvasAvailable()` fail-fast check inside enrichPdf.
const stubCanvasModule = {} as unknown as typeof import('@napi-rs/canvas');

// Distinct bytes per page so each rendered PNG has a distinct sha256 (distinct
// caption cache key) — pages never collide in the shared cache.
function makeRenderedPng(pageNumber: number): ArrayBuffer {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 7 + pageNumber * 13) & 0xff;
  return bytes.buffer;
}

function makePages(specs: Array<{ pageNumber: number; text: string }>): PdfPage[] {
  return specs.map((s) => ({ pageNumber: s.pageNumber, text: s.text }));
}

// One image-heavy page (title-only text, below the default 90-char threshold).
function imageHeavyPages(count = 1): PdfPage[] {
  return Array.from({ length: count }, (_, i) => ({ pageNumber: i + 1, text: '组织架构' }));
}

function makePdfBytes(size = 16): Uint8Array {
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) b[i] = i & 0xff;
  return b;
}

function makeProvider(captionFn?: VisionProvider['caption']): VisionProvider & {
  caption: ReturnType<typeof vi.fn>;
} {
  return {
    providerId: 'anthropic',
    modelId: 'claude-haiku-4-5',
    caption: vi.fn(captionFn ?? (async () => '整页描述文本')),
  };
}

describe('withPageCaption — factory validation', () => {
  beforeEach(() => {
    __setCanvasImporterForTests(() => Promise.resolve(stubCanvasModule));
    renderPageAsImageMock.mockReset();
  });
  afterEach(() => {
    __setCanvasImporterForTests(null);
  });

  it('shares DEFAULT_VISION_PROMPT (Chinese 200-300 + OCR guidance)', () => {
    expect(DEFAULT_VISION_PROMPT).toContain('200-300');
    expect(DEFAULT_VISION_PROMPT).toContain('OCR');
  });

  it('throws when opts.provider is missing', () => {
    expect(() =>
      withPageCaption({} as unknown as Parameters<typeof withPageCaption>[0]),
    ).toThrow(/provider must be a VisionProvider/);
  });

  it('throws when opts.provider.caption is not a function', () => {
    expect(() =>
      withPageCaption({
        provider: {
          providerId: 'x',
          modelId: 'y',
          caption: 'nope' as unknown as VisionProvider['caption'],
        },
      }),
    ).toThrow(/provider must be a VisionProvider/);
  });

  it('throws when opts.provider.providerId is empty', () => {
    expect(() =>
      withPageCaption({
        provider: { providerId: '', modelId: 'y', caption: async () => 'x' },
      }),
    ).toThrow(/providerId must be a non-empty string/);
  });

  it('returns a plugin with name="page-caption" and an enrichPdf hook', () => {
    const plugin = withPageCaption({ provider: makeProvider() });
    expect(plugin.name).toBe('page-caption');
    expect(typeof plugin.enrichPdf).toBe('function');
  });

  it('rejects out-of-range maxConcurrency / maxRetries / timeoutMs / scale', () => {
    const provider = makeProvider();
    expect(() => withPageCaption({ provider, maxConcurrency: 0 })).toThrow(/maxConcurrency/);
    expect(() => withPageCaption({ provider, maxRetries: -1 })).toThrow(/maxRetries/);
    expect(() => withPageCaption({ provider, timeoutMs: 50 })).toThrow(/timeoutMs/);
    expect(() => withPageCaption({ provider, scale: 0 })).toThrow(/scale/);
    expect(() => withPageCaption({ provider, scale: 99 })).toThrow(/scale/);
  });

  it('rejects invalid onFailure value', () => {
    expect(() =>
      withPageCaption({
        provider: makeProvider(),
        onFailure: 'invalid' as unknown as 'skip-page',
      }),
    ).toThrow(/onFailure/);
  });

  it('rejects non-function selectPage', () => {
    expect(() =>
      withPageCaption({
        provider: makeProvider(),
        selectPage: 'not-a-fn' as unknown as (p: PdfPage) => boolean,
      }),
    ).toThrow(/selectPage must be a function/);
  });

  it('rejects negative minTextLength', () => {
    expect(() => withPageCaption({ provider: makeProvider(), minTextLength: -5 })).toThrow(
      /minTextLength/,
    );
  });
});

describe('withPageCaption — enrichPdf core path', () => {
  let cacheDir: string;
  beforeEach(() => {
    __setCanvasImporterForTests(() => Promise.resolve(stubCanvasModule));
    renderPageAsImageMock.mockReset();
    renderPageAsImageMock.mockImplementation(async (_bytes: unknown, pageNumber: number) =>
      makeRenderedPng(pageNumber),
    );
    cacheDir = mkdtempSync(path.join(tmpdir(), 'page-caption-cache-'));
  });
  afterEach(() => {
    __setCanvasImporterForTests(null);
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('produces a single caption chunk for one image-heavy page', async () => {
    const provider = makeProvider();
    const plugin = withPageCaption({ provider, cacheDir });
    const chunks = await plugin.enrichPdf?.(imageHeavyPages(1), {
      source: 'hr.pdf',
      pdfBytes: makePdfBytes(),
    });
    expect(chunks).toEqual([
      { content: '整页描述文本', source: 'hr.pdf', page: 1, section: '[图片描述]' },
    ]);
    expect(provider.caption).toHaveBeenCalledTimes(1);
    expect(provider.caption).toHaveBeenCalledWith({
      imagePng: expect.any(Uint8Array),
      prompt: DEFAULT_VISION_PROMPT,
      timeoutMs: 30_000,
    });
  });

  it('default predicate skips text-heavy pages (no render, no caption)', async () => {
    const longText = 'x'.repeat(200);
    const pages = makePages([
      { pageNumber: 1, text: longText }, // text-heavy → skipped
      { pageNumber: 2, text: '组织架构' }, // image-heavy → captioned
    ]);
    const provider = makeProvider();
    const plugin = withPageCaption({ provider, cacheDir });
    const chunks = await plugin.enrichPdf?.(pages, { source: 'hr.pdf', pdfBytes: makePdfBytes() });
    expect(chunks).toHaveLength(1);
    expect(chunks?.[0]?.page).toBe(2);
    expect(renderPageAsImageMock).toHaveBeenCalledTimes(1);
    expect(renderPageAsImageMock).toHaveBeenCalledWith(expect.any(Uint8Array), 2, expect.any(Object));
    expect(provider.caption).toHaveBeenCalledTimes(1);
  });

  it('minTextLength override widens/narrows the default predicate', async () => {
    const pages = makePages([{ pageNumber: 1, text: 'x'.repeat(50) }]);
    const provider = makeProvider();
    // threshold 30 → 50-char page is NOT image-heavy → skipped.
    const plugin = withPageCaption({ provider, cacheDir, minTextLength: 30 });
    const chunks = await plugin.enrichPdf?.(pages, { source: 'hr.pdf', pdfBytes: makePdfBytes() });
    expect(chunks).toHaveLength(0);
    expect(provider.caption).not.toHaveBeenCalled();
  });

  it('selectPage override fully replaces the default predicate', async () => {
    const pages = makePages([
      { pageNumber: 1, text: 'x'.repeat(500) },
      { pageNumber: 2, text: 'x'.repeat(500) },
      { pageNumber: 3, text: 'x'.repeat(500) },
    ]);
    const provider = makeProvider();
    const plugin = withPageCaption({
      provider,
      cacheDir,
      selectPage: (p) => p.pageNumber === 2, // text length irrelevant
    });
    const chunks = await plugin.enrichPdf?.(pages, { source: 'hr.pdf', pdfBytes: makePdfBytes() });
    expect(chunks).toHaveLength(1);
    expect(chunks?.[0]?.page).toBe(2);
  });

  it('forwards the scale option to renderPageAsImage', async () => {
    const provider = makeProvider();
    const plugin = withPageCaption({ provider, cacheDir, scale: 2.5 });
    await plugin.enrichPdf?.(imageHeavyPages(1), { source: 'hr.pdf', pdfBytes: makePdfBytes() });
    const opts = renderPageAsImageMock.mock.calls[0]?.[2] as { scale?: number };
    expect(opts.scale).toBe(2.5);
  });

  it('writes a cache row so the second enrichPdf needs no provider call', async () => {
    const provider1 = makeProvider();
    const plugin1 = withPageCaption({ provider: provider1, cacheDir });
    await plugin1.enrichPdf?.(imageHeavyPages(1), { source: 'hr.pdf', pdfBytes: makePdfBytes() });
    expect(provider1.caption).toHaveBeenCalledTimes(1);

    const provider2 = makeProvider(async () => 'SHOULD NOT BE CALLED');
    const plugin2 = withPageCaption({ provider: provider2, cacheDir });
    const chunks = await plugin2.enrichPdf?.(imageHeavyPages(1), {
      source: 'hr.pdf',
      pdfBytes: makePdfBytes(),
    });
    expect(provider2.caption).not.toHaveBeenCalled();
    expect(chunks?.[0]?.content).toBe('整页描述文本');
  });

  it('retries on 5xx then 429 then succeeds', async () => {
    let callIdx = 0;
    const provider = makeProvider(async () => {
      callIdx += 1;
      if (callIdx === 1) throw Object.assign(new Error('server'), { statusCode: 503 });
      if (callIdx === 2) throw Object.assign(new Error('rate'), { statusCode: 429 });
      return '重试成功';
    });
    const plugin = withPageCaption({ provider, cacheDir, maxRetries: 2, timeoutMs: 200 });
    const chunks = await plugin.enrichPdf?.(imageHeavyPages(1), {
      source: 'hr.pdf',
      pdfBytes: makePdfBytes(),
    });
    expect(chunks?.[0]?.content).toBe('重试成功');
    expect(provider.caption).toHaveBeenCalledTimes(3);
  }, 10_000);

  it('fails fast on non-retryable 401; onFailure=skip-page returns zero chunks', async () => {
    const provider = makeProvider(async () => {
      throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
    });
    const plugin = withPageCaption({ provider, cacheDir });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const chunks = await plugin.enrichPdf?.(imageHeavyPages(1), {
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
    const provider = makeProvider(async () => {
      throw Object.assign(new Error('boom'), { statusCode: 500 });
    });
    const plugin = withPageCaption({
      provider,
      cacheDir,
      maxRetries: 0,
      onFailure: 'fail-index',
    });
    await expect(
      plugin.enrichPdf?.(imageHeavyPages(1), { source: 'hr.pdf', pdfBytes: makePdfBytes() }),
    ).rejects.toBeInstanceOf(VisionCaptionFailedError);
  });

  it('respects maxConcurrency — peak in-flight provider calls never exceeds cap', async () => {
    const total = 9;
    let inFlight = 0;
    let peak = 0;
    const provider = makeProvider(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      await Promise.resolve();
      inFlight -= 1;
      return 'caption';
    });
    const plugin = withPageCaption({ provider, cacheDir, maxConcurrency: 3 });
    const chunks = await plugin.enrichPdf?.(imageHeavyPages(total), {
      source: 'hr.pdf',
      pdfBytes: makePdfBytes(),
    });
    expect(chunks).toHaveLength(total);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(0);
  });

  it('markSyntheticChunk=false drops the section marker', async () => {
    const provider = makeProvider();
    const plugin = withPageCaption({ provider, cacheDir, markSyntheticChunk: false });
    const chunks = await plugin.enrichPdf?.(imageHeavyPages(1), {
      source: 'hr.pdf',
      pdfBytes: makePdfBytes(),
    });
    expect(chunks?.[0]?.section).toBeUndefined();
  });

  it('hands renderPageAsImage a fresh contiguous buffer (byteOffset 0) per page', async () => {
    const provider = makeProvider();
    const plugin = withPageCaption({ provider, cacheDir });
    // Offset view into a larger parent buffer — the per-page `.slice()` must
    // copy it into a fresh contiguous Uint8Array so PDF.js does not mis-point.
    const parent = new Uint8Array(64);
    for (let i = 0; i < parent.length; i += 1) parent[i] = i & 0xff;
    const view = parent.subarray(4, 20);
    await plugin.enrichPdf?.(imageHeavyPages(1), { source: 'view.pdf', pdfBytes: view });
    const passed = renderPageAsImageMock.mock.calls[0]?.[0] as Uint8Array;
    expect(passed).toBeInstanceOf(Uint8Array);
    expect(passed.byteOffset).toBe(0);
    expect(passed.byteLength).toBe(16);
  });

  it('rejects ctx.source missing/empty with actionable error', async () => {
    const plugin = withPageCaption({ provider: makeProvider(), cacheDir });
    await expect(
      plugin.enrichPdf?.(imageHeavyPages(1), { source: '', pdfBytes: makePdfBytes() }),
    ).rejects.toThrow(/ctx.source/);
  });

  it('rejects ctx.pdfBytes when not a Uint8Array', async () => {
    const plugin = withPageCaption({ provider: makeProvider(), cacheDir });
    await expect(
      plugin.enrichPdf?.(imageHeavyPages(1), {
        source: 'x.pdf',
        pdfBytes: 'not-bytes' as unknown as Uint8Array,
      }),
    ).rejects.toThrow(/pdfBytes/);
  });

  it('rejects a page array with a bad pageNumber before any render', async () => {
    const plugin = withPageCaption({ provider: makeProvider(), cacheDir });
    await expect(
      plugin.enrichPdf?.(
        [{ pageNumber: 0, text: '组织架构' }] as PdfPage[],
        { source: 'x.pdf', pdfBytes: makePdfBytes() },
      ),
    ).rejects.toThrow(/page.pageNumber must be a positive integer/);
    expect(renderPageAsImageMock).not.toHaveBeenCalled();
  });

  it('returns empty result + no provider call when no page is selected', async () => {
    const pages = makePages([{ pageNumber: 1, text: 'x'.repeat(300) }]);
    const provider = makeProvider();
    const plugin = withPageCaption({ provider, cacheDir });
    const chunks = await plugin.enrichPdf?.(pages, { source: 'x.pdf', pdfBytes: makePdfBytes() });
    expect(chunks).toHaveLength(0);
    expect(provider.caption).not.toHaveBeenCalled();
    expect(renderPageAsImageMock).not.toHaveBeenCalled();
  });

  it('treats AbortError (timeout) as retryable', async () => {
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
    const plugin = withPageCaption({ provider, cacheDir, maxRetries: 2 });
    const chunks = await plugin.enrichPdf?.(imageHeavyPages(1), {
      source: 'hr.pdf',
      pdfBytes: makePdfBytes(),
    });
    expect(chunks).toHaveLength(1);
    expect(provider.caption).toHaveBeenCalledTimes(2);
  }, 10_000);

  it('retries a transient network error whose code hides under .cause', async () => {
    let calls = 0;
    const provider = makeProvider(async () => {
      calls += 1;
      if (calls === 1) {
        // Shape an SDK-style failure: top error has no HTTP status, the real
        // network code lives one level down in `.cause` (Anthropic SDK
        // APIConnectionError → undici ECONNRESET).
        throw Object.assign(new Error('Connection error.'), {
          cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
        });
      }
      return '网络抖动后成功';
    });
    const plugin = withPageCaption({ provider, cacheDir, maxRetries: 2, timeoutMs: 200 });
    const chunks = await plugin.enrichPdf?.(imageHeavyPages(1), {
      source: 'hr.pdf',
      pdfBytes: makePdfBytes(),
    });
    expect(chunks?.[0]?.content).toBe('网络抖动后成功');
    expect(provider.caption).toHaveBeenCalledTimes(2);
  }, 10_000);

  it('retries an SDK *ConnectionError wrapper (no code, no status)', async () => {
    // Mirrors @anthropic-ai/sdk APIConnectionError: name stays "Error", status
    // is undefined, but constructor.name ends with ConnectionError.
    class APIConnectionError extends Error {}
    let calls = 0;
    const provider = makeProvider(async () => {
      calls += 1;
      if (calls === 1) throw new APIConnectionError('Connection error.');
      return '连接错误重试成功';
    });
    const plugin = withPageCaption({ provider, cacheDir, maxRetries: 1, timeoutMs: 200 });
    const chunks = await plugin.enrichPdf?.(imageHeavyPages(1), {
      source: 'hr.pdf',
      pdfBytes: makePdfBytes(),
    });
    expect(chunks?.[0]?.content).toBe('连接错误重试成功');
    expect(provider.caption).toHaveBeenCalledTimes(2);
  }, 10_000);

  it('safety-net aborts when provider hangs past timeoutMs * 1.5', async () => {
    const provider = makeProvider(
      () =>
        new Promise<string>(() => {
          // Never resolves — misbehaving SDK that ignores its timeoutMs.
        }),
    );
    const plugin = withPageCaption({
      provider,
      cacheDir,
      maxRetries: 0,
      timeoutMs: 100,
      onFailure: 'fail-index',
    });
    await expect(
      plugin.enrichPdf?.(imageHeavyPages(1), { source: 'hang.pdf', pdfBytes: makePdfBytes() }),
    ).rejects.toBeInstanceOf(VisionCaptionFailedError);
  }, 10_000);
});

describe('withPageCaption — canvas peer recovery', () => {
  let cacheDir: string;
  beforeEach(() => {
    renderPageAsImageMock.mockReset();
    renderPageAsImageMock.mockImplementation(async (_bytes: unknown, pageNumber: number) =>
      makeRenderedPng(pageNumber),
    );
    cacheDir = mkdtempSync(path.join(tmpdir(), 'page-caption-cache-'));
  });
  afterEach(() => {
    __setCanvasImporterForTests(null);
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('retries the canvas importer on the next enrichPdf call after a failed import', async () => {
    let attempt = 0;
    __setCanvasImporterForTests(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('simulated missing peer');
      return stubCanvasModule;
    });
    const provider = makeProvider();
    const plugin = withPageCaption({ provider, cacheDir });
    await expect(
      plugin.enrichPdf?.(imageHeavyPages(1), { source: 'x.pdf', pdfBytes: makePdfBytes() }),
    ).rejects.toThrow(/@napi-rs\/canvas/);
    const chunks = await plugin.enrichPdf?.(imageHeavyPages(1), {
      source: 'x.pdf',
      pdfBytes: makePdfBytes(),
    });
    expect(chunks).toHaveLength(1);
    expect(attempt).toBe(2);
  });
});
