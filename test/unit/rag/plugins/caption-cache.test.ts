import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  openCaptionCache,
  resolveDefaultCaptionCacheDir,
  sha256Hex,
} from '../../../../src/rag/plugins/caption-cache.js';
import type { CaptionCacheEntry } from '../../../../src/rag/plugins/types.js';

function makeEntry(overrides: Partial<CaptionCacheEntry> = {}): CaptionCacheEntry {
  return {
    captionText: '示例图片描述',
    imageSha256: 'a'.repeat(64),
    promptSha256: 'b'.repeat(64),
    providerId: 'anthropic',
    modelId: 'claude-haiku-4-5',
    createdAt: '2026-05-17T00:00:00.000Z',
    ...overrides,
  };
}

describe('sha256Hex', () => {
  it('matches the canonical sha256("hello") known vector', () => {
    expect(sha256Hex('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('treats Uint8Array vs string inputs as distinct encodings', () => {
    const bytes = new Uint8Array([0x31, 0x32, 0x33]); // ASCII "123"
    expect(sha256Hex(bytes)).toBe(sha256Hex('123'));
    const nonAscii = new Uint8Array([0xff, 0xfe, 0xfd]);
    expect(sha256Hex(nonAscii)).not.toBe(sha256Hex('123'));
  });

  it('hashes UTF-8 encoded Chinese text deterministically', () => {
    const a = sha256Hex('图片描述');
    const b = sha256Hex('图片描述');
    expect(a).toBe(b);
    expect(a).not.toBe(sha256Hex('其他描述'));
  });
});

describe('openCaptionCache', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'caption-cache-test-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects empty cacheDir with actionable error', () => {
    expect(() => openCaptionCache({ cacheDir: '' })).toThrow(/cacheDir must be a non-empty string/);
  });

  it('creates the cacheDir and exposes the 6-column schema', () => {
    const cache = openCaptionCache({ cacheDir: tmpDir });
    try {
      // Round-trip a fixture to indirectly assert schema acceptance.
      const entry = makeEntry();
      cache.set(entry);
      const got = cache.get({
        imageSha256: entry.imageSha256,
        promptSha256: entry.promptSha256,
        providerId: entry.providerId,
        modelId: entry.modelId,
      });
      expect(got).toEqual(entry);
    } finally {
      cache.close();
    }
  });

  it('round-trips a single entry via set/get', () => {
    const cache = openCaptionCache({ cacheDir: tmpDir });
    try {
      const entry = makeEntry({ captionText: '另一个描述' });
      cache.set(entry);
      const got = cache.get({
        imageSha256: entry.imageSha256,
        promptSha256: entry.promptSha256,
        providerId: entry.providerId,
        modelId: entry.modelId,
      });
      expect(got).toEqual(entry);
    } finally {
      cache.close();
    }
  });

  it('returns undefined on cache miss', () => {
    const cache = openCaptionCache({ cacheDir: tmpDir });
    try {
      const got = cache.get({
        imageSha256: 'z'.repeat(64),
        promptSha256: 'z'.repeat(64),
        providerId: 'anthropic',
        modelId: 'claude-haiku-4-5',
      });
      expect(got).toBeUndefined();
    } finally {
      cache.close();
    }
  });

  it('treats each of (imageSha, promptSha, providerId, modelId) as part of the PK', () => {
    const cache = openCaptionCache({ cacheDir: tmpDir });
    try {
      const base = makeEntry();
      cache.set(base);
      cache.set({ ...base, promptSha256: 'c'.repeat(64), captionText: 'prompt-changed' });
      cache.set({ ...base, providerId: 'doubao-vision', captionText: 'provider-changed' });
      cache.set({ ...base, modelId: 'claude-haiku-4-6', captionText: 'model-changed' });

      const original = cache.get({
        imageSha256: base.imageSha256,
        promptSha256: base.promptSha256,
        providerId: base.providerId,
        modelId: base.modelId,
      });
      expect(original?.captionText).toBe('示例图片描述');

      const promptChanged = cache.get({
        imageSha256: base.imageSha256,
        promptSha256: 'c'.repeat(64),
        providerId: base.providerId,
        modelId: base.modelId,
      });
      expect(promptChanged?.captionText).toBe('prompt-changed');

      const providerChanged = cache.get({
        imageSha256: base.imageSha256,
        promptSha256: base.promptSha256,
        providerId: 'doubao-vision',
        modelId: base.modelId,
      });
      expect(providerChanged?.captionText).toBe('provider-changed');

      const modelChanged = cache.get({
        imageSha256: base.imageSha256,
        promptSha256: base.promptSha256,
        providerId: base.providerId,
        modelId: 'claude-haiku-4-6',
      });
      expect(modelChanged?.captionText).toBe('model-changed');
    } finally {
      cache.close();
    }
  });

  it('INSERT OR REPLACE: setting the same PK twice updates captionText', () => {
    const cache = openCaptionCache({ cacheDir: tmpDir });
    try {
      const entry = makeEntry({ captionText: 'first' });
      cache.set(entry);
      cache.set({ ...entry, captionText: 'second' });
      const got = cache.get({
        imageSha256: entry.imageSha256,
        promptSha256: entry.promptSha256,
        providerId: entry.providerId,
        modelId: entry.modelId,
      });
      expect(got?.captionText).toBe('second');
    } finally {
      cache.close();
    }
  });

  it('exposes hash() identical to the standalone sha256Hex helper', () => {
    const cache = openCaptionCache({ cacheDir: tmpDir });
    try {
      expect(cache.hash('hello')).toBe(sha256Hex('hello'));
    } finally {
      cache.close();
    }
  });

  it('close() is idempotent', () => {
    const cache = openCaptionCache({ cacheDir: tmpDir });
    expect(() => cache.close()).not.toThrow();
    expect(() => cache.close()).not.toThrow();
  });

  it('rejects get/set after close with actionable error', () => {
    const cache = openCaptionCache({ cacheDir: tmpDir });
    cache.close();
    expect(() =>
      cache.get({
        imageSha256: 'a'.repeat(64),
        promptSha256: 'b'.repeat(64),
        providerId: 'p',
        modelId: 'm',
      }),
    ).toThrow(/cache is closed/);
    expect(() => cache.set(makeEntry())).toThrow(/cache is closed/);
  });
});

describe('resolveDefaultCaptionCacheDir', () => {
  it('returns a path containing the caption-cache subpath', () => {
    const dir = resolveDefaultCaptionCacheDir();
    expect(dir).toMatch(/mcp-chinese-rag-toolkit[\\/]caption-cache$/);
  });

  it('honours XDG_CACHE_HOME when set', () => {
    const original = process.env.XDG_CACHE_HOME;
    const tmp = mkdtempSync(path.join(tmpdir(), 'xdg-cache-'));
    try {
      process.env.XDG_CACHE_HOME = tmp;
      const dir = resolveDefaultCaptionCacheDir();
      expect(dir.startsWith(tmp)).toBe(true);
      expect(dir.endsWith(path.join('mcp-chinese-rag-toolkit', 'caption-cache'))).toBe(true);
    } finally {
      if (original === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = original;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
