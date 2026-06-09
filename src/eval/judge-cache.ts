// ---------------------------------------------------------------------------
// — Judge-result cache (additive decorator over an injected JudgeFn)
// ---------------------------------------------------------------------------
//
// A real LLM judge is the dominant cost of an answer-quality eval: a single
// benchmark sweep costs roughly `queries × metrics × configs × variance-samples`
// judge calls. Many of those calls are BYTE-IDENTICAL — the same answer is judged
// again under a different retrieval configuration, and a run is often replayed.
// This module memoizes a judge call so an identical `(model, promptVersion,
// input)` triple is paid for once.
//
// It is purely ADDITIVE: it wraps an injected `JudgeFn` and returns a `JudgeFn`
// with the same string-in / string-out shape, so callers opt in by passing the
// wrapped function where they used to pass the raw one. Nothing in the judge
// tasks, the `callJudge` core, or the orchestrator changes.
//
// Cache key — REUSES the v1 canonicalize rule, never a second normalizer: the key
// is `computeCacheKey(model, promptVersion, input)` =
// `sha256(model + ':' + promptVersion + ':' + canonicalize(input))`. Pinning the
// model and the prompt version into the key means a model swap or a
// `JUDGE_PROMPT_VERSION` bump INVALIDATES the cache automatically — a stale score
// from a different prompt can never be served against a new prompt.
//
// PII posture: the stored key is a non-reversible SHA-256 digest (the raw input
// text is never persisted), and the stored value is the judge's OWN output. An
// in-memory store is process-ephemeral; a persistent store is opt-in and owned by
// the key-bound caller, which handles PII in its own domain.
//
// NOT for variance sampling: measuring a judge's residual non-determinism means
// calling it N times for the SAME input and observing the spread — caching would
// collapse that to one value and report a false zero variance. A variance harness
// must drive the RAW judge, never a cached one.

import { LRUCache } from 'lru-cache';
import { computeCacheKey } from '../middleware/with-lru-cache.js';
import type { JudgeFn } from './types.js';

/**
 * Pluggable backing store for {@link withJudgeCache}. The contract is the minimal
 * synchronous get/set a memoizer needs; an in-memory LRU is the default, and a
 * persistent (e.g. SQLite) store can be supplied by a caller that wants
 * cross-process reuse without the toolkit taking on a file-handle lifecycle in
 * the eval hot path. Keys are SHA-256 hex digests; values are raw judge output.
 */
export interface JudgeCacheStore {
  /** Return the cached judge output for `key`, or `undefined` on a miss. */
  get(key: string): string | undefined;
  /** Persist (or overwrite) the judge output for `key`. */
  set(key: string, value: string): void;
}

/** Options for {@link withJudgeCache}. */
export interface JudgeCacheOptions {
  /**
   * Judge model id — pinned into the cache key so a model swap invalidates the
   * cache (a score from a different model must never be served). Required, non-empty.
   */
  model: string;
  /**
   * Judge prompt version (the toolkit's `JUDGE_PROMPT_VERSION` at run time) —
   * pinned into the cache key so a prompt edit invalidates the cache. Required,
   * non-empty.
   */
  promptVersion: string;
  /**
   * Backing store. Defaults to a per-decorator in-memory LRU (see
   * {@link createMemoryJudgeCacheStore}); supply a persistent store for
   * cross-process reuse.
   */
  store?: JudgeCacheStore;
  /** Max entries for the default in-memory store. Ignored when `store` is supplied. @default 1000 */
  max?: number;
}

/**
 * Compute the judge cache key for an input. REUSES {@link computeCacheKey} (and
 * therefore `canonicalize`) verbatim — the toolkit's single canonicalization
 * rule — so an object input is key-order-insensitive (`{answer,context}` ≡
 * `{context,answer}`) and a string input is trimmed + 全角-space-normalized. The
 * model and prompt version are the key's first two segments, exactly as the
 * `with-lru-cache` tool key pins tool name + index version.
 *
 * `input` is typed `unknown` because the decorator memoizes at the `JudgeFn`
 * boundary (a fully-built prompt STRING), while the key rule itself works for any
 * structured input a caller might key on.
 */
export function computeJudgeCacheKey(
  model: string,
  promptVersion: string,
  input: unknown,
): string {
  return computeCacheKey(model, promptVersion, input);
}

/**
 * Build a per-decorator in-memory LRU store. Process-ephemeral: it memoizes
 * within a run (and across configurations in a single benchmark sweep) but does
 * not survive process exit. The key is a hash, so no raw input text is retained.
 *
 * @throws when `max` is not a positive integer (mirrors `withLruCache`).
 */
export function createMemoryJudgeCacheStore(max = 1000): JudgeCacheStore {
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(
      `createMemoryJudgeCacheStore: max must be a positive integer, got ${String(max)}`,
    );
  }
  const lru = new LRUCache<string, string>({ max });
  return {
    get(key) {
      return lru.get(key);
    },
    set(key, value) {
      lru.set(key, value);
    },
  };
}

/**
 * Wrap a {@link JudgeFn} with an additive result cache. On a hit the cached
 * judge output is returned without calling the inner judge; on a miss the call
 * passes THROUGH to the real judge and its output is cached for next time.
 *
 * A judge REJECTION is never cached — the `await` throws before the write, so a
 * transient failure does not poison the cache (the next call re-drives the judge).
 * This mirrors `withLruCache`'s "don't cache an error" stance.
 *
 * The returned function is a drop-in `JudgeFn`: same `(prompt) => Promise<string>`
 * shape, no extra fields, safe to pass anywhere a raw judge is accepted.
 *
 * @throws when `model` or `promptVersion` is not a non-empty string (a blank
 *   segment would silently merge distinct models/prompts into one cache bucket).
 */
export function withJudgeCache(judgeFn: JudgeFn, opts: JudgeCacheOptions): JudgeFn {
  if (typeof judgeFn !== 'function') {
    throw new Error('withJudgeCache: judgeFn must be a function');
  }
  if (typeof opts.model !== 'string' || opts.model.trim() === '') {
    throw new Error('withJudgeCache: opts.model must be a non-empty string');
  }
  if (typeof opts.promptVersion !== 'string' || opts.promptVersion.trim() === '') {
    throw new Error('withJudgeCache: opts.promptVersion must be a non-empty string');
  }
  const store = opts.store ?? createMemoryJudgeCacheStore(opts.max);
  const { model, promptVersion } = opts;

  return async (prompt: string): Promise<string> => {
    const key = computeJudgeCacheKey(model, promptVersion, prompt);
    const hit = store.get(key);
    if (hit !== undefined) return hit;
    const result = await judgeFn(prompt);
    store.set(key, result);
    return result;
  };
}
