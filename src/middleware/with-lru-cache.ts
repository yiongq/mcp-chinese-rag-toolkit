import { createHash } from 'node:crypto';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { LRUCache } from 'lru-cache';
import type { CacheOptions, CacheStatus } from '../rag/types.js';

/**
 * Args keys that disable cache writes when present and `!== 'dev'`.
 * Architecture §缓存策略 L658. Currently a single-element set; future
 * additions (e.g. `'dryRun'`, `'force'`) APPEND ONLY — never replace the
 * constant shape, never expose runtime mutation.
 */
export const NON_CACHEABLE_ARGS = new Set<string>(['env']);

/**
 * Tool handler signature matching `createMcpServer`'s
 * {@link import('../server/create-mcp-server.js').McpToolDefinition.handler}.
 */
export type ToolHandler = (args: unknown) => Promise<CallToolResult> | CallToolResult;

/**
 * Canonicalize args for cache-key stability (architecture L630):
 *
 * 1. JSON keys recursively sorted, so `{a:1,b:2}` ≡ `{b:2,a:1}`.
 * 2. String values trimmed + 全角空格 `'　'` → 半角 `' '`.
 * 3. Case PRESERVED — `'Apple'` ≠ `'apple'` (proper-noun-sensitive; HR /
 *    modeling docs contain model numbers, customer names, factory names
 *    where case is identity, not formatting).
 * 4. Non-plain-object branches pass through unchanged (number / bool /
 *    null / array element order is meaningful and kept).
 *
 * Output is the canonical `JSON.stringify` of the normalized value.
 */
export function canonicalize(args: unknown): string {
  return JSON.stringify(normalizeValue(args));
}

function normalizeValue(v: unknown): unknown {
  if (typeof v === 'string') return v.trim().replace(/　/g, ' ');
  // BigInt → JSON.stringify throws an opaque TypeError; surface a friendly,
  // actionable error so caller knows to coerce to string before caching.
  if (typeof v === 'bigint') {
    throw new TypeError(
      'canonicalize: BigInt values are not cacheable — coerce to string before passing as a tool arg',
    );
  }
  if (Array.isArray(v)) return v.map(normalizeValue);
  if (v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const obj = v as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = normalizeValue(obj[k]);
        return acc;
      }, {});
  }
  return v;
}

/**
 * `sha256(toolName + ':' + indexVersion + ':' + canonicalize(args))` as
 * lowercase hex. The `':'` delimiter is contract — switching to `'|'` /
 * `';'` / unicode separators would break Story 2.7 cross-version eval
 * replay (cache keys recorded in fixtures must match new computations).
 */
export function computeCacheKey(toolName: string, indexVersion: string, args: unknown): string {
  return createHash('sha256')
    .update(`${toolName}:${indexVersion}:${canonicalize(args)}`)
    .digest('hex');
}

/**
 * Decide whether the just-computed `result` is eligible for cache write.
 * Returns `true` to SKIP write. Three orthogonal conditions (architecture
 * L632 / L680-686):
 *
 * 1. `result.isError === true` — re-running may yield a different
 *    (successful) outcome; caching the error would lock the user out.
 * 2. `result.structuredContent.confidence === 'low'` — low-confidence
 *    answers are dynamic state (eval threshold tuning, fixture churn);
 *    caching them would freeze the dynamic surface across reindexing.
 * 3. Any {@link NON_CACHEABLE_ARGS} key present in `args` AND `!== 'dev'`
 *    — `env=prod` / `env=test` etc. are write-side hints that the caller
 *    explicitly does NOT want cached. `env=dev` is the only allow-listed
 *    value; missing `env` field is also allowed (interpreted as "no
 *    environment hint"). Strict `!== 'dev'` comparison guards against
 *    `args.env = NaN` / `undefined` falling through to a wrong branch
 *    (Story 2.5 H2 lesson on strict-equality defenses).
 */
export function shouldSkipWrite(result: CallToolResult, args: unknown): boolean {
  if (result.isError === true) return true;
  // Only treat plain-object structuredContent as confidence-bearing; arrays /
  // primitives have no `.confidence` semantic. Trim + lowercase guards against
  // benign casing/whitespace variations (`'LOW'`, `'low '`) that would
  // otherwise wrongly cache a dynamic-confidence answer.
  const sc = result.structuredContent;
  if (sc !== null && typeof sc === 'object' && !Array.isArray(sc)) {
    const confidence = (sc as { confidence?: unknown }).confidence;
    if (typeof confidence === 'string' && confidence.trim().toLowerCase() === 'low') return true;
  }
  if (args !== null && typeof args === 'object' && !Array.isArray(args)) {
    const argsObj = args as Record<string, unknown>;
    for (const key of NON_CACHEABLE_ARGS) {
      if (!Object.hasOwn(argsObj, key)) continue;
      const v = argsObj[key];
      // Only non-empty string values trigger skip — `env: null/0/false/''`
      // are treated as "no environment hint" rather than "non-dev", matching
      // the spec intent that NON_CACHEABLE_ARGS only fires when the caller
      // explicitly names a meaningful non-dev environment string.
      if (typeof v === 'string' && v.length > 0 && v !== 'dev') return true;
    }
  }
  return false;
}

/**
 * Inject `structuredContent._meta.cache = status` without mutating the
 * input result. The `_meta` namespace (underscore prefix) avoids
 * collision with business fields; other `_meta.*` entries (e.g. Story
 * 2.7 `_meta.indexVersion`) are owned by their respective writers.
 *
 * Always called on BOTH read and write paths, so the
 * `structuredContent._meta.cache` field is guaranteed present and
 * accurate on every response that passes through {@link withLruCache} —
 * eval / OTel can rely on a binary contract instead of a truthy-or-
 * missing check.
 */
export function injectCacheMeta(result: CallToolResult, status: CacheStatus): CallToolResult {
  const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v);
  const rawSc = result.structuredContent;
  // Plain-object (or undefined) structuredContent → inject into
  // `structuredContent._meta.cache` (the documented contract location).
  // For undefined we fabricate `{ _meta: { cache } }` to keep the
  // "always-present" contract that eval/OTel rely on.
  if (rawSc === undefined || isPlainObject(rawSc)) {
    const sc = (rawSc ?? {}) as Record<string, unknown>;
    const rawMeta = sc._meta;
    // Guard `_meta` so non-object existing meta (string/number/array) isn't
    // spread into character-indexed garbage — drop it and start fresh.
    const existingMeta = isPlainObject(rawMeta) ? rawMeta : {};
    return {
      ...result,
      structuredContent: {
        ...sc,
        _meta: { ...existingMeta, cache: status },
      },
    };
  }
  // structuredContent is an array or primitive — preserve verbatim and
  // migrate the cache status to the result-level `_meta` (MCP allows
  // `_meta` at the top of `CallToolResult`). This avoids corrupting
  // array payloads (spreading `[a,b]` into `{0:a,1:b,_meta:...}` would
  // silently change the wire type).
  const rawTopMeta = (result as { _meta?: unknown })._meta;
  const existingTopMeta = isPlainObject(rawTopMeta) ? rawTopMeta : {};
  return {
    ...result,
    _meta: { ...existingTopMeta, cache: status },
  } as CallToolResult;
}

/**
 * Wrap a tool handler with the L0 LRU cache.
 *
 * Returns the original handler unchanged when `opts.enabled === false`
 * (zero-overhead pass-through; semantically distinct from omitting the
 * `cache` field on `createMcpServer`, which is the recommended path to
 * disable cache entirely). The cache instance is per-wrap — two calls
 * to `withLruCache` produce two independent LRU stores; do NOT share
 * across tools / index versions.
 *
 * Lifecycle: the LRUCache is GC-managed (no `dispose()` required); it
 * disappears with the wrapping closure when the parent
 * `createMcpServer` handle is closed.
 *
 * Throw vs envelope: this middleware re-throws inner-handler exceptions
 * (architecture §AI Agent 强制规则 #5 constrains *tool handler* boundary,
 * not middleware). The outer `wrapHandler` in `create-mcp-server.ts`
 * catches and converts to `INTERNAL_ERROR` envelope — see Task 4.5 wrap
 * order rationale ("cache inside, wrapHandler outside").
 */
export function withLruCache(
  toolName: string,
  handler: ToolHandler,
  opts: CacheOptions,
): ToolHandler {
  if (typeof toolName !== 'string' || toolName.trim().length === 0) {
    throw new Error('withLruCache: toolName must be a non-empty string');
  }
  if (typeof opts.indexVersion !== 'string' || opts.indexVersion.trim().length === 0) {
    throw new Error('withLruCache: opts.indexVersion must be a non-empty string');
  }
  if (opts.enabled === false) return handler;

  const max = opts.max ?? 500;
  const ttl = opts.ttlMs ?? 60 * 60 * 1000;
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(`withLruCache: opts.max must be a positive integer, got ${String(max)}`);
  }
  if (!Number.isInteger(ttl) || ttl < 1) {
    throw new Error(`withLruCache: opts.ttlMs must be a positive integer, got ${String(ttl)}`);
  }

  const cache = new LRUCache<string, CallToolResult>({ max, ttl });
  const indexVersion = opts.indexVersion;

  return async (args: unknown): Promise<CallToolResult> => {
    const key = computeCacheKey(toolName, indexVersion, args);

    const hit = cache.get(key);
    if (hit !== undefined) return injectCacheMeta(hit, 'hit');

    const result = await handler(args);
    if (!shouldSkipWrite(result, args)) {
      // Store WITHOUT the `_meta.cache` field — re-inject on every read so
      // the first miss-path response and subsequent hit-path responses
      // are byte-equal except for the cache status.
      cache.set(key, result);
    }
    return injectCacheMeta(result, 'miss');
  };
}
