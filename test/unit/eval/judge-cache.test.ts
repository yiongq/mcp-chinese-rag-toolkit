import { describe, expect, it, vi } from 'vitest';

import {
  computeJudgeCacheKey,
  createMemoryJudgeCacheStore,
  type JudgeCacheStore,
  withJudgeCache,
} from '../../../src/eval/judge-cache.js';
import type { JudgeFn } from '../../../src/eval/types.js';

// A judge that records every prompt it is actually asked to score, so a test can
// assert how many calls reached the real judge vs. were served from cache.
function countingJudge(reply: (prompt: string) => string): { fn: JudgeFn; calls: string[] } {
  const calls: string[] = [];
  const fn: JudgeFn = (prompt) => {
    calls.push(prompt);
    return Promise.resolve(reply(prompt));
  };
  return { fn, calls };
}

const OPTS = { model: 'claude-sonnet-4-6', promptVersion: '2026-06-09' } as const;

describe('computeJudgeCacheKey', () => {
  it('is stable for the same input and reuses the v1 canonicalize rule (object key order ignored)', () => {
    const a = computeJudgeCacheKey('m', 'v', { answer: '甲', context: '乙' });
    const b = computeJudgeCacheKey('m', 'v', { context: '乙', answer: '甲' });
    expect(a).toBe(b);
  });

  it('normalizes string inputs (trim + 全角 space) like canonicalize does', () => {
    const a = computeJudgeCacheKey('m', 'v', '判断这条论断');
    const b = computeJudgeCacheKey('m', 'v', '  判断这条论断  ');
    expect(a).toBe(b);
  });

  it('changes when the model changes', () => {
    const a = computeJudgeCacheKey('model-a', 'v', 'p');
    const b = computeJudgeCacheKey('model-b', 'v', 'p');
    expect(a).not.toBe(b);
  });

  it('changes when the prompt version changes', () => {
    const a = computeJudgeCacheKey('m', '2026-06-09', 'p');
    const b = computeJudgeCacheKey('m', '2026-06-10', 'p');
    expect(a).not.toBe(b);
  });

  it('returns a lowercase sha256 hex digest', () => {
    expect(computeJudgeCacheKey('m', 'v', 'p')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('createMemoryJudgeCacheStore', () => {
  it('round-trips a value and misses on an unknown key', () => {
    const store = createMemoryJudgeCacheStore();
    expect(store.get('k')).toBeUndefined();
    store.set('k', 'v');
    expect(store.get('k')).toBe('v');
  });

  it('rejects a non-positive max', () => {
    expect(() => createMemoryJudgeCacheStore(0)).toThrow(/positive integer/);
    expect(() => createMemoryJudgeCacheStore(-3)).toThrow(/positive integer/);
  });
});

describe('withJudgeCache', () => {
  it('serves a second identical call from cache (inner judge invoked once)', async () => {
    const { fn, calls } = countingJudge(() => '["ok"]');
    const cached = withJudgeCache(fn, OPTS);

    const first = await cached('判断：入职第一天要报到');
    const second = await cached('判断：入职第一天要报到');

    expect(first).toBe('["ok"]');
    expect(second).toBe('["ok"]');
    expect(calls).toHaveLength(1); // the second call hit the cache
  });

  it('treats trim/全角-space-equivalent prompts as the same key (canonicalize)', async () => {
    const { fn, calls } = countingJudge(() => 'x');
    const cached = withJudgeCache(fn, OPTS);

    await cached('同一个 prompt');
    await cached('  同一个　prompt  '); // trailing ws + 全角 space → canonicalized equal

    expect(calls).toHaveLength(1);
  });

  it('invalidates when the prompt version changes (a new prompt must re-judge)', async () => {
    const store = createMemoryJudgeCacheStore();
    const { fn, calls } = countingJudge(() => 'x');
    const v1 = withJudgeCache(fn, { ...OPTS, promptVersion: '2026-06-09', store });
    const v2 = withJudgeCache(fn, { ...OPTS, promptVersion: '2026-06-10', store });

    await v1('prompt');
    await v2('prompt'); // same store, different prompt version → different key

    expect(calls).toHaveLength(2);
  });

  it('invalidates when the model changes', async () => {
    const store = createMemoryJudgeCacheStore();
    const { fn, calls } = countingJudge(() => 'x');
    const a = withJudgeCache(fn, { ...OPTS, model: 'model-a', store });
    const b = withJudgeCache(fn, { ...OPTS, model: 'model-b', store });

    await a('prompt');
    await b('prompt');

    expect(calls).toHaveLength(2);
  });

  it('does NOT cache a rejection — the next call re-drives the judge', async () => {
    const calls: string[] = [];
    let attempt = 0;
    const flaky: JudgeFn = (prompt) => {
      calls.push(prompt);
      attempt += 1;
      if (attempt === 1) return Promise.reject(new Error('judge backend 500'));
      return Promise.resolve('recovered');
    };
    const cached = withJudgeCache(flaky, OPTS);

    await expect(cached('p')).rejects.toThrow('judge backend 500');
    await expect(cached('p')).resolves.toBe('recovered');
    expect(calls).toHaveLength(2);
  });

  it('passes a miss THROUGH to the real judge and caches its output', async () => {
    const { fn, calls } = countingJudge((p) => `judged:${p}`);
    const cached = withJudgeCache(fn, OPTS);

    expect(await cached('a')).toBe('judged:a');
    expect(await cached('b')).toBe('judged:b');
    expect(await cached('a')).toBe('judged:a');
    expect(calls).toEqual(['a', 'b']); // 'a' judged once, reused; 'b' judged once
  });

  it('accepts a custom (e.g. persistent) store', async () => {
    const backing = new Map<string, string>();
    const store: JudgeCacheStore = {
      get: (k) => backing.get(k),
      set: (k, v) => {
        backing.set(k, v);
      },
    };
    const probe = vi.spyOn(store, 'set');
    const { fn } = countingJudge(() => 'out');
    const cached = withJudgeCache(fn, { ...OPTS, store });

    await cached('p');
    expect(probe).toHaveBeenCalledTimes(1);
    expect(backing.size).toBe(1);
    // The stored key is a hash, never the raw prompt text.
    expect([...backing.keys()][0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects blank model / promptVersion / non-function judge', () => {
    const { fn } = countingJudge(() => 'x');
    expect(() => withJudgeCache(fn, { ...OPTS, model: '' })).toThrow(/model/);
    expect(() => withJudgeCache(fn, { ...OPTS, promptVersion: '  ' })).toThrow(/promptVersion/);
    expect(() => withJudgeCache(undefined as unknown as JudgeFn, OPTS)).toThrow(/judgeFn/);
  });
});
