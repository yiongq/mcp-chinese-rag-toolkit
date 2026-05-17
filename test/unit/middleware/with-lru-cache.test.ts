import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canonicalize,
  computeCacheKey,
  injectCacheMeta,
  NON_CACHEABLE_ARGS,
  shouldSkipWrite,
  withLruCache,
} from '../../../src/middleware/with-lru-cache.js';
import type { CacheOptions } from '../../../src/rag/types.js';

function makeResult(overrides: Partial<CallToolResult> = {}): CallToolResult {
  return {
    content: [{ type: 'text', text: 'ok' }],
    structuredContent: { value: 1 },
    ...overrides,
  };
}

function defaultOpts(overrides: Partial<CacheOptions> = {}): CacheOptions {
  return { indexVersion: 'v1', ...overrides };
}

describe('canonicalize', () => {
  it('sorts object keys recursively so {b,a} === {a,b}', () => {
    expect(canonicalize({ b: 2, a: 1 })).toBe(canonicalize({ a: 1, b: 2 }));
    expect(canonicalize({ outer: { y: 2, x: 1 } })).toBe(canonicalize({ outer: { x: 1, y: 2 } }));
  });

  it('trims string values', () => {
    expect(canonicalize({ q: '试用期 ' })).toBe(canonicalize({ q: '试用期' }));
    expect(canonicalize({ q: '  hello  ' })).toBe(canonicalize({ q: 'hello' }));
  });

  it('converts 全角空格 to 半角', () => {
    expect(canonicalize({ q: '试用期　多久' })).toBe(canonicalize({ q: '试用期 多久' }));
  });

  it('preserves case — Apple !== apple (proper-noun-sensitive)', () => {
    expect(canonicalize({ q: 'Apple' })).not.toBe(canonicalize({ q: 'apple' }));
  });

  it('keeps array element order significant', () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it('passes non-plain-object branches through unchanged', () => {
    // numbers / booleans / null are JSON-stringified as-is
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(null)).toBe('null');
  });

  it('recurses into nested arrays of objects with key sorting', () => {
    const a = canonicalize({
      list: [
        { y: 2, x: 1 },
        { y: 4, x: 3 },
      ],
    });
    const b = canonicalize({
      list: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    });
    expect(a).toBe(b);
  });
});

describe('computeCacheKey', () => {
  it('returns a 64-char lowercase hex string', () => {
    const key = computeCacheKey('a', 'v1', {});
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when indexVersion changes', () => {
    expect(computeCacheKey('a', 'v1', {})).not.toBe(computeCacheKey('a', 'v2', {}));
  });

  it('changes when toolName changes', () => {
    expect(computeCacheKey('a', 'v1', {})).not.toBe(computeCacheKey('b', 'v1', {}));
  });

  it('collapses to the same key after canonicalize (key order)', () => {
    expect(computeCacheKey('a', 'v1', { x: 1, y: 2 })).toBe(
      computeCacheKey('a', 'v1', { y: 2, x: 1 }),
    );
  });
});

describe('shouldSkipWrite', () => {
  it('skips when result.isError is true', () => {
    expect(shouldSkipWrite(makeResult({ isError: true }), {})).toBe(true);
  });

  it('skips when structuredContent.confidence === "low"', () => {
    const r = makeResult({ structuredContent: { confidence: 'low' } });
    expect(shouldSkipWrite(r, {})).toBe(true);
  });

  it('skips when args.env is present and !== "dev" (e.g. "prod", "test")', () => {
    expect(shouldSkipWrite(makeResult(), { env: 'prod' })).toBe(true);
    expect(shouldSkipWrite(makeResult(), { env: 'test' })).toBe(true);
  });

  it('allows write when args.env === "dev" or missing', () => {
    expect(shouldSkipWrite(makeResult(), { env: 'dev' })).toBe(false);
    expect(shouldSkipWrite(makeResult(), {})).toBe(false);
    expect(shouldSkipWrite(makeResult(), { other: 'value' })).toBe(false);
  });
});

describe('injectCacheMeta', () => {
  it('does not mutate the input result', () => {
    const original = makeResult({ structuredContent: { foo: 'bar' } });
    const beforeJson = JSON.stringify(original);
    injectCacheMeta(original, 'hit');
    expect(JSON.stringify(original)).toBe(beforeJson);
  });

  it('preserves existing _meta.* fields when injecting cache status', () => {
    const r = makeResult({
      structuredContent: { foo: 'bar', _meta: { indexVersion: 'v1', extra: 'baz' } },
    });
    const out = injectCacheMeta(r, 'hit');
    const sc = out.structuredContent as Record<string, unknown>;
    const meta = sc._meta as Record<string, unknown>;
    expect(meta.cache).toBe('hit');
    expect(meta.indexVersion).toBe('v1');
    expect(meta.extra).toBe('baz');
  });
});

describe('withLruCache factory-time validation', () => {
  const handler = vi.fn(async () => makeResult());

  beforeEach(() => handler.mockClear());

  it('throws when toolName is empty', () => {
    expect(() => withLruCache('', handler, defaultOpts())).toThrow(/toolName must be a non-empty/);
    expect(() => withLruCache('   ', handler, defaultOpts())).toThrow(
      /toolName must be a non-empty/,
    );
  });

  it('throws when indexVersion is empty', () => {
    expect(() => withLruCache('t', handler, defaultOpts({ indexVersion: '' }))).toThrow(
      /indexVersion must be a non-empty/,
    );
  });

  it('throws when max is not a positive integer', () => {
    expect(() => withLruCache('t', handler, defaultOpts({ max: 0 }))).toThrow(/max must be/);
    expect(() => withLruCache('t', handler, defaultOpts({ max: 1.5 }))).toThrow(/max must be/);
  });

  it('throws when ttlMs is not a positive integer', () => {
    expect(() => withLruCache('t', handler, defaultOpts({ ttlMs: 0 }))).toThrow(/ttlMs must be/);
  });
});

describe('withLruCache runtime behavior', () => {
  it('first call → miss; second call (same args) → hit, handler not re-invoked', async () => {
    const handler = vi.fn(async () => makeResult({ structuredContent: { v: 1 } }));
    const wrapped = withLruCache('t', handler, defaultOpts());

    const r1 = await wrapped({ q: '试用期' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect((r1.structuredContent as { _meta: { cache: string } })._meta.cache).toBe('miss');

    const r2 = await wrapped({ q: '试用期' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect((r2.structuredContent as { _meta: { cache: string } })._meta.cache).toBe('hit');
  });

  it('args canonicalize: trimmed + 全角空格 query hits same cache slot', async () => {
    const handler = vi.fn(async () => makeResult());
    const wrapped = withLruCache('t', handler, defaultOpts());

    await wrapped({ q: '试用期' });
    const r2 = await wrapped({ q: '试用期 ' }); // trailing space
    const r3 = await wrapped({ q: '试用期　多久' }); // full-width space

    expect(handler).toHaveBeenCalledTimes(2); // first + once for the new "多久" query
    expect((r2.structuredContent as { _meta: { cache: string } })._meta.cache).toBe('hit');
    expect((r3.structuredContent as { _meta: { cache: string } })._meta.cache).toBe('miss');
  });

  it('isError envelope is not stored — second identical call still triggers handler', async () => {
    const handler = vi.fn(async () =>
      makeResult({ isError: true, structuredContent: { error: 'X' } }),
    );
    const wrapped = withLruCache('t', handler, defaultOpts());

    await wrapped({ q: 'fail' });
    await wrapped({ q: 'fail' });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('low-confidence envelope is not stored', async () => {
    const handler = vi.fn(async () =>
      makeResult({ structuredContent: { confidence: 'low', message: 'unsure' } }),
    );
    const wrapped = withLruCache('t', handler, defaultOpts());

    await wrapped({ q: 'q' });
    await wrapped({ q: 'q' });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('env=prod is not stored; env=dev is stored', async () => {
    const handler = vi.fn(async () => makeResult());
    const wrapped = withLruCache('t', handler, defaultOpts());

    await wrapped({ q: 'a', env: 'prod' });
    await wrapped({ q: 'a', env: 'prod' });
    expect(handler).toHaveBeenCalledTimes(2);

    await wrapped({ q: 'b', env: 'dev' });
    await wrapped({ q: 'b', env: 'dev' });
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('enabled: false → returns original handler (no _meta.cache injection)', async () => {
    const handler = vi.fn(async () => makeResult());
    const wrapped = withLruCache('t', handler, defaultOpts({ enabled: false }));

    const r1 = await wrapped({ q: 'a' });
    const r2 = await wrapped({ q: 'a' });
    expect(handler).toHaveBeenCalledTimes(2);
    // raw handler bypass → no injected _meta.cache field
    const sc1 = r1.structuredContent as Record<string, unknown>;
    expect(sc1._meta).toBeUndefined();
    expect(r2).toEqual(r1);
  });

  it('TTL eviction: entry expires after ttlMs and triggers re-computation', async () => {
    // lru-cache@^11 reads `performance.now()` directly, which Vitest fake
    // timers can desync from `setTimeout` clocks in subtle ways. Real
    // timers + a very short TTL keep this fast (< 50ms) without flakiness.
    const handler = vi.fn(async () => makeResult());
    const wrapped = withLruCache('t', handler, defaultOpts({ ttlMs: 20 }));

    await wrapped({ q: 'x' });
    expect(handler).toHaveBeenCalledTimes(1);

    // Within TTL — hit
    await new Promise((resolve) => setTimeout(resolve, 5));
    await wrapped({ q: 'x' });
    expect(handler).toHaveBeenCalledTimes(1);

    // Past TTL — miss again
    await new Promise((resolve) => setTimeout(resolve, 30));
    await wrapped({ q: 'x' });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('NON_CACHEABLE_ARGS contains "env" (functional smoke)', () => {
    expect(NON_CACHEABLE_ARGS.has('env')).toBe(true);
  });
});
